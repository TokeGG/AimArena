// Detailed, non-blocky sci-fi armoured soldier, built procedurally from core three.js primitives.
// Every part is transformed and merged per material, so one character is <= 7 meshes.
//
// Conventions: origin at the feet, faces -Z, gun hand on +X. Everything stays inside a
// cylinder of radius 0.5 and height 1.8.
import * as THREE from 'three';

const PI = Math.PI;
// Level of detail: 1 = full, ~0.55 on 'Fast' graphics (fewer segments on every round part). Applies to characters built afterwards.
let DETAIL = 1;
export function setCharacterDetail(v) { DETAIL = Math.max(0.4, Math.min(1, Number(v) || 1)); }
const sg = (n, min = 4) => Math.max(min, Math.round(n * DETAIL));
const HELMS = 8, SHOULDERS = 6, BACKS = 7, MATS = 8;
const HEXRE = /^#[0-9a-f]{6}$/i;
const MODEL_NAMES = ['striker', 'vanguard', 'phantom', 'warden'];

// ---------------------------------------------------------------- body style table
// Heights (ankle/knee/hip/waist/chest/neck/head) are shared by every style, so hitboxes match.
const STYLES = {
  striker: { sx: 0.235, chest: [0.19, 0.19, 0.125], waist: 0.115, hip: 0.165, hx: 0.095, thigh: 0.082, shin: 0.06, arm: 0.048, fore: 0.054, hs: 1.0, vw: 1.0, pk: 1.0 },
  vanguard: { sx: 0.3, chest: [0.25, 0.205, 0.16], waist: 0.14, hip: 0.19, hx: 0.115, thigh: 0.095, shin: 0.07, arm: 0.062, fore: 0.07, hs: 1.08, vw: 1.1, pk: 1.25 },
  phantom: { sx: 0.19, chest: [0.15, 0.18, 0.095], waist: 0.09, hip: 0.135, hx: 0.08, thigh: 0.066, shin: 0.048, arm: 0.038, fore: 0.04, hs: 0.93, vw: 0.7, pk: 0.8 },
  warden: { sx: 0.215, chest: [0.17, 0.185, 0.115], waist: 0.105, hip: 0.15, hx: 0.085, thigh: 0.075, shin: 0.055, arm: 0.045, fore: 0.049, hs: 1.0, vw: 1.0, pk: 0.95 },
};
const HEAD_Y = 1.585; // head centre

// ---------------------------------------------------------------- look helpers
const clampIdx = (v, n) => (Number.isFinite(v) ? Math.max(0, Math.min(n - 1, Math.floor(v))) : 0);
const hexOr = (v, d) => (typeof v === 'string' && HEXRE.test(v) ? v.toLowerCase() : d);

function normLook(look) {
  const r = look && typeof look === 'object' ? look : {};
  return {
    model: MODEL_NAMES.includes(r.model) ? r.model : 'striker',
    helm: clampIdx(r.helm, HELMS),
    shoulder: clampIdx(r.shoulder, SHOULDERS),
    back: clampIdx(r.back, BACKS),
    mat: clampIdx(r.mat, MATS),
    c1: hexOr(r.c1, '#2b2f3a'),
    c2: hexOr(r.c2, '#14161c'),
    glow: hexOr(r.glow, '#35e0ff'),
  };
}

/** String that changes whenever the look changes. */
export function lookKey(look) {
  const l = normLook(look);
  return `${DETAIL}|${l.model}|${l.helm}|${l.shoulder}|${l.back}|${l.mat}|${l.c1}|${l.c2}|${l.glow}`;
}

// ---------------------------------------------------------------- colour + PRNG utils
function hexRgb(h) {
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}
function mixRgb(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
function css(c, a = 1) {
  const q = (v) => Math.max(0, Math.min(255, Math.round(v)));
  return `rgba(${q(c[0])},${q(c[1])},${q(c[2])},${a})`;
}
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashStr(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 33) + s.charCodeAt(i)) >>> 0;
  return h;
}

// ---------------------------------------------------------------- procedural armour textures
const TEX_SIZE = 128;
const TEX_CACHE_MAX = 64;
const texCache = new Map(); // key -> { map, emissive } | null (shared, never disposed by disposeCharacter)

