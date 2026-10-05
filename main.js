import * as THREE from 'three';
import {
  DT, EYE_H, FIRE_INTERVAL, SPELLS, MODELS, SLOT_KEYS, SLOT_COUNT, DEFAULT_LOADOUT, DEFAULT_MODEL,
  MOVE_SPEED, VERSION, stepPlayer, lookDir, rayWorld, spawnPoint,
} from '/sim.js';
import { TEAM_COLOR, buildWorld, buildShowroom, SHOWROOM } from '/world.js';

// Must match VERSION in sim.js and what the server reports at /version. If someone uploads only some files, the menu warns.
const CLIENT_VERSION = '0.3.0';

const $ = (id) => document.getElementById(id);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const angDiff = (a, b) => { let d = a - b; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };
const INTERP_MS = 80; // render other players this far in the past (snapshots arrive at 30 Hz)

// ------------------------------------------------------------------ settings
const store = {
  get(k, d) { try { const v = localStorage.getItem('aimarena.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('aimarena.' + k, JSON.stringify(v)); } catch { /* ignore */ } },
};
const cfg = {
  name: store.get('name', 'Player'),
  mode: store.get('mode', 2),
  sens: store.get('sens', 1),
  loadout: store.get('loadout3', DEFAULT_LOADOUT),
  model: store.get('model', DEFAULT_MODEL),
  quality: store.get('quality', 'high'),
};
if (!Array.isArray(cfg.loadout) || cfg.loadout.length > SLOT_COUNT || !cfg.loadout.every((s) => SPELLS[s])) cfg.loadout = [...DEFAULT_LOADOUT];
if (!MODELS[cfg.model]) cfg.model = DEFAULT_MODEL;
if (cfg.quality !== 'low') cfg.quality = 'high';
const TEAM_COLOR_CSS = ['#3b82ff', '#ff5436'];

// ------------------------------------------------------------------ audio
let actx = null;
function audio() {
  if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch { /* ignore */ } }
  return actx;
}
function beep(freq = 440, dur = 0.08, type = 'square', vol = 0.05, slide = 0) {
  const a = audio();
  if (!a) return;
  const o = a.createOscillator(), g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, a.currentTime);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), a.currentTime + dur);
  g.gain.setValueAtTime(vol, a.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + dur);
  o.connect(g).connect(a.destination);
  o.start();
  o.stop(a.currentTime + dur);
}

// ------------------------------------------------------------------ menu
const ICON = {
  dash: '\u{1F4A8}', shield: '\u{1F6E1}️', heal: '\u{1F49A}', shockwave: '\u{1F4A5}', bind: '⛓️',
  firepool: '\u{1F30B}', nova: '❄️', incendiary: '\u{1F525}', barbed: '\u{1FA78}', explosive: '\u{1F4A3}',
};
const MODEL_SWATCH = { striker: '#d9d4c7', vanguard: '#9b7be8', phantom: '#4fd8e8', warden: '#7be08a' };
const statBar = (label, v, max) => `<div class="stat">${label}<i><u style="width:${Math.round((v / max) * 100)}%"></u></i></div>`;

function renderMenu() {
  $('name').value = cfg.name;
  $('m2').classList.toggle('on', cfg.mode === 2);
  $('m3').classList.toggle('on', cfg.mode === 3);
  $('qh').classList.toggle('on', cfg.quality === 'high');
  $('ql').classList.toggle('on', cfg.quality === 'low');
  $('sens').value = cfg.sens;
  $('sensv').textContent = Number(cfg.sens).toFixed(2);

  const mbox = $('modelpick');
  mbox.innerHTML = '';
  for (const [id, m] of Object.entries(MODELS)) {
    const b = document.createElement('button');
    b.className = 'modelcard' + (cfg.model === id ? ' on' : '');
    b.innerHTML = `<div class="sw" style="background:${MODEL_SWATCH[id]}"></div><b>${m.name}</b>` +
      statBar('HP', m.hp, 130) + statBar('SPD', m.speed, 8) + statBar('HEAL', m.healMult, 1.5);
    b.onclick = () => { cfg.model = id; renderMenu(); setPreview(id); };
    mbox.appendChild(b);
  }
  $('modeldesc').textContent = MODELS[cfg.model].desc;

  const slots = $('slots');
  slots.innerHTML = '';
  for (let i = 0; i < SLOT_COUNT; i++) {
    const id = cfg.loadout[i];
    const d = document.createElement('div');
    if (id) {
      d.className = 'slot filled';
      d.innerHTML = `<span class="k">${SLOT_KEYS[i]}</span><span class="x">&#10005;</span><div class="ic">${ICON[id]}</div><div class="nm">${SPELLS[id].name}</div>`;
      d.onclick = () => { cfg.loadout = cfg.loadout.filter((x) => x !== id); renderMenu(); };
    } else {
      d.className = 'slot';
      d.innerHTML = `<span class="k">${SLOT_KEYS[i]}</span><div class="empty">pick a skill</div>`;
    }
    slots.appendChild(d);
  }

  const box = $('spellpick');
  box.innerHTML = '';
  for (const [id, s] of Object.entries(SPELLS)) {
    const slot = cfg.loadout.indexOf(id);
    const b = document.createElement('button');
    b.className = 'spellcard' + (slot >= 0 ? ' on' : '');
    b.innerHTML = `${slot >= 0 ? `<span class="badge">${SLOT_KEYS[slot]}</span>` : ''}<span class="ic">${ICON[id]}</span><span><b>${s.name}</b><small>${s.desc} (${s.cd}s)</small></span>`;
    b.onclick = () => {
      if (slot >= 0) cfg.loadout = cfg.loadout.filter((x) => x !== id);
      else if (cfg.loadout.length < SLOT_COUNT) cfg.loadout = [...cfg.loadout, id];
      renderMenu();
    };
    box.appendChild(b);
  }
  const ready = cfg.loadout.length === SLOT_COUNT;
  $('play').disabled = !ready;
  $('play').textContent = ready ? 'PLAY' : `PICK ${SLOT_COUNT - cfg.loadout.length} MORE SKILL${SLOT_COUNT - cfg.loadout.length > 1 ? 'S' : ''}`;
}
$('m2').onclick = () => { cfg.mode = 2; renderMenu(); };
$('m3').onclick = () => { cfg.mode = 3; renderMenu(); };
$('qh').onclick = () => { cfg.quality = 'high'; renderMenu(); applyQuality(); };
$('ql').onclick = () => { cfg.quality = 'low'; renderMenu(); applyQuality(); };
$('sens').oninput = (e) => { cfg.sens = Number(e.target.value); $('sensv').textContent = cfg.sens.toFixed(2); };
$('ver').textContent = `v${CLIENT_VERSION}`;

