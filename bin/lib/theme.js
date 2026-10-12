'use strict';
/* Key colour themes. "default" follows the stock Stream Deck look (black, white, greys);
 * "duotone" follows the Duotone Essentials icon packs (same palette as Volume Controller NEO):
 * muted background, a bright primary and a secondary tone (custom: primary at 40% over bg). */

const PRESETS = {
	blue: { bg: '#3b4c66', sec: '#4c70a3', accent: '#67a4ff' },
	orange: { bg: '#6a5542', sec: '#a67b50', accent: '#ffb367' },
	purple: { bg: '#4e3d66', sec: '#774ea3', accent: '#b367ff' },
	red: { bg: '#623d46', sec: '#a14e5d', accent: '#ff6783' },
};

const rgb = (h) => { const n = parseInt(String(h).replace('#', ''), 16) || 0; return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
const hex = (c) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
const mix = (a, b, t) => { const x = rgb(a), y = rgb(b); return hex(x.map((v, i) => v + (y[i] - v) * t)); };
const isHex = (h) => /^#[0-9a-f]{6}$/i.test(h || '');

/** settings: { style: 'default' | 'duotone', duoPreset, duoBg, duoAccent } */
function theme(s = {}) {
	if (s.style !== 'duotone') {
		return { duo: false, bg: '#000000', fg: '#ffffff', sec: '#8a8a8a', dim: '#8a8a8a', track: '#333333', danger: '#e5484d' };
	}
	const p = s.duoPreset === 'custom' && isHex(s.duoBg) && isHex(s.duoAccent)
		? { bg: s.duoBg, accent: s.duoAccent }
		: PRESETS[s.duoPreset] || PRESETS.blue;
	const sec = p.sec || mix(p.bg, p.accent, 0.4);
	return { duo: true, bg: p.bg, fg: p.accent, sec, dim: sec, track: sec, danger: p.accent };
}

module.exports = { theme, PRESETS };
