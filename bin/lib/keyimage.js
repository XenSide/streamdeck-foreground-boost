'use strict';
/* Foreground Boost key image as an SVG data URI, in the key's theme (see theme.js).
 * Off: dimmed icon, amount in the muted tone. On: full icon, amount in a filled pill. */

const { theme } = require('./theme');

const FONT = 'font-family="Arial,Helvetica,sans-serif" font-weight="700"';
// Arial Bold advance widths at 22px, to centre the arrow + label as one group.
const textWidth = (s) => [...s].reduce((w, c) => w + (c === '%' ? 19.6 : c === '+' ? 12.8 : 12.2), 0);

// "Focused window" glyph: four corner brackets around a dot, in the 64px icon box.
const focusGlyph = (c) => `<g fill="none" stroke="${c}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round">`
	+ '<path d="M44 34V22a4 4 0 0 1 4-4h12"/><path d="M84 18h12a4 4 0 0 1 4 4v12"/>'
	+ '<path d="M100 62v12a4 4 0 0 1-4 4H84"/><path d="M60 78H48a4 4 0 0 1-4-4V62"/></g>'
	+ `<circle cx="72" cy="48" r="9" fill="${c}"/>`;

/** on: this key's boost is active. icon: base64 PNG, or null for the focused-app glyph. */
function keyImage({ on = false, icon = null, step = 15, settings }) {
	const t = theme(settings);
	const label = `+${step}%`;
	const arrowW = 12, gap = 5, w = arrowW + gap + textWidth(label), x0 = 72 - w / 2;
	const ink = on ? t.bg : t.dim; // label colour: on the pill when on, muted when off
	const p = ['<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">'];
	p.push(`<rect width="144" height="144" fill="${t.bg}"/>`);
	if (icon) p.push(`<image x="40" y="14" width="64" height="64" opacity="${on ? 1 : 0.45}" href="data:image/png;base64,${icon}"/>`);
	else p.push(focusGlyph(on ? t.fg : t.dim));
	if (on) p.push(`<rect x="${x0 - 12}" y="96" width="${w + 24}" height="34" rx="17" fill="${t.fg}"/>`);
	p.push(`<path d="M${x0} 118l6-7 6 7" fill="none" stroke="${ink}" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>`);
	p.push(`<text x="${x0 + arrowW + gap}" y="121" ${FONT} font-size="22" fill="${ink}">${label}</text>`);
	p.push('</svg>');
	return 'data:image/svg+xml;base64,' + Buffer.from(p.join('')).toString('base64');
}

module.exports = { keyImage };