// Warn when the uploaded files and the running server are different versions (the "old menu" problem).
fetch('/version', { cache: 'no-store' }).then((r) => r.json()).then((j) => {
  if (j.version !== CLIENT_VERSION || VERSION !== CLIENT_VERSION) {
    const w = $('verwarn');
    w.classList.remove('hidden');
    w.textContent = `Version mismatch: page ${CLIENT_VERSION}, server ${j.version}. Some files were not updated on GitHub. Upload ALL files, wait for Render to redeploy, then hard-refresh (Ctrl+Shift+R).`;
  }
}).catch(() => {});

// ------------------------------------------------------------------ three.js scene
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(80, 1, 0.05, 400);
camera.rotation.order = 'YXZ';
scene.add(camera);
const world = buildWorld(scene);
buildShowroom(scene);
function applyQuality() { world.setQuality(renderer, cfg.quality); resize(); }
function resize() {
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  viewOffsetOn = false;
}
let viewOffsetOn = false;
window.addEventListener('resize', resize);
applyQuality();

// viewmodel gun (child of camera)
const gun = new THREE.Group();
{
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 0.5), new THREE.MeshStandardMaterial({ color: 0x20263d, roughness: 0.5, metalness: 0.4 }));
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.084, 0.02, 0.3), new THREE.MeshBasicMaterial({ color: 0xe2b84a }));
  stripe.position.set(0, 0.055, -0.05);
  const flash = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffe9a0 }));
  flash.position.set(0, 0, -0.32);
  flash.visible = false;
  gun.add(body, stripe, flash);
  gun.position.set(0.22, -0.2, -0.5);
  gun.userData.flash = flash;
  camera.add(gun);
}

// ------------------------------------------------------------------ entities
const ents = new Map();
const gunGeo = new THREE.BoxGeometry(0.1, 0.12, 0.6);
const darkMat = new THREE.MeshStandardMaterial({ color: 0x15192b, roughness: 0.5 });
const shieldGeo = new THREE.SphereGeometry(1.15, 20, 14);
const auraGeo = new THREE.SphereGeometry(0.95, 16, 12);
const glowMat = (color, opacity) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false });
const AURA_MATS = { burn: glowMat(0xff6a1a, 0.32), bleed: glowMat(0xd01030, 0.3), slow: glowMat(0x6ab8ff, 0.28) };
const discGeo = new THREE.CircleGeometry(0.62, 24);
const rootGeo = new THREE.RingGeometry(0.55, 0.75, 28);
const rootMat = new THREE.MeshBasicMaterial({ color: 0xb36bff, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false });

// Each model gets its own silhouette (hitbox is identical for all models).
const geoCache = new Map();
function modelParts(model) {
  if (geoCache.has(model)) return geoCache.get(model);
  const T = (g, x, y, z) => { g.translate(x, y, z); return g; };
  let parts;
  if (model === 'vanguard') {
    parts = {
      body: T(new THREE.BoxGeometry(0.85, 1.3, 0.55), 0, 0.65, 0), head: T(new THREE.SphereGeometry(0.24, 16, 12), 0, 1.57, 0),
      extras: [T(new THREE.BoxGeometry(0.32, 0.26, 0.55), -0.58, 1.25, 0), T(new THREE.BoxGeometry(0.32, 0.26, 0.55), 0.58, 1.25, 0)],
    };
  } else if (model === 'phantom') {
    parts = {
      body: T(new THREE.CylinderGeometry(0.2, 0.34, 1.3, 14), 0, 0.65, 0), head: T(new THREE.SphereGeometry(0.2, 16, 12), 0, 1.55, 0),
      extras: [T(new THREE.BoxGeometry(0.34, 0.07, 0.12), 0, 1.58, -0.17)], bright: true,
    };
  } else if (model === 'warden') {
    parts = {
      body: T(new THREE.CylinderGeometry(0.4, 0.34, 1.3, 14), 0, 0.65, 0), head: T(new THREE.SphereGeometry(0.22, 16, 12), 0, 1.55, 0),
      extras: [T(new THREE.TorusGeometry(0.3, 0.035, 8, 24), 0, 1.98, 0)], halo: true,
    };
  } else {
    parts = { body: T(new THREE.CylinderGeometry(0.38, 0.38, 1.3, 14), 0, 0.65, 0), head: T(new THREE.SphereGeometry(0.22, 16, 12), 0, 1.55, 0), extras: [] };
  }
  geoCache.set(model, parts);
  return parts;
}
const brightMat = new THREE.MeshBasicMaterial({ color: 0xaaf6ff });
const haloMat = new THREE.MeshBasicMaterial({ color: 0xfff3a0 });