function drawTextures(look) {
  if (typeof document === 'undefined' || !document.createElement) return null;
  const S = TEX_SIZE;
  const mk = () => {
    const cv = document.createElement('canvas');
    cv.width = S; cv.height = S;
    const ctx = cv.getContext && cv.getContext('2d');
    return ctx ? { cv, ctx } : null;
  };
  const base = mk();
  if (!base) return null;
  const { ctx } = base;
  const c1 = hexRgb(look.c1), c2 = hexRgb(look.c2), gl = hexRgb(look.glow);
  const black = [0, 0, 0], white = [255, 255, 255];
  const rng = mulberry32(hashStr(`${look.mat}|${look.c1}|${look.c2}|${look.glow}`));
  let emi = null;
  let repeat = [1, 1];

  ctx.fillStyle = css(c1);
  ctx.fillRect(0, 0, S, S);

  if (look.mat === 0) { // Alloy: smooth paint with speckle
    const g = ctx.createLinearGradient(0, 0, 0, S);
    g.addColorStop(0, css(mixRgb(c1, white, 0.08)));
    g.addColorStop(1, css(mixRgb(c1, black, 0.1)));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
    for (let i = 0; i < 700; i++) {
      const light = rng() < 0.5;
      ctx.fillStyle = css(light ? white : black, 0.03 + rng() * 0.07);
      ctx.fillRect(Math.floor(rng() * S), Math.floor(rng() * S), 1, 1);
    }
  } else if (look.mat === 1) { // Brushed steel: horizontal streaks
    for (let i = 0; i < 420; i++) {
      const y = Math.floor(rng() * S), x = Math.floor(rng() * S), w = 12 + Math.floor(rng() * 70);
      ctx.fillStyle = css(rng() < 0.5 ? white : black, 0.04 + rng() * 0.12);
      ctx.fillRect(x, y, w, 1);
      if (x + w > S) ctx.fillRect(0, y, x + w - S, 1);
    }
  } else if (look.mat === 2) { // Carbon weave: twill
    const shades = [mixRgb(c1, black, 0.55), mixRgb(c1, black, 0.35), mixRgb(c1, black, 0.5), mixRgb(c1, black, 0.7)];
    const cell = 8;
    for (let gy = 0; gy < S / cell; gy++) {
      for (let gx = 0; gx < S / cell; gx++) {
        const k = (gx + gy) % 4;
        ctx.fillStyle = css(shades[k]);
        ctx.fillRect(gx * cell, gy * cell, cell, cell);
        ctx.fillStyle = css(mixRgb(shades[k], white, 0.14), 0.7);
        if ((gx + gy) % 2 === 0) ctx.fillRect(gx * cell, gy * cell + 1, cell, 3);
        else ctx.fillRect(gx * cell + 1, gy * cell, 3, cell);
      }
    }
    repeat = [2, 2];
  } else if (look.mat === 3) { // Hex plating
    const R = 9.2, w = Math.sqrt(3) * R, rowH = 1.5 * R;
    ctx.lineWidth = 1.6;
    for (let row = -1; row < S / rowH + 1; row++) {
      for (let col = -1; col < S / w + 1; col++) {
        const cx = col * w + (row & 1 ? w / 2 : 0), cy = row * rowH;
        ctx.beginPath();
        for (let k = 0; k < 6; k++) {
          const a = PI / 6 + (k * PI) / 3;
          const px = cx + Math.cos(a) * (R - 0.6), py = cy + Math.sin(a) * (R - 0.6);
          if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fillStyle = css(mixRgb(c1, rng() < 0.5 ? white : black, 0.04 + rng() * 0.1));
        ctx.fill();
        ctx.strokeStyle = css(mixRgb(c1, black, 0.65));
        ctx.stroke();
      }
    }
    repeat = [2, 2];
  } else if (look.mat === 4) { // Camo blotches
    const mid = mixRgb(c1, c2, 0.5), dark = mixRgb(c1, black, 0.35);
    const cols = [c2, mid, dark];
    for (let i = 0; i < 46; i++) {
      const x = rng() * S, y = rng() * S, rx = 8 + rng() * 22, ry = 6 + rng() * 14, rot = rng() * PI;
      ctx.fillStyle = css(cols[i % 3]);
      for (const ox of [-S, 0, S]) {
        for (const oy of [-S, 0, S]) {
          const px = x + ox, py = y + oy;
          if (px + rx < 0 || px - rx > S || py + rx < 0 || py - rx > S) continue;
          ctx.save();
          ctx.translate(px, py);
          ctx.rotate(rot);
          ctx.scale(1, ry / rx);
          ctx.beginPath();
          ctx.arc(0, 0, rx, 0, PI * 2);
          ctx.fill();
          ctx.restore();
        }
      }
    }
    repeat = [2, 2];
  } else if (look.mat === 6) { // Gilded: polished gold over your primary colour
    const gold = [226, 184, 72];
    const base0 = mixRgb(c1, gold, 0.8);
    const g = ctx.createLinearGradient(0, 0, S, S);
    g.addColorStop(0, css(mixRgb(base0, white, 0.25)));
    g.addColorStop(0.5, css(mixRgb(base0, black, 0.15)));
    g.addColorStop(1, css(mixRgb(base0, white, 0.18)));
    ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
    for (let i = 0; i < 6; i++) { // wide diagonal sheen bands
      const x = rng() * S;
      ctx.fillStyle = css(white, 0.08 + rng() * 0.1);
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + 14, 0); ctx.lineTo(x + 14 - S * 0.4, S); ctx.lineTo(x - S * 0.4, S); ctx.fill();
    }
    ctx.strokeStyle = css(mixRgb(base0, black, 0.5), 0.7); ctx.lineWidth = 1.2;
    for (let i = 0; i <= S; i += 32) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, S); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(S, i); ctx.stroke(); }
    for (let i = 0; i < 300; i++) { ctx.fillStyle = css(rng() < 0.5 ? white : black, 0.03 + rng() * 0.06); ctx.fillRect(Math.floor(rng() * S), Math.floor(rng() * S), 1, 1); }
    repeat = [2, 2];
  } else if (look.mat === 7) { // Void: dark nebula with glowing stars
    ctx.fillStyle = css(mixRgb(c1, black, 0.82)); ctx.fillRect(0, 0, S, S);
    for (let i = 0; i < 9; i++) {
      const x = rng() * S, y = rng() * S, r = 22 + rng() * 34;
      const gr = ctx.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, css(i % 2 ? c2 : gl, 0.32)); gr.addColorStop(1, css(black, 0));
      ctx.fillStyle = gr; ctx.fillRect(0, 0, S, S);
    }
    emi = mk();
    if (emi) { emi.ctx.fillStyle = '#000'; emi.ctx.fillRect(0, 0, S, S); }
    for (let i = 0; i < 60; i++) {
      const x = Math.floor(rng() * S), y = Math.floor(rng() * S), big = rng() < 0.2;
      ctx.fillStyle = css(white, 0.9); ctx.fillRect(x, y, big ? 2 : 1, big ? 2 : 1);
      if (emi) { emi.ctx.fillStyle = css(mixRgb(gl, white, 0.5), 1); emi.ctx.fillRect(x, y, big ? 2 : 1, big ? 2 : 1); }
    }
    repeat = [2, 2];
  } else { // Molten: dark rock plates with glowing cracks
    const rock = mixRgb(c1, black, 0.55);
    ctx.fillStyle = css(rock);
    ctx.fillRect(0, 0, S, S);
    for (let i = 0; i < 30; i++) {
      const x = rng() * S, y = rng() * S, r = 7 + rng() * 16;
      ctx.fillStyle = css(mixRgb(c1, black, 0.2 + rng() * 0.5), 0.7);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, PI * 2);
      ctx.fill();
      ctx.strokeStyle = css(black, 0.5);
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    const cracks = [];
    for (let i = 0; i < 8; i++) {
      let x = rng() * S, y = rng() * S, a = rng() * PI * 2;
      const pts = [[x, y]];
      for (let s = 0; s < 14; s++) {
        a += (rng() - 0.5) * 1.2;
        x += Math.cos(a) * 9; y += Math.sin(a) * 9;
        pts.push([x, y]);
        if (s === 6 && rng() < 0.6) {
          let bx = x, by = y, ba = a + (rng() < 0.5 ? 0.9 : -0.9);
          const br = [[bx, by]];
          for (let t = 0; t < 6; t++) {
            ba += (rng() - 0.5) * 1.0;
            bx += Math.cos(ba) * 8; by += Math.sin(ba) * 8;
            br.push([bx, by]);
          }
          cracks.push(br);
        }
      }
      cracks.push(pts);
    }
    const strokeCracks = (cx2, core, lw) => {
      cx2.lineCap = 'round'; cx2.lineJoin = 'round';
      for (const pts of cracks) {
        cx2.beginPath();
        cx2.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length; i++) cx2.lineTo(pts[i][0], pts[i][1]);
        cx2.strokeStyle = core; cx2.lineWidth = lw;
        cx2.stroke();
      }
    };
    strokeCracks(ctx, css(gl, 0.95), 2.6);
    strokeCracks(ctx, css(mixRgb(gl, white, 0.6), 0.9), 1);
    emi = mk();
    if (emi) {
      emi.ctx.fillStyle = '#000';
      emi.ctx.fillRect(0, 0, S, S);
      strokeCracks(emi.ctx, css(gl, 1), 2.6);
      strokeCracks(emi.ctx, css(mixRgb(gl, white, 0.6), 1), 1);
    }
    repeat = [2, 2];
  }

  const finish = (cv) => {
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
    return t;
  };
  return { map: finish(base.cv), emissive: emi ? finish(emi.cv) : null };
}

