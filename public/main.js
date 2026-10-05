import * as THREE from 'three';
import {
  DT, ARENA, WALLS, EYE_H, MAX_HP, FIRE_INTERVAL, SPELLS, stepPlayer, lookDir, rayWorld, spawnPoint,
} from '/shared/sim.js';

const $ = (id) => document.getElementById(id);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const angDiff = (a, b) => { let d = a - b; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };
const INTERP_MS = 100;
const TEAM_COLOR = [0x3b82ff, 0xff5436];

// ------------------------------------------------------------------ settings
const store = {
  get(k, d) { try { const v = localStorage.getItem('aimarena.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('aimarena.' + k, JSON.stringify(v)); } catch { /* ignore */ } },
};
const cfg = {
  name: store.get('name', 'Player'),
  mode: store.get('mode', 2),
  sens: store.get('sens', 1),
  loadout: store.get('loadout', ['dash', 'heal']),
};
if (!Array.isArray(cfg.loadout) || cfg.loadout.length !== 2 || !cfg.loadout.every((s) => SPELLS[s])) cfg.loadout = ['dash', 'heal'];

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
function renderMenu() {
  $('name').value = cfg.name;
  $('m2').classList.toggle('on', cfg.mode === 2);
  $('m3').classList.toggle('on', cfg.mode === 3);
  $('sens').value = cfg.sens;
  $('sensv').textContent = Number(cfg.sens).toFixed(2);
  const box = $('spellpick');
  box.innerHTML = '';
  for (const [id, s] of Object.entries(SPELLS)) {
    const b = document.createElement('button');
    b.className = 'spellcard' + (cfg.loadout.includes(id) ? ' on' : '');
    b.innerHTML = `<b>${s.name}</b><small>${s.desc} (${s.cd}s)</small>`;
    b.onclick = () => {
      if (cfg.loadout.includes(id)) cfg.loadout = cfg.loadout.filter((x) => x !== id);
      else cfg.loadout = [...cfg.loadout, id].slice(-2);
      renderMenu();
    };
    box.appendChild(b);
  }
  $('play').disabled = cfg.loadout.length !== 2;
}
$('m2').onclick = () => { cfg.mode = 2; renderMenu(); };
$('m3').onclick = () => { cfg.mode = 3; renderMenu(); };
$('sens').oninput = (e) => { cfg.sens = Number(e.target.value); $('sensv').textContent = cfg.sens.toFixed(2); };
renderMenu();

// ------------------------------------------------------------------ three.js scene
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0f1e);
scene.fog = new THREE.Fog(0x0a0f1e, 35, 120);
const camera = new THREE.PerspectiveCamera(80, 1, 0.05, 300);
camera.rotation.order = 'YXZ';
scene.add(camera);
function resize() {
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

scene.add(new THREE.HemisphereLight(0xaac4ff, 0x1a1f33, 1.2));
const sun = new THREE.DirectionalLight(0xffffff, 1.3);
sun.position.set(20, 40, 10);
scene.add(sun);

function gridTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#131a2e'; g.fillRect(0, 0, 256, 256);
  g.strokeStyle = '#1c2748'; g.lineWidth = 1;
  for (let i = 64; i < 256; i += 64) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 256); g.moveTo(0, i); g.lineTo(256, i); g.stroke(); }
  g.strokeStyle = '#2b3a6b'; g.lineWidth = 3; g.strokeRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
{
  const tex = gridTexture();
  tex.repeat.set((ARENA * 2) / 4, (ARENA * 2) / 4);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(ARENA * 2, ARENA * 2), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 }));
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  for (const team of [0, 1]) {
    const pad = new THREE.Mesh(new THREE.PlaneGeometry(16, 6), new THREE.MeshBasicMaterial({ color: TEAM_COLOR[team], transparent: true, opacity: 0.18 }));
    pad.rotation.x = -Math.PI / 2;
    pad.position.set(0, 0.02, team === 0 ? -(ARENA - 4) : ARENA - 4);
    scene.add(pad);
  }

  const wallMat = new THREE.MeshStandardMaterial({ color: 0x2a3558, roughness: 0.8 });
  const lowMat = new THREE.MeshStandardMaterial({ color: 0x3a4f8a, roughness: 0.8 });
  const edgeMat = new THREE.LineBasicMaterial({ color: 0x7f9bff });
  for (const w of WALLS) {
    const sx = w.maxX - w.minX, sz = w.maxZ - w.minZ;
    const geo = new THREE.BoxGeometry(sx, w.h, sz);
    const m = new THREE.Mesh(geo, w.h < 2 ? lowMat : wallMat);
    m.position.set((w.minX + w.maxX) / 2, w.h / 2, (w.minZ + w.maxZ) / 2);
    scene.add(m);
    const e = new THREE.LineSegments(new THREE.EdgesGeometry(geo), edgeMat);
    e.position.copy(m.position);
    scene.add(e);
  }
  const bMat = new THREE.MeshStandardMaterial({ color: 0x1b2442, roughness: 0.9 });
  const bh = 8, th = 1;
  const borders = [
    [0, -ARENA - th / 2, ARENA * 2 + th * 2, th], [0, ARENA + th / 2, ARENA * 2 + th * 2, th],
    [-ARENA - th / 2, 0, th, ARENA * 2], [ARENA + th / 2, 0, th, ARENA * 2],
  ];
  for (const [x, z, w, d] of borders) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, bh, d), bMat);
    m.position.set(x, bh / 2, z);
    scene.add(m);
  }
}