function makeEntity(pd) {
  const color = TEAM_COLOR[pd.tm];
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.1, emissive: color, emissiveIntensity: 0.3 });
  const group = new THREE.Group();
  const parts = modelParts(pd.md || DEFAULT_MODEL);
  group.add(new THREE.Mesh(parts.body, mat), new THREE.Mesh(parts.head, mat));
  for (const g of parts.extras) group.add(new THREE.Mesh(g, parts.bright ? brightMat : parts.halo ? haloMat : mat));
  const g = new THREE.Mesh(gunGeo, darkMat);
  g.position.set(0.3, 1.0, -0.4);
  group.add(g);
  const shield = new THREE.Mesh(shieldGeo, new THREE.MeshBasicMaterial({ color: 0x7fe9ff, transparent: true, opacity: 0.22, depthWrite: false }));
  shield.position.y = 0.9;
  shield.visible = false;
  group.add(shield);
  // status auras (burning / bleeding / slowed) and a ring on the floor while rooted
  const auras = {};
  for (const k of Object.keys(AURA_MATS)) {
    const a = new THREE.Mesh(auraGeo, AURA_MATS[k]);
    a.position.y = 0.9;
    a.visible = false;
    group.add(a);
    auras[k] = a;
  }
  const root = new THREE.Mesh(rootGeo, rootMat);
  root.rotation.x = -Math.PI / 2;
  root.position.y = 0.06;
  root.visible = false;
  group.add(root);

  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 72;
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sprite.scale.set(2.2, 0.62, 1);
  sprite.position.y = 2.25;
  sprite.renderOrder = 10;
  group.add(sprite);
  group.traverse((o) => { if (o.isMesh && o !== shield && !Object.values(auras).includes(o) && o !== root) o.castShadow = true; });
  const disc = new THREE.Mesh(discGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, depthWrite: false }));
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = 0.035;
  group.add(disc);
  scene.add(group);
  return { group, shield, auras, root, sprite, cv, tex, key: '', x: pd.x, y: pd.y, z: pd.z, yaw: pd.yaw, pit: pd.pit };
}

// Menu showroom: the chosen model turns on a podium next to the menu panel.
let preview = null;
function setPreview(modelId) {
  if (preview) scene.remove(preview.group);
  preview = makeEntity({ tm: 0, md: modelId, x: 0, y: 0, z: 0, yaw: 0, pit: 0 });
  preview.sprite.visible = false;
  preview.group.scale.setScalar(1.35);
  preview.group.position.set(SHOWROOM.x, SHOWROOM.y, SHOWROOM.z);
}

function drawTag(ent, pd, ally) {
  const key = `${pd.n}|${pd.hp}|${pd.mh}|${ally}`;
  if (key === ent.key) return;
  ent.key = key;
  const g = ent.cv.getContext('2d');
  g.clearRect(0, 0, 256, 72);
  g.font = 'bold 30px system-ui, sans-serif';
  g.textAlign = 'center';
  g.lineWidth = 5; g.strokeStyle = 'rgba(0,0,0,.8)';
  g.fillStyle = ally ? '#4ade80' : '#ff7a62';
  g.strokeText(pd.n, 128, 30); g.fillText(pd.n, 128, 30);
  g.fillStyle = 'rgba(0,0,0,.75)'; g.fillRect(28, 42, 200, 16);
  g.fillStyle = ally ? '#4ade80' : '#ff5436';
  g.fillRect(30, 44, 196 * clamp(pd.hp / (pd.mh || 100), 0, 1), 12);
  ent.tex.needsUpdate = true;
}

// ------------------------------------------------------------------ effects
const effects = [];
function addEffect(obj, dur, update) {
  scene.add(obj);
  effects.push({ obj, t0: performance.now(), dur: dur * 1000, update });
}
function addTracer(a, b, color, dur = 0.1, width = 0.012) {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  const len = Math.hypot(dx, dy, dz);
  if (len < 0.01) return;
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 });
  const m = new THREE.Mesh(new THREE.CylinderGeometry(width, width, len, 5), mat);
  m.position.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(dx / len, dy / len, dz / len));
  addEffect(m, dur, (f) => { mat.opacity = 0.9 * (1 - f); });
}

