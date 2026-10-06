// Procedural AK-style rifle + paint-job skins. No external assets: geometry from boxes/cylinders,
// skins painted on small canvases (falls back to flat colours when no canvas exists, e.g. in tests).
// The rifle points down -Z, origin at the middle of the receiver, about 1.0 units long.
import * as THREE from 'three';

/** Skin table. Order MUST match LOOK_PARTS.gun in sim.js.
 *  metal = receiver/magazine colour, wood = furniture colour, steel = barrel/sights, paint = canvas painter (optional),
 *  glowy = skin lights up (emissive), rough/met = material feel. */
export const SKINS = [
  { name: 'Classic AK', metal: '#23252b', wood: '#8a4b1f', steel: '#14161a', rough: 0.55, met: 0.5, paint: paintWood },
  { name: 'Redline', metal: '#16181d', wood: '#1d1f25', steel: '#0e0f12', rough: 0.45, met: 0.6, paint: paintRedline },
  { name: 'Jungle Camo', metal: '#3c5a2c', wood: '#3c5a2c', steel: '#1a2214', rough: 0.85, met: 0.1, paint: paintCamo },
  { name: 'Wasteland', metal: '#7a5a38', wood: '#5b4630', steel: '#2b2118', rough: 0.95, met: 0.2, paint: paintRust },
  { name: 'Frostbite', metal: '#a9d8f0', wood: '#6fa8d0', steel: '#33556b', rough: 0.25, met: 0.5, paint: paintFrost },
  { name: 'Neon Grid', metal: '#0b0d18', wood: '#0b0d18', steel: '#07080f', rough: 0.4, met: 0.5, paint: paintGrid, glowy: true },
  { name: 'Inferno', metal: '#1a0d08', wood: '#1a0d08', steel: '#0d0605', rough: 0.5, met: 0.4, paint: paintFlames, glowy: true },
  { name: 'Toxic', metal: '#16220f', wood: '#16220f', steel: '#0b1007', rough: 0.4, met: 0.3, paint: paintToxic, glowy: true },
  { name: 'Gilded', metal: '#d8ac3a', wood: '#f1d27a', steel: '#8a6a1c', rough: 0.2, met: 1.0, paint: paintGild },
  { name: 'Void Prism', metal: '#120a24', wood: '#120a24', steel: '#07040f', rough: 0.25, met: 0.7, paint: paintPrism, glowy: true },
];

const SZ = 128;
function canvas() {
  try {
    if (typeof document === 'undefined') return null;
    const c = document.createElement('canvas');
    c.width = c.height = SZ;
    const g = c.getContext && c.getContext('2d');
    return g ? { c, g } : null;
  } catch { return null; }
}
const rnd = (seed) => { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); };