// viewmodel gun (child of camera)
const gun = new THREE.Group();
{
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 0.5), new THREE.MeshStandardMaterial({ color: 0x20263d, roughness: 0.5, metalness: 0.4 }));
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.084, 0.02, 0.3), new THREE.MeshBasicMaterial({ color: 0x7f9bff }));
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
const bodyGeo = new THREE.CylinderGeometry(0.38, 0.38, 1.3, 14); bodyGeo.translate(0, 0.65, 0);
const headGeo = new THREE.SphereGeometry(0.22, 16, 12); headGeo.translate(0, 1.55, 0);
const gunGeo = new THREE.BoxGeometry(0.1, 0.12, 0.6);
const darkMat = new THREE.MeshStandardMaterial({ color: 0x15192b, roughness: 0.5 });
const shieldGeo = new THREE.SphereGeometry(1.15, 20, 14);

function makeEntity(pd) {
  const color = TEAM_COLOR[pd.tm];
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.1, emissive: color, emissiveIntensity: 0.25 });
  const group = new THREE.Group();
  group.add(new THREE.Mesh(bodyGeo, mat), new THREE.Mesh(headGeo, mat));
  const g = new THREE.Mesh(gunGeo, darkMat);
  g.position.set(0.3, 1.0, -0.4);
  group.add(g);
  const shield = new THREE.Mesh(shieldGeo, new THREE.MeshBasicMaterial({ color: 0x7fe9ff, transparent: true, opacity: 0.22, depthWrite: false }));
  shield.position.y = 0.9;
  shield.visible = false;
  group.add(shield);

  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 72;
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sprite.scale.set(2.2, 0.62, 1);
  sprite.position.y = 2.25;
  sprite.renderOrder = 10;
  group.add(sprite);
  scene.add(group);
  return { group, shield, sprite, cv, tex, key: '', x: pd.x, y: pd.y, z: pd.z, yaw: pd.yaw, pit: pd.pit };
}

function drawTag(ent, pd, ally) {
  const key = `${pd.n}|${pd.hp}|${ally}`;
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
  g.fillRect(30, 44, 196 * clamp(pd.hp / MAX_HP, 0, 1), 12);
  ent.tex.needsUpdate = true;
}

// ------------------------------------------------------------------ effects
const effects = [];
function addEffect(obj, dur, update) {
  scene.add(obj);
  effects.push({ obj, t0: performance.now(), dur: dur * 1000, update });
}
function addTracer(a, b, color) {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  const len = Math.hypot(dx, dy, dz);
  if (len < 0.01) return;
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 });
  const m = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, len, 5), mat);
  m.position.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(dx / len, dy / len, dz / len));
  addEffect(m, 0.1, (f) => { mat.opacity = 0.9 * (1 - f); });
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
let castQ = false, castE = false;
const keys = {};
const me = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, dvx: 0, dvz: 0, dashT: 0 };
let meAlive = true, meHp = MAX_HP, meCd = [0, 0], meLoadout = cfg.loadout, cdAt = 0;
const errOff = { x: 0, y: 0, z: 0 };
let snaps = [], latest = null, snapAt = 0;
let phase = 'countdown', phaseT = 0;
let pingMs = 0;

