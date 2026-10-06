// Visual themes for every arena (see maps.js for the theme data): night sky, dark stone, gold trim, torch light.
// Everything here is decoration; collision comes from the map's walls in maps.js.
import * as THREE from 'three';
import { MAPS, DEFAULT_MAP } from './sim.js';

export const TEAM_COLOR = [0x3b82ff, 0xff5436];
const css = (hex) => `#${hex.toString(16).padStart(6, '0')}`;
const mix = (a, b, t) => {
  const ch = (h, sh) => (h >> sh) & 255;
  const m = (sh) => Math.round(ch(a, sh) + (ch(b, sh) - ch(a, sh)) * t);
  return (m(16) << 16) | (m(8) << 8) | m(0);
};

const mat = (color, roughness = 0.6, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
// stone / trim materials of the arena currently being built (replaced by applyTheme)
let MARBLE, MARBLE_DARK, SAND, SAND_DARK, GOLD_MAT;
let THEME = null;
function applyTheme(t) {
  THEME = t;
  MARBLE = mat(t.marble, 0.35, 0.1);
  MARBLE_DARK = mat(t.marbleDark, 0.45, 0.05);
  SAND = mat(t.sand, 0.85);
  SAND_DARK = mat(t.sandDark, 0.9);
  GOLD_MAT = mat(t.gold, 0.35, 0.6);
  GOLD_MAT.emissive = new THREE.Color(mix(t.gold, 0x000000, 0.8));
  flameMats[0].color.setHex(t.torch);
  flameMats[1].color.setHex(mix(t.torch, 0xffffff, 0.5));
}

function canvasTexture(w, h, draw, repeat) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  return t;
}

function skyTexture(t) {
  return canvasTexture(1024, 512, (g, w, h) => {
    const grad = g.createLinearGradient(0, 0, 0, h);
    for (const [at, color] of t.sky) grad.addColorStop(at, color);
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    if (t.stars) {
      for (let i = 0; i < 380; i++) {
        const y = Math.random() * h * 0.46;
        g.fillStyle = `rgba(255,255,255,${0.25 + Math.random() * 0.7})`;
        const r = Math.random() < 0.12 ? 2 : 1;
        g.fillRect(Math.random() * w, y, r, r);
      }
    }
  });
}

function floorTexture(t, map) {
  const size = map.size, TILES = Math.round(size / 2); // 4 m slabs
  const S = 1024, k = S / (size * 2);
  return canvasTexture(S, S, (g) => {
    g.fillStyle = t.floor;
    g.fillRect(0, 0, S, S);
    // checker tint + speckle so the floor reads as stone slabs
    const tile = 4 * k;
    for (let iz = 0; iz < TILES; iz++) {
      for (let ix = 0; ix < TILES; ix++) {
        if ((ix + iz) % 2 === 0) { g.fillStyle = t.floorTint; g.fillRect(ix * tile, iz * tile, tile, tile); }
      }
    }
    for (let i = 0; i < 7000; i++) {
      g.fillStyle = Math.random() < 0.5 ? 'rgba(0,0,0,.07)' : 'rgba(200,200,255,.04)';
      g.fillRect(Math.random() * S, Math.random() * S, 2 + Math.random() * 3, 2 + Math.random() * 3);
    }
    g.strokeStyle = t.floorLine;
    g.lineWidth = 2;
    for (let i = 0; i <= TILES; i++) {
      g.beginPath(); g.moveTo(i * tile, 0); g.lineTo(i * tile, S); g.moveTo(0, i * tile); g.lineTo(S, i * tile); g.stroke();
    }
    // spawn areas: a tinted disc under every team spawn (blue = team 0, red = team 1), or small marks for FFA spawns
    const spot = (x, z, r, rgba) => {
      g.fillStyle = rgba;
      g.beginPath(); g.arc((x + size) * k, (z + size) * k, r * k, 0, Math.PI * 2); g.fill();
    };
    for (const sp of map.spawns || []) {
      spot(sp.x, sp.z, 3.2, 'rgba(59,130,255,.34)');
      spot(-sp.x, -sp.z, 3.2, 'rgba(255,84,54,.34)');
    }
    for (const sp of map.ffaSpawns || []) spot(sp.x, sp.z, 1.6, 'rgba(212,167,58,.22)');
    // centre emblem: gold rings + sun rays
    g.save();
    g.translate(S / 2, S / 2);
    const ek = Math.min(1, size / 30);
    g.strokeStyle = css(mix(t.accent, 0x000000, 0.2));
    g.lineWidth = 7;
    for (const r of [10.5 * ek, 8.2 * ek]) { g.beginPath(); g.arc(0, 0, r * k, 0, Math.PI * 2); g.stroke(); }
    g.lineWidth = 4;
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      g.beginPath(); g.moveTo(Math.cos(a) * 8.6 * ek * k, Math.sin(a) * 8.6 * ek * k); g.lineTo(Math.cos(a) * 10.1 * ek * k, Math.sin(a) * 10.1 * ek * k); g.stroke();
    }
    g.restore();
    // darker edge so the arena sits inside its walls
    const vg = g.createRadialGradient(S / 2, S / 2, S * 0.35, S / 2, S / 2, S * 0.75);
    vg.addColorStop(0, 'rgba(0,0,10,0)');
    vg.addColorStop(1, 'rgba(0,0,10,.5)');
    g.fillStyle = vg;
    g.fillRect(0, 0, S, S);
  });
}

