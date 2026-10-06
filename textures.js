// Procedural surface textures for the arenas (no image files needed).
// Everything is drawn on 2D canvases and tiles seamlessly; one tile covers TILE x TILE metres.
// This file has no three.js import so it can be previewed on its own.

export const TILE = 4;

const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);
export const hexToRgb = (h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255];
const rgbCss = (c, a = 1) => `rgba(${Math.round(clamp255(c[0]))},${Math.round(clamp255(c[1]))},${Math.round(clamp255(c[2]))},${a})`;
const shade = (c, f) => [c[0] * f, c[1] * f, c[2] * f];
const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeCanvas(S) {
  const c = document.createElement('canvas');
  c.width = S; c.height = S;
  return c;
}

/** Seamless fractal value noise, values 0..1, S x S. */
function fbm(S, seed, cells = 6, octaves = 3) {
  const out = new Float32Array(S * S);
  const r = rng(seed);
  let amp = 1, total = 0;
  for (let o = 0; o < octaves; o++) {
    const n = cells << o;
    const lat = new Float32Array(n * n);
    for (let i = 0; i < lat.length; i++) lat[i] = r();
    const step = n / S;
    for (let y = 0; y < S; y++) {
      const fy = y * step, y0 = Math.floor(fy), ty = fy - y0, sy = ty * ty * (3 - 2 * ty);
      const ya = (y0 % n) * n, yb = ((y0 + 1) % n) * n;
      for (let x = 0; x < S; x++) {
        const fx = x * step, x0 = Math.floor(fx), tx = fx - x0, sx = tx * tx * (3 - 2 * tx);
        const xa = x0 % n, xb = (x0 + 1) % n;
        const top = lat[ya + xa] + (lat[ya + xb] - lat[ya + xa]) * sx;
        const bot = lat[yb + xa] + (lat[yb + xb] - lat[yb + xa]) * sx;
        out[y * S + x] += (top + (bot - top) * sy) * amp;
      }
    }
    total += amp;
    amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

/** Fill with a base colour modulated by noise (amp = strength) and optional second colour blotches. */
function noisyFill(g, S, base, seed, amp = 0.28, cells = 6, second = null, secondAmt = 0.5) {
  const n = fbm(S, seed, cells, 4);
  const n2 = second ? fbm(S, seed + 77, cells + 2, 3) : null;
  const img = g.createImageData(S, S);
  const d = img.data;
  for (let i = 0, p = 0; i < n.length; i++, p += 4) {
    const k = 1 - amp + 2 * amp * n[i];
    let c = base;
    if (n2) c = mixc(base, second, clampT((n2[i] - 0.5) * 3 * secondAmt + 0.5 * secondAmt));
    d[p] = clamp255(c[0] * k); d[p + 1] = clamp255(c[1] * k); d[p + 2] = clamp255(c[2] * k); d[p + 3] = 255;
  }
  g.putImageData(img, 0, 0);
}
const clampT = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);

/** Fine sparkle / dirt grain on top. */
function grain(g, S, seed, count, lightA = 0.05, darkA = 0.08) {
  const r = rng(seed);
  for (let i = 0; i < count; i++) {
    g.fillStyle = r() < 0.5 ? `rgba(0,0,0,${darkA})` : `rgba(255,255,255,${lightA})`;
    const s = 1 + r() * 2.2;
    g.fillRect(r() * S, r() * S, s, s);
  }
}

/** Call draw(ox, oy) for the tile and its 8 neighbours so shapes crossing an edge wrap around. */
function wrap(S, draw) {
  for (const oy of [-S, 0, S]) for (const ox of [-S, 0, S]) draw(ox, oy);
}

// ---------------------------------------------------------------- structures
/** Brick / ashlar courses with per-block tone and bevels. */
function blocks(g, S, cols, rows, base, mortar, seed, { stagger = true, tone = 0.16, bevel = 0.2, gap = 3 } = {}) {
  const r = rng(seed);
  const w = S / cols, h = S / rows;
  for (let j = 0; j < rows; j++) {
    const off = stagger && j % 2 ? w / 2 : 0;
    for (let i = 0; i < cols; i++) {
      const x = i * w + off, y = j * h;
      const f = 1 + (r() - 0.5) * 2 * tone;
      const col = shade(base, f);
      wrap(S, (ox, oy) => {
        const px = x + ox, py = y + oy;
        if (px > S || py > S || px + w < 0 || py + h < 0) return;
        g.fillStyle = rgbCss(mixc(col, [0, 0, 0], 0));
        g.globalAlpha = 0.55;
        g.fillRect(px + gap / 2, py + gap / 2, w - gap, h - gap);
        g.globalAlpha = 1;
        // bevel: light top/left, dark bottom/right
        g.fillStyle = `rgba(255,255,255,${bevel * 0.5})`;
        g.fillRect(px + gap / 2, py + gap / 2, w - gap, 2);
        g.fillRect(px + gap / 2, py + gap / 2, 2, h - gap);
        g.fillStyle = `rgba(0,0,0,${bevel})`;
        g.fillRect(px + gap / 2, py + h - gap / 2 - 2, w - gap, 2);
        g.fillRect(px + w - gap / 2 - 2, py + gap / 2, 2, h - gap);
        // mortar lines
        g.strokeStyle = rgbCss(mortar, 0.9);
        g.lineWidth = gap;
        g.strokeRect(px, py, w, h);
      });
    }
  }
}

/** Large square slabs with thin grout. */
function slabs(g, S, n, grout, seed, tone = 0.1) {
  const r = rng(seed);
  const s = S / n;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const f = (r() - 0.5) * 2 * tone;
    g.fillStyle = f > 0 ? `rgba(255,255,255,${f})` : `rgba(0,0,0,${-f})`;
    g.fillRect(i * s, j * s, s, s);
  }
  g.strokeStyle = rgbCss(grout, 0.85);
  g.lineWidth = 3;
  for (let i = 0; i <= n; i++) {
    g.beginPath(); g.moveTo(i * s, 0); g.lineTo(i * s, S); g.moveTo(0, i * s); g.lineTo(S, i * s); g.stroke();
  }
}