function paintWood(g, base) {
  g.fillStyle = base; g.fillRect(0, 0, SZ, SZ);
  const r = rnd(7);
  for (let i = 0; i < 26; i++) {
    g.strokeStyle = r() < 0.5 ? 'rgba(60,28,8,.35)' : 'rgba(210,150,80,.22)';
    g.lineWidth = 1 + r() * 2;
    const y = r() * SZ;
    g.beginPath(); g.moveTo(0, y); g.bezierCurveTo(40, y + (r() - 0.5) * 14, 90, y + (r() - 0.5) * 14, SZ, y + (r() - 0.5) * 8); g.stroke();
  }
}
function paintRedline(g, base) {
  g.fillStyle = base; g.fillRect(0, 0, SZ, SZ);
  g.fillStyle = '#e02b2b'; g.fillRect(0, 46, SZ, 12); g.fillRect(0, 70, SZ, 4);
  g.fillStyle = 'rgba(255,255,255,.12)'; g.fillRect(0, 0, SZ, 5);
}
function paintCamo(g, base) {
  g.fillStyle = base; g.fillRect(0, 0, SZ, SZ);
  const r = rnd(11), cols = ['#2a4020', '#6b7a3a', '#1b2a15', '#8a8a52'];
  for (let i = 0; i < 34; i++) {
    g.fillStyle = cols[i % cols.length];
    g.beginPath(); g.ellipse(r() * SZ, r() * SZ, 8 + r() * 20, 5 + r() * 12, r() * 3, 0, Math.PI * 2); g.fill();
  }
}
function paintRust(g, base) {
  g.fillStyle = base; g.fillRect(0, 0, SZ, SZ);
  const r = rnd(5);
  for (let i = 0; i < 60; i++) {
    g.fillStyle = r() < 0.5 ? 'rgba(120,50,15,.45)' : 'rgba(30,22,14,.4)';
    g.fillRect(r() * SZ, r() * SZ, 2 + r() * 14, 2 + r() * 6);
  }
  g.strokeStyle = 'rgba(220,200,160,.5)'; g.lineWidth = 1.5;
  for (let i = 0; i < 9; i++) { const x = r() * SZ, y = r() * SZ; g.beginPath(); g.moveTo(x, y); g.lineTo(x + 12 + r() * 20, y + (r() - 0.5) * 10); g.stroke(); }
}
function paintFrost(g, base) {
  const gr = g.createLinearGradient(0, 0, SZ, SZ);
  gr.addColorStop(0, '#e6f6ff'); gr.addColorStop(0.5, base); gr.addColorStop(1, '#4f8fc0');
  g.fillStyle = gr; g.fillRect(0, 0, SZ, SZ);
  const r = rnd(3);
  g.strokeStyle = 'rgba(255,255,255,.8)'; g.lineWidth = 1.5;
  for (let i = 0; i < 12; i++) {
    const x = r() * SZ, y = r() * SZ, l = 5 + r() * 7;
    for (let a = 0; a < 3; a++) { const t = a * Math.PI / 3; g.beginPath(); g.moveTo(x - Math.cos(t) * l, y - Math.sin(t) * l); g.lineTo(x + Math.cos(t) * l, y + Math.sin(t) * l); g.stroke(); }
  }
}
function paintGrid(g, base, glow) {
  g.fillStyle = base; g.fillRect(0, 0, SZ, SZ);
  g.strokeStyle = glow; g.lineWidth = 3;
  for (let i = 0; i <= SZ; i += 32) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, SZ); g.stroke(); g.beginPath(); g.moveTo(0, i); g.lineTo(SZ, i); g.stroke(); }
}
function paintFlames(g, base) {
  g.fillStyle = base; g.fillRect(0, 0, SZ, SZ);
  const r = rnd(9);
  for (let i = 0; i < 9; i++) {
    const x = (i + 0.5) * (SZ / 9), h = 40 + r() * 60;
    const gr = g.createLinearGradient(0, SZ, 0, SZ - h);
    gr.addColorStop(0, '#ff3a00'); gr.addColorStop(0.6, '#ff9a1a'); gr.addColorStop(1, 'rgba(255,230,90,0)');
    g.fillStyle = gr;
    g.beginPath(); g.moveTo(x - 12, SZ); g.quadraticCurveTo(x - 4, SZ - h * 0.5, x + (r() - 0.5) * 8, SZ - h); g.quadraticCurveTo(x + 6, SZ - h * 0.5, x + 12, SZ); g.fill();
  }
}
function paintToxic(g, base) {
  g.fillStyle = base; g.fillRect(0, 0, SZ, SZ);
  const r = rnd(13);
  g.fillStyle = '#7dff2a';
  for (let i = 0; i < 7; i++) {
    const x = r() * SZ, l = 20 + r() * 50;
    g.fillRect(x - 3, 0, 6, l); g.beginPath(); g.arc(x, l, 6, 0, Math.PI * 2); g.fill();
  }
  g.fillStyle = 'rgba(180,255,90,.5)';
  for (let i = 0; i < 14; i++) { g.beginPath(); g.arc(r() * SZ, r() * SZ, 2 + r() * 3, 0, Math.PI * 2); g.fill(); }
}
function paintGild(g, base) {
  const gr = g.createLinearGradient(0, 0, SZ, 0);
  gr.addColorStop(0, '#fff0a8'); gr.addColorStop(0.5, base); gr.addColorStop(1, '#a87c1c');
  g.fillStyle = gr; g.fillRect(0, 0, SZ, SZ);
  g.strokeStyle = 'rgba(120,80,10,.55)'; g.lineWidth = 2;
  for (let i = -SZ; i < SZ * 2; i += 20) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + SZ, SZ); g.stroke(); }
}
function paintPrism(g, base) {
  g.fillStyle = base; g.fillRect(0, 0, SZ, SZ);
  const gr = g.createLinearGradient(0, 0, SZ, SZ);
  ['#ff3bd4', '#6a4bff', '#2fd8ff', '#5dff9a', '#ffe14a', '#ff3bd4'].forEach((c, i, a) => gr.addColorStop(i / (a.length - 1), c));
  g.globalAlpha = 0.75; g.fillStyle = gr;
  g.beginPath(); g.moveTo(0, 40); g.lineTo(SZ, 0); g.lineTo(SZ, 70); g.lineTo(0, 110); g.fill();
  g.globalAlpha = 1;
}