// Fire pools: one group per server zone id (flat glowing disc + flickering flames).
const zoneMeshes = new Map();
const zoneDiscGeo = new THREE.CircleGeometry(1, 40);
const zoneEdgeGeo = new THREE.RingGeometry(0.92, 1, 40);
const flameGeo = new THREE.ConeGeometry(0.22, 1, 6);
const zoneDiscMat = new THREE.MeshBasicMaterial({ color: 0xff5a14, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false });
const zoneEdgeMat = new THREE.MeshBasicMaterial({ color: 0xffb04a, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false });
const flameMat = new THREE.MeshBasicMaterial({ color: 0xffa21f, transparent: true, opacity: 0.8, depthWrite: false });
function syncZones(zn) {
  const ids = new Set();
  for (const z of zn) {
    ids.add(z.id);
    let m = zoneMeshes.get(z.id);
    if (!m) {
      const group = new THREE.Group();
      const disc = new THREE.Mesh(zoneDiscGeo, zoneDiscMat);
      disc.rotation.x = -Math.PI / 2; disc.position.y = 0.04; disc.scale.set(z.r, z.r, 1);
      const edge = new THREE.Mesh(zoneEdgeGeo, zoneEdgeMat);
      edge.rotation.x = -Math.PI / 2; edge.position.y = 0.05; edge.scale.set(z.r, z.r, 1);
      group.add(disc, edge);
      const flames = [];
      const count = Math.max(4, Math.round(z.r * 3));
      for (let i = 0; i < count; i++) {
        const f = new THREE.Mesh(flameGeo, flameMat);
        const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * z.r * 0.85;
        f.position.set(Math.cos(a) * d, 0.3, Math.sin(a) * d);
        f.userData.phase = Math.random() * 6.28;
        group.add(f);
        flames.push(f);
      }
      group.position.set(z.x, 0, z.z);
      group.userData.flames = flames;
      scene.add(group);
      m = group;
      zoneMeshes.set(z.id, m);
    }
    m.userData.t = z.t;
  }
  for (const [id, m] of zoneMeshes) {
    if (!ids.has(id)) { scene.remove(m); zoneMeshes.delete(id); }
  }
}
function animateZones(now) {
  for (const m of zoneMeshes.values()) {
    for (const f of m.userData.flames) {
      const s = 0.7 + 0.5 * Math.sin(now / 90 + f.userData.phase);
      f.scale.set(1, s, 1);
      f.position.y = 0.05 + s * 0.5;
    }
  }
  const pulse = 0.3 + 0.1 * Math.sin(now / 150);
  zoneDiscMat.opacity = pulse;
}
function ring(x, y, z, color, maxR, dur, vertical = false) {
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false });
  const m = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 40), mat);
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, y + 0.05, z);
  addEffect(m, dur, (f) => {
    m.scale.setScalar(0.3 + maxR * f);
    if (vertical) m.position.y = y + 0.05 + f * 1.8;
    mat.opacity = 0.8 * (1 - f);
  });
}

// ------------------------------------------------------------------ game state
let ws = null;
let playing = false, locked = false, mouseDown = false;
let myId = -1, myTeam = 0;
let yaw = 0, pitch = 0;
let seq = 0, pending = [];
let fireCd = 0, kick = 0, flashT = 0;
let castQ = false, castE = false, castR = false;
const keys = {};
const me = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, dvx: 0, dvz: 0, dashT: 0, rootT: 0, slowT: 0, speed: MOVE_SPEED };
let meAlive = true, meHp = 100, meMax = 100, meSf = 0, meBf = 0, meCd = [0, 0, 0], meLoadout = cfg.loadout, cdAt = 0;
const errOff = { x: 0, y: 0, z: 0 };
let snaps = [], latest = null, snapAt = 0;
let phase = 'countdown', phaseT = 0;
let pingMs = 0;

const toState = (st) => ({ x: st.x, y: st.y, z: st.z, vx: st.vx, vy: st.vy, vz: st.vz, dvx: st.dvx, dvz: st.dvz, dashT: st.dashT, rootT: st.rootT || 0, slowT: st.slowT || 0 });

function buildSpellHud() {
  const box = $('spells');
  box.innerHTML = '';
  meLoadout.forEach((id, i) => {
    const d = document.createElement('div');
    d.className = 'spell';
    d.innerHTML = `<div class="rdy">READY</div><div class="key">${SLOT_KEYS[i]}</div><div class="ic">${ICON[id]}</div><div class="nm">${SPELLS[id].name}</div><div class="cdo"></div><div class="cdt"></div>`;
    box.appendChild(d);
  });
}