function bannerTexture(colorHex) {
  const css = `#${colorHex.toString(16).padStart(6, '0')}`;
  return canvasTexture(128, 256, (g, w, h) => {
    g.fillStyle = css; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#d4a73a'; g.lineWidth = 8; g.strokeRect(6, 6, w - 12, h - 12);
    g.fillStyle = '#d4a73a';
    g.beginPath(); g.arc(w / 2, h * 0.42, 30, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#d4a73a'; g.lineWidth = 5;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      g.beginPath(); g.moveTo(w / 2 + Math.cos(a) * 36, h * 0.42 + Math.sin(a) * 36); g.lineTo(w / 2 + Math.cos(a) * 52, h * 0.42 + Math.sin(a) * 52); g.stroke();
    }
    g.fillStyle = 'rgba(0,0,0,.25)';
    g.beginPath(); g.moveTo(10, h - 10); g.lineTo(w / 2, h - 50); g.lineTo(w - 10, h - 10); g.lineTo(w - 10, h - 10); g.fill();
  });
}

// ------------------------------------------------------------------ pieces
// Static scenery boxes added straight to the scene are collected and merged into a few big meshes
// (one per material) so the GPU draws a few dozen things instead of hundreds.
let batchScene = null;
const batches = [new Map(), new Map()]; // [shadowed, unshadowed]: material -> boxes [[w,h,d,x,y,z]]