// ---- cached resources (shared by every rifle in the scene)
const matCache = new Map();
function skinMats(skinIdx, glow) {
  const sk = SKINS[skinIdx] || SKINS[0];
  const key = `${skinIdx}|${sk.name === 'Neon Grid' ? glow : ''}`;
  if (matCache.has(key)) return matCache.get(key);
  const mk = (base, paint) => {
    let map = null;
    const cv = paint && canvas();
    if (cv) { try { paint(cv.g, base, glow); map = new THREE.CanvasTexture(cv.c); if (THREE.SRGBColorSpace) map.colorSpace = THREE.SRGBColorSpace; } catch { map = null; } }
    const p = { color: map ? 0xffffff : base, roughness: sk.rough, metalness: sk.met };
    if (map) { p.map = map; if (sk.glowy) { p.emissive = 0xffffff; p.emissiveMap = map; p.emissiveIntensity = 0.7; } }
    return new THREE.MeshStandardMaterial(p);
  };
  const out = {
    body: mk(sk.metal, sk.paint === paintWood ? null : sk.paint),
    wood: mk(sk.wood, sk.paint),
    steel: new THREE.MeshStandardMaterial({ color: sk.steel, roughness: 0.4, metalness: 0.85 }),
  };
  matCache.set(key, out);
  return out;
}
const geoCache = new Map();
function boxGeo(w, h, l) { const k = `b${w},${h},${l}`; if (!geoCache.has(k)) geoCache.set(k, new THREE.BoxGeometry(w, h, l)); return geoCache.get(k); }
function cylGeo(r, l) { const k = `c${r},${l}`; if (!geoCache.has(k)) { const g = new THREE.CylinderGeometry(r, r, l, 10); g.rotateX(Math.PI / 2); geoCache.set(k, g); } return geoCache.get(k); }

/** Build an AK-style rifle. opts.flash adds the muzzle-flash mesh (userData.flash); opts.shadow makes parts cast shadows. */
export function buildRifle(skinIdx = 0, glow = '#35e0ff', opts = {}) {
  const m = skinMats(skinIdx, glow);
  const root = new THREE.Group();
  const add = (geo, mat, x, y, z, rx = 0) => {
    const me = new THREE.Mesh(geo, mat);
    me.position.set(x, y, z);
    if (rx) me.rotation.x = rx;
    if (opts.shadow) me.castShadow = true;
    root.add(me);
    return me;
  };
  // receiver + dust cover + rear sight
  add(boxGeo(0.05, 0.07, 0.3), m.body, 0, 0, 0);
  add(boxGeo(0.046, 0.022, 0.27), m.body, 0, 0.045, 0.0);
  add(boxGeo(0.032, 0.022, 0.04), m.steel, 0, 0.066, -0.09);
  // grip, curved magazine, stock
  add(boxGeo(0.036, 0.11, 0.046), m.wood, 0, -0.085, 0.135, -0.35);
  add(boxGeo(0.032, 0.085, 0.065), m.body, 0, -0.075, -0.03, 0.1);
  add(boxGeo(0.032, 0.085, 0.065), m.body, 0, -0.145, -0.048, 0.3);
  add(boxGeo(0.032, 0.085, 0.065), m.body, 0, -0.205, -0.078, 0.5);
  add(boxGeo(0.04, 0.075, 0.22), m.wood, 0, -0.012, 0.26, 0.12);
  add(boxGeo(0.044, 0.09, 0.014), m.steel, 0, -0.03, 0.375, 0.12);
  // handguards, gas tube + block, barrel, front sight, muzzle brake
  add(boxGeo(0.052, 0.045, 0.2), m.wood, 0, -0.01, -0.25);
  add(boxGeo(0.046, 0.026, 0.17), m.wood, 0, 0.045, -0.235);
  add(cylGeo(0.011, 0.22), m.steel, 0, 0.066, -0.29);
  add(boxGeo(0.024, 0.032, 0.04), m.steel, 0, 0.04, -0.4);
  add(cylGeo(0.011, 0.3), m.steel, 0, 0.012, -0.5);
  add(boxGeo(0.014, 0.04, 0.02), m.steel, 0, 0.04, -0.58);
  add(boxGeo(0.005, 0.026, 0.005), m.steel, 0, 0.078, -0.58);
  add(cylGeo(0.016, 0.05), m.steel, 0, 0.012, -0.65);
  // glow strip: tinted with the player's glow colour
  const accent = new THREE.MeshBasicMaterial({ color: glow });
  add(boxGeo(0.012, 0.004, 0.2), accent, 0, 0.058, 0.0);
  root.userData.accent = accent;
  if (opts.flash) {
    const flash = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffe9a0 }));
    flash.position.set(0, 0.012, -0.7);
    flash.visible = false;
    root.add(flash);
    root.userData.flash = flash;
  }
  return root;
}