// ------------------------------------------------------------------ networking
function connect() {
  ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`);
  ws.onopen = () => {
    ws.send(JSON.stringify({ t: 'join', name: cfg.name, mode: cfg.mode, loadout: cfg.loadout, model: cfg.model }));
    setInterval(() => { if (ws.readyState === 1) ws.send(JSON.stringify({ t: 'ping', ts: performance.now() })); }, 2000);
  };
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.t === 'welcome') {
      myId = m.id; myTeam = m.team; meLoadout = m.loadout; playing = true;
      me.speed = (MODELS[m.model] || MODELS[DEFAULT_MODEL]).speed;
      const sp = spawnPoint(m.team, 0, m.mode);
      yaw = sp.yaw;
      buildSpellHud();
      $('hud').classList.remove('hidden');
      $('scB').classList.toggle('mine', myTeam === 0);
      $('scR').classList.toggle('mine', myTeam === 1);
    } else if (m.t === 's') onSnapshot(m);
    else if (m.t === 'pong') pingMs = Math.round(performance.now() - m.ts);
    else if (m.t === 'full') showMessage('Match is full', 'Try again in a moment.');
  };
  ws.onclose = () => { if (playing) showMessage('Disconnected', 'The server connection was lost.'); };
  ws.onerror = () => showMessage('Cannot connect', 'Is the server running?');
}

function showMessage(title, sub) {
  playing = false;
  if (document.pointerLockElement) document.exitPointerLock();
  $('msgt').textContent = title;
  $('msgs').textContent = sub;
  $('msg').classList.remove('hidden');
  $('pause').classList.add('hidden');
}

function onSnapshot(d) {
  const now = performance.now();
  d.byId = {};
  for (const p of d.p) d.byId[p.id] = p;
  snaps.push({ t: now, d });
  if (snaps.length > 30) snaps.shift();
  latest = d; snapAt = now;
  phase = d.ph; phaseT = d.pt;

  const mp = d.byId[myId];
  if (mp) { meAlive = !!mp.a; meHp = mp.hp; meMax = mp.mh || 100; meSf = mp.sf || 0; meBf = mp.bf || 0; }
  syncZones(d.zn || []);

  if (d.me) {
    const px = me.x, py = me.y, pz = me.z;
    Object.assign(me, toState(d.me.st));
    meCd = d.me.cd; cdAt = now;
    pending = pending.filter((i) => i.seq > d.me.ack);
    if (meAlive && phase !== 'countdown') for (const i of pending) stepPlayer(me, i, DT);
    const ox = px - me.x, oy = py - me.y, oz = pz - me.z;
    if (Math.hypot(ox, oy, oz) < 3) { errOff.x += ox; errOff.y += oy; errOff.z += oz; }
    else { errOff.x = errOff.y = errOff.z = 0; }
  }
  for (const ev of d.ev) handleEvent(ev, d);
  updateRoster(d);
}

function nameOf(id) { const p = latest && latest.byId[id]; return p ? p.n : '?'; }

function handleEvent(ev, d) {
  const cam = camera.position;
  if (ev.k === 'shot') {
    if (ev.id === myId) return;
    const shooter = d.byId[ev.id];
    addTracer([ev.ox, ev.oy - 0.25, ev.oz], [ev.ex, ev.ey, ev.ez], shooter ? TEAM_COLOR[shooter.tm] : 0xffffff);
    const dist = Math.hypot(ev.ox - cam.x, ev.oz - cam.z);
    const vol = 0.04 * clamp(1 - dist / 60, 0, 1);
    if (vol > 0.002) beep(300, 0.07, 'square', vol, -120);
  } else if (ev.k === 'hit') {
    if (ev.a === myId) {
      const h = $('hitm');
      h.classList.toggle('head', !!ev.head);
      h.classList.add('on');
      setTimeout(() => h.classList.remove('on'), 90);
      beep(ev.head ? 1500 : 900, 0.07, 'sine', 0.08);
    }
    if (ev.v === myId) {
      const f = $('flash');
      f.classList.add('on');
      setTimeout(() => f.classList.remove('on'), 60);
      beep(140, 0.15, 'sawtooth', 0.07, -60);
    }
  } else if (ev.k === 'kill') {
    const row = document.createElement('div');
    const a = d.byId[ev.a], v = d.byId[ev.v];
    const col = (p) => (p && p.tm === 0 ? '#6fa3ff' : '#ff7a62');
    row.innerHTML = `<span style="color:${col(a)}">${nameOf(ev.a)}</span> ${ev.head ? '&#127919;' : '&#10140;'} <span style="color:${col(v)}">${nameOf(ev.v)}</span>`;
    $('killfeed').appendChild(row);
    setTimeout(() => row.remove(), 5000);
    if (ev.a === myId) beep(600, 0.18, 'triangle', 0.09, 500);
  } else if (ev.k === 'spell') {
    if (ev.s === 'shockwave') { ring(ev.x, ev.y, ev.z, 0xffb347, 6.5, 0.45); beep(90, 0.3, 'sawtooth', 0.08, -40); }
    else if (ev.s === 'heal') { ring(ev.x, ev.y, ev.z, 0x4ade80, 1.2, 0.7, true); beep(520, 0.25, 'sine', 0.06, 400); }
    else if (ev.s === 'shield') { ring(ev.x, ev.y, ev.z, 0x7fe9ff, 1.4, 0.5); beep(700, 0.2, 'triangle', 0.05, -300); }
    else if (ev.s === 'dash') { ring(ev.x, ev.y, ev.z, 0xffffff, 1.6, 0.3); beep(250, 0.15, 'sawtooth', 0.04, 400); }
    else if (ev.s === 'nova') { ring(ev.x, ev.y, ev.z, 0x6ab8ff, ev.r + 0.5, 0.5); beep(180, 0.3, 'triangle', 0.07, 500); }
    else if (ev.s === 'firepool') { ring(ev.tx, 0, ev.tz, 0xff7a1a, ev.r + 0.5, 0.6); beep(120, 0.35, 'sawtooth', 0.07, 200); }
    else if (ev.s === 'bind') {
      const shooter = d.byId[ev.id];
      addTracer([ev.ox, ev.oy - 0.25, ev.oz], [ev.ex, ev.ey, ev.ez], 0xb36bff, 0.3, 0.035);
      if (!ev.hit) beep(300, 0.12, 'sine', 0.04, -150);
      if (shooter && ev.id === myId) beep(420, 0.1, 'triangle', 0.05, 200);
    }
    else if (ev.s === 'incendiary') { ring(ev.x, ev.y, ev.z, 0xff7a1a, 1.5, 0.5, true); beep(260, 0.2, 'sawtooth', 0.05, 200); }
    else if (ev.s === 'barbed') { ring(ev.x, ev.y, ev.z, 0xd01030, 1.5, 0.5, true); beep(200, 0.2, 'sawtooth', 0.05, -80); }
    else if (ev.s === 'explosive') { ring(ev.x, ev.y, ev.z, 0xffd23f, 1.5, 0.5, true); beep(330, 0.2, 'square', 0.05, 200); }
  } else if (ev.k === 'bound') {
    const v = d.byId[ev.v];
    if (v) { ring(v.x, v.y, v.z, 0xb36bff, 1.4, 0.6); beep(150, 0.25, 'square', 0.06, -60); }
  } else if (ev.k === 'blast') {
    ring(ev.x, ev.y, ev.z, 0xffa21f, ev.r + 0.5, 0.35);
    beep(110, 0.25, 'sawtooth', 0.06, -50);
  }
}

function updateRoster(d) {
  const mine = d.p.filter((p) => p.tm === myTeam), theirs = d.p.filter((p) => p.tm !== myTeam);
  const row = (p) => `<div class="r ${p.a ? '' : 'dead'}"><span class="nm" style="color:${p.tm === 0 ? '#6fa3ff' : '#ff7a62'}">${p.n}${p.id === myId ? ' (you)' : p.b ? ' &#9881;' : ''}</span>` +
    `<span class="bar"><i style="width:${Math.min(100, Math.round((p.hp / (p.mh || 100)) * 100))}%;background:${p.tm === myTeam ? '#4ade80' : '#ff5436'}"></i></span></div>`;
  $('roster').innerHTML = mine.map(row).join('') + '<hr>' + theirs.map(row).join('');
  const sc = d.sc;
  $('scB').textContent = sc[0];
  $('scR').textContent = sc[1];
  $('rd').textContent = `ROUND ${d.rd} · FIRST TO 3`;
}

// ------------------------------------------------------------------ input
window.addEventListener('keydown', (e) => {
  if (!playing) return;
  if (e.code === 'Tab') e.preventDefault();
  if (e.repeat) return;
  keys[e.code] = true;
  if (e.code === 'KeyQ') castQ = true;
  if (e.code === 'KeyE') castE = true;
  if (e.code === 'KeyR') castR = true;
  if (e.code === 'Space') e.preventDefault();
});
window.addEventListener('keyup', (e) => { keys[e.code] = false; });
window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; mouseDown = false; });
canvas.addEventListener('mousedown', (e) => {
  if (!playing) return;
  if (!locked) { canvas.requestPointerLock(); return; }
  if (e.button === 0) mouseDown = true;
});
window.addEventListener('mouseup', (e) => { if (e.button === 0) mouseDown = false; });
window.addEventListener('contextmenu', (e) => e.preventDefault());
window.addEventListener('mousemove', (e) => {
  if (!locked || !playing) return;
  const s = 0.0022 * cfg.sens;
  yaw -= e.movementX * s;
  pitch = clamp(pitch - e.movementY * s, -1.5, 1.5);
});
document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === canvas;
  if (!locked) mouseDown = false;
  $('pause').classList.toggle('hidden', locked || !playing);
});

$('play').onclick = () => {
  cfg.name = ($('name').value || 'Player').trim().slice(0, 14) || 'Player';
  store.set('name', cfg.name); store.set('mode', cfg.mode); store.set('sens', cfg.sens); store.set('loadout3', cfg.loadout); store.set('model', cfg.model); store.set('quality', cfg.quality);
  audio();
  $('menu').classList.add('hidden');
  connect();
  canvas.requestPointerLock();
};
$('resume').onclick = () => canvas.requestPointerLock();
$('leave').onclick = () => location.reload();

// ------------------------------------------------------------------ fixed-step update (60 Hz)
function step() {
  if (!playing || !ws || ws.readyState !== 1) return;
  fireCd = Math.max(0, fireCd - DT);
  if (!meAlive || phase === 'countdown') { castQ = castE = castR = false; return; }
  const inp = {
    seq: ++seq,
    mx: (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0),
    mz: (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0),
    yaw, pitch,
    jump: !!keys.Space,
    shoot: mouseDown && locked,
    q: castQ, e: castE, r: castR,
  };
  // Tell the server which moment of the world we are looking at, so it can rewind enemies to match.
  if (inp.shoot || inp.q || inp.e || inp.r) inp.vt = viewTick(performance.now());
  castQ = castE = castR = false;
  stepPlayer(me, inp, DT);
  pending.push(inp);
  if (pending.length > 120) pending.shift();
  ws.send(JSON.stringify({ t: 'in', ...inp }));
  if (inp.shoot && phase === 'live' && fireCd <= 0) { fireCd = FIRE_INTERVAL; localShot(); }
}

/** Fractional server tick that other players are currently drawn at (same logic as sampleRemote). */
function viewTick(now) {
  if (!snaps.length) return 0;
  const rt = now - INTERP_MS;
  for (let i = snaps.length - 1; i >= 0; i--) {
    if (snaps[i].t <= rt) {
      const a = snaps[i], b = snaps[i + 1];
      if (!b) return a.d.n;
      return a.d.n + (b.d.n - a.d.n) * clamp((rt - a.t) / (b.t - a.t), 0, 1);
    }
  }
  return snaps[0].d.n;
}

function localShot() {
  const [dx, dy, dz] = lookDir(yaw, pitch);
  const ex = me.x, ey = me.y + EYE_H, ez = me.z;
  let t = rayWorld(ex, ey, ez, dx, dy, dz, 80);
  if (!Number.isFinite(t)) t = 80;
  const rx = Math.cos(yaw), rz = -Math.sin(yaw);
  const start = [ex + rx * 0.25 + dx * 0.7, ey - 0.22 + dy * 0.7, ez + rz * 0.25 + dz * 0.7];
  addTracer(start, [ex + dx * t, ey + dy * t, ez + dz * t], TEAM_COLOR[myTeam]);
  flashT = 0.04;
  kick = 0.07;
  beep(220, 0.06, 'square', 0.05, -100);
}

// ------------------------------------------------------------------ rendering
const setText = (el, v) => { if (el.textContent !== v) el.textContent = v; };

function sampleRemote(id, now) {
  if (!snaps.length) return null;
  const rt = now - INTERP_MS;
  let a = null, b = null;
  for (let i = snaps.length - 1; i >= 0; i--) {
    if (snaps[i].t <= rt) { a = snaps[i]; b = snaps[i + 1] || null; break; }
  }
  if (!a) { a = snaps[0]; b = null; }
  const pa = a.d.byId[id], pb = b ? b.d.byId[id] : null;
  if (!pa && !pb) return null;
  if (pa && pb) {
    const f = clamp((rt - a.t) / (b.t - a.t), 0, 1);
    return {
      x: pa.x + (pb.x - pa.x) * f, y: pa.y + (pb.y - pa.y) * f, z: pa.z + (pb.z - pa.z) * f,
      yaw: pa.yaw + angDiff(pb.yaw, pa.yaw) * f, pit: pa.pit + (pb.pit - pa.pit) * f,
    };
  }
  return pa || pb;
}

let last = performance.now(), acc = 0;
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  acc += dt;
  let n = 0;
  while (acc >= DT && n < 8) { step(); acc -= DT; n++; }
  if (n >= 8) acc = 0;
  render(dt, now);
  requestAnimationFrame(frame);
}

function render(dt, now) {
  if (!playing || !latest) {
    // menu: camera looks at the podium; the view is shifted so the model sits right of the menu panel
    const t = now / 1000;
    const W = window.innerWidth, H = window.innerHeight;
    const panel = Math.min(560, W);
    if (!viewOffsetOn) { camera.setViewOffset(W, H, W > 700 ? -panel / 2 : 0, 0, W, H); viewOffsetOn = true; }
    camera.position.set(SHOWROOM.x + Math.sin(t * 0.15) * 0.8, SHOWROOM.y + 1.7, SHOWROOM.z + 7.2);
    camera.lookAt(SHOWROOM.x, SHOWROOM.y + 1.1, SHOWROOM.z);
    gun.visible = false;
    if (preview) {
      preview.group.visible = true;
      preview.group.rotation.y = Math.PI + t * 0.7;
      preview.group.position.y = SHOWROOM.y;
    }
    world.update(now, camera);
    animateZones(now);
    renderer.render(scene, camera);
    return;
  }
  if (viewOffsetOn) { camera.clearViewOffset(); viewOffsetOn = false; }
  if (preview) preview.group.visible = false;

  world.update(now, camera);
  // entities
  const seen = new Set();
  let spectateTarget = null;
  for (const pd of latest.p) {
    seen.add(pd.id);
    let ent = ents.get(pd.id);
    if (ent && ent.model !== (pd.md || DEFAULT_MODEL)) { scene.remove(ent.group); ents.delete(pd.id); ent = null; }
    if (!ent) { ent = makeEntity(pd); ent.model = pd.md || DEFAULT_MODEL; ents.set(pd.id, ent); }
    if (pd.id === myId) { ent.group.visible = false; continue; }
    const s = sampleRemote(pd.id, now) || pd;
    ent.x = s.x; ent.y = s.y; ent.z = s.z; ent.yaw = s.yaw; ent.pit = s.pit;
    ent.group.visible = !!pd.a;
    ent.group.position.set(s.x, s.y, s.z);
    ent.group.rotation.y = s.yaw;
    ent.shield.visible = !!pd.sh;
    ent.auras.burn.visible = !!(pd.sf & 4);
    ent.auras.bleed.visible = !!(pd.sf & 8) && !(pd.sf & 4);
    ent.auras.slow.visible = !!(pd.sf & 2) && !(pd.sf & 12);
    ent.root.visible = !!(pd.sf & 1);
    drawTag(ent, pd, pd.tm === myTeam);
    if (pd.a && pd.tm === myTeam && !spectateTarget) spectateTarget = ent;
  }
  for (const [id, ent] of ents) {
    if (!seen.has(id)) { scene.remove(ent.group); ents.delete(id); }
  }
  if (!spectateTarget) {
    for (const pd of latest.p) {
      const ent = ents.get(pd.id);
      if (pd.a && pd.id !== myId && ent) { spectateTarget = ent; break; }
    }
  }

  // camera
  const decay = Math.exp(-12 * dt);
  errOff.x *= decay; errOff.y *= decay; errOff.z *= decay;
  if (meAlive) {
    camera.position.set(me.x + errOff.x, me.y + EYE_H + errOff.y, me.z + errOff.z);
    camera.rotation.set(pitch, yaw, 0);
    gun.visible = true;
  } else if (spectateTarget) {
    camera.position.set(spectateTarget.x, spectateTarget.y + EYE_H, spectateTarget.z);
    camera.rotation.set(spectateTarget.pit, spectateTarget.yaw, 0);
    gun.visible = false;
  }

  // viewmodel recoil + muzzle flash
  kick = Math.max(0, kick - dt * 0.5);
  flashT = Math.max(0, flashT - dt);
  gun.position.z = -0.5 + kick * 2;
  gun.userData.flash.visible = flashT > 0;

  animateZones(now);

  // effects
  for (let i = effects.length - 1; i >= 0; i--) {
    const e = effects[i];
    const f = (now - e.t0) / e.dur;
    if (f >= 1) {
      scene.remove(e.obj);
      if (e.obj.geometry) e.obj.geometry.dispose();
      if (e.obj.material) e.obj.material.dispose();
      effects.splice(i, 1);
    } else e.update(f);
  }

  renderer.render(scene, camera);
  updateHud(now);
}

function updateHud(now) {
  setText($('hpval'), String(meAlive ? meHp : 0));
  const hf = $('hpfill');
  hf.style.width = `${meAlive ? clamp(meHp / meMax, 0, 1) * 100 : 0}%`;
  hf.style.background = meHp > 50 ? '#4ade80' : meHp > 25 ? '#facc15' : '#f87171';

  const spells = $('spells').children;
  for (let i = 0; i < spells.length; i++) {
    const total = SPELLS[meLoadout[i]].cd;
    const rem = Math.max(0, (meCd[i] || 0) - (now - cdAt) / 1000);
    const isReady = rem <= 0.05 && meAlive;
    spells[i].classList.toggle('ready', isReady);
    spells[i].querySelector('.cdo').style.height = isReady ? '0%' : `${clamp(rem / total, 0, 1) * 100}%`;
    // READY shows the glowing icon and no number; cooling down shows seconds left (tenths under 1s so it never sits on "1")
    setText(spells[i].querySelector('.cdt'), isReady || !meAlive ? '' : rem < 1 ? rem.toFixed(1) : String(Math.ceil(rem)));
  }

  const BUFF_BIT = { incendiary: 1, barbed: 2, explosive: 4 };
  for (let i = 0; i < spells.length; i++) spells[i].classList.toggle('buffed', !!(meAlive && (meBf & (BUFF_BIT[meLoadout[i]] || 0))));
  const tags = [];
  if (meAlive) {
    if (meSf & 1) tags.push('<span style="color:#b36bff">ROOTED</span>');
    if (meSf & 2) tags.push('<span style="color:#6ab8ff">SLOWED</span>');
    if (meSf & 4) tags.push('<span style="color:#ff8a3a">BURNING</span>');
    if (meSf & 8) tags.push('<span style="color:#ff4060">BLEEDING</span>');
    if (meBf & 1) tags.push('<span style="color:#ffb04a">INCENDIARY ROUNDS</span>');
    if (meBf & 2) tags.push('<span style="color:#ff6a80">BARBED ROUNDS</span>');
    if (meBf & 4) tags.push('<span style="color:#ffd23f">EXPLOSIVE ROUNDS</span>');
  }
  const tagHtml = tags.join('');
  const st = $('status');
  if (st.innerHTML !== tagHtml) st.innerHTML = tagHtml;

  const sinceSnap = (now - snapAt) / 1000;
  const rt = phase === 'live' ? Math.max(0, latest.rt - sinceSnap) : latest.rt;
  setText($('timer'), `${Math.floor(rt / 60)}:${String(Math.floor(rt % 60)).padStart(2, '0')}`);

  let big = '', small = '';
  if (phase === 'countdown') {
    big = String(Math.max(1, Math.ceil(phaseT - sinceSnap)));
    small = `ROUND ${latest.rd}`;
  } else if (phase === 'roundEnd') {
    big = latest.lw === -1 ? 'DRAW' : latest.lw === myTeam ? 'ROUND WON' : 'ROUND LOST';
  } else if (phase === 'matchEnd') {
    big = latest.w === myTeam ? 'VICTORY' : 'DEFEAT';
    small = 'NEXT MATCH STARTING...';
  }
  const banner = $('banner');
  const html = big ? `${big}${small ? `<small>${small}</small>` : ''}` : '';
  if (banner.innerHTML !== html) banner.innerHTML = html;

  $('spectate').classList.toggle('hidden', meAlive || phase === 'countdown');
  setText($('ping'), `${pingMs} ms`);
}

setPreview(cfg.model);
renderMenu();
requestAnimationFrame(frame);

// Small read-only handle used by automated browser tests.
window.__aim = {
  me, errOff, ents,
  get phase() { return phase; },
  get latest() { return latest; },
  get pending() { return pending; },
  get alive() { return meAlive; },
  forceFire(v) { locked = v; mouseDown = v; },
};