function getTextures(look) {
  if (typeof document === 'undefined') return null;
  const key = `${look.mat}|${look.c1}|${look.c2}|${look.mat === 5 || look.mat === 7 ? look.glow : ''}`;
  if (texCache.has(key)) return texCache.get(key);
  let res = null;
  try { res = drawTextures(look); } catch (e) { res = null; }
  texCache.set(key, res);
  if (texCache.size > TEX_CACHE_MAX) {
    const oldest = texCache.keys().next().value;
    const old = texCache.get(oldest);
    texCache.delete(oldest);
    if (old) { old.map.dispose(); if (old.emissive) old.emissive.dispose(); }
  }
  return res;
}

// ---------------------------------------------------------------- geometry merge (core three only)
function mergeGeometries(list) {
  let vc = 0, ic = 0;
  for (const g of list) {
    const pos = g.getAttribute('position');
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(pos.count * 2), 2));
    if (!g.index) {
      const a = new Uint32Array(pos.count);
      for (let i = 0; i < a.length; i++) a[i] = i;
      g.setIndex(new THREE.BufferAttribute(a, 1));
    }
    vc += pos.count;
    ic += g.index.count;
  }
  const P = new Float32Array(vc * 3), N = new Float32Array(vc * 3), U = new Float32Array(vc * 2);
  const I = vc > 65535 ? new Uint32Array(ic) : new Uint16Array(ic);
  let vo = 0, io = 0;
  for (const g of list) {
    const pos = g.getAttribute('position'), nor = g.getAttribute('normal'), uv = g.getAttribute('uv');
    P.set(pos.array, vo * 3);
    N.set(nor.array, vo * 3);
    U.set(uv.array, vo * 2);
    const idx = g.index.array;
    for (let i = 0; i < idx.length; i++) I[io + i] = idx[i] + vo;
    vo += pos.count;
    io += idx.length;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(P, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(U, 2));
  out.setIndex(new THREE.BufferAttribute(I, 1));
  return out;
}

// ---------------------------------------------------------------- part kit
const ZERO = [0, 0, 0], ONE = [1, 1, 1];
const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const mir = (p) => [-p[0], p[1], p[2]];
function mx(p, r, s) {
  _e.set(r[0], r[1], r[2], 'XYZ');
  _q.setFromEuler(_e);
  return new THREE.Matrix4().compose(_p.set(p[0], p[1], p[2]), _q, _s.set(s[0], s[1], s[2]));
}
const vec3 = (v) => (Array.isArray(v) ? v : [v, v, v]);