/** Wandering mineral veins. */
function veins(g, S, color, count, seed, width = 2, alpha = 0.5) {
  const r = rng(seed);
  for (let i = 0; i < count; i++) {
    let x = r() * S, y = r() * S, a = r() * Math.PI * 2;
    const len = 30 + r() * 70;
    const w = width * (0.5 + r());
    wrap(S, (ox, oy) => {
      let px = x, py = y, pa = a;
      const rr = rng(seed * 31 + i);
      g.beginPath();
      g.moveTo(px + ox, py + oy);
      for (let k = 0; k < len; k++) {
        pa += (rr() - 0.5) * 0.7;
        px += Math.cos(pa) * 4; py += Math.sin(pa) * 4;
        g.lineTo(px + ox, py + oy);
      }
      g.strokeStyle = rgbCss(color, alpha);
      g.lineWidth = w;
      g.lineCap = 'round';
      g.stroke();
    });
  }
}

/** Dark jagged cracks (and optional glowing ones when drawn in a bright colour). */
function cracks(g, S, color, count, seed, width = 1.6, alpha = 0.7, maxLen = 40) {
  const r = rng(seed);
  for (let i = 0; i < count; i++) {
    const x0 = r() * S, y0 = r() * S, a0 = r() * Math.PI * 2;
    wrap(S, (ox, oy) => {
      const rr = rng(seed * 17 + i);
      let x = x0, y = y0, a = a0;
      g.beginPath();
      g.moveTo(x + ox, y + oy);
      const len = 12 + rr() * maxLen;
      for (let k = 0; k < len; k++) {
        a += (rr() - 0.5) * 1.3;
        x += Math.cos(a) * (3 + rr() * 4); y += Math.sin(a) * (3 + rr() * 4);
        g.lineTo(x + ox, y + oy);
        if (rr() < 0.06) { // branch
          g.moveTo(x + ox, y + oy);
          let bx = x, by = y, ba = a + (rr() < 0.5 ? 1 : -1) * 0.9;
          for (let m = 0; m < 6; m++) { ba += (rr() - 0.5) * 0.9; bx += Math.cos(ba) * 4; by += Math.sin(ba) * 4; g.lineTo(bx + ox, by + oy); }
          g.moveTo(x + ox, y + oy);
        }
      }
      g.strokeStyle = rgbCss(color, alpha);
      g.lineWidth = width;
      g.lineJoin = 'round';
      g.stroke();
    });
  }
}

