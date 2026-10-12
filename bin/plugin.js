'use strict';
/*
 * Foreground Boost - Stream Deck plugin backend (Node 20, CommonJS).
 * Toggle: each key boosts the focused app or a chosen app (volume ×(1+N%), every other app ×(1-N%));
 * one boost at a time, the same key again undoes the delta actually applied. State
 * survives restarts via a lock file. Key images are drawn live (app icon, amount),
 * in the default Stream Deck look or Duotone Essentials colours. Also starts the bundled
 * VolumeProxy (Foreground.exe); the exe holds a named mutex, so only one copy runs
 * even when several plugins launch it.
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const koffi = require('koffi');
const WebSocket = require('ws');
const { AudioRouter, baseName, clamp01 } = require('./lib/audiorouter');
const { decodeIcoToRgba, rgbaToPngBase64, duoIconRgba } = require('./lib/icondib');
const { theme } = require('./lib/theme');
const { keyImage } = require('./lib/keyimage');

const log = (...a) => { try { console.log(new Date().toISOString(), ...a); } catch {} };
process.on('uncaughtException', (e) => log('uncaught', e && e.stack || e));
process.on('unhandledRejection', (e) => log('unhandledRejection', e && e.stack || e));

// Bundled VolumeProxy, always run from one fixed path so mixers that match by full exe path
// (Volume Controller NEO) keep finding it, whichever plugin starts first. The exe holds a
// named mutex, so only one copy runs.
const PROXY_EXE = path.join(process.env.LOCALAPPDATA, 'VolumeProxy', 'Foreground.exe');
try {
	const src = path.join(__dirname, 'Foreground.exe');
	if (!fs.existsSync(PROXY_EXE) || fs.statSync(PROXY_EXE).size !== fs.statSync(src).size) {
		fs.mkdirSync(path.dirname(PROXY_EXE), { recursive: true });
		fs.copyFileSync(src, PROXY_EXE);
	}
} catch (e) { log('VolumeProxy copy', e.message); } // EBUSY: a copy is already running
try { spawn(PROXY_EXE, [], { detached: true, stdio: 'ignore' }).unref(); }
catch (e) { log('VolumeProxy spawn', e.message); }

/* ---------------------------------------------------------- Focused app */
const user32 = koffi.load('user32.dll');
const kernel32 = koffi.load('kernel32.dll');
const GetForegroundWindow = user32.func('void* __stdcall GetForegroundWindow()');
const GetWindowThreadProcessId = user32.func('uint32 __stdcall GetWindowThreadProcessId(void*, _Out_ uint32*)');
const OpenProcess = kernel32.func('void* __stdcall OpenProcess(uint32, bool, uint32)');
const CloseHandle = kernel32.func('bool __stdcall CloseHandle(void*)');
const QueryFullProcessImageNameW = kernel32.func('bool __stdcall QueryFullProcessImageNameW(void*, uint32, _Out_ uint16*, _Inout_ uint32*)');

const PostThreadMessageW = user32.func('bool __stdcall PostThreadMessageW(uint32, uint32, uintptr, intptr)');

function exeOf(pid) {
	const h = OpenProcess(0x1000 /* PROCESS_QUERY_LIMITED_INFORMATION */, false, pid);
	if (!h) return '';
	const buf = new Uint16Array(1024), len = [buf.length];
	const ok = QueryFullProcessImageNameW(h, 0, buf, len);
	CloseHandle(h);
	return ok ? baseName(Buffer.from(buf.buffer, 0, len[0] * 2).toString('utf16le')) : '';
}

function focused() {
	const pid = [0];
	GetWindowThreadProcessId(GetForegroundWindow(), pid);
	return { pid: pid[0], exe: exeOf(pid[0]) };
}

// Browsers/Discord play audio from a child process, not the window's: match the exe too.
const isApp = (a, f) => a.processID === f.pid || (!!f.exe && baseName(a.executableFile) === f.exe);