function mergeBoxes(list) {
  const pos = [], nor = [], uv = [], idx = [];
  let base = 0;
  for (const [w, h, d, x, y, z] of list) {
    const g = new THREE.BoxGeometry(w, h, d);
    const p = g.attributes.position.array, n = g.attributes.normal.array, t = g.attributes.uv.array, ix = g.index.array;
    for (let i = 0; i < p.length; i += 3) pos.push(p[i] + x, p[i + 1] + y, p[i + 2] + z);
    for (let i = 0; i < n.length; i++) nor.push(n[i]);
    for (let i = 0; i < t.length; i++) uv.push(t[i]);
    for (let i = 0; i < ix.length; i++) idx.push(ix[i] + base);
    base += p.length / 3;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  out.setIndex(idx);
  out.computeBoundingSphere();
  return out;
}

function flushBatches(scene) {
  batches.forEach((map, i) => {
    for (const [material, boxes] of map) {
      const m = new THREE.Mesh(mergeBoxes(boxes), material);
      m.castShadow = i === 0; m.receiveShadow = i === 0;
      scene.add(m);
    }
    map.clear();
  });
  batchScene = null;
}

function box(parent, w, h, d, x, y, z, material, shadows = true) {
  if (parent === batchScene) {
    const map = batches[shadows ? 0 : 1];
    if (!map.has(material)) map.set(material, []);
    map.get(material).push([w, h, d, x, y, z]);
    return null;
  }
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  m.castShadow = shadows; m.receiveShadow = shadows;
  parent.add(m);
  return m;
}

const flames = [];
const torchLights = [];
const flameGeo = new THREE.ConeGeometry(0.17, 0.75, 6);
flameGeo.translate(0, 0.37, 0);
const flameMats = [
  new THREE.MeshBasicMaterial({ color: 0xff8a1f, transparent: true, opacity: 0.9, depthWrite: false }),
  new THREE.MeshBasicMaterial({ color: 0xffd25a, transparent: true, opacity: 0.9, depthWrite: false }),
];
function torch(scene, x, z, h = 1.25, lit = false) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.3, h, 10), MARBLE);
  ped.position.y = h / 2; ped.castShadow = true;
  const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.25, 0.28, 12), GOLD_MAT);
  bowl.position.y = h + 0.1;
  g.add(ped, bowl);
  for (let i = 0; i < 3; i++) {
    const f = new THREE.Mesh(flameGeo, flameMats[i % 2]);
    const a = (i / 3) * Math.PI * 2;
    f.position.set(Math.cos(a) * 0.14, h + 0.22, Math.sin(a) * 0.14);
    f.userData.phase = Math.random() * 6.28;
    g.add(f);
    flames.push(f);
  }
  if (lit) { // real lights are costly: only the four central braziers get one
    const light = new THREE.PointLight(THEME.torch, 55, 24, 2);
    light.position.set(0, h + 0.9, 0);
    g.add(light);
    torchLights.push(light);
  }
  scene.add(g);
}

function column(parent, w, d, h, x, z, material = MARBLE) {
  box(parent, w + 0.5, 0.35, d + 0.5, x, 0.175, z, MARBLE_DARK); // plinth
  box(parent, w, h - 0.9, d, x, 0.35 + (h - 0.9) / 2, z, material); // shaft
  box(parent, w + 0.1, 0.1, d + 0.1, x, h - 0.5, z, GOLD_MAT); // gold ring
  box(parent, w + 0.55, 0.45, d + 0.55, x, h - 0.225, z, MARBLE_DARK); // capital
}

let teamOfWall = () => 0;
function buildWallMesh(scene, w) {
  const sx = w.maxX - w.minX, sz = w.maxZ - w.minZ;
  const cx = (w.minX + w.maxX) / 2, cz = (w.minZ + w.maxZ) / 2;
  if (w.kind === 'temple') {
    box(scene, sx + 1.4, 0.3, sz + 1.4, cx, 0.15, cz, SAND_DARK);
    box(scene, sx + 0.7, 0.3, sz + 0.7, cx, 0.45, cz, SAND);
    box(scene, sx, w.h - 0.6, sz, cx, 0.6 + (w.h - 0.6) / 2, cz, MARBLE);
    box(scene, sx + 0.35, 0.28, sz + 0.35, cx, w.h + 0.14, cz, GOLD_MAT);
    box(scene, sx + 0.05, 0.12, sz + 0.05, cx, 1.9, cz, GOLD_MAT); // gold band
    return;
  }
  if (w.kind === 'shield') {
    const long = Math.max(sx, sz);
    const alongX = sx >= sz;
    const team = teamOfWall(cx, cz);
    box(scene, sx + 0.2, 0.3, sz + 0.2, cx, 0.15, cz, MARBLE_DARK);
    box(scene, sx, w.h - 0.3, sz, cx, 0.3 + (w.h - 0.3) / 2, cz, MARBLE);
    box(scene, sx + 0.25, 0.25, sz + 0.25, cx, w.h + 0.125, cz, GOLD_MAT);
    // team colour stripe on both faces
    const stripe = new THREE.MeshBasicMaterial({ color: team < 0 ? 0xd4a73a : TEAM_COLOR[team] });
    if (alongX) { for (const s of [-1, 1]) box(scene, sx - 0.4, 0.45, 0.06, cx, w.h - 0.7, cz + s * (sz / 2 + 0.03), stripe, false); }
    else { for (const s of [-1, 1]) box(scene, 0.06, 0.45, sz - 0.4, cx + s * (sx / 2 + 0.03), w.h - 0.7, cz, stripe, false); }
    // pilasters
    const n = Math.max(2, Math.floor(long / 4));
    for (let i = 0; i < n; i++) {
      const t = ((i + 0.5) / n - 0.5) * long;
      if (alongX) box(scene, 0.5, w.h - 0.3, sz + 0.3, cx + t, 0.3 + (w.h - 0.3) / 2, cz, MARBLE_DARK);
      else box(scene, sx + 0.3, w.h - 0.3, 0.5, cx, 0.3 + (w.h - 0.3) / 2, cz + t, MARBLE_DARK);
    }
    return;
  }
  if (w.kind === 'low') {
    box(scene, sx, w.h, sz, cx, w.h / 2, cz, SAND);
    box(scene, sx + 0.12, 0.1, sz + 0.12, cx, w.h + 0.05, cz, GOLD_MAT);
    return;
  }
  // cover
  if (Math.max(sx, sz) <= 3.2) { column(scene, sx, sz, w.h, cx, cz); return; }
  box(scene, sx + 0.2, 0.3, sz + 0.2, cx, 0.15, cz, MARBLE_DARK);
  box(scene, sx, w.h - 0.3, sz, cx, 0.3 + (w.h - 0.3) / 2, cz, MARBLE);
  box(scene, sx + 0.2, 0.2, sz + 0.2, cx, w.h + 0.1, cz, GOLD_MAT);
}