class Kit {
  constructor() { this.lists = {}; }
  push(slot, geo, m) {
    geo.applyMatrix4(m);
    (this.lists[slot] || (this.lists[slot] = [])).push(geo);
  }
  /** Place geometry; o.m mirrors it across x = 0. */
  put(slot, geo, p, r, s, m) {
    if (m) this.push(slot, geo.clone(), mx(mir(p), [r[0], -r[1], -r[2]], s));
    this.push(slot, geo, mx(p, r, s));
  }
  blob(slot, p, rad, o = {}) {
    this.put(slot, new THREE.SphereGeometry(1, sg(o.w || 10, 5), sg(o.h || 7, 3)), p, o.r || ZERO, vec3(rad), o.m);
  }
  cyl(slot, p, rt, rb, h, o = {}) {
    this.put(slot, new THREE.CylinderGeometry(rt, rb, h, sg(o.n || 8), 1, !!o.open), p, o.r || ZERO, o.s || ONE, o.m);
  }
  torus(slot, p, R, tube, o = {}) {
    this.put(slot, new THREE.TorusGeometry(R, tube, sg(o.rs || 6, 3), sg(o.ts || 14, 6), o.arc || PI * 2), p, o.r || ZERO, o.s || ONE, o.m);
  }
  box(slot, p, w, h, d, o = {}) {
    this.put(slot, new THREE.BoxGeometry(w, h, d), p, o.r || ZERO, o.s || ONE, o.m);
  }
  /** Tapered limb from a (radius ra) to b (radius rb). o.flat squashes the local z (cloth strips). */
  seg(slot, a, b, ra, rb, o = {}) {
    if (o.m) this.seg(slot, mir(a), mir(b), ra, rb, { ...o, m: false });
    const A = new THREE.Vector3(a[0], a[1], a[2]);
    const d = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const len = d.length();
    if (len < 1e-6) return;
    const q = new THREE.Quaternion().setFromUnitVectors(_up, d.clone().normalize());
    const mid = A.clone().addScaledVector(d, 0.5);
    const geo = new THREE.CylinderGeometry(rb, ra, len, sg(o.n || 8), 1, !!o.open);
    this.push(slot, geo, new THREE.Matrix4().compose(mid, q, new THREE.Vector3(1, 1, o.flat || 1)));
  }
  /** Cone with its base centre at `base`, pointing along `dir`. */
  cone(slot, base, dir, rad, len, o = {}) {
    if (o.m) this.cone(slot, mir(base), mir(dir), rad, len, { ...o, m: false });
    const d = new THREE.Vector3(dir[0], dir[1], dir[2]).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(_up, d);
    const c = new THREE.Vector3(base[0], base[1], base[2]).addScaledVector(d, len / 2);
    const geo = new THREE.ConeGeometry(rad, len, sg(o.n || 6, 3), 1);
    this.push(slot, geo, new THREE.Matrix4().compose(c, q, new THREE.Vector3(1, 1, o.flat || 1)));
  }
  /** Lathe surface of revolution (profile ascends in y so the outside faces out). */
  lathe(slot, pts, segs, phiStart, phiLen, s) {
    const v = pts.map((p) => new THREE.Vector2(p[0], p[1]));
    this.put(slot, new THREE.LatheGeometry(v, sg(segs, 6), phiStart, phiLen), ZERO, ZERO, s || ONE, false);
  }
}