// "Focused app" keys show the focused app's icon. fgworker.js hooks EVENT_SYSTEM_FOREGROUND and
// sleeps in a Windows message loop (no CPU while idle). fgExe = last focused app with an audio
// session; an app that starts playing later is picked up on the next 3 s render tick.
let fgFocus = null, fgExe = '', fgPending = false, fgTid = 0;
async function matchFocus() {
	if (!fgFocus) return;
	const a = (await ar.listApps()).find((x) => baseName(x.executableFile) !== PROXY_NAME && isApp(x, fgFocus));
	fgPending = !a;
	if (a && a.executableFile !== fgExe) { fgExe = a.executableFile; renderAll(); }
}
try {
	const { Worker } = require('worker_threads');
	const w = new Worker(path.join(__dirname, 'fgworker.js'), { workerData: { koffi: require.resolve('koffi') } });
	w.on('message', (m) => { if (m.tid) fgTid = m.tid; else { fgFocus = { pid: m.pid, exe: exeOf(m.pid) }; matchFocus().catch((e) => log('focus', e.message)); } });
	w.on('error', (e) => log('focus worker', e.message));
	w.unref();
	// The worker blocks in GetMessageW; WM_QUIT ends its loop so the plugin can exit.
	process.on('exit', () => { if (fgTid) PostThreadMessageW(fgTid, 0x12, 0, 0); });
} catch (e) { log('focus worker', e.message); }

/* ---------------------------------------------------------------- Boost */
const ar = new AudioRouter(log);
const PROXY_NAME = 'foreground.exe'; // follows the focused app by itself: never touch it
const DEFAULT_STEP = 15; // percent; per-key "step" setting from the inspector
const LOCK_FILE = path.join(__dirname, 'foregroundboost.lock.json');
const boostCtx = new Map(); // context -> settings { target: '' = focused app | exe path, step }
// One boost at a time. owner = context of the key that turned it on.
let boosted = null; // pid -> applied delta while on; null when off
let owner = null;
let boostedExe = ''; // exe actually boosted, for the key image
try {
	const j = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8'));
	boosted = new Map(Array.isArray(j) ? j : j.deltas); // array = lock from before per-key targets
	owner = Array.isArray(j) ? null : j.owner;
	boostedExe = (!Array.isArray(j) && j.exe) || '';
} catch {}

function saveBoost() {
	try { if (boosted) fs.writeFileSync(LOCK_FILE, JSON.stringify({ owner, exe: boostedExe, deltas: [...boosted] })); else fs.rmSync(LOCK_FILE, { force: true }); }
	catch (e) { log('boost lock', e.message); }
}

// Press: undo the active boost, if any; then, unless this key owned it, apply this key's boost.
async function toggleBoost(ctx) {
	const apps = (await ar.listApps()).filter((a) => baseName(a.executableFile) !== PROXY_NAME);
	const wasOwner = boosted && (owner === ctx || !boostCtx.has(owner));
	if (boosted) {
		for (const a of apps) {
			const d = boosted.get(a.processID);
			if (d) { a.volume = clamp01(a.volume - d); await ar.setVolume(a.processID, a.volume); } // keep local copy current for a switch
		}
		boosted = null; owner = null; boostedExe = '';
	}
	if (!wasOwner) await applyBoost(ctx, apps);
	saveBoost();
	renderAll();
}

async function applyBoost(ctx, apps) {
	const s = boostCtx.get(ctx) || {};
	const step = (parseInt(s.step, 10) || DEFAULT_STEP) / 100;
	const byExe = (exe) => (a) => baseName(a.executableFile) === baseName(exe);
	let isTarget;
	if (s.target) isTarget = byExe(s.target);
	else {
		// The focused app; if it has no audio, the last focused one that has (what the key shows).
		const fg = focused();
		isTarget = (a) => isApp(a, fg);
		if (!apps.some(isTarget) && fgExe) isTarget = byExe(fgExe);
	}
	if (!apps.some(isTarget)) { showAlert(ctx); return; } // target app not playing audio
	boosted = new Map(); owner = ctx;
	boostedExe = apps.find(isTarget).executableFile;
	for (const a of apps) {
		// Relative: +N% of the app's own volume for the target, -N% for every other app.
		const target = clamp01(a.volume * (isTarget(a) ? 1 + step : 1 - step));
		await ar.setVolume(a.processID, target);
		boosted.set(a.processID, target - a.volume);
	}
}