// ------------------------------------------------------------------ world
export function buildWorld(parent, mapId = DEFAULT_MAP) {
  const map = MAPS[mapId] || MAPS[DEFAULT_MAP];
  const T0 = map.theme;
  const ARENA = map.size; // half-extent of THIS map
  const bk = Math.max(1, ARENA / 30); // scale factor for lights, fog and shadows on big maps
  applyTheme(T0);
  if (map.spawns) {
    const ax = map.spawns.reduce((a, q) => a + q.x, 0), az = map.spawns.reduce((a, q) => a + q.z, 0);
    teamOfWall = (x, z) => (x * ax + z * az > 0 ? 0 : 1);
  } else teamOfWall = () => -1;
  flames.length = 0; torchLights.length = 0;
  const scene = new THREE.Group(); // everything we build lives in here so a different arena can replace it
  parent.add(scene);
  batchScene = scene;
  parent.background = new THREE.Color(T0.haze);
  parent.fog = new THREE.Fog(T0.haze, 45 * bk, 170 * bk);

  // sky dome follows the camera
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(260, 32, 16),
    new THREE.MeshBasicMaterial({ map: skyTexture(T0), side: THREE.BackSide, fog: false, depthWrite: false }),
  );
  sky.renderOrder = -10;
  scene.add(sky);
  // sun disc + halo, low on the horizon
  const sunDir = new THREE.Vector3(-0.5, 0.42, -0.76).normalize();
  const sunDisc = new THREE.Mesh(new THREE.CircleGeometry(11, 32), new THREE.MeshBasicMaterial({ color: T0.moonDisc, fog: false, depthWrite: false }));
  const halo = new THREE.Mesh(new THREE.CircleGeometry(40, 32), new THREE.MeshBasicMaterial({ color: T0.moonHalo, transparent: true, opacity: 0.16, fog: false, depthWrite: false }));
  for (const m of [sunDisc, halo]) { m.position.copy(sunDir).multiplyScalar(240); m.lookAt(0, 0, 0); scene.add(m); }
  halo.renderOrder = -9; sunDisc.renderOrder = -8;

  // lights
  const hemi = new THREE.HemisphereLight(T0.hemi[0], T0.hemi[1], T0.hemi[2]);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(T0.moon[0], T0.moon[1]);
  sun.position.set(-40 * bk, 48 * bk, -55 * bk);
  const sh = ARENA * 1.2 + 6;
  sun.shadow.camera.left = -sh; sun.shadow.camera.right = sh;
  sun.shadow.camera.top = sh; sun.shadow.camera.bottom = -sh;
  sun.shadow.camera.near = 5; sun.shadow.camera.far = 170 * bk + 40;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.04;
  sun.shadow.camera.updateProjectionMatrix();
  scene.add(sun);

  // floor
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(ARENA * 2, ARENA * 2), new THREE.MeshStandardMaterial({ map: floorTexture(T0, map), roughness: 0.92 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  // ground outside the arena
  const outer = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), new THREE.MeshStandardMaterial({ color: T0.ground, roughness: 1 }));
  outer.rotation.x = -Math.PI / 2;
  outer.position.y = -0.02;
  scene.add(outer);

  // gameplay walls
  for (const w of map.walls) buildWallMesh(scene, w);

  // outer colonnade wall with pilasters and a gold frieze
  const T = 2, H = 9;
  const sides = [
    [0, -ARENA - T / 2, ARENA * 2 + T * 2, T], [0, ARENA + T / 2, ARENA * 2 + T * 2, T],
    [-ARENA - T / 2, 0, T, ARENA * 2], [ARENA + T / 2, 0, T, ARENA * 2],
  ];
  for (const [x, z, w, d] of sides) {
    box(scene, w, H, d, x, H / 2, z, MARBLE_DARK);
    box(scene, w + 0.3, 0.4, d + 0.3, x, H + 0.2, z, GOLD_MAT);
    box(scene, w + 0.1, 0.25, d + 0.1, x, H - 1.2, z, GOLD_MAT);
  }
  for (let i = -ARENA + 3; i <= ARENA - 3; i += 6) {
    for (const [px, pz] of [[i, -ARENA + 0.45], [i, ARENA - 0.45], [-ARENA + 0.45, i], [ARENA - 0.45, i]]) {
      box(scene, 0.9, H - 0.5, 0.9, px, (H - 0.5) / 2 + 0.25, pz, MARBLE);
    }
  }
  flushBatches(scene);
  // team banners on the wall behind each team's spawn (none in free-for-all)
  if (map.spawns) {
    const cx = map.spawns.reduce((a, q) => a + q.x, 0) / map.spawns.length;
    const cz = map.spawns.reduce((a, q) => a + q.z, 0) / map.spawns.length;
    for (const team of [0, 1]) {
      const sgn = team === 0 ? 1 : -1;
      const bx = cx * sgn, bz = cz * sgn;
      const onZ = Math.abs(bz) >= Math.abs(bx);
      const tex = bannerTexture(TEAM_COLOR[team]);
      const b = new THREE.Mesh(new THREE.PlaneGeometry(5, 8.5), new THREE.MeshBasicMaterial({ map: tex, color: 0xb0b0b8, side: THREE.DoubleSide }));
      if (onZ) { b.position.set(bx, 4.9, Math.sign(bz) * (ARENA - 0.1)); b.rotation.y = bz < 0 ? 0 : Math.PI; }
      else { b.position.set(Math.sign(bx) * (ARENA - 0.1), 4.9, bz); b.rotation.y = bx < 0 ? Math.PI / 2 : -Math.PI / 2; }
      scene.add(b);
    }
  }

  // torches: decorative braziers around the walls, and (costly) real lights on only four of them
  const clear = (x, z) => !map.walls.some((w) => x > w.minX - 0.9 && x < w.maxX + 0.9 && z > w.minZ - 0.9 && z < w.maxZ + 0.9)
    && !(map.hazards || []).some((h) => Math.hypot(x - h.x, z - h.z) < h.r + 1.2);
  const edge = ARENA - 1.4;
  const q = ARENA * 0.45;
  const deco = [[q, -edge], [-q, -edge], [q, edge], [-q, edge]];
  if (ARENA >= 40) deco.push([-edge, q], [-edge, -q], [edge, q], [edge, -q]); // big maps: a few more so the walls are not bare
  for (const [x, z] of deco) if (clear(x, z)) torch(scene, x, z);
  for (const [x, z] of [[-edge, 0], [edge, 0], [0, -edge], [0, edge]]) if (clear(x, z)) torch(scene, x, z, 1.25, true);

  // hazards (lava pits): glowing animated disc, dark rim stones and flames
  const lava = [];
  const bigHaz = [...(map.hazards || [])].sort((a, b) => b.r - a.r).slice(0, 2); // only the two biggest pits get a real light
  for (const h of map.hazards || []) {
    h.lit = bigHaz.includes(h);
    const lm = new THREE.MeshBasicMaterial({ color: 0xff4a10 });
    const disc = new THREE.Mesh(new THREE.CircleGeometry(h.r, 48), lm);
    disc.rotation.x = -Math.PI / 2; disc.position.set(h.x, 0.04, h.z);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(h.r + 0.15, 0.22, 8, 48), SAND_DARK);
    rim.rotation.x = Math.PI / 2; rim.position.set(h.x, 0.1, h.z);
    scene.add(disc, rim);
    lava.push(lm);
    for (let i = 0; i < 9; i++) {
      const f = new THREE.Mesh(flameGeo, flameMats[i % 2]);
      const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * (h.r - 0.5);
      f.position.set(h.x + Math.cos(a) * d, 0.05, h.z + Math.sin(a) * d);
      f.scale.set(1.6, 1.6, 1.6);
      f.userData.phase = Math.random() * 6.28;
      scene.add(f);
      flames.push(f);
    }
    if (h.lit) {
      const glow = new THREE.PointLight(0xff5a1a, 90, 26, 2);
      glow.position.set(h.x, 2.2, h.z);
      scene.add(glow);
      torchLights.push(glow);
    }
  }

  // distant mountains (hazy silhouettes)
  const mtnMat = new THREE.MeshStandardMaterial({ color: T0.mountain, roughness: 1, flatShading: true });
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2 + Math.random() * 0.2;
    const r = 150 + Math.random() * 30;
    const h = 45 + Math.random() * 55;
    const m = new THREE.Mesh(new THREE.ConeGeometry(34 + Math.random() * 30, h, 7), mtnMat);
    m.position.set(Math.cos(a) * r, h / 2 - 2, Math.sin(a) * r);
    scene.add(m);
  }
  // drifting clouds
  const clouds = [];
  const cloudMat = new THREE.MeshBasicMaterial({ color: T0.cloud, transparent: true, opacity: 0.35, fog: false, depthWrite: false });
  for (let i = 0; i < 9; i++) {
    const c = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), cloudMat);
    c.scale.set(24 + Math.random() * 20, 4 + Math.random() * 3, 9 + Math.random() * 6);
    const a = Math.random() * Math.PI * 2, r = 110 + Math.random() * 80;
    c.position.set(Math.cos(a) * r, 55 + Math.random() * 40, Math.sin(a) * r);
    c.userData.speed = 0.4 + Math.random() * 0.5;
    scene.add(c);
    clouds.push(c);
  }

  function update(now, camera) {
    sky.position.copy(camera.position);
    for (const f of flames) {
      const s = 0.75 + 0.45 * Math.sin(now / 85 + f.userData.phase);
      f.scale.set(1, s, 1);
    }
    for (const lm of lava) lm.color.setRGB(1, 0.2 + 0.12 * Math.sin(now / 260), 0.04);
    for (const c of clouds) {
      c.position.x += c.userData.speed * 0.016;
      if (c.position.x > 200) c.position.x = -200;
    }
  }

  /** 'high' = shadows + full resolution, 'low' = no shadows, capped resolution. */
  function setQuality(renderer, q) {
    const high = q === 'high';
    renderer.setPixelRatio(high ? Math.min(window.devicePixelRatio || 1, 1.5) : 0.75);
    renderer.shadowMap.enabled = high;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    sun.castShadow = high;
    for (const l of torchLights) l.visible = high;
    sun.shadow.mapSize.set(1024, 1024);
    for (const c of clouds) c.visible = high;
    if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
    scene.traverse((o) => {
      if (!o.material) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.needsUpdate = true;
    });
  }

  /** Remove this arena from the scene (used when the next match is on another map). */
  function dispose() { parent.remove(scene); flames.length = 0; torchLights.length = 0; }

  return { update, setQuality, sun, dispose, map };
}