/** Soft blotches (moss, rust, frost, soot). */
function blotches(g, S, color, count, seed, minR, maxR, alpha) {
  const r = rng(seed);
  for (let i = 0; i < count; i++) {
    const x = r() * S, y = r() * S, rad = minR + r() * (maxR - minR);
    wrap(S, (ox, oy) => {
      const grd = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, rad);
      grd.addColorStop(0, rgbCss(color, alpha));
      grd.addColorStop(1, rgbCss(color, 0));
      g.fillStyle = grd;
      g.fillRect(x + ox - rad, y + oy - rad, rad * 2, rad * 2);
    });
  }
}

/** Riveted metal plates. */
function plates(g, S, n, base, seed, rivet) {
  const r = rng(seed);
  const s = S / n;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const f = 0.82 + r() * 0.36;
    g.fillStyle = rgbCss(shade(base, f), 0.8);
    g.fillRect(i * s + 2, j * s + 2, s - 4, s - 4);
    g.fillStyle = 'rgba(255,255,255,.07)';
    g.fillRect(i * s + 2, j * s + 2, s - 4, 3);
    g.fillStyle = 'rgba(0,0,0,.35)';
    g.fillRect(i * s + 2, j * s + s - 5, s - 4, 3);
    for (const [dx, dy] of [[10, 10], [s - 10, 10], [10, s - 10], [s - 10, s - 10]]) {
      g.fillStyle = 'rgba(0,0,0,.45)';
      g.beginPath(); g.arc(i * s + dx + 1, j * s + dy + 1.5, 3.6, 0, 7); g.fill();
      g.fillStyle = rgbCss(rivet, 0.95);
      g.beginPath(); g.arc(i * s + dx, j * s + dy, 3.2, 0, 7); g.fill();
    }
  }
  g.strokeStyle = 'rgba(0,0,0,.7)';
  g.lineWidth = 3;
  for (let i = 0; i <= n; i++) {
    g.beginPath(); g.moveTo(i * s, 0); g.lineTo(i * s, S); g.moveTo(0, i * s); g.lineTo(S, i * s); g.stroke();
  }
}

/** Irregular rounded cobblestones. */
function cobbles(g, S, n, base, mortar, seed) {
  const r = rng(seed);
  const s = S / n;
  g.fillStyle = rgbCss(mortar, 0.95);
  g.fillRect(0, 0, S, S);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const cx = (i + 0.5 + (j % 2 ? 0.5 : 0) + (r() - 0.5) * 0.25) * s;
    const cy = (j + 0.5 + (r() - 0.5) * 0.2) * s;
    const rx = s * (0.42 + r() * 0.08), ry = s * (0.38 + r() * 0.08);
    const f = 0.75 + r() * 0.5;
    wrap(S, (ox, oy) => {
      const x = cx + ox, y = cy + oy;
      if (x < -s || y < -s || x > S + s || y > S + s) return;
      const grd = g.createRadialGradient(x - rx * 0.3, y - ry * 0.35, 2, x, y, Math.max(rx, ry));
      grd.addColorStop(0, rgbCss(shade(base, f * 1.25)));
      grd.addColorStop(1, rgbCss(shade(base, f * 0.7)));
      g.fillStyle = grd;
      g.beginPath(); g.ellipse(x, y, rx, ry, (r() - 0.5) * 0.6, 0, Math.PI * 2); g.fill();
    });
  }
}