// ---------------------------------------------------------------- body
function buildBody(K, L, st) {
  const { sx, chest, waist, hip, hx, thigh, shin, arm, fore } = st;
  const [cw, ch, cd] = chest;
  const cy = 1.24;
  const M = L.model;
  const chestZ = (x, dy) => -cd * Math.sqrt(Math.max(0.02, 1 - (x / cw) ** 2 - (dy / ch) ** 2));

  // ---- legs (mirrored)
  K.seg('suit', [hx, 0.93, 0], [hx * 0.97, 0.5, -0.01], thigh * 0.95, thigh * 0.75, { m: true });
  K.blob('armor', [hx, 0.72, -thigh * 0.55], [thigh * 0.95, 0.21, thigh * 0.5], { m: true, w: 10, h: 6 });
  K.blob('suit', [hx * 0.97, 0.5, -0.01], thigh * 0.78, { m: true, w: 8, h: 6 });
  K.blob('armor', [hx * 0.96, 0.5, -thigh * 0.75], [thigh * 0.72, thigh * 0.8, thigh * 0.42], { m: true, w: 10, h: 6 });
  K.seg('armor', [hx * 0.96, 0.45, -0.012], [hx * 0.9, 0.17, -0.005], shin * 1.12, shin * 0.82, { m: true, n: 10 });
  K.blob('suit', [hx * 0.9, 0.125, 0], shin * 0.72, { m: true, w: 8, h: 6 });
  K.blob('trim', [hx * 0.9, 0.058, -0.04], [thigh * 0.82, 0.058, 0.125], { m: true, w: 10, h: 7 });
  K.blob('armor', [hx * 0.9, 0.05, -0.115], [thigh * 0.6, 0.04, 0.06], { m: true, w: 8, h: 6 });
  K.seg('glow', [hx + thigh * 0.98, 0.9, -0.01], [hx + thigh * 0.8, 0.56, -0.02], 0.006, 0.006, { m: true, n: 5 });

  // ---- pelvis, belt
  K.blob('armor', [0, 0.93, 0], [hip, 0.09, hip * 0.72], { w: 12, h: 7 });
  K.blob('armor', [0, 0.85, -hip * 0.5], [0.055, 0.08, 0.035], { w: 8, h: 6 });
  const beltR = waist * 1.2;
  K.torus('trim', [0, 1.0, 0], beltR, 0.02, { rs: 5, ts: 16, r: [PI / 2, 0, 0], s: [1, 0.8, 1] });
  K.blob('glow', [0, 1.0, -(beltR * 0.8 + 0.005)], [0.025, 0.022, 0.012], { w: 8, h: 5 });
  K.blob('team', [beltR + 0.008, 1.0, 0], [0.014, 0.018, 0.014], { m: true, w: 6, h: 5 });
  K.blob('team', [0.05, 1.0, beltR * 0.8 + 0.008], [0.014, 0.016, 0.012], { m: true, w: 6, h: 5 });

  // ---- torso
  K.cyl('suit', [0, 1.1, 0], waist * 1.12, waist, 0.26, { n: 12, open: true, s: [1, 1, 0.8] });
  K.cyl('armor', [0, 1.14, 0], cw * 0.93, waist * 1.3, 0.2, { n: 14, open: true, s: [1, 1, (cd / cw) * 0.95] });
  K.blob('armor', [0, cy, 0], [cw, ch, cd], { w: 16, h: 10 });
  // chest core, ring, vents and glowing seams
  K.blob('glow', [0, cy + 0.025, -cd * 0.985], [0.032, 0.032, 0.02], { w: 8, h: 6 });
  K.torus('trim', [0, cy + 0.025, -cd * 0.975], 0.048, 0.008, { rs: 5, ts: 16 });
  for (let k = 0; k < 3; k++) {
    const dy = -0.045 - 0.04 * k, x = cw * 0.5;
    K.box('trim', [x, cy + dy, chestZ(x, dy) - 0.002], 0.055, 0.012, 0.02, { m: true, r: [0, -0.5, 0] });
  }
  const seam = [[0.72, 0.1], [0.5, 0.085], [0.28, 0.06], [0.1, 0.035]].map(([u, dy]) => {
    const x = cw * u;
    return [x, cy + dy, chestZ(x, dy) - 0.003];
  });
  for (let i = 0; i < seam.length - 1; i++) K.seg('glow', seam[i], seam[i + 1], 0.005, 0.005, { m: true, n: 5 });

  // ---- neck + gorget
  K.cyl('suit', [0, 1.47, 0], 0.045, 0.05, 0.1, { n: 8 });
  if (M !== 'vanguard' && M !== 'warden') K.cyl('armor', [0, 1.43, 0], 0.075, 0.1, 0.07, { n: 12, open: true, s: [1, 1, 0.9] });

  // ---- arms (mirrored); band on the LEFT (-x) upper arm only
  K.blob('suit', [sx, 1.36, 0], arm * 1.3, { m: true, w: 10, h: 7 });
  K.seg('suit', [sx, 1.35, 0], [sx + 0.012, 1.12, -0.02], arm, arm * 0.82, { m: true });
  K.blob('suit', [sx + 0.012, 1.12, -0.02], arm * 0.88, { m: true, w: 8, h: 6 });
  K.blob('armor', [sx + 0.02, 1.115, -0.02 + arm * 0.7], [arm * 0.7, arm * 0.8, arm * 0.5], { m: true, w: 8, h: 6 });
  const sleeve = M === 'warden' ? 1.3 : 1.2;
  K.seg('armor', [sx + 0.012, 1.115, -0.025], [sx + 0.022, 0.9, -0.1], fore * sleeve, fore * (M === 'warden' ? 1.1 : 0.95), { m: true, n: 10 });
  K.blob('suit', [sx + 0.022, 0.875, -0.112], fore * 0.95, { m: true, w: 8, h: 6 });
  K.blob('suit', [sx + 0.022, 0.84, -0.13], [fore * 0.9, 0.045, 0.05], { m: true, w: 8, h: 6 });
  K.cyl('team', [-(sx + 0.005), 1.2, -0.009], arm * 1.05, arm * 1.05, 0.04, { n: 12, open: true });

  // ---- style specific
  if (M === 'striker') {
    for (let k = 0; k < 3; k++) K.blob('armor', [0, 1.05 + 0.05 * k, -0.07], [0.085, 0.022, 0.04], { w: 10, h: 5 });
    K.blob('armor', [cw * 0.95, cy - 0.04, 0], [0.03, 0.1, cd * 0.7], { m: true, w: 8, h: 6 });
  } else if (M === 'vanguard') {
    K.blob('armor', [0, cy + 0.015, -cd * 0.6], [cw * 0.82, 0.15, cd * 0.42], { w: 14, h: 8 });
    K.blob('trim', [hip + 0.01, 0.92, 0], [0.06, 0.1, 0.09], { m: true, w: 8, h: 6 });
    K.cyl('armor', [0, 1.44, 0], 0.1, 0.13, 0.09, { n: 12, open: true, s: [1, 1, 0.9] });
    K.blob('armor', [sx + 0.05, 1.0, -0.065], [0.05, 0.14, 0.075], { m: true, w: 10, h: 7 });
    K.seg('glow', [sx + 0.095, 1.06, -0.07], [sx + 0.085, 0.94, -0.085], 0.007, 0.007, { m: true, n: 5 });
    K.blob('armor', [sx + 0.014, 1.31, -0.01], [arm * 1.3, 0.06, arm * 1.3], { m: true, w: 10, h: 6 });
  } else if (M === 'phantom') {
    K.torus('suit', [0, 1.46, 0.0], 0.07, 0.03, { rs: 6, ts: 12, r: [PI / 2, 0, 0] });
    const path = [[1.46, 0.075, 0.03], [1.36, 0.14, 0.04], [1.22, 0.19, 0.045], [1.05, 0.225, 0.045], [0.88, 0.245, 0.04], [0.72, 0.245, 0.03]];
    for (let i = 0; i < path.length - 1; i++) {
      K.seg('suit', [0, path[i][0], path[i][1]], [0, path[i + 1][0], path[i + 1][1]], path[i][2], path[i + 1][2], { flat: 0.12 });
    }
    K.seg('glow', [sx + fore * 1.1, 1.08, -0.06], [sx + fore * 1.0, 0.94, -0.1], 0.005, 0.005, { m: true, n: 5 });
    K.seg('glow', [cw * 0.9, 1.02, -0.04], [cw * 0.9, 0.92, -0.05], 0.005, 0.005, { m: true, n: 5 });
  } else if (M === 'warden') {
    // coat: open at the front, hangs to the knees
    const g = 0.5;
    const prof = [[0.262, 0.46], [0.255, 0.52], [0.235, 0.64], [0.205, 0.78], [0.172, 0.9], [0.145, 0.98], [0.128, 1.02]];
    K.lathe('cloth', prof, 22, -(PI - g), 2 * (PI - g));
    K.lathe('trim', [[0.256, 0.46], [0.264, 0.46], [0.266, 0.5], [0.256, 0.5]], 22, -(PI - g), 2 * (PI - g));
    // tabard panel with a glowing stripe
    K.seg('suit', [0, 1.0, -0.158], [0, 0.55, -0.255], 0.07, 0.085, { flat: 0.1 });
    K.seg('glow', [0, 0.99, -0.164], [0, 0.56, -0.26], 0.006, 0.006, { n: 5 });
    // high collar
    K.cyl('armor', [0, 1.5, 0.01], 0.125, 0.105, 0.13, { n: 14, open: true, s: [1, 1, 0.9] });
    K.torus('trim', [0, 1.435, 0], 0.105, 0.012, { rs: 5, ts: 16, r: [PI / 2, 0, 0], s: [1, 0.9, 1] });
  }
}