// ------------------------------------------------------------------ menu showroom
// A podium just outside the arena wall; the menu camera looks at it with the arena wall behind.
export const SHOWROOM = { x: 0, z: 46, y: 0.4 };
export function buildShowroom(parent) {
  const scene = new THREE.Group(); // the whole podium lives in one group so it can be hidden during matches
  parent.add(scene);
  const g = new THREE.Group();
  g.position.set(SHOWROOM.x, 0, SHOWROOM.z);
  const step = new THREE.Mesh(new THREE.CylinderGeometry(3.1, 3.2, 0.16, 40), SAND);
  step.position.y = 0.08;
  const top = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.6, 0.24, 40), MARBLE);
  top.position.y = 0.28;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(2.4, 0.06, 8, 48), GOLD_MAT);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.4;
  for (const m of [step, top, ring]) { m.castShadow = false; m.receiveShadow = false; g.add(m); }
  // columns behind the podium
  for (const x of [-6.5, 6.5]) column(g, 1.3, 1.3, 7, x, -4);
  scene.add(g);
  torch(scene, SHOWROOM.x - 3.6, SHOWROOM.z + 1.5, 1.4);
  torch(scene, SHOWROOM.x + 3.6, SHOWROOM.z + 1.5, 1.4);
  return scene;
}