/** Horizontal rock strata. */
function strata(g, S, count, base, seed) {
  const r = rng(seed);
  let y = 0;
  while (y < S) {
    const h = S / count * (0.5 + r());
    g.fillStyle = r() < 0.5 ? `rgba(255,255,255,${0.04 + r() * 0.06})` : `rgba(0,0,0,${0.05 + r() * 0.1})`;
    g.fillRect(0, y, S, h);
    g.strokeStyle = 'rgba(0,0,0,.28)';
    g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(0, y); g.lineTo(S, y + (r() - 0.5) * 4); g.stroke();
    y += h;
  }
}

/** Hex grid of tiles (metal floor grating). */
function hexes(g, S, cols, base, seed) {
  const r = rng(seed);
  const w = S / cols, rad = w / Math.sqrt(3), rowH = rad * 1.5;
  const rows = Math.round(S / rowH);
  const rh = S / rows;
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const cx = (i + 0.5 + (j % 2 ? 0.5 : 0)) * w, cy = (j + 0.5) * rh;
    wrap(S, (ox, oy) => {
      g.beginPath();
      for (let k = 0; k < 6; k++) {
        const a = Math.PI / 6 + k * Math.PI / 3;
        const px = cx + ox + Math.cos(a) * (rad * 0.93), py = cy + oy + Math.sin(a) * (rad * 0.93 * (rh / rowH));
        if (k === 0) g.moveTo(px, py); else g.lineTo(px, py);
      }
      g.closePath();
      g.fillStyle = rgbCss(shade(base, 0.8 + (i * 7 + j * 13) % 5 * 0.07), 0.75);
      g.fill();
      g.strokeStyle = 'rgba(0,0,0,.6)';
      g.lineWidth = 2.2;
      g.stroke();
    });
  }
}

// ---------------------------------------------------------------- canvases -> bump / emissive
/** Greyscale height map from a colour canvas (dark = low). */
function toBump(src, S, contrast = 1.6) {
  const c = makeCanvas(S);
  const g = c.getContext('2d');
  g.drawImage(src, 0, 0);
  const img = g.getImageData(0, 0, S, S);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const l = (d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11);
    const v = clamp255(128 + (l - 110) * contrast);
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  g.putImageData(img, 0, 0);
  return c;
}

function surface(S, paint, bump = 1.6) {
  const color = makeCanvas(S);
  const g = color.getContext('2d');
  paint(g, S);
  return { color, bump: toBump(color, S, bump) };
}

