'use strict';
/* Key colour themes. "default" follows the stock Stream Deck look (black, white, greys);
 * "duotone" follows the Duotone Essentials icon packs: muted background, one bright accent,
 * and a mid tone that is the accent at 40% over the background. */

const PRESETS = {
	blue: { bg: '#3b4c66', accent: '#67a4ff' },
	orange: { bg: '#6a5542', accent: '#ffb367' },
	purple: { bg: '#4e3d66', accent: '#b367ff' },
	red: { bg: '#623d46', accent: '#ff6783' },
};

const rgb = (h) => { const n = parseInt(String(h).replace('#', ''), 16) || 0; return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
const hex = (c) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
const mix = (a, b, t) => { const x = rgb(a), y = rgb(b); return hex(x.map((v, i) => v + (y[i] - v) * t)); };
const isHex = (h) => /^#[0-9a-f]{6}$/i.test(h || '');

/** settings: { style: 'default' | 'duotone', duoPreset, duoBg, duoAccent } */
function theme(s = {}) {
	if (s.style !== 'duotone') {
		return { bg: '#000000', fg: '#ffffff', dim: '#8a8a8a', track: '#333333', danger: '#e5484d' };
	}
	const p = s.duoPreset === 'custom' && isHex(s.duoBg) && isHex(s.duoAccent)
		? { bg: s.duoBg, accent: s.duoAccent }
		: PRESETS[s.duoPreset] || PRESETS.blue;
	const mid = mix(p.bg, p.accent, 0.4);
	return { bg: p.bg, fg: p.accent, dim: mid, track: mid, danger: p.accent };
}

module.exports = { theme, PRESETS };
