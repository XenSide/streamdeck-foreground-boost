// Decode an ICO (single/best entry) whose payload is a DIB, to {width,height,rgba}.
const { PNG } = require('pngjs');
function decodeIcoToRgba(buf) {
  const count = buf.readUInt16LE(4);
  if (!count) return null;
  // pick largest entry by (w*h, bpp)
  let best = null;
  for (let e = 0; e < count; e++) {
    const o = 6 + e * 16;
    const w = buf[o] || 256, h = buf[o+1] || 256;
    const size = buf.readUInt32LE(o+8), off = buf.readUInt32LE(o+12);
    const area = w * h;
    if (!best || area > best.area) best = { w, h, size, off, area };
  }
  const { off } = best;
  if (buf[off] === 0x89 && buf[off+1] === 0x50) { // embedded PNG
    const png = PNG.sync.read(buf.slice(off, off + best.size));
    return { width: png.width, height: png.height, rgba: png.data };
  }
  // DIB (BITMAPINFOHEADER)
  const hs = buf.readUInt32LE(off);
  const biW = buf.readInt32LE(off+4);
  let biH = buf.readInt32LE(off+8);
  const bpp = buf.readUInt16LE(off+14);
  const width = biW, height = Math.abs(biH) / 2; // ICO stores XOR+AND stacked
  const bottomUp = biH > 0;
  let p = off + hs;
  let palette = null;
  if (bpp <= 8) {
    const n = buf.readUInt32LE(off+32) || (1 << bpp);
    palette = [];
    for (let i = 0; i < n; i++) { palette.push([buf[p+2], buf[p+1], buf[p], 255]); p += 4; }
  }
  const rowXor = Math.ceil((width * bpp) / 32) * 4;
  const rgba = Buffer.alloc(width * height * 4);
  const xorStart = p;
  const andStart = p + rowXor * height;
  const rowAnd = Math.ceil(width / 32) * 4;
  for (let y = 0; y < height; y++) {
    const sy = bottomUp ? (height - 1 - y) : y;
    for (let x = 0; x < width; x++) {
      let r, g, b, a = 255;
      if (bpp === 32) { const o = xorStart + sy*rowXor + x*4; b=buf[o]; g=buf[o+1]; r=buf[o+2]; a=buf[o+3]; }
      else if (bpp === 24) { const o = xorStart + sy*rowXor + x*3; b=buf[o]; g=buf[o+1]; r=buf[o+2]; }
      else if (bpp === 8) { const idx = buf[xorStart + sy*rowXor + x]; const c = palette[idx]||[0,0,0,255]; r=c[0];g=c[1];b=c[2]; }
      else { r=g=b=0; }
      // AND mask (transparency) when no usable alpha
      if (bpp !== 32 || a === 0) {
        const byte = buf[andStart + sy*rowAnd + (x>>3)];
        const bit = (byte >> (7 - (x & 7))) & 1;
        if (bpp !== 32) a = bit ? 0 : 255;
      }
      const di = (y*width + x) * 4;
      rgba[di]=r; rgba[di+1]=g; rgba[di+2]=b; rgba[di+3]=a;
    }
  }
  return { width, height, rgba };
}
function rgbaToPngBase64(width, height, rgba) {
  const png = new PNG({ width, height });
  rgba.copy(png.data);
  return PNG.sync.write(png).toString('base64');
}
const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
// Duotone Essentials look (same as Volume Controller NEO): split the icon into its two
// best-separated luminance groups (Otsu) and paint them in the secondary / primary tone.
function duoIconRgba(rgba, sec, pri) {
  const S = hexRgb(sec), P = hexRgb(pri), d = Buffer.from(rgba);
  const L = (i) => (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255;
  let lo = 1, hi = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 128) { const l = L(i); lo = Math.min(lo, l); hi = Math.max(hi, l); }
  const span = Math.max(0.05, hi - lo), lum = (i) => (L(i) - lo) / span, hist = new Array(64).fill(0);
  let n = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 128) { hist[Math.min(63, Math.floor(64 * lum(i)))]++; n++; }
  let best = 0, cut = 0.5, w0 = 0, s0 = 0;
  const tot = hist.reduce((a, c, k) => a + c * k, 0);
  for (let k = 0; k < 63; k++) {
    w0 += hist[k]; s0 += hist[k] * k;
    const w1 = n - w0;
    if (!w0 || !w1) continue;
    const v = w0 * w1 * (s0 / w0 - (tot - s0) / w1) ** 2;
    if (v > best) { best = v; cut = (k + 1) / 64; }
  }
  for (let i = 0; i < d.length; i += 4) {
    const t = Math.min(1, Math.max(0, (lum(i) - cut) / 0.08 + 0.5)); // soft edge at the cut
    for (let k = 0; k < 3; k++) d[i + k] = Math.round(S[k] + (P[k] - S[k]) * t);
  }
  return d;
}
module.exports = { decodeIcoToRgba, rgbaToPngBase64, duoIconRgba };