// ---------------------------------------------------------------- styles
// Each style paints: wall (main stone), wallDark (plinths / outer wall), sand (low walls), sandDark, floor.
// `T` = theme (hex numbers): marble, marbleDark, sand, sandDark, accent. `floor` is a css colour string.
const STYLES = {
  // Olympus: veined marble, sandstone ashlar, polished stone floor
  marble(S, T, floorCss) {
    const m = hexToRgb(T.marble), md = hexToRgb(T.marbleDark), sa = hexToRgb(T.sand), sd = hexToRgb(T.sandDark);
    const light = mixc(m, [255, 255, 255], 0.45);
    return {
      wall: surface(S, (g) => { noisyFill(g, S, m, 11, 0.12, 4, light, 0.4); blocks(g, S, 4, 8, m, shade(md, 0.4), 14, { tone: 0.13, gap: 6, bevel: 0.3 }); veins(g, S, light, 8, 12, 1.6, 0.35); cracks(g, S, shade(md, 0.45), 4, 13, 1.1, 0.5, 18); grain(g, S, 15, 1500); }, 2.0),
      wallDark: surface(S, (g) => { noisyFill(g, S, md, 21, 0.12, 4, shade(md, 1.35), 0.4); blocks(g, S, 4, 8, md, shade(md, 0.35), 24, { tone: 0.14, gap: 6, bevel: 0.3 }); veins(g, S, mixc(md, [255, 255, 255], 0.4), 6, 22, 1.4, 0.3); grain(g, S, 25, 1500); }, 2.0),
      sand: surface(S, (g) => { noisyFill(g, S, sa, 31, 0.2, 5, shade(sa, 1.25), 0.5); blocks(g, S, 4, 6, sa, shade(sd, 0.55), 32); cracks(g, S, shade(sd, 0.4), 5, 33, 1.2, 0.5, 20); grain(g, S, 34, 1800); }),
      sandDark: surface(S, (g) => { noisyFill(g, S, sd, 41, 0.2, 5); blocks(g, S, 4, 6, sd, shade(sd, 0.4), 42); grain(g, S, 44, 1800); }),
      floor: surface(S, (g) => { const fc = hexToRgb(parseInt(floorCss.slice(1), 16)); noisyFill(g, S, fc, 51, 0.16, 5, shade(fc, 1.3), 0.5); veins(g, S, mixc(fc, [255, 255, 255], 0.4), 7, 52, 1.6, 0.3); slabs(g, S, 1, shade(fc, 0.35), 53, 0.05); cracks(g, S, shade(fc, 0.35), 3, 54, 1.1, 0.5, 26); grain(g, S, 55, 2400); }, 1.2),
    };
  },
  // Foundry: riveted iron, scorched basalt, glowing floor cracks
  forge(S, T, floorCss) {
    const m = hexToRgb(T.marble), md = hexToRgb(T.marbleDark), sa = hexToRgb(T.sand), sd = hexToRgb(T.sandDark), ac = hexToRgb(T.accent);
    const fc = hexToRgb(parseInt(floorCss.slice(1), 16));
    const set = {
      wall: surface(S, (g) => { noisyFill(g, S, shade(m, 0.9), 111, 0.22, 4, [90, 60, 50], 0.5); plates(g, S, 2, shade(m, 0.95), 112, [150, 140, 135]); blotches(g, S, [110, 52, 24], 9, 113, 20, 60, 0.35); cracks(g, S, [20, 10, 8], 3, 114, 1.2, 0.5, 18); grain(g, S, 115, 1800); }),
      wallDark: surface(S, (g) => { noisyFill(g, S, shade(md, 0.9), 121, 0.2, 4); plates(g, S, 4, md, 122, [110, 100, 96]); blotches(g, S, [0, 0, 0], 8, 123, 20, 55, 0.35); grain(g, S, 124, 1800); }),
      sand: surface(S, (g) => { noisyFill(g, S, sa, 131, 0.28, 5, [30, 20, 18], 0.5); strata(g, S, 7, sa, 132); cracks(g, S, [15, 8, 6], 8, 133, 1.4, 0.7, 26); blotches(g, S, [255, 110, 30], 4, 134, 14, 30, 0.12); grain(g, S, 135, 2000); }),
      sandDark: surface(S, (g) => { noisyFill(g, S, sd, 141, 0.28, 5); strata(g, S, 6, sd, 142); cracks(g, S, [10, 5, 4], 6, 143, 1.3, 0.7, 24); grain(g, S, 144, 2000); }),
      floor: surface(S, (g) => { noisyFill(g, S, fc, 151, 0.22, 5, [18, 14, 14], 0.6); hexes(g, S, 4, fc, 152); cracks(g, S, [12, 6, 6], 5, 153, 1.4, 0.7, 22); grain(g, S, 154, 2600); }, 1.4),
    };
    // glowing cracks as an emissive layer for the floor
    const em = makeCanvas(S), eg = em.getContext('2d');
    eg.fillStyle = '#000'; eg.fillRect(0, 0, S, S);
    cracks(eg, S, mixc(ac, [255, 220, 120], 0.3), 7, 153, 2.4, 0.95, 30);
    set.floor.emissive = em;
    return set;
  },
  // Frostpeak: snow-dusted rock, ice, packed snow floor
  ice(S, T, floorCss) {
    const m = hexToRgb(T.marble), md = hexToRgb(T.marbleDark), sa = hexToRgb(T.sand), sd = hexToRgb(T.sandDark);
    const fc = hexToRgb(parseInt(floorCss.slice(1), 16));
    const white = [235, 244, 252];
    return {
      wall: surface(S, (g) => { noisyFill(g, S, m, 211, 0.24, 4, [170, 205, 235], 0.7); veins(g, S, white, 12, 212, 1.4, 0.55); cracks(g, S, [60, 90, 125], 6, 213, 1.4, 0.5, 30); blotches(g, S, white, 8, 214, 16, 50, 0.35); grain(g, S, 215, 1600, 0.12, 0.05); }, 1.4),
      wallDark: surface(S, (g) => { noisyFill(g, S, md, 221, 0.14, 4); blocks(g, S, 4, 8, md, [20, 34, 52], 222, { tone: 0.14, gap: 6, bevel: 0.3 }); blotches(g, S, white, 6, 223, 14, 40, 0.3); cracks(g, S, [20, 28, 40], 6, 224, 1.3, 0.55, 28); grain(g, S, 225, 1800); }),
      sand: surface(S, (g) => { noisyFill(g, S, sa, 231, 0.2, 5, white, 0.5); blocks(g, S, 3, 5, sa, [90, 110, 135], 232, { tone: 0.12 }); blotches(g, S, white, 10, 233, 14, 40, 0.4); grain(g, S, 234, 1800, 0.12, 0.04); }),
      sandDark: surface(S, (g) => { noisyFill(g, S, sd, 241, 0.2, 5); strata(g, S, 6, sd, 242); blotches(g, S, white, 6, 243, 14, 34, 0.3); grain(g, S, 244, 1800); }),
      floor: surface(S, (g) => { noisyFill(g, S, fc, 251, 0.1, 6, [150, 190, 225], 0.5); blotches(g, S, [255, 255, 255], 16, 252, 20, 60, 0.28); cracks(g, S, [90, 130, 175], 5, 253, 1.2, 0.35, 34); blotches(g, S, [70, 90, 120], 6, 254, 10, 26, 0.22); grain(g, S, 255, 3200, 0.2, 0.05); }, 1.0),
    };
  },
  // Labyrinth: old ochre brick with moss, flagstone floor
  brick(S, T, floorCss) {
    const m = hexToRgb(T.marble), md = hexToRgb(T.marbleDark), sa = hexToRgb(T.sand), sd = hexToRgb(T.sandDark);
    const fc = hexToRgb(parseInt(floorCss.slice(1), 16));
    const moss = [70, 100, 50];
    return {
      wall: surface(S, (g) => { noisyFill(g, S, shade(m, 0.8), 311, 0.22, 5); blocks(g, S, 4, 8, m, [30, 24, 16], 312, { tone: 0.2, gap: 6, bevel: 0.3 }); blotches(g, S, moss, 8, 313, 14, 36, 0.3); cracks(g, S, [25, 18, 10], 6, 314, 1.3, 0.55, 22); grain(g, S, 315, 2200); }),
      wallDark: surface(S, (g) => { noisyFill(g, S, md, 321, 0.22, 5); blocks(g, S, 2, 4, md, [14, 10, 6], 322, { tone: 0.18, gap: 6, bevel: 0.3 }); blotches(g, S, moss, 5, 323, 14, 30, 0.25); grain(g, S, 324, 2200); }),
      sand: surface(S, (g) => { noisyFill(g, S, sa, 331, 0.22, 5); blocks(g, S, 3, 6, sa, [24, 18, 10], 332, { tone: 0.2 }); blotches(g, S, moss, 6, 333, 12, 30, 0.28); cracks(g, S, [22, 16, 8], 5, 334, 1.2, 0.5, 18); grain(g, S, 335, 2000); }),
      sandDark: surface(S, (g) => { noisyFill(g, S, sd, 341, 0.22, 5); blocks(g, S, 3, 6, sd, [10, 7, 4], 342, { tone: 0.18 }); grain(g, S, 343, 2000); }),
      floor: surface(S, (g) => { noisyFill(g, S, fc, 351, 0.18, 5, shade(fc, 1.35), 0.4); slabs(g, S, 2, [12, 9, 6], 352, 0.12); blotches(g, S, moss, 7, 353, 16, 44, 0.22); cracks(g, S, [14, 10, 6], 6, 354, 1.3, 0.6, 26); grain(g, S, 355, 3000); }, 1.3),
    };
  },
  // Necropolis: weathered gravestone, moss, cobblestones
  crypt(S, T, floorCss) {
    const m = hexToRgb(T.marble), md = hexToRgb(T.marbleDark), sa = hexToRgb(T.sand), sd = hexToRgb(T.sandDark);
    const fc = hexToRgb(parseInt(floorCss.slice(1), 16));
    const moss = [58, 104, 78];
    return {
      wall: surface(S, (g) => { noisyFill(g, S, m, 411, 0.26, 4, [60, 70, 66], 0.5); blocks(g, S, 3, 6, m, [18, 22, 20], 412, { tone: 0.18, gap: 6, bevel: 0.3 }); blotches(g, S, moss, 12, 413, 16, 46, 0.34); cracks(g, S, [14, 18, 16], 8, 414, 1.4, 0.65, 30); grain(g, S, 415, 2200); }),
      wallDark: surface(S, (g) => { noisyFill(g, S, md, 421, 0.16, 4); blocks(g, S, 4, 8, md, [10, 14, 12], 422, { tone: 0.16, gap: 6, bevel: 0.3 }); blotches(g, S, moss, 8, 423, 14, 40, 0.3); cracks(g, S, [8, 12, 10], 6, 424, 1.3, 0.6, 26); grain(g, S, 425, 2200); }),
      sand: surface(S, (g) => { noisyFill(g, S, sa, 431, 0.24, 5, [70, 76, 70], 0.4); blocks(g, S, 3, 5, sa, [18, 20, 18], 432, { tone: 0.2 }); blotches(g, S, moss, 9, 433, 12, 34, 0.32); cracks(g, S, [12, 14, 12], 6, 434, 1.3, 0.55, 22); grain(g, S, 435, 2000); }),
      sandDark: surface(S, (g) => { noisyFill(g, S, sd, 441, 0.24, 5); blocks(g, S, 3, 5, sd, [8, 10, 9], 442, { tone: 0.18 }); blotches(g, S, moss, 5, 443, 12, 28, 0.25); grain(g, S, 444, 2000); }),
      floor: surface(S, (g) => { cobbles(g, S, 8, fc, [10, 14, 12], 451); noisyFill_overlay(g, S, 452); blotches(g, S, moss, 14, 453, 14, 38, 0.3); grain(g, S, 455, 3200); }, 1.5),
    };
  },
};