const toState = (st) => ({ x: st.x, y: st.y, z: st.z, vx: st.vx, vy: st.vy, vz: st.vz, dvx: st.dvx, dvz: st.dvz, dashT: st.dashT });

function buildSpellHud() {
  const box = $('spells');
  box.innerHTML = '';
  meLoadout.forEach((id, i) => {
    const d = document.createElement('div');
    d.className = 'spell';
    d.innerHTML = `<div class="key">${i === 0 ? 'Q' : 'E'}</div><div class="nm">${SPELLS[id].name}</div><div class="cdo"></div><div class="cdt"></div>`;
    box.appendChild(d);
  });
}

// ------------------------------------------------------------------ networking
function connect() {
  ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`);
  ws.onopen = () => {
    ws.send(JSON.stringify({ t: 'join', name: cfg.name, mode: cfg.mode, loadout: cfg.loadout }));
    setInterval(() => { if (ws.readyState === 1) ws.send(JSON.stringify({ t: 'ping', ts: performance.now() })); }, 2000);
  };
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.t === 'welcome') {
      myId = m.id; myTeam = m.team; meLoadout = m.loadout; playing = true;
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
  if (mp) { meAlive = !!mp.a; meHp = mp.hp; }

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
  }
}

function updateRoster(d) {
  const mine = d.p.filter((p) => p.tm === myTeam), theirs = d.p.filter((p) => p.tm !== myTeam);
  const row = (p) => `<div class="r ${p.a ? '' : 'dead'}"><span class="nm" style="color:${p.tm === 0 ? '#6fa3ff' : '#ff7a62'}">${p.n}${p.id === myId ? ' (you)' : p.b ? ' &#9881;' : ''}</span>` +
    `<span class="bar"><i style="width:${p.hp}%;background:${p.tm === myTeam ? '#4ade80' : '#ff5436'}"></i></span></div>`;
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
  store.set('name', cfg.name); store.set('mode', cfg.mode); store.set('sens', cfg.sens); store.set('loadout', cfg.loadout);
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
  if (!meAlive || phase === 'countdown') { castQ = castE = false; return; }
  const inp = {
    seq: ++seq,
    mx: (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0),
    mz: (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0),
    yaw, pitch,
    jump: !!keys.Space,
    shoot: mouseDown && locked,
    q: castQ, e: castE,
  };
  castQ = castE = false;
  stepPlayer(me, inp, DT);
  pending.push(inp);
  if (pending.length > 120) pending.shift();
  ws.send(JSON.stringify({ t: 'in', ...inp }));
  if (inp.shoot && phase === 'live' && fireCd <= 0) { fireCd = FIRE_INTERVAL; localShot(); }
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
    // menu background: slow orbit
    const t = now / 1000;
    camera.position.set(Math.sin(t * 0.1) * 42, 20, Math.cos(t * 0.1) * 42);
    camera.lookAt(0, 0, 0);
    gun.visible = false;
    renderer.render(scene, camera);
    return;
  }

  // entities
  const seen = new Set();
  let spectateTarget = null;
  for (const pd of latest.p) {
    seen.add(pd.id);
    let ent = ents.get(pd.id);
    if (!ent) { ent = makeEntity(pd); ents.set(pd.id, ent); }
    if (pd.id === myId) { ent.group.visible = false; continue; }
    const s = sampleRemote(pd.id, now) || pd;
    ent.x = s.x; ent.y = s.y; ent.z = s.z; ent.yaw = s.yaw; ent.pit = s.pit;
    ent.group.visible = !!pd.a;
    ent.group.position.set(s.x, s.y, s.z);
    ent.group.rotation.y = s.yaw;
    ent.shield.visible = !!pd.sh;
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
  hf.style.width = `${meAlive ? clamp(meHp / MAX_HP, 0, 1) * 100 : 0}%`;
  hf.style.background = meHp > 50 ? '#4ade80' : meHp > 25 ? '#facc15' : '#f87171';

  const spells = $('spells').children;
  for (let i = 0; i < spells.length; i++) {
    const total = SPELLS[meLoadout[i]].cd;
    const rem = Math.max(0, (meCd[i] || 0) - (now - cdAt) / 1000);
    spells[i].classList.toggle('ready', rem <= 0 && meAlive);
    spells[i].querySelector('.cdo').style.height = `${clamp(rem / total, 0, 1) * 100}%`;
    setText(spells[i].querySelector('.cdt'), rem > 0 ? String(Math.ceil(rem)) : '');
  }

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