// ---------------------------------------------------------------- helmets / heads
function buildHelm(K, L, st) {
  const hs = st.hs, vw = st.vw, HY = HEAD_Y;
  const P = (p) => [p[0] * hs, HY + p[1] * hs, p[2] * hs];
  const R3 = (r) => vec3(r).map((v) => v * hs);
  const blob = (slot, p, r, o) => K.blob(slot, P(p), R3(r), o);
  const seg = (slot, a, b, ra, rb, o) => K.seg(slot, P(a), P(b), ra * hs, rb * hs, o);
  const cyl = (slot, p, rt, rb, h, o) => K.cyl(slot, P(p), rt * hs, rb * hs, h * hs, o);
  const cone = (slot, p, d, r, len, o) => K.cone(slot, P(p), d, r * hs, len * hs, o);
  const torus = (slot, p, Rr, t, o) => K.torus(slot, P(p), Rr * hs, t * hs, o);

  const shell = () => {
    blob('armor', [0, 0, 0.005], [0.125, 0.125, 0.14], { w: 16, h: 10 });
    blob('armor', [0, -0.075, -0.065], [0.075, 0.05, 0.07], { w: 10, h: 6 });
    cyl('trim', [0.118, -0.005, 0.01], 0.036, 0.036, 0.03, { m: true, n: 8, r: [0, 0, PI / 2] });
  };
  const visor = () => {
    blob('trim', [0, 0.012, -0.122], [0.095 * vw, 0.03 * (0.6 + 0.4 * vw), 0.02], { w: 10, h: 6 });
    blob('glow', [0, 0.012, -0.128], [0.08 * vw, 0.018 * (0.6 + 0.4 * vw), 0.022], { w: 10, h: 6 });
    blob('trim', [0, 0.06, -0.115], [0.1, 0.014, 0.03], { w: 8, h: 5 });
  };

  switch (L.helm) {
    case 0: // Visor helm
      shell();
      visor();
      break;
    case 1: { // Hood
      blob('suit', [0, 0, 0.012], [0.14, 0.15, 0.155], { w: 14, h: 9 });
      cone('suit', [0, 0.1, 0.06], [0, 0.35, 0.94], 0.075, 0.14, { n: 8 });
      blob('trim', [0, -0.005, -0.1], [0.085, 0.095, 0.05], { w: 10, h: 7 });
      torus('suit', [0, 0, -0.115], 0.105, 0.018, { rs: 6, ts: 14, s: [1, 1.1, 1] });
      blob('glow', [0.038, 0.01, -0.145], [0.022, 0.008, 0.008], { m: true, w: 6, h: 4, r: [0, 0, 0.25] });
      blob('suit', [0, -0.17, 0.01], [0.19, 0.07, 0.15], { w: 12, h: 6 });
      break;
    }
    case 2: { // Horned
      shell();
      visor();
      const pts = [[0.105, 0.05, 0], [0.165, 0.07, 0], [0.215, 0.105, -0.005], [0.235, 0.15, -0.015], [0.24, 0.18, -0.025]];
      const rr = [0.03, 0.026, 0.02, 0.013, 0.003];
      for (let i = 0; i < pts.length - 1; i++) seg('trim', pts[i], pts[i + 1], rr[i], rr[i + 1], { m: true, n: 7 });
      for (let i = 1; i < pts.length - 1; i++) blob('trim', pts[i], rr[i], { m: true, w: 7, h: 5 });
      break;
    }
    case 3: { // Crest
      shell();
      visor();
      const fin = [[-0.095, 0.085, 0.035, 0.045], [-0.045, 0.115, 0.05, 0.05], [0.01, 0.125, 0.055, 0.05], [0.065, 0.115, 0.05, 0.05], [0.115, 0.09, 0.04, 0.045], [0.155, 0.055, 0.03, 0.04]];
      for (const [z, y, ry, rz] of fin) blob('armor', [0, y, z], [0.013, ry, rz], { w: 8, h: 6 });
      seg('glow', [0, 0.1, -0.098], [0, 0.14, 0.01], 0.004, 0.004, { n: 5 });
      break;
    }
    case 4: { // Faceplate with respirator
      shell();
      blob('armor', [0, -0.055, -0.09], [0.095, 0.06, 0.06], { w: 12, h: 7 });
      blob('trim', [0, 0.04, -0.12], [0.1, 0.02, 0.02], { w: 8, h: 5 });
      blob('glow', [0.045, 0.012, -0.128], [0.03, 0.012, 0.012], { m: true, w: 8, h: 5, r: [0, 0, 0.3] });
      cyl('trim', [0, -0.055, -0.13], 0.045, 0.05, 0.07, { n: 10, r: [PI / 2, 0, 0] });
      torus('trim', [0, -0.055, -0.167], 0.03, 0.006, { rs: 4, ts: 10 });
      cyl('trim', [0.085, -0.05, -0.1], 0.03, 0.03, 0.06, { m: true, n: 8, r: [PI / 2, 0, 0] });
      seg('suit', [0.08, -0.06, -0.075], [0.07, -0.125, -0.03], 0.01, 0.01, { m: true, n: 5 });
      break;
    }
    case 6: { // Crown
      shell();
      visor();
      torus('glow', [0, 0.115, 0.005], 0.105, 0.011, { rs: 5, ts: 18, r: [PI / 2, 0, 0] });
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * PI * 2, x = Math.cos(a) * 0.105, z = Math.sin(a) * 0.105 + 0.005;
        cone('glow', [x, 0.115, z], [x * 2, 1.2, (z - 0.005) * 2], 0.02, i % 2 ? 0.07 : 0.1, { n: 5 });
      }
      break;
    }
    case 7: { // Skull mask
      shell();
      blob('trim', [0, -0.005, -0.1], [0.098, 0.1, 0.05], { w: 10, h: 7 });
      blob('glow', [0.04, 0.02, -0.147], [0.026, 0.03, 0.01], { m: true, w: 7, h: 5 });
      blob('armor', [0, -0.03, -0.152], [0.012, 0.02, 0.008], { w: 5, h: 4 });
      for (let i = -2; i <= 2; i++) blob('armor', [i * 0.02, -0.092, -0.135], [0.007, 0.018, 0.008], { w: 5, h: 4 });
      break;
    }
    default: { // Bare head
      const skin = 'skin';
      blob(skin, [0, 0, 0], [0.105, 0.13, 0.12], { w: 14, h: 9 });
      blob(skin, [0, -0.08, -0.04], [0.06, 0.06, 0.06], { w: 8, h: 6 });
      blob(skin, [0, -0.01, -0.118], [0.014, 0.025, 0.02], { w: 6, h: 4 });
      blob(skin, [0.105, -0.01, 0.0], [0.014, 0.03, 0.02], { m: true, w: 6, h: 4 });
      K.put('trim', new THREE.SphereGeometry(1, 14, 6, 0, PI * 2, 0, 1.05), P([0, 0, 0]), ZERO, R3([0.113, 0.14, 0.128]), false);
      torus('glow', [0, 0.015, 0], 0.108, 0.008, { rs: 4, ts: 18, r: [PI / 2, 0, 0], s: [1, 1.12, 1] });
      break;
    }
  }
}

