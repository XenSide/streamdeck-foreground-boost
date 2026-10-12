'use strict';
/* Thin client for Elgato's local Audio Router (ws://127.0.0.1:1844). */
const WebSocket = require('ws');

const RPC_URL = 'ws://127.0.0.1:1844';
const JSONRPC = '2.0';

class AudioRouter {
	constructor(log) {
		this.log = log || (() => {});
		this.ws = null;
		this.ready = false;
		this.pending = new Map();
		this.reconnectTimer = null;
		this._connect();
	}
	_connect() {
		try { this.ws = new WebSocket(RPC_URL); }
		catch (e) { this.log('AR connect throw', e.message); this._scheduleReconnect(); return; }
		this.ws.on('open', () => { this.ready = true; this.log('Audio Router connected'); });
		this.ws.on('message', (d) => {
			let m; try { m = JSON.parse(d.toString()); } catch { return; }
			if (m && m.id != null && this.pending.has(m.id)) { const r = this.pending.get(m.id); this.pending.delete(m.id); r(m.result); }
		});
		this.ws.on('close', () => { this.ready = false; this.ws = null; this._scheduleReconnect(); });
		this.ws.on('error', (e) => this.log('Audio Router error', e && e.message));
	}
	_scheduleReconnect() {
		if (this.reconnectTimer) return;
		this.reconnectTimer = setTimeout(() => { this.reconnectTimer = null; if (!this.ready) this._connect(); }, 1500);
	}
	call(method, params) {
		return new Promise((resolve) => {
			if (!this.ready || !this.ws) return resolve(undefined);
			const id = Math.floor(1e9 * Math.random());
			this.pending.set(id, resolve);
			try { this.ws.send(JSON.stringify({ id, jsonrpc: JSONRPC, method, ...(params ? { params } : {}) })); }
			catch { this.pending.delete(id); return resolve(undefined); }
			setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); resolve(undefined); } }, 2000);
		});
	}
	async listApps() {
		const c = await this.call('getApplicationInstanceCount');
		const n = (c && c.count) || 0;
		const out = [];
		for (let i = 0; i < n; i++) {
			const a = await this.call('getApplicationInstanceAtIndex', { index: i });
			if (a && a.processID != null && saneVol(a.volume)) out.push(a);
		}
		return out;
	}
	// The server returns garbage for an unknown PID, so only trust a matching processID.
	async getByPid(pid) {
		const a = await this.call('getApplicationInstance', { processID: pid });
		return (a && a.processID === pid && saneVol(a.volume)) ? a : null;
	}
	async getIcon(pid) {
		const r = await this.call('getApplicationInstanceImage', { processID: pid, imageSize: 262244 });
		return (r && typeof r.image === 'string' && r.image.length > 16) ? r.image : null; // base64 ICO
	}
	// The server never answers set* calls, so awaiting a reply cost a 2s timeout per app.
	notify(method, params) {
		if (!this.ready || !this.ws) return Promise.resolve();
		try { this.ws.send(JSON.stringify({ id: Math.floor(1e9 * Math.random()), jsonrpc: JSONRPC, method, params })); } catch {}
		return Promise.resolve();
	}
	setVolume(pid, v) { return this.notify('setApplicationInstanceVolume', { processID: pid, volume: round2(v) }); }
	setMute(pid, mute) { return this.notify('setApplicationInstanceMute', { processID: pid, mute: !!mute }); }
}

const saneVol = (v) => typeof v === 'number' && isFinite(v) && v >= 0 && v <= 1;
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const round2 = (v) => parseFloat(clamp01(v).toFixed(2));
const baseName = (p) => { if (!p) return ''; const s = String(p).replace(/\\/g, '/'); return s.slice(s.lastIndexOf('/') + 1).toLowerCase(); };

module.exports = { AudioRouter, saneVol, clamp01, round2, baseName };
