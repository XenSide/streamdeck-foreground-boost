'use strict';
/* Foreground Boost key image (drawn as SVG, sent as a PNG data URI), in the key's theme (see theme.js).
 * Off: dimmed icon, amount in the muted tone. On: full icon, amount in a filled pill. */

const { Resvg } = require('@resvg/resvg-js');
const { theme } = require('./theme');

const FONT = 'font-family="Segoe UI,Arial,sans-serif" font-weight="700"';

// "Focused window" glyph: four corner brackets around a dot, in the 64px icon box.
const focusGlyph = (frame, dot) => `<g fill="none" stroke="${frame}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round">`
	+ '<path d="M44 34V22a4 4 0 0 1 4-4h12"/><path d="M84 18h12a4 4 0 0 1 4 4v12"/>'
	+ '<path d="M100 62v12a4 4 0 0 1-4 4H84"/><path d="M60 78H48a4 4 0 0 1-4-4V62"/></g>'
	+ `<circle cx="72" cy="48" r="9" fill="${dot}"/>`;

/** on: this key's boost is active. icon: base64 PNG, or null for the focused-app glyph. */
function keyImage({ on = false, icon = null, step = 15, settings }) {
	const t = theme(settings);
	const label = `+${step}%`;
	// Fixed-width pill: Stream Deck draws Segoe UI wider than browsers, so never size to the text.
	// Arrow on the left, label centred in the rest; "+100%" still fits with margin.
	const ink = on ? t.bg : t.dim; // label colour: on the pill when on, muted when off
	const p = ['<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">'];
	p.push(`<rect width="144" height="144" fill="${t.bg}"/>`);
	if (icon) p.push(`<image x="40" y="14" width="64" height="64" opacity="${on ? 1 : 0.45}" href="data:image/png;base64,${icon}"/>`);
	else p.push(`<g opacity="${on ? 1 : 0.45}">${focusGlyph(t.duo ? t.sec : t.fg, t.fg)}</g>`);
	if (on) p.push(`<rect x="12" y="95" width="120" height="36" rx="18" fill="${t.fg}"/>`);
	p.push(`<path d="M26 118l6-7 6 7" fill="none" stroke="${ink}" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>`);
	p.push(`<text x="84" y="121" text-anchor="middle" ${FONT} font-size="22" fill="${ink}">${label}</text>`);
	p.push('</svg>');
	return toPng(p.join(''));
}

// Sent as PNG: Stream Deck rasterizing an SVG with an embedded icon held back key events from a phone deck by up
// to 0.6 s. Only Segoe UI Bold is used, so load just that file (loading every system font is slow).
const FONT_OPTS = { font: { loadSystemFonts: false, fontFiles: ['C:/Windows/Fonts/segoeuib.ttf'], defaultFontFamily: 'Segoe UI' } };
function toPng(svg) {
	try {
		return 'data:image/png;base64,' + new Resvg(svg, FONT_OPTS).render().asPng().toString('base64');
	} catch {
		return 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
	}
}

module.exports = { keyImage };
