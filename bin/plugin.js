'use strict';
/*
 * Foreground Boost - Stream Deck plugin backend (Node 20, CommonJS).
 * Toggle: the focused app +15, every other app -15; press again to undo the delta
 * actually applied. State survives restarts via a lock file. Also starts the bundled
 * VolumeProxy (Foreground.exe); the exe holds a named mutex, so only one copy runs
 * even when several plugins launch it.
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const koffi = require('koffi');
const WebSocket = require('ws');
const { AudioRouter, baseName, clamp01 } = require('./lib/audiorouter');

const log = (...a) => { try { console.log(new Date().toISOString(), ...a); } catch {} };
process.on('uncaughtException', (e) => log('uncaught', e && e.stack || e));
process.on('unhandledRejection', (e) => log('unhandledRejection', e && e.stack || e));

try { spawn(path.join(__dirname, 'Foreground.exe'), [], { detached: true, stdio: 'ignore' }).unref(); }
catch (e) { log('VolumeProxy spawn', e.message); }

/* ---------------------------------------------------------- Focused app */
const user32 = koffi.load('user32.dll');
const kernel32 = koffi.load('kernel32.dll');
const GetForegroundWindow = user32.func('void* __stdcall GetForegroundWindow()');
const GetWindowThreadProcessId = user32.func('uint32 __stdcall GetWindowThreadProcessId(void*, _Out_ uint32*)');
const OpenProcess = kernel32.func('void* __stdcall OpenProcess(uint32, bool, uint32)');
const CloseHandle = kernel32.func('bool __stdcall CloseHandle(void*)');
const QueryFullProcessImageNameW = kernel32.func('bool __stdcall QueryFullProcessImageNameW(void*, uint32, _Out_ uint16*, _Inout_ uint32*)');

function focused() {
	const pid = [0];
	GetWindowThreadProcessId(GetForegroundWindow(), pid);
	let exe = '';
	const h = OpenProcess(0x1000 /* PROCESS_QUERY_LIMITED_INFORMATION */, false, pid[0]);
	if (h) {
		const buf = new Uint16Array(1024), len = [buf.length];
		if (QueryFullProcessImageNameW(h, 0, buf, len)) exe = baseName(Buffer.from(buf.buffer, 0, len[0] * 2).toString('utf16le'));
		CloseHandle(h);
	}
	return { pid: pid[0], exe };
}

/* ---------------------------------------------------------------- Boost */
const ar = new AudioRouter(log);
const PROXY_EXE = 'foreground.exe'; // follows the focused app by itself: never touch it
const STEP = 0.15;
const LOCK_FILE = path.join(__dirname, 'foregroundboost.lock.json');
const boostCtx = new Set();
let boosted = null; // pid -> applied delta while on; null when off
try { boosted = new Map(JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8'))); } catch {}

function saveBoost() {
	try { if (boosted) fs.writeFileSync(LOCK_FILE, JSON.stringify([...boosted])); else fs.rmSync(LOCK_FILE, { force: true }); }
	catch (e) { log('boost lock', e.message); }
}

async function toggleBoost(ctx) {
	const apps = (await ar.listApps()).filter((a) => baseName(a.executableFile) !== PROXY_EXE);
	if (!apps.length) { showAlert(ctx); return; }
	if (boosted) {
		for (const a of apps) { const d = boosted.get(a.processID); if (d) await ar.setVolume(a.processID, a.volume - d); }
		boosted = null;
	} else {
		// Match the exe too: browsers/Discord play audio from a child process, not the window's.
		const fg = focused();
		const isFg = (a) => a.processID === fg.pid || (!!fg.exe && baseName(a.executableFile) === fg.exe);
		boosted = new Map();
		for (const a of apps) {
			const target = clamp01(a.volume + (isFg(a) ? STEP : -STEP));
			await ar.setVolume(a.processID, target);
			boosted.set(a.processID, target - a.volume);
		}
	}
	saveBoost();
	for (const c of boostCtx) setState(c);
}

/* ---------------------------------------------------------- Stream Deck IO */
const args = {};
for (let i = 2; i < process.argv.length; i += 2) args[process.argv[i].replace(/^-/, '')] = process.argv[i + 1];
let sd = null;

function sdSend(o) { try { if (sd && sd.readyState === WebSocket.OPEN) sd.send(JSON.stringify(o)); } catch (e) { log('sdSend', e.message); } }
const showAlert = (ctx) => sdSend({ event: 'showAlert', context: ctx });
const setState = (ctx) => sdSend({ event: 'setState', context: ctx, payload: { state: boosted ? 1 : 0 } });

function onEvent({ event, context }) {
	if (event === 'willAppear') { boostCtx.add(context); setState(context); }
	else if (event === 'willDisappear') boostCtx.delete(context);
	else if (event === 'keyDown') toggleBoost(context).catch((e) => { log('boost', e.message); showAlert(context); });
}

if (!args.port) { log('No -port; not launched by Stream Deck. Exiting.'); process.exit(1); }
sd = new WebSocket('ws://127.0.0.1:' + args.port);
sd.on('open', () => { sdSend({ event: args.registerEvent, uuid: args.pluginUUID }); log('Registered with Stream Deck'); });
sd.on('message', (d) => { let m; try { m = JSON.parse(d.toString()); } catch { return; } onEvent(m); });
sd.on('close', () => { log('Stream Deck socket closed; exiting'); process.exit(0); });
sd.on('error', (e) => log('Stream Deck socket error', e && e.message));