// ---------------------------------------------------------------- shoulders
function buildShoulders(K, L, st) {
  const k = st.pk, sx = st.sx;
  if (L.shoulder === 1 || L.shoulder === 2) {
    const pc = [sx + 0.02, 1.405, 0];
    K.blob('armor', pc, [0.115 * k, 0.065 * k, 0.12 * k], { m: true, w: 12, h: 8, r: [0, 0, -0.3] });
    K.torus('trim', [pc[0] + 0.012 * k, 1.378, 0], 0.07 * k, 0.008 * k, { m: true, rs: 4, ts: 14, r: [PI / 2, 0, -0.3], s: [1, 1.1, 1] });
    if (L.shoulder === 2) {
      const ts = [0.15, 0.45, 0.8], zs = [-0.035, 0, 0.035], lens = [0.1, 0.11, 0.09];
      for (let i = 0; i < 3; i++) {
        const t = ts[i];
        const base = [pc[0] + 0.115 * k * 0.9 * Math.sin(t), pc[1] + 0.065 * k * 0.9 * Math.cos(t) - 0.005, zs[i] * k];
        K.cone('trim', base, [Math.sin(t) * 0.5, Math.cos(t), zs[i] * 4], 0.022 * k, lens[i] * k, { m: true, n: 6 });
      }
    }
  } else if (L.shoulder === 4) { // floating orbs
    K.blob('glow', [sx + 0.03, 1.62, 0], [0.042 * k, 0.042 * k, 0.042 * k], { m: true, w: 8, h: 6 });
    K.torus('trim', [sx + 0.03, 1.62, 0], 0.07 * k, 0.006 * k, { m: true, rs: 4, ts: 14, r: [PI / 2, 0, 0.3] });
    K.blob('armor', [sx + 0.02, 1.41, 0], [0.1 * k, 0.055 * k, 0.1 * k], { m: true, w: 10, h: 6, r: [0, 0, -0.3] });
  } else if (L.shoulder === 5) { // crystal cluster
    K.blob('armor', [sx + 0.02, 1.41, 0], [0.1 * k, 0.055 * k, 0.1 * k], { m: true, w: 10, h: 6, r: [0, 0, -0.3] });
    K.cone('glow', [sx + 0.02, 1.43, 0], [0.25, 1, 0], 0.032 * k, 0.24 * k, { m: true, n: 5 });
    K.cone('glow', [sx + 0.05, 1.42, -0.035], [0.55, 1, -0.3], 0.024 * k, 0.16 * k, { m: true, n: 5 });
    K.cone('glow', [sx + 0.0, 1.42, 0.04], [-0.15, 1, 0.4], 0.022 * k, 0.14 * k, { m: true, n: 5 });
  } else if (L.shoulder === 3) {
    const f = sx / 0.235;
    const prof = [[0.295 * f, 1.33], [0.24 * f, 1.385], [0.18 * f, 1.43], [0.13, 1.465], [0.09, 1.49]];
    K.lathe('armor', prof, 18, 0, PI * 2, [1, 1, 0.75]);
    K.lathe('trim', [[0.293 * f, 1.325], [0.3 * f, 1.325], [0.298 * f, 1.335], [0.292 * f, 1.337]], 18, 0, PI * 2, [1, 1, 0.75]);
  }
}