async function sendAppsToPI(ctx) {
	const seen = new Set(), list = [];
	for (const a of await ar.listApps()) {
		const k = baseName(a.executableFile);
		if (!k || k === PROXY_NAME || seen.has(k)) continue;
		seen.add(k);
		list.push({ displayName: a.displayName || k.replace(/.exe$/, ''), executableFile: a.executableFile });
	}
	list.sort((x, y) => x.displayName.localeCompare(y.displayName));
	sdSend({ event: 'sendToPropertyInspector', context: ctx, payload: { apps: list } });
}

/* ------------------------------------------------------------ Key image */
const isOn = (ctx) => !!boosted && (owner === ctx || !boostCtx.has(owner));
const iconCache = new Map(); // exe|duotone colours -> base64 png or null
const lastImage = new Map(); // context -> data URI last sent

// t: key theme; in Duotone the icon is recoloured into the pack's two tones.
async function iconFor(exe, t) {
	const key = baseName(exe) + (t.duo ? '|' + t.sec + t.fg : '');
	if (iconCache.has(key)) return iconCache.get(key);
	const a = (await ar.listApps()).find((x) => baseName(x.executableFile) === baseName(exe));
	if (!a) return null; // not cached: retry once the app has a session
	let png = null;
	try {
		const ico = await ar.getIcon(a.processID);
		const dec = ico && decodeIcoToRgba(Buffer.from(ico, 'base64'));
		if (dec) png = rgbaToPngBase64(dec.width, dec.height, t.duo ? duoIconRgba(dec.rgba, t.sec, t.fg) : dec.rgba);
	} catch (e) { log('icon', e.message); }
	iconCache.set(key, png);
	return png;
}

async function render(ctx) {
	const s = boostCtx.get(ctx);
	if (!s) return;
	const on = isOn(ctx);
	const exe = on ? boostedExe : (s.target || fgExe); // ON: what is actually boosted; "focused": live focus
	const icon = exe ? await iconFor(exe, theme(s)) : null;
	const img = keyImage({ on, icon, step: parseInt(s.step, 10) || DEFAULT_STEP, settings: s });
	if (lastImage.get(ctx) === img) return;
	lastImage.set(ctx, img);
	sdSend({ event: 'setImage', context: ctx, payload: { image: img, target: 0 } });
}
const renderAll = () => { for (const c of boostCtx.keys()) render(c).catch((e) => log('render', e.message)); };

/* ---------------------------------------------------------- Stream Deck IO */
const args = {};
for (let i = 2; i < process.argv.length; i += 2) args[process.argv[i].replace(/^-/, '')] = process.argv[i + 1];
let sd = null;

function sdSend(o) { try { if (sd && sd.readyState === WebSocket.OPEN) sd.send(JSON.stringify(o)); } catch (e) { log('sdSend', e.message); } }
const showAlert = (ctx) => sdSend({ event: 'showAlert', context: ctx });

function onEvent({ event, context, payload }) {
	if (event === 'willAppear' || event === 'didReceiveSettings') { boostCtx.set(context, (payload && payload.settings) || {}); lastImage.delete(context); render(context).catch((e) => log('render', e.message)); }
	else if (event === 'willDisappear') { boostCtx.delete(context); lastImage.delete(context); }
	else if (event === 'propertyInspectorDidAppear' || (event === 'sendToPlugin' && payload && payload.kind === 'refreshApps')) sendAppsToPI(context).catch((e) => log('apps', e.message));
	else if (event === 'keyDown') toggleBoost(context).catch((e) => { log('boost', e.message); showAlert(context); });
}

if (!args.port) { log('No -port; not launched by Stream Deck. Exiting.'); process.exit(1); }
sd = new WebSocket('ws://127.0.0.1:' + args.port);
sd.on('open', () => { sdSend({ event: args.registerEvent, uuid: args.pluginUUID }); log('Registered with Stream Deck'); });
sd.on('message', (d) => { let m; try { m = JSON.parse(d.toString()); } catch { return; } onEvent(m); });
sd.on('close', () => { log('Stream Deck socket closed; exiting'); process.exit(0); });
sd.on('error', (e) => log('Stream Deck socket error', e && e.message));
// Picks up icons of apps that start playing later; unchanged images are not resent.
setInterval(() => { renderAll(); if (fgPending) matchFocus().catch(() => {}); }, 3000);