/** Multiply a soft noise layer over what is already drawn. */
function noisyFill_overlay(g, S, seed) {
  const n = fbm(S, seed, 6, 3);
  const img = g.getImageData(0, 0, S, S);
  const d = img.data;
  for (let i = 0, p = 0; i < n.length; i++, p += 4) {
    const k = 0.78 + n[i] * 0.44;
    d[p] = clamp255(d[p] * k); d[p + 1] = clamp255(d[p + 1] * k); d[p + 2] = clamp255(d[p + 2] * k);
  }
  g.putImageData(img, 0, 0);
}

/** Lava surface: dark crust with glowing orange-yellow channels. */
function lava(S) {
  const c = makeCanvas(S);
  const g = c.getContext('2d');
  const n = fbm(S, 901, 5, 4);
  const n2 = fbm(S, 902, 9, 3);
  const img = g.createImageData(S, S);
  const d = img.data;
  for (let i = 0, p = 0; i < n.length; i++, p += 4) {
    const v = Math.abs(n[i] - 0.5) * 2; // ridges at 0
    const glow = clampT(1 - v * 4.2);
    const crust = 0.25 + n2[i] * 0.3;
    d[p] = clamp255(35 + crust * 60 + 220 * glow); d[p + 1] = clamp255(8 + crust * 14 + 190 * glow * glow); d[p + 2] = clamp255(4 + 70 * glow * glow * glow); d[p + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}

/** Build every texture of one arena style. Returns canvases only: { wall, wallDark, sand, sandDark, floor, lava }. */
export function makeSurfaceSet(style, theme, floorCss, S = 512) {
  const make = STYLES[style] || STYLES.marble;
  const set = make(S, theme, floorCss);
  set.lava = { color: lava(256) };
  return set;
}
export const STYLE_NAMES = Object.keys(STYLES);