// ------------------------------------------------------------------ player models
// One humanoid per class. Faces -z, gun hand on +x. All of them fit inside the shared hitbox
// (radius 0.5, height 1.8), so the silhouette never changes who can hit whom.
const STEEL = mat(0x9aa2b8, 0.35, 0.7);
const DARKM = mat(0x1f1c2b, 0.6, 0.2);
const SKIN = mat(0xd9b79a, 0.7);
const WHITE = mat(0xe9e5f2, 0.55);
const GLOW_CYAN = new THREE.MeshBasicMaterial({ color: 0x7ff3ff });
const GLOW_ORANGE = new THREE.MeshBasicMaterial({ color: 0xff8a3a });
const GLOW_GREEN = new THREE.MeshBasicMaterial({ color: 0x8dffb4 });
const GEO = new Map();
const geo = (key, make) => { if (!GEO.has(key)) GEO.set(key, make()); return GEO.get(key); };
const bx = (w, h, d) => geo(`b${w},${h},${d}`, () => new THREE.BoxGeometry(w, h, d));
const sp = (r) => geo(`s${r}`, () => new THREE.SphereGeometry(r, 14, 10));

function part(group, g, material, x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  const m = new THREE.Mesh(g, material);
  m.position.set(x, y, z);
  m.rotation.x = rx; m.rotation.y = ry; m.rotation.z = rz;
  if (sx !== 1 || sy !== 1 || sz !== 1) m.scale.set(sx, sy, sz);
  m.castShadow = true;
  group.add(m);
  return m;
}