// ---------------------------------------------------------------- back items
function buildBack(K, L, st) {
  const B = st.chest[2];
  const sx = st.sx;
  switch (L.back) {
    case 1: { // Jetpack
      K.blob('armor', [0, 1.28, B + 0.02], [0.14, 0.16, 0.05], { w: 10, h: 7 });
      K.cyl('trim', [0.075, 1.25, B + 0.075], 0.055, 0.06, 0.3, { m: true, n: 10 });
      K.blob('trim', [0.075, 1.4, B + 0.075], [0.055, 0.03, 0.055], { m: true, w: 8, h: 5 });
      K.cyl('trim', [0.075, 1.07, B + 0.075], 0.04, 0.055, 0.06, { m: true, n: 10 });
      K.cyl('glow', [0.075, 1.04, B + 0.075], 0.04, 0.04, 0.012, { m: true, n: 10 });
      K.cone('glow', [0.075, 1.035, B + 0.075], [0, -1, 0], 0.03, 0.07, { m: true, n: 8 });
      K.seg('glow', [0.075, 1.2, B + 0.133], [0.075, 1.3, B + 0.133], 0.006, 0.006, { m: true, n: 5 });
      break;
    }
    case 2: { // Cape (half-shell hanging from the shoulders to mid-calf)
      const kb = 1 + (B - 0.125) * 3;
      const prof = [[0.275, 0.35], [0.26, 0.5], [0.235, 0.7], [0.21, 0.9], [0.19, 1.1], [0.175, 1.3], [0.16, 1.4], [0.13, 1.45]].map(([r, y]) => [r * kb, y]);
      K.lathe('cloth', prof, 14, -1.1, 2.2);
      K.lathe('trim', [[0.272 * kb, 0.345], [0.28 * kb, 0.345], [0.278 * kb, 0.375], [0.268 * kb, 0.375]], 14, -1.1, 2.2);
      K.blob('trim', [0.115 * kb, 1.43, 0.06 * kb], [0.025, 0.025, 0.025], { m: true, w: 6, h: 5 });
      break;
    }
    case 3: { // Cables + battery box
      K.blob('trim', [0, 1.22, B + 0.05], [0.09, 0.12, 0.045], { w: 10, h: 7 });
      K.blob('glow', [0.03, 1.22, B + 0.09], [0.012, 0.07, 0.006], { m: true, w: 6, h: 5 });
      for (const [R, y, z] of [[0.06, 1.335, B * 0.8], [0.075, 1.31, B * 0.85]]) {
        K.torus('trim', [0.11, y, z], R, 0.008, { m: true, rs: 5, ts: 12, arc: PI, r: [0, 0.6, 0] });
      }
      K.seg('trim', [0.07, 1.15, B + 0.035], [0.1, 0.98, B * 0.7], 0.008, 0.008, { m: true, n: 6 });
      break;
    }
    case 4: { // Fins
      K.blob('trim', [0.06, 1.28, B + 0.03], [0.04, 0.05, 0.03], { m: true, w: 8, h: 5 });
      const d = [0.35, 0.8, 0.45];
      K.cone('armor', [0.06, 1.28, B + 0.03], d, 0.06, 0.38, { m: true, n: 4, flat: 0.25 });
      K.seg('glow', [0.065, 1.3, B + 0.04], [0.065 + d[0] * 0.28, 1.3 + d[1] * 0.28, B + 0.04 + d[2] * 0.28], 0.005, 0.003, { m: true, n: 5 });
      break;
    }
    case 5: { // Halo
      K.torus('glow', [0, 1.62, B + 0.12], 0.17, 0.011, { rs: 5, ts: 28, r: [0.15, 0, 0] });
      K.seg('trim', [0, 1.42, B + 0.03], [0, 1.55, B + 0.1], 0.01, 0.008, { n: 5 });
      break;
    }
    case 6: { // Wings
      K.blob('trim', [0.05, 1.3, B + 0.03], [0.04, 0.05, 0.03], { m: true, w: 8, h: 5 });
      const ws = [[[0.85, 0.5, 0.45], 0.62], [[0.95, 0.15, 0.35], 0.55], [[0.8, -0.2, 0.4], 0.45]];
      for (const [d, len] of ws) {
        K.cone('armor', [0.06, 1.3, B + 0.03], d, 0.05, len, { m: true, n: 4, flat: 0.2 });
        K.seg('glow', [0.065, 1.3, B + 0.035], [0.065 + d[0] * len * 0.9, 1.3 + d[1] * len * 0.9, B + 0.035 + d[2] * len * 0.9], 0.005, 0.003, { m: true, n: 5 });
      }
      break;
    }
    default: break;
  }
  void sx;
}

// ---------------------------------------------------------------- assemble
function makeMaterials(L, teamColor, textures) {
  const MAT_PARAMS = [
    { metalness: 0.6, roughness: 0.35 },
    { metalness: 0.85, roughness: 0.4 },
    { metalness: 0.3, roughness: 0.45 },
    { metalness: 0.5, roughness: 0.45 },
    { metalness: 0.05, roughness: 0.8 },
    { metalness: 0.2, roughness: 0.7 },
    { metalness: 0.95, roughness: 0.28 },
    { metalness: 0.35, roughness: 0.5 },
  ];
  const mp = MAT_PARAMS[L.mat];
  const armorParams = { color: textures ? 0xffffff : L.c1, metalness: mp.metalness, roughness: mp.roughness };
  if (textures) armorParams.map = textures.map;
  if ((L.mat === 5 || L.mat === 7) && textures && textures.emissive) {
    armorParams.emissive = 0xffffff;
    armorParams.emissiveMap = textures.emissive;
    armorParams.emissiveIntensity = 1;
  }
  const armor = new THREE.MeshStandardMaterial(armorParams);
  const clothParams = { color: textures ? 0xffffff : L.c1, metalness: Math.min(mp.metalness, 0.15), roughness: 0.75, side: THREE.DoubleSide };
  if (textures) clothParams.map = textures.map;
  return {
    armor,
    cloth: new THREE.MeshStandardMaterial(clothParams),
    suit: new THREE.MeshStandardMaterial({ color: L.c2, metalness: 0.05, roughness: 0.85, side: THREE.DoubleSide }),
    trim: new THREE.MeshStandardMaterial({ color: 0x4a4f58, metalness: 0.85, roughness: 0.35 }),
    skin: new THREE.MeshStandardMaterial({ color: 0xb5a695, metalness: 0, roughness: 0.8 }),
    glow: new THREE.MeshBasicMaterial({ color: L.glow }),
    team: new THREE.MeshBasicMaterial({ color: Number.isFinite(teamColor) ? teamColor : 0xffffff }),
  };
}

const SLOT_ORDER = ['armor', 'cloth', 'suit', 'trim', 'glow', 'team', 'skin'];

/** Build the soldier. `look` as returned by sanitizeLook; `teamColor` is 0xrrggbb. */
export function buildCharacter(look, teamColor) {
  const L = normLook(look);
  const st = STYLES[L.model];
  const K = new Kit();
  buildBody(K, L, st);
  buildHelm(K, L, st);
  buildShoulders(K, L, st);
  buildBack(K, L, st);

  const mats = makeMaterials(L, teamColor, getTextures(L));
  const group = new THREE.Group();
  group.name = 'character';
  group.userData.lookKey = lookKey(L);
  for (const slot of SLOT_ORDER) {
    const list = K.lists[slot];
    if (!list || !list.length) { mats[slot].dispose(); continue; }
    const mesh = new THREE.Mesh(mergeGeometries(list), mats[slot]);
    mesh.name = slot === 'armor' ? 'armor' : slot;
    mesh.castShadow = true;
    group.add(mesh);
  }
  return group;
}

/** Dispose geometries and materials made by buildCharacter (cached textures are shared and kept). */
export function disposeCharacter(group) {
  if (!group || !group.traverse) return;
  group.traverse((o) => {
    if (!o.isMesh) return;
    if (o.geometry) o.geometry.dispose();
    const ms = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of ms) if (m && m.dispose) m.dispose();
  });
}