export function buildModel(model, teamColor) {
  const team = new THREE.MeshStandardMaterial({ color: teamColor, roughness: 0.5, metalness: 0.15, emissive: teamColor, emissiveIntensity: 0.3 });
  const g = new THREE.Group();
  if (model === 'vanguard') {
    for (const s of [-1, 1]) part(g, bx(0.28, 0.8, 0.3), STEEL, s * 0.18, 0.4, 0);
    part(g, bx(0.86, 0.66, 0.52), team, 0, 1.1, 0);
    part(g, bx(0.7, 0.4, 0.08), STEEL, 0, 1.15, -0.3);
    part(g, bx(0.14, 0.14, 0.03), GOLD_MAT, 0, 1.17, -0.35);
    for (const s of [-1, 1]) {
      part(g, sp(0.27), STEEL, s * 0.55, 1.38, 0, 0, 0, 0, 1, 0.8, 1.1);
      part(g, bx(0.22, 0.55, 0.22), team, s * 0.56, 0.98, 0);
    }
    part(g, bx(0.1, 0.8, 0.5), STEEL, -0.7, 1.0, -0.12);
    part(g, bx(0.12, 0.1, 0.52), GOLD_MAT, -0.7, 1.42, -0.12);
    part(g, bx(0.34, 0.34, 0.36), STEEL, 0, 1.54, 0);
    part(g, bx(0.28, 0.06, 0.04), GLOW_ORANGE, 0, 1.55, -0.19);
    part(g, bx(0.06, 0.16, 0.34), GOLD_MAT, 0, 1.73, 0);
  } else if (model === 'phantom') {
    for (const s of [-1, 1]) part(g, bx(0.15, 0.8, 0.18), DARKM, s * 0.1, 0.4, 0);
    part(g, bx(0.38, 0.56, 0.22), DARKM, 0, 1.08, 0);
    part(g, bx(0.42, 0.09, 0.25), team, 0, 0.9, 0, 0, 0, 0.35);
    for (const s of [-1, 1]) part(g, bx(0.1, 0.5, 0.1), DARKM, s * 0.26, 1.06, -0.04);
    part(g, sp(0.15), DARKM, 0, 1.52, 0);
    part(g, geo('cone', () => new THREE.ConeGeometry(0.2, 0.42, 10)), DARKM, 0, 1.6, 0.03);
    for (const s of [-1, 1]) part(g, bx(0.07, 0.03, 0.02), GLOW_CYAN, s * 0.06, 1.53, -0.15);
    part(g, bx(0.5, 0.9, 0.04), team, 0, 1.0, 0.17, 0.12);
    part(g, bx(0.14, 0.05, 0.6), team, 0, 1.4, 0.4, 0.3);
  } else if (model === 'warden') {
    part(g, geo('robe', () => new THREE.CylinderGeometry(0.26, 0.5, 1.0, 16)), team, 0, 0.5, 0);
    part(g, geo('trim', () => new THREE.TorusGeometry(0.49, 0.03, 8, 28)), GOLD_MAT, 0, 0.06, 0, Math.PI / 2);
    part(g, geo('top', () => new THREE.CylinderGeometry(0.27, 0.27, 0.4, 14)), WHITE, 0, 1.2, 0);
    part(g, geo('mantle', () => new THREE.CylinderGeometry(0.3, 0.4, 0.14, 14)), GOLD_MAT, 0, 1.4, 0);
    for (const s of [-1, 1]) part(g, bx(0.12, 0.45, 0.12), WHITE, s * 0.34, 1.08, -0.03);
    part(g, sp(0.17), SKIN, 0, 1.56, 0);
    part(g, geo('halo', () => new THREE.TorusGeometry(0.24, 0.025, 8, 28)), GLOW_GREEN, 0, 1.84, 0, Math.PI / 2);
    part(g, geo('staff', () => new THREE.CylinderGeometry(0.025, 0.025, 1.7, 8)), GOLD_MAT, -0.44, 0.85, -0.15);
    part(g, sp(0.1), GLOW_GREEN, -0.44, 1.76, -0.15);
  } else { // striker
    for (const s of [-1, 1]) {
      part(g, bx(0.2, 0.8, 0.24), DARKM, s * 0.13, 0.4, 0);
      part(g, bx(0.22, 0.12, 0.32), STEEL, s * 0.13, 0.06, -0.04);
    }
    part(g, bx(0.54, 0.58, 0.32), team, 0, 1.09, 0);
    part(g, bx(0.56, 0.1, 0.34), DARKM, 0, 0.79, 0);
    part(g, bx(0.4, 0.3, 0.05), STEEL, 0, 1.15, -0.18);
    for (const s of [-1, 1]) part(g, bx(0.14, 0.5, 0.14), team, s * 0.36, 1.06, -0.05);
    part(g, sp(0.18), SKIN, 0, 1.55, 0);
    part(g, geo('helm', () => new THREE.SphereGeometry(0.2, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2)), DARKM, 0, 1.56, 0);
    part(g, bx(0.3, 0.07, 0.05), GLOW_CYAN, 0, 1.55, -0.18);
    part(g, bx(0.34, 0.4, 0.16), DARKM, 0, 1.1, 0.24);
  }
  return g;
}
