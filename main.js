import * as THREE from 'three';
import {
  DT, EYE_H, eyeH, FIRE_INTERVAL, LOOK_UNLOCK, levelFor, xpForLevel, clampLook, MAX_LEVEL, LOADOUT_BUDGET, loadoutCost, AMMO_START, AMMO_KILL, SPELLS, MODELS, SLOT_KEYS, SLOT_COUNT, DEFAULT_LOADOUT, DEFAULT_MODEL, BODY_DMG, HEAD_DMG,
  MOVE_SPEED, VERSION, dayKey, dailyFor, msUntilDailyReset, MAPS, LOOK_PARTS, LOOK_PALETTES, DEFAULT_LOOK, sanitizeLook, randomLook, decodeLook, encodeLook, MAP_IDS, TEAM_MAP_IDS, FFA_MAP_IDS, DEFAULT_MAP, useMap, stepPlayer, lookDir, rayWorld, spawnPoint,
} from '/sim.js';
import { buildRifle } from '/weapon.js';
import { TEAM_COLOR, buildWorld, buildShowroom, buildModel, lookKey, setCharacterDetail, SHOWROOM } from '/world.js';

// Must match VERSION in sim.js and what the server reports at /version. If someone uploads only some files, the menu warns.
const CLIENT_VERSION = '0.8.6';

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
  volume: Number(store.get('volume', 0.7)),
  loadout: store.get('loadout3', DEFAULT_LOADOUT),
  look: sanitizeLook(store.get('look', { model: store.get('model', DEFAULT_MODEL) })),
  quality: store.get('quality', 'high'),
  map: store.get('map', DEFAULT_MAP),     // last team map
  ffaMap: store.get('ffaMap', FFA_MAP_IDS[0]), // last free-for-all map
  team: store.get('team', -1),
};
if (!Array.isArray(cfg.loadout) || cfg.loadout.length > SLOT_COUNT || !cfg.loadout.every((s) => SPELLS[s]) || loadoutCost(cfg.loadout) > LOADOUT_BUDGET) cfg.loadout = [...DEFAULT_LOADOUT];
if (cfg.quality !== 'low') cfg.quality = 'high';
if (!TEAM_MAP_IDS.includes(cfg.map)) cfg.map = DEFAULT_MAP;
if (!FFA_MAP_IDS.includes(cfg.ffaMap)) cfg.ffaMap = FFA_MAP_IDS[0];
if (![2, 3, 'ffa'].includes(cfg.mode)) cfg.mode = 2;
const isFfaMode = () => cfg.mode === 'ffa';
const chosenMap = () => (isFfaMode() ? cfg.ffaMap : cfg.map);
if (![-1, 0, 1].includes(cfg.team)) cfg.team = -1;
const TEAM_COLOR_CSS = ['#3b82ff', '#ff5436'];
// Free-for-all: everyone else is an enemy; give each player their own colour so they can be told apart.
const FFA_COLORS = [0xff5436, 0xffb020, 0xb36bff, 0x35d0a0, 0xff6fb5, 0x9be04a, 0x4fd8e8, 0xe8e8e8];
let inFfa = false;
const colorOf = (tm) => (inFfa ? FFA_COLORS[tm % FFA_COLORS.length] : TEAM_COLOR[tm]);
const cssOf = (tm) => (inFfa ? hex(FFA_COLORS[tm % FFA_COLORS.length]) : TEAM_COLOR_CSS[tm]);

// ------------------------------------------------------------------ audio
let actx = null, master = null;
function audio() {
  if (!actx) {
    try {
      actx = new (window.AudioContext || window.webkitAudioContext)();
      // master chain: volume -> gentle low-pass (takes the sting off) -> compressor (no sudden loud peaks) -> speakers
      master = actx.createGain();
      master.gain.value = Number.isFinite(cfg.volume) ? cfg.volume : 0.7;
      const lp = actx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 5200; lp.Q.value = 0.5;
      const comp = actx.createDynamicsCompressor(); comp.threshold.value = -18; comp.ratio.value = 6;
      master.connect(lp); lp.connect(comp); comp.connect(actx.destination);
    } catch { /* ignore */ }
  }
  return actx;
}
const setVolume = (v) => { cfg.volume = v; if (master) master.gain.value = v; };
const SOFTEN = { square: 'triangle', sawtooth: 'triangle' }; // buzzy waves become rounder ones
function beep(freq = 440, dur = 0.08, type = 'square', vol = 0.05, slide = 0) {
  const a = audio();
  if (!a || !master || cfg.volume <= 0) return;
  const o = a.createOscillator(), g = a.createGain(), t0 = a.currentTime;
  o.type = SOFTEN[type] || type;
  o.frequency.setValueAtTime(freq, t0);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(vol * 0.85, t0 + 0.006); // short fade-in: no click
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(master);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}

function noise(dur = 0.1, vol = 0.05, freq = 2000, type = 'bandpass', q = 1) {
  const a = audio();
  if (!a || !master || cfg.volume <= 0) return;
  const n = Math.max(1, Math.floor(a.sampleRate * dur));
  const buf = a.createBuffer(1, n, a.sampleRate), data = buf.getChannelData(0);
  for (let i = 0; i < n; i++) { const k = 1 - i / n; data[i] = (Math.random() * 2 - 1) * k * k; }
  const src = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
  src.buffer = buf; f.type = type; f.frequency.value = Math.min(freq, 4500); f.Q.value = q; g.gain.value = vol;
  src.connect(f).connect(g).connect(master);
  src.start();
}
const later = (ms, fn) => setTimeout(fn, ms);
/** Every kind of hit and effect has its own sound, so you can tell what just happened with your eyes closed. */
const SFX = {
  // rifle: a soft "thump" and a short breath of noise, instead of a buzzing tone
  shot(vol = 1) { noise(0.09, 0.075 * vol, 1500, 'bandpass', 0.7); beep(130, 0.11, 'sine', 0.13 * vol, -70); },
  dry() { noise(0.025, 0.04, 2500, 'bandpass', 1.2); },
  arm() { beep(520, 0.06, 'sine', 0.04, 160); },
  hitBody() { beep(620, 0.06, 'sine', 0.07, -80); },
  hitHead() { beep(880, 0.07, 'sine', 0.07); later(50, () => beep(1320, 0.1, 'sine', 0.06)); },
  hitOver(head) { beep(110, 0.25, 'sine', 0.15, -60); noise(0.1, 0.07, 2500, 'bandpass'); later(40, () => beep(head ? 1500 : 900, 0.12, 'sine', 0.06, 300)); },
  hitBind() { beep(1000, 0.05, 'sine', 0.06); later(55, () => beep(780, 0.06, 'sine', 0.06)); later(110, () => beep(200, 0.14, 'sine', 0.08, -60)); },
  hitShield() { beep(760, 0.18, 'sine', 0.07); beep(1140, 0.14, 'sine', 0.04); },
  hitBarbed() { noise(0.12, 0.06, 700, 'lowpass'); beep(260, 0.1, 'sine', 0.06, -100); },
  hitNova() { beep(1500, 0.12, 'sine', 0.05, -500); beep(1900, 0.1, 'sine', 0.035, -600); },
  hurt() { beep(150, 0.14, 'sine', 0.09, -50); noise(0.06, 0.03, 600, 'lowpass'); },
  hurtOver() { beep(70, 0.3, 'sine', 0.18, -30); noise(0.16, 0.07, 400, 'lowpass'); },
  kill() { beep(520, 0.12, 'sine', 0.08); later(90, () => beep(780, 0.2, 'sine', 0.08)); },
  poly() { for (let i = 0; i < 4; i++) later(i * 70, () => beep(i % 2 ? 420 : 340, 0.09, 'sine', 0.05, i % 2 ? -30 : 30)); },
  trap() { noise(0.05, 0.07, 3500, 'bandpass'); beep(150, 0.16, 'sine', 0.1, -60); },
  trapPlace() { beep(420, 0.05, 'sine', 0.045); later(70, () => beep(320, 0.07, 'sine', 0.045)); },
  mark() { beep(900, 0.16, 'sine', 0.06); later(130, () => beep(900, 0.12, 'sine', 0.03)); },
  gravity() { beep(70, 0.5, 'sine', 0.13, 110); noise(0.4, 0.04, 300, 'lowpass'); },
  overcharge() { beep(240, 0.3, 'sine', 0.06, 500); later(200, () => beep(1000, 0.1, 'sine', 0.05)); },
  whoosh(f = 300, vol = 0.05) { noise(0.22, vol, f, 'bandpass', 0.6); },
};
const hitSound = (tg, head) => {
  if (tg === 'oc') SFX.hitOver(head);
  else if (tg === 'bd') SFX.hitBind();
  else if (tg === 'sh') SFX.hitShield();
  else if (tg === 'bl') SFX.hitBarbed();
  else if (tg === 'nv') SFX.hitNova();
  else if (head) SFX.hitHead(); else SFX.hitBody();
};

// ------------------------------------------------------------------ keybinds
// A bind is a keyboard code ('KeyW') or a mouse code: 'Mouse0' left, 'Mouse1' middle, 'Mouse2' right,
// 'Mouse3' / 'Mouse4' side buttons, 'WheelUp' / 'WheelDown'.
const DEFAULT_BINDS = {
  forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD', jump: 'Space',
  crouch: 'KeyC', crouch2: 'ShiftLeft', shoot: 'Mouse0', skill1: 'KeyQ', skill2: 'KeyE', skill3: 'KeyR',
};
const BIND_LABELS = {
  forward: 'Move forward', back: 'Move back', left: 'Move left', right: 'Move right', jump: 'Jump',
  crouch: 'Crouch', crouch2: 'Crouch (second key)', shoot: 'Fire', skill1: 'Skill 1', skill2: 'Skill 2', skill3: 'Skill 3',
};
const binds = { ...DEFAULT_BINDS };
{
  const saved = store.get('binds', {});
  for (const k of Object.keys(DEFAULT_BINDS)) if (saved && typeof saved[k] === 'string' && saved[k].length < 24) binds[k] = saved[k];
}
const MOUSE_NAMES = { Mouse0: 'Left Click', Mouse1: 'Middle Click', Mouse2: 'Right Click', Mouse3: 'Mouse 4', Mouse4: 'Mouse 5', WheelUp: 'Wheel Up', WheelDown: 'Wheel Down' };
const MOUSE_SHORT = { Mouse0: 'LMB', Mouse1: 'MMB', Mouse2: 'RMB', Mouse3: 'M4', Mouse4: 'M5', WheelUp: 'Wh↑', WheelDown: 'Wh↓' };
function keyName(code, short = false) {
  if (!code) return '-';
  if (short && MOUSE_SHORT[code]) return MOUSE_SHORT[code];
  if (MOUSE_NAMES[code]) return MOUSE_NAMES[code];
  if (code.startsWith('Mouse')) return `Mouse ${Number(code.slice(5)) + 1}`;
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  const map = { Space: 'Space', ShiftLeft: 'L-Shift', ShiftRight: 'R-Shift', ControlLeft: 'L-Ctrl', ControlRight: 'R-Ctrl', AltLeft: 'L-Alt', AltRight: 'R-Alt', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Tab: 'Tab', CapsLock: 'Caps' };
  return map[code] || code;
}
const slotLabel = (i) => keyName(binds[`skill${i + 1}`], true);
let listening = null; // action currently being rebound
function renderBinds() {
  const box = $('bindlist');
  box.innerHTML = '';
  for (const act of Object.keys(DEFAULT_BINDS)) {
    const row = document.createElement('div');
    row.className = 'bindrow';
    const label = document.createElement('span');
    label.textContent = BIND_LABELS[act];
    const btn = document.createElement('button');
    btn.className = listening === act ? 'listening' : '';
    btn.textContent = listening === act ? 'press a key or mouse button...' : keyName(binds[act]);
    btn.onclick = (e) => { if (listening) return; listening = act; renderBinds(); e.stopPropagation(); };
    row.append(label, btn);
    box.appendChild(row);
  }
}
function setBind(act, code) {
  for (const other of Object.keys(binds)) if (other !== act && binds[other] === code) binds[other] = binds[act]; // swap
  binds[act] = code;
  store.set('binds', binds);
}
function finishBind(code) {
  if (code) setBind(listening, code);
  listening = null;
  renderBinds();
  if (typeof buildSpellHud === 'function' && playing) buildSpellHud();
  renderMenu();
}
window.addEventListener('keydown', (e) => {
  if (!listening) return;
  e.preventDefault(); e.stopPropagation();
  finishBind(e.code === 'Escape' ? null : e.code);
}, true);
// While a bind is waiting, any mouse button or the wheel can be used (the click that started it has already finished).
window.addEventListener('mousedown', (e) => {
  if (!listening) return;
  e.preventDefault(); e.stopPropagation();
  finishBind(`Mouse${e.button}`);
}, true);
window.addEventListener('wheel', (e) => {
  if (!listening || !e.deltaY) return;
  e.preventDefault(); e.stopPropagation();
  finishBind(e.deltaY < 0 ? 'WheelUp' : 'WheelDown');
}, { capture: true, passive: false });
const openBinds = () => { listening = null; renderBinds(); $('binds').classList.remove('hidden'); };
$('controlsbtn').onclick = openBinds;
$('controlsbtn2').onclick = openBinds;
$('bindclose').onclick = () => { listening = null; $('binds').classList.add('hidden'); };
$('bindreset').onclick = () => { Object.assign(binds, DEFAULT_BINDS); store.set('binds', binds); renderBinds(); renderMenu(); if (playing) buildSpellHud(); };

// ------------------------------------------------------------------ crosshair
const DEFAULT_XH = { shape: 'cross', color: '#ffffff', length: 7, thick: 2, gap: 4, opacity: 1, outline: true, dot: true };
const XH_COLORS = ['#ffffff', '#4ade80', '#22d3ee', '#facc15', '#ff4d4d', '#ff6fb5', '#b36bff'];
const xh = { ...DEFAULT_XH };
{
  const saved = store.get('xhair', {});
  if (saved && typeof saved === 'object') {
    if (['cross', 'tcross', 'dot', 'circle'].includes(saved.shape)) xh.shape = saved.shape;
    if (typeof saved.color === 'string' && /^#[0-9a-f]{6}$/i.test(saved.color)) xh.color = saved.color;
    for (const [k, lo, hi] of [['length', 1, 20], ['thick', 1, 6], ['gap', 0, 14], ['opacity', 0.2, 1]]) if (Number.isFinite(saved[k])) xh[k] = clamp(saved[k], lo, hi);
    if (typeof saved.outline === 'boolean') xh.outline = saved.outline;
    if (typeof saved.dot === 'boolean') xh.dot = saved.dot;
  }
}
/** The crosshair as SVG (64 x 64 view box, centre at 32,32). */
function crosshairSvg(c) {
  const m = 32, L = c.length, g = c.gap, t = c.thick;
  const parts = [];
  const line = (x1, y1, x2, y2, w, col) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${col}" stroke-width="${w}" stroke-linecap="butt"/>`;
  const draw = (col, extra) => {
    if (c.shape === 'cross' || c.shape === 'tcross') {
      if (c.shape === 'cross') parts.push(line(m, m - g - L, m, m - g, t + extra, col));
      parts.push(line(m, m + g, m, m + g + L, t + extra, col));
      parts.push(line(m - g - L, m, m - g, m, t + extra, col));
      parts.push(line(m + g, m, m + g + L, m, t + extra, col));
      if (c.dot) parts.push(`<circle cx="${m}" cy="${m}" r="${t / 2 + 0.4 + extra / 2}" fill="${col}"/>`);
    } else if (c.shape === 'dot') {
      parts.push(`<circle cx="${m}" cy="${m}" r="${Math.max(1, L / 3) + extra / 2}" fill="${col}"/>`);
    } else {
      parts.push(`<circle cx="${m}" cy="${m}" r="${g + L / 2 + 2}" fill="none" stroke="${col}" stroke-width="${t + extra}"/>`);
      if (c.dot) parts.push(`<circle cx="${m}" cy="${m}" r="${t / 2 + 0.4 + extra / 2}" fill="${col}"/>`);
    }
  };
  if (c.outline) draw('#000', 2);
  draw(c.color, 0);
  return `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" opacity="${c.opacity}">${parts.join('')}</svg>`;
}
function applyCrosshair() {
  $('crosshair').innerHTML = crosshairSvg(xh);
  if (!$('xh').classList.contains('hidden')) $('xhprev').innerHTML = crosshairSvg(xh);
}
function renderXhList() {
  const box = $('xhlist');
  box.innerHTML = '';
  const row = (label, control) => {
    const r = document.createElement('div');
    r.className = 'bindrow';
    const l = document.createElement('span');
    l.textContent = label;
    r.append(l, control);
    box.appendChild(r);
  };
  const seg = (opts, cur, set) => {
    const d = document.createElement('div'); d.className = 'seg';
    for (const [v, text] of opts) {
      const b = document.createElement('button'); b.textContent = text; b.className = cur === v ? 'on' : '';
      b.onclick = () => { set(v); store.set('xhair', xh); applyCrosshair(); renderXhList(); };
      d.appendChild(b);
    }
    return d;
  };
  const slider = (key, min, max, step) => {
    const i = document.createElement('input');
    i.type = 'range'; i.min = min; i.max = max; i.step = step; i.value = xh[key];
    i.oninput = () => { xh[key] = Number(i.value); store.set('xhair', xh); applyCrosshair(); };
    return i;
  };
  row('Shape', seg([['cross', 'Cross'], ['tcross', 'T'], ['dot', 'Dot'], ['circle', 'Ring']], xh.shape, (v) => { xh.shape = v; }));
  const sw = document.createElement('div'); sw.className = 'swatches';
  for (const c of XH_COLORS) {
    const b = document.createElement('button'); b.style.background = c; b.className = xh.color.toLowerCase() === c ? 'on' : '';
    b.onclick = () => { xh.color = c; store.set('xhair', xh); applyCrosshair(); renderXhList(); };
    sw.appendChild(b);
  }
  const pick = document.createElement('input'); pick.type = 'color'; pick.value = xh.color; pick.title = 'Custom colour';
  pick.oninput = () => { xh.color = pick.value; store.set('xhair', xh); applyCrosshair(); };
  sw.appendChild(pick);
  row('Colour', sw);
  row('Size', slider('length', 1, 20, 1));
  row('Thickness', slider('thick', 1, 6, 1));
  row('Gap', slider('gap', 0, 14, 1));
  row('Opacity', slider('opacity', 0.2, 1, 0.05));
  row('Outline', seg([[true, 'On'], [false, 'Off']], xh.outline, (v) => { xh.outline = v; }));
  row('Centre dot', seg([[true, 'On'], [false, 'Off']], xh.dot, (v) => { xh.dot = v; }));
}
const openXh = () => { renderXhList(); $('xh').classList.remove('hidden'); applyCrosshair(); };
$('xhbtn').onclick = openXh;
$('xhbtn2').onclick = openXh;
$('xhclose').onclick = () => $('xh').classList.add('hidden');
$('xhreset').onclick = () => { Object.assign(xh, DEFAULT_XH); store.set('xhair', xh); renderXhList(); applyCrosshair(); };
applyCrosshair();

// ------------------------------------------------------------------ account
const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let account = null; // { username, rating, rank, wins, losses } when signed in
let token = store.get('token', '');
async function apiPost(path, body) {
  const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body || {}) });
  return r.json();
}
function renderAcct() {
  const box = $('acct');
  if (account) {
    box.innerHTML = `<div class="who"><b>${esc(account.username)}</b><span class="rankpill">${esc(account.rank)}</span><small>Lv ${levelFor(account.xp || 0)} &middot; ${account.rating} rating &middot; ${account.kills || 0} kills &middot; ${account.mwins || 0} wins</small></div><button id="logoutbtn">Log out</button>`;
    $('logoutbtn').onclick = async () => { try { await apiPost('/api/logout'); } catch { /* ignore */ } token = ''; store.set('token', ''); account = null; renderAcct(); };
  } else {
    box.innerHTML = '<div class="who">Playing as guest<small>Sign in to keep your rank and play ranked</small></div><button id="loginbtn">Sign in</button>';
    $('loginbtn').onclick = () => openAuth('login');
  }
  $('nameblock').classList.toggle('hidden', !!account);
  setRankedSub();
  renderCharSum();
  setPreview(effLook());
  if (!$('lookview').classList.contains('hidden')) renderLookView();
}
function setRankedSub() {
  $('rankedsub').textContent = isFfaMode() ? 'team modes only' : account ? `${account.rating} · ${account.rank}` : 'sign in to play';
}
async function loadAccount() {
  try {
    const st = await (await fetch('/api/status', { cache: 'no-store' })).json();
    $('persist').classList.toggle('hidden', !!st.persistent);
  } catch { /* ignore */ }
  if (token) {
    try {
      const j = await (await fetch('/api/me', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' })).json();
      if (j.ok) account = j.profile; else { token = ''; store.set('token', ''); }
    } catch { /* offline: stay a guest */ }
  }
  renderAcct();
}
let authMode = 'login';
function openAuth(mode) {
  authMode = mode;
  $('authtitle').textContent = mode === 'login' ? 'Sign in' : 'Create account';
  $('authgo').textContent = mode === 'login' ? 'SIGN IN' : 'CREATE ACCOUNT';
  $('authswitch').textContent = mode === 'login' ? 'Create account' : 'I have an account';
  $('authpass').autocomplete = mode === 'login' ? 'current-password' : 'new-password';
  $('autherr').textContent = '';
  $('auth').classList.remove('hidden');
  $('authuser').focus();
}
$('authswitch').onclick = () => openAuth(authMode === 'login' ? 'signup' : 'login');
$('authclose').onclick = () => $('auth').classList.add('hidden');
async function submitAuth() {
  const username = $('authuser').value.trim(), password = $('authpass').value;
  $('autherr').textContent = '';
  $('authgo').disabled = true;
  try {
    const j = await apiPost(authMode === 'login' ? '/api/login' : '/api/signup', { username, password });
    if (!j.ok) { $('autherr').textContent = j.error || 'Something went wrong'; return; }
    token = j.token; store.set('token', token); account = j.profile;
    $('authpass').value = '';
    $('auth').classList.add('hidden');
    renderAcct(); renderMenu();
  } catch { $('autherr').textContent = 'Cannot reach the server'; } finally { $('authgo').disabled = false; }
}
$('authgo').onclick = submitAuth;
$('authpass').addEventListener('keydown', (e) => { if (e.key === 'Enter') submitAuth(); });
$('authuser').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('authpass').focus(); });

// ------------------------------------------------------------------ menu
const ICON = {
  dash: '\u{1F4A8}', shield: '\u{1F6E1}️', heal: '\u{1F49A}', shockwave: '\u{1F4A5}', bind: '⛓️',
  firepool: '\u{1F30B}', nova: '❄️', pushback: '\u{1F32A}️', barbed: '\u{1FA78}',
  blink: '✨', grapple: '\u{1FA9D}', smoke: '☁️', decoy: '\u{1F465}',
  slowtrap: '\u{1FAA4}', mark: '\u{1F3AF}', gravity: '\u{1F300}', polymorph: '\u{1F411}', overcharge: '⚡',
};
const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;

/** The 3 keybind slots as a fixed-size array (null = empty). Removing a skill leaves its slot empty, so the next pick drops back into it. */
function slotArr(st) {
  const holes = new Set(st.holes || []);
  const arr = new Array(SLOT_COUNT).fill(null);
  let k = 0;
  for (let p = 0; p < SLOT_COUNT && k < st.loadout.length; p++) if (!holes.has(p)) arr[p] = st.loadout[k++];
  for (let p = 0; p < SLOT_COUNT && k < st.loadout.length; p++) if (!arr[p]) arr[p] = st.loadout[k++]; // stale holes: just fill what is free
  return arr;
}
function setSlots(st, arr) {
  st.loadout = arr.filter(Boolean);
  st.holes = arr.map((x, i) => (x ? -1 : i)).filter((i) => i >= 0);
}

/** 3 skills picker, used by the main menu and by the 15 second window after a match. */
function renderPicker(ids, st, onChange) {
  const slots = $(ids.slots);
  slots.innerHTML = '';
  const arr = slotArr(st);
  for (let i = 0; i < SLOT_COUNT; i++) {
    const id = arr[i];
    const d = document.createElement('div');
    if (id) {
      d.className = 'slot filled';
      d.innerHTML = `<span class="k">${esc(slotLabel(i))}</span><span class="x">&#10005;</span><div class="ic">${ICON[id]}</div><div class="nm">${SPELLS[id].name}</div>`;
      d.onclick = () => { const a = slotArr(st); a[i] = null; setSlots(st, a); onChange('skills'); };
    } else {
      d.className = 'slot';
      d.innerHTML = `<span class="k">${esc(slotLabel(i))}</span><div class="empty">pick a skill</div>`;
    }
    slots.appendChild(d);
  }

  const box = $(ids.spells);
  box.innerHTML = '';
  const used = loadoutCost(st.loadout);
  const pts = document.createElement('div');
  pts.className = 'pts' + (used >= LOADOUT_BUDGET ? ' full' : '');
  pts.textContent = `Skill points: ${used} / ${LOADOUT_BUDGET} spent`;
  box.appendChild(pts);
  for (const [id, s] of Object.entries(SPELLS)) {
    const slot = arr.indexOf(id);
    const tooCostly = slot < 0 && used + s.cost > LOADOUT_BUDGET;
    const b = document.createElement('button');
    b.className = 'spellcard' + (slot >= 0 ? ' on' : '') + (tooCostly ? ' costly' : '');
    b.innerHTML = `${slot >= 0 ? `<span class="badge">${esc(slotLabel(slot))}</span>` : ''}<span class="ic">${ICON[id]}</span><span><b>${s.name} <em class="cost">${s.cost} pt${s.cost > 1 ? 's' : ''}</em></b><small>${s.desc} (${s.cd}s)</small></span>`;
    b.onclick = () => {
      const a = slotArr(st);
      if (slot >= 0) a[slot] = null;
      else if (tooCostly) { pts.classList.add('shake'); setTimeout(() => pts.classList.remove('shake'), 400); return; }
      else { const free = a.indexOf(null); if (free < 0) return; a[free] = id; }
      setSlots(st, a);
      onChange('skills');
    };
    box.appendChild(b);
  }
}

// ------------------------------------------------------------------ progression
const myLevel = () => (account ? levelFor(account.xp || 0) : 1);
/** The look you actually wear: your saved choice, minus anything you have not unlocked yet. */
const effLook = () => clampLook(cfg.look, myLevel());

// ------------------------------------------------------------------ customizer
const LOOK_GROUPS = [['helm', 'Helmet'], ['shoulder', 'Shoulders'], ['back', 'Back piece'], ['mat', 'Material'], ['gun', 'Rifle skin'], ['fx', 'Kill effect']];
const COLOR_GROUPS = [['c1', 'Primary colour'], ['c2', 'Secondary colour'], ['glow', 'Glow colour']];
function renderCharSum() {
  const l = effLook();
  $('charsum').innerHTML = `${esc(MODELS[l.model].name)} &middot; ${esc(LOOK_PARTS.helm[l.helm])}`
    + ` <span class="dots"><i style="background:${l.c1}"></i><i style="background:${l.c2}"></i><i style="background:${l.glow}"></i></span>`;
}
function lookChanged() {
  store.set('look', cfg.look);
  renderLookView();
  renderCharSum();
  setPreview(effLook());
}
function seg(label, items, cur, onPick, req) {
  const g = document.createElement('div');
  g.className = 'lgroup';
  g.innerHTML = `<h4>${esc(label)}</h4>`;
  const row = document.createElement('div');
  row.className = 'seg';
  items.forEach((nm, i) => {
    const b = document.createElement('button');
    const need = req ? req[i] : 1;
    const locked = need > myLevel();
    b.textContent = locked ? `\u{1F512} ${nm} \u00b7 Lv ${need}` : nm;
    b.className = (i === cur ? 'on' : '') + (locked ? ' locked' : '');
    if (locked) b.title = account ? `Reach level ${need} to unlock` : `Sign in and reach level ${need} to unlock`;
    b.onclick = () => { if (!locked) onPick(i); };
    row.appendChild(b);
  });
  g.appendChild(row);
  return g;
}
function renderLookView() {
  const box = $('looklist');
  box.innerHTML = '';
  const names = Object.keys(MODELS);
  box.appendChild(seg('Body style', names.map((id) => MODELS[id].name), names.indexOf(cfg.look.model), (i) => { cfg.look.model = names[i]; lookChanged(); }));
  for (const [key, label] of LOOK_GROUPS) box.appendChild(seg(label, LOOK_PARTS[key], effLook()[key], (i) => { cfg.look[key] = i; lookChanged(); if (key === 'fx' && preview && !playing) killFx(effLook().fx, SHOWROOM.x, SHOWROOM.y, SHOWROOM.z, 0x6fa3ff); }, LOOK_UNLOCK[key]));
  for (const [key, label] of COLOR_GROUPS) {
    const g = document.createElement('div');
    g.className = 'lgroup';
    g.innerHTML = `<h4>${esc(label)}</h4>`;
    const row = document.createElement('div');
    row.className = 'swatches';
    for (const c of LOOK_PALETTES[key]) {
      const b = document.createElement('button');
      b.style.background = c;
      b.className = cfg.look[key] === c ? 'on' : '';
      b.title = c;
      b.onclick = () => { cfg.look[key] = c; lookChanged(); };
      row.appendChild(b);
    }
    const inp = document.createElement('input');
    inp.type = 'color';
    inp.value = cfg.look[key];
    inp.title = 'Custom colour';
    inp.onchange = () => { cfg.look[key] = inp.value.toLowerCase(); lookChanged(); };
    row.appendChild(inp);
    g.appendChild(row);
    box.appendChild(g);
  }
}
const SUBS = ['lookview', 'mapview', 'skillview', 'optview'];
function openSub(id) {
  $('side').classList.add('looking');
  for (const v of SUBS) $(v).classList.toggle('hidden', v !== id);
  $('side').scrollTop = 0;
  if (id === 'lookview') renderLookView();
}
function closeSub() {
  $('side').classList.remove('looking');
  for (const v of SUBS) $(v).classList.add('hidden');
  $('side').scrollTop = 0;
}
$('customizebtn').onclick = () => openSub('lookview');
$('mapbtn').onclick = () => openSub('mapview');
$('skillbtn').onclick = () => openSub('skillview');
$('optbtn').onclick = () => openSub('optview');
$('lookdone').onclick = closeSub;
for (const b of document.querySelectorAll('[data-close]')) b.onclick = closeSub;
$('lookrandom').onclick = () => { cfg.look = clampLook(randomLook(), myLevel()); lookChanged(); };
$('lookreset').onclick = () => { cfg.look = sanitizeLook(DEFAULT_LOOK); lookChanged(); };

function renderMenu() {
  $('name').value = cfg.name;
  $('m2').classList.toggle('on', cfg.mode === 2);
  $('m3').classList.toggle('on', cfg.mode === 3);
  $('mffa').classList.toggle('on', isFfaMode());
  $('ffa-note').classList.toggle('hidden', !isFfaMode());
  $('teamblock').classList.toggle('hidden', isFfaMode());
  $('qh').classList.toggle('on', cfg.quality === 'high');
  $('ql').classList.toggle('on', cfg.quality === 'low');
  $('sens').value = cfg.sens;
  $('sensv').textContent = Number(cfg.sens).toFixed(2);
  $('vol').value = cfg.volume; $('volv').textContent = `${Math.round(cfg.volume * 100)}%`;
  for (const b of document.querySelectorAll('#teampick button')) b.classList.toggle('on', Number(b.dataset.team) === cfg.team);

  const mp = $('mappick');
  mp.innerHTML = '';
  for (const id of isFfaMode() ? FFA_MAP_IDS : TEAM_MAP_IDS) {
    const m = MAPS[id], t = m.theme;
    const b = document.createElement('button');
    b.className = 'mapcard' + (chosenMap() === id ? ' on' : '');
    b.innerHTML = `<div class="sw" style="background:linear-gradient(110deg, ${hex(t.haze)}, ${t.floor} 55%, ${hex(t.accent)})"></div><div class="tx"><b>${esc(m.name)}</b><small>${esc(m.tagline)} &middot; ${m.size * 2}m wide</small></div>`;
    b.onclick = () => { if (isFfaMode()) cfg.ffaMap = id; else cfg.map = id; renderMenu(); closeSub(); };
    mp.appendChild(b);
  }

  renderPicker({ slots: 'slots', spells: 'spellpick' }, cfg, () => renderMenu());
  renderCharSum();
  { const cm = MAPS[chosenMap()], ct = cm.theme;
    $('mapname').textContent = cm.name;
    $('mapsw').style.background = `linear-gradient(110deg, ${hex(ct.haze)}, ${ct.floor} 55%, ${hex(ct.accent)})`;
    const left = SLOT_COUNT - cfg.loadout.length, sb = $('skillsum');
    sb.classList.toggle('warn', left > 0);
    sb.textContent = left > 0 ? `Pick ${left} more` : cfg.loadout.map((id) => SPELLS[id].name).join(' · '); }
  const ready = cfg.loadout.length === SLOT_COUNT;
  $('quick').disabled = !ready;
  $('ranked').disabled = !ready || isFfaMode();
  setRankedSub();
  $('quick').firstChild.textContent = ready ? 'QUICK PLAY' : `PICK ${SLOT_COUNT - cfg.loadout.length} MORE SKILL${SLOT_COUNT - cfg.loadout.length > 1 ? 'S' : ''}`;
}
$('m2').onclick = () => { cfg.mode = 2; renderMenu(); };
$('m3').onclick = () => { cfg.mode = 3; renderMenu(); };
$('mffa').onclick = () => { cfg.mode = 'ffa'; renderMenu(); };
for (const b of document.querySelectorAll('#teampick button')) b.onclick = () => { cfg.team = Number(b.dataset.team); renderMenu(); };
$('qh').onclick = () => { cfg.quality = 'high'; renderMenu(); applyQuality(); setPreview(effLook()); };
$('ql').onclick = () => { cfg.quality = 'low'; renderMenu(); applyQuality(); setPreview(effLook()); };
$('vol').oninput = (e) => { setVolume(Number(e.target.value)); store.set('volume', cfg.volume); $('volv').textContent = `${Math.round(cfg.volume * 100)}%`; if (audio()) { SFX.hitBody(); } };
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
const camera = new THREE.PerspectiveCamera(80, 1, 0.08, 400);
renderer.autoClear = false;
let gunCam = null;
camera.rotation.order = 'YXZ';
scene.add(camera);
let world = buildWorld(scene, DEFAULT_MAP);
let worldMapId = DEFAULT_MAP;
const showroom = buildShowroom(scene);
// The arena for the match we joined (the menu always shows the first one).
function enterMap(id) {
  useMap(id);
  if (id === worldMapId) return;
  world.dispose();
  world = buildWorld(scene, id);
  worldMapId = id;
  applyQuality();
}
function applyQuality() { setCharacterDetail(cfg.quality === 'low' ? 0.55 : 1); world.setQuality(renderer, cfg.quality); resize(); }
function resize() {
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  if (gunCam) { gunCam.aspect = camera.aspect; gunCam.updateProjectionMatrix(); }
  viewOffsetOn = false;
}
let viewOffsetOn = false;
window.addEventListener('resize', resize);
applyQuality();

// Viewmodel gun: drawn in its own pass on top of the world (depth cleared first), so it can never
// poke through a wall when you stand against it.
const gunScene = new THREE.Scene();
gunCam = new THREE.PerspectiveCamera(70, 1, 0.02, 10);
resize();
gunScene.add(new THREE.HemisphereLight(0xdfe6ff, 0x4a4050, 1.6));
const gunLight = new THREE.DirectionalLight(0xffffff, 1.2);
gunLight.position.set(1, 2, 2);
gunScene.add(gunLight);
const gun = new THREE.Group();
const GUN_X = 0.15, GUN_Y = -0.14, GUN_Z = -0.38, GUN_SCALE = 0.4; // viewmodel placement: tune here
gun.position.set(GUN_X, GUN_Y, GUN_Z);
gun.rotation.y = 0;
gunScene.add(gun);
let gunKey = '', gunRifle = null;
/** (Re)build the first-person AK in the skin you wear. */
function setViewGun(look) {
  const key = `${look.gun}|${look.glow}`;
  if (key === gunKey) return;
  gunKey = key;
  if (gunRifle) gun.remove(gunRifle);
  const rifle = buildRifle(look.gun, look.glow, { flash: true });
  rifle.scale.setScalar(GUN_SCALE);
  gun.add(rifle);
  gunRifle = rifle;
  gun.userData.flash = rifle.userData.flash;
}
setViewGun(effLook());
function drawFrame(showGun) {
  renderer.clear();
  renderer.render(scene, camera);
  if (showGun) {
    renderer.clearDepth();
    renderer.render(gunScene, gunCam);
  }
}

// ------------------------------------------------------------------ entities
const ents = new Map();
const shieldGeo = new THREE.SphereGeometry(1.15, 20, 14);
const auraGeo = new THREE.SphereGeometry(0.95, 16, 12);
const glowMat = (color, opacity) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false });
const AURA_MATS = { burn: glowMat(0xff6a1a, 0.32), bleed: glowMat(0xd01030, 0.3), slow: glowMat(0x6ab8ff, 0.28) };
const discGeo = new THREE.CircleGeometry(0.62, 24);
const rootGeo = new THREE.RingGeometry(0.55, 0.75, 28);
const rootMat = new THREE.MeshBasicMaterial({ color: 0xb36bff, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false });

let markTex = null;
function markTexture() {
  if (markTex) return markTex;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#ffd24a'; g.strokeStyle = '#3a2a00'; g.lineWidth = 5;
  g.beginPath(); g.moveTo(8, 12); g.lineTo(56, 12); g.lineTo(32, 56); g.closePath(); g.stroke(); g.fill();
  markTex = new THREE.CanvasTexture(c);
  return markTex;
}
function makeEntity(pd) {
  const color = colorOf(pd.tm);
  const group = new THREE.Group();
  const model = buildModel(decodeLook(pd.md, pd.lk), color);
  group.add(model);
  // Polymorph: a little sheep stands in for the soldier
  const sheep = new THREE.Group();
  const wool = new THREE.MeshStandardMaterial({ color: 0xf2efe6, roughness: 1 }), dark = new THREE.MeshStandardMaterial({ color: 0x2a2623, roughness: 1 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.55, 1.0), wool); body.position.set(0, 0.62, 0);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.32, 0.34), dark); head.position.set(0, 0.8, -0.62);
  sheep.add(body, head);
  for (const [lx, lz] of [[-0.22, -0.34], [0.22, -0.34], [-0.22, 0.34], [0.22, 0.34]]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.4, 0.1), dark); leg.position.set(lx, 0.2, lz); sheep.add(leg);
  }
  sheep.visible = false;
  group.add(sheep);
  const lk = decodeLook(pd.md, pd.lk);
  const g = buildRifle(lk.gun, lk.glow, { shadow: true });
  g.scale.setScalar(0.72);
  g.position.set(0.3, 1.02, -0.3);
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
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: true, transparent: true }));
  sprite.scale.set(2.2, 0.62, 1);
  sprite.position.y = 2.25;
  sprite.renderOrder = 10;
  group.add(sprite);
  const disc = new THREE.Mesh(discGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, depthWrite: false }));
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = 0.035;
  group.add(disc);
  scene.add(group);
  const mk = new THREE.Sprite(new THREE.SpriteMaterial({ map: markTexture(), depthTest: false, depthWrite: false, transparent: true }));
  mk.scale.set(0.6, 0.6, 1); mk.position.y = 3.0; mk.renderOrder = 999; mk.visible = false;
  group.add(mk);
  return { group, model, gun: g, sheep, mk, shield, auras, root, sprite, cv, tex, cy: 1, key: '', x: pd.x, y: pd.y, z: pd.z, yaw: pd.yaw, pit: pd.pit };
}

// Menu showroom: the chosen model turns on a podium next to the menu panel.
let preview = null;
function setPreview(look) {
  if (preview) scene.remove(preview.group);
  preview = makeEntity({ tm: 0, md: look.model, lk: encodeLook(look), x: 0, y: 0, z: 0, yaw: 0, pit: 0 });
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
const smokeGeo = new THREE.SphereGeometry(1, 10, 8);
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
    if (!m && (z.k === 2 || z.k === 3)) {
      const group = new THREE.Group();
      const own = z.tm === myTeam;
      const col = z.k === 2 ? 0x6ab8ff : 0xa070ff;
      const disc = new THREE.Mesh(zoneDiscGeo, new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: z.k === 2 ? (own ? 0.4 : 0.15) : 0.3, side: THREE.DoubleSide, depthWrite: false }));
      disc.rotation.x = -Math.PI / 2; disc.position.y = 0.04; disc.scale.set(z.r, z.r, 1);
      const edge = new THREE.Mesh(zoneEdgeGeo, new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: z.k === 2 ? (own ? 0.9 : 0.3) : 0.9, side: THREE.DoubleSide, depthWrite: false }));
      edge.rotation.x = -Math.PI / 2; edge.position.y = 0.05; edge.scale.set(z.r, z.r, 1);
      group.add(disc, edge);
      group.userData.spin = z.k === 3 ? [] : null; group.userData.r = z.r;
      if (z.k === 3) { // rings that keep collapsing toward the centre
        for (let i = 0; i < 3; i++) {
          const r2m = new THREE.Mesh(zoneEdgeGeo, edge.material);
          r2m.rotation.x = -Math.PI / 2; r2m.position.y = 0.3 + i * 0.35;
          group.add(r2m); group.userData.spin.push(r2m);
        }
      }
      group.position.set(z.x, 0, z.z);
      group.userData.flames = [];
      scene.add(group);
      m = group;
      zoneMeshes.set(z.id, m);
    }
    if (!m && z.k === 1) {
      const group = new THREE.Group();
      const puffMat = new THREE.MeshBasicMaterial({ color: 0xc4c9d0, transparent: true, opacity: 0.9, depthWrite: false });
      const puffs = [];
      for (let i = 0; i < 9; i++) {
        const p = new THREE.Mesh(smokeGeo, puffMat);
        const a = Math.random() * Math.PI * 2, dd = Math.sqrt(Math.random()) * z.r * 0.7;
        p.position.set(Math.cos(a) * dd, 0.9 + Math.random() * 1.6, Math.sin(a) * dd);
        p.scale.setScalar(z.r * (0.45 + Math.random() * 0.25));
        p.userData.phase = Math.random() * 6.28; p.userData.y0 = p.position.y;
        group.add(p); puffs.push(p);
      }
      group.position.set(z.x, 0, z.z);
      group.userData.puffs = puffs; group.userData.mat = puffMat; group.userData.flames = [];
      scene.add(group);
      m = group;
      zoneMeshes.set(z.id, m);
    }
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
    if (m.userData.spin) m.userData.spin.forEach((s, i) => { const f = (now / 900 + i / 3) % 1, rr = m.userData.r * (1 - f); s.scale.set(rr, rr, 1); });
    if (m.userData.puffs) {
      for (const p of m.userData.puffs) p.position.y = p.userData.y0 + Math.sin(now / 700 + p.userData.phase) * 0.15;
      m.userData.mat.opacity = Math.min(0.9, m.userData.t > 1 ? 0.9 : m.userData.t * 0.9);
    }
    for (const f of m.userData.flames) {
      const s = 0.7 + 0.5 * Math.sin(now / 90 + f.userData.phase);
      f.scale.set(1, s, 1);
      f.position.y = 0.05 + s * 0.5;
    }
  }
  const pulse = 0.3 + 0.1 * Math.sin(now / 150);
  zoneDiscMat.opacity = pulse;
}
// Kill effects: whatever the KILLER equipped plays where the victim fell.
const pBox = new THREE.BoxGeometry(1, 1, 1), pBall = new THREE.SphereGeometry(1, 8, 6);
function killFx(id, x, y, z, teamCol) {
  const g = new THREE.Group();
  g.position.set(x, y + 0.9, z);
  const parts = [];
  const R = (a, b) => a + Math.random() * (b - a);
  const add = (color, size, o, v, grav, geo = pBox, sc = null) => {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1, depthWrite: false });
    const mesh = new THREE.Mesh(geo, mat);
    if (sc) mesh.scale.set(sc[0], sc[1], sc[2]); else mesh.scale.setScalar(size);
    g.add(mesh);
    parts.push({ mesh, mat, o, v, grav });
  };
  const burst = (n, cols, size, spd, up, grav) => {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = R(spd * 0.4, spd);
      add(cols[i % cols.length], size * R(0.7, 1.3), [0, 0, 0], [Math.cos(a) * s, R(0, up), Math.sin(a) * s], grav);
    }
  };
  let dur = 0.8, fade = 2;
  switch (id) {
    case 1: // Embers
      for (let i = 0; i < 20; i++) add(i % 3 ? 0xff7a1a : 0xffd24a, R(0.05, 0.1), [R(-0.3, 0.3), R(-0.5, 0), R(-0.3, 0.3)], [R(-0.7, 0.7), R(1.2, 3.4), R(-0.7, 0.7)], -0.8);
      ring(x, y, z, 0xff7a1a, 1.8, 0.5); dur = 1.2; break;
    case 2: // Frost shatter
      burst(18, [0xbfefff, 0x6ab8ff, 0xffffff], 0.13, 3.2, 2.5, 9);
      ring(x, y, z, 0x9fe8ff, 2.2, 0.45); break;
    case 3: // Lightning
      for (let i = 0; i < 4; i++) add(i ? 0xb7d4ff : 0xffffff, 0, [R(-0.25, 0.25), 0.9, R(-0.25, 0.25)], [0, 0, 0], 0, pBox, [i ? 0.04 : 0.09, 3.2, i ? 0.04 : 0.09]);
      ring(x, y, z, 0xffffff, 2.6, 0.35); dur = 0.45; fade = 1; break;
    case 4: // Confetti
      burst(30, [0xff4d6d, 0xffd24a, 0x4ade80, 0x6ab8ff, 0xc27bff, 0xffffff], 0.09, 2.6, 6, 9);
      dur = 1.5; fade = 4; break;
    case 5: // Ghost rise
      add(0xdff3ff, 0.32, [0, -0.2, 0], [0, 1.3, 0], 0, pBall);
      add(0xdff3ff, 0.18, [0, 0.15, 0], [0, 1.3, 0], 0, pBall);
      for (let i = 0; i < 6; i++) add(0xbfe6ff, 0.07, [R(-0.3, 0.3), R(-0.4, 0.2), R(-0.3, 0.3)], [R(-0.3, 0.3), R(0.6, 1.6), R(-0.3, 0.3)], 0, pBall);
      ring(x, y, z, 0xdff3ff, 1.6, 0.8); dur = 1.4; break;
    case 6: // Gold coins
      for (let i = 0; i < 16; i++) { const a = Math.random() * 6.28, s = R(0.8, 2.4); add(i % 4 ? 0xffd24a : 0xfff0a0, 0, [0, 0, 0], [Math.cos(a) * s, R(3.5, 6), Math.sin(a) * s], 14, pBox, [0.13, 0.025, 0.13]); }
      ring(x, y, z, 0xffd24a, 1.8, 0.5); dur = 1.3; fade = 4; break;
    case 7: // Void collapse
      for (let i = 0; i < 24; i++) {
        const a = Math.random() * 6.28, b = R(-0.8, 0.8), r = R(1.2, 2);
        const o = [Math.cos(a) * r, b, Math.sin(a) * r];
        add(i % 2 ? 0xa070ff : 0x3a1a6a, 0.1, o, [-o[0] / 0.7, -o[1] / 0.7, -o[2] / 0.7], 0);
      }
      add(0x120820, 0.5, [0, 0, 0], [0, 0, 0], 0, pBall);
      ring(x, y, z, 0xa070ff, 2.4, 0.6); dur = 0.8; fade = 3; break;
    default: // Burst
      burst(14, [teamCol, 0xffffff], 0.09, 3.6, 2.5, 8); break;
  }
  addEffect(g, dur, (f) => {
    const t = f * dur;
    for (const p of parts) {
      p.mesh.position.set(p.o[0] + p.v[0] * t, p.o[1] + p.v[1] * t - 0.5 * p.grav * t * t, p.o[2] + p.v[2] * t);
      p.mat.opacity = id === 3 ? (Math.random() < 0.6 ? 1 - f : 0.2) : Math.max(0, 1 - Math.pow(f, fade));
      if (id === 7 && p.mesh.scale.x === 0.5) p.mesh.scale.setScalar(0.5 * (1 - f * 0.6));
    }
  });
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

// Floating damage numbers (DOM, projected each frame) and the red damage-direction arc.
const floaters = [];
function addFloater(x, y, z, dmg, head) {
  const el = document.createElement('div');
  el.className = 'dmgnum' + (head ? ' head' : '');
  el.textContent = String(dmg);
  $('dmgnums').appendChild(el);
  floaters.push({ el, x: x + (Math.random() - 0.5) * 0.5, y, z, t0: performance.now() });
  if (floaters.length > 24) floaters.shift().el.remove();
}
const _fv = new THREE.Vector3();
function updateFloaters(now) {
  const W = window.innerWidth, H = window.innerHeight;
  for (let i = floaters.length - 1; i >= 0; i--) {
    const f = floaters[i], age = (now - f.t0) / 800;
    if (age >= 1) { f.el.remove(); floaters.splice(i, 1); continue; }
    _fv.set(f.x, f.y + age * 0.8, f.z).project(camera);
    if (_fv.z > 1) { f.el.style.display = 'none'; continue; }
    f.el.style.display = '';
    f.el.style.left = `${(_fv.x * 0.5 + 0.5) * W}px`;
    f.el.style.top = `${(-_fv.y * 0.5 + 0.5) * H}px`;
    f.el.style.opacity = String(1 - age * age);
  }
}
let dmgDirT = 0;
function showDamageDir(ax, az) {
  const rel = Math.atan2(-(ax - me.x), -(az - me.z)) - yaw;
  const el = $('dmgdir');
  el.style.transform = `rotate(${(-rel * 180) / Math.PI}deg)`;
  el.classList.add('on');
  clearTimeout(dmgDirT);
  dmgDirT = setTimeout(() => el.classList.remove('on'), 700);
}

// ------------------------------------------------------------------ game state
let ws = null;
let playing = false, locked = false;
let myId = -1, myTeam = 0;
let inRange = false;
let rs = { shots: 0, hits: 0, heads: 0, kills: 0 }; // practice range stats
let spec = false, specId = -1; // spectator mode: watching a live game without a player
let yaw = 0, pitch = 0;
let seq = 0, pending = [];
let shotCount = 0;
let meAmmo = AMMO_START, ammoShown = -1, gainT = 0;
let fireCd = 0, kick = 0, flashT = 0, shootBuf = 0, eyeCur = EYE_H;
let castQ = false, castE = false, castR = false;
let meArmed = -1, armHold = 0; // slot of the aimed skill waiting for your next shot (-1 = none); armHold = ignore the server's value for a moment after we change it
const SKILL_COLOR = { shockwave: 0xffb347, firepool: 0xff6a1a, grapple: 0xcfd8e6, smoke: 0xc8ccd4, decoy: 0x8fd0ff, slowtrap: 0x6ab8ff, mark: 0xffd24a, gravity: 0xb36bff, polymorph: 0xffffff };
const keys = {};
const me = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, dvx: 0, dvz: 0, dashT: 0, rootT: 0, slowT: 0, speed: MOVE_SPEED, crouch: false };
let meAlive = true, meHp = 100, meMax = 100, meSf = 0, meBf = 0, meCd = [0, 0, 0], meLoadout = cfg.loadout, cdAt = 0;
const errOff = { x: 0, y: 0, z: 0 };
let snaps = [], latest = null, snapAt = 0;
let phase = 'countdown', phaseT = 0;
let pingMs = 0;

const toState = (st) => ({ crouch: me.crouch,  x: st.x, y: st.y, z: st.z, vx: st.vx, vy: st.vy, vz: st.vz, dvx: st.dvx, dvz: st.dvz, dashT: st.dashT, rootT: st.rootT || 0, slowT: st.slowT || 0 });

function buildSpellHud() {
  const box = $('spells');
  box.innerHTML = '';
  meLoadout.forEach((id, i) => {
    const d = document.createElement('div');
    d.className = 'spell';
    d.innerHTML = `<div class="rdy">READY</div><div class="key">${esc(slotLabel(i))}</div><div class="ic">${ICON[id]}</div><div class="nm">${SPELLS[id].name}</div><div class="cdo"></div><div class="cdt"></div>`;
    box.appendChild(d);
  });
}

// ------------------------------------------------------------------ networking
let searching = false, phaseOverride = null, deadOverride = false;
let yawInit = false, meRespawn = 0;
let ranked = false, meModel = cfg.look.model, ratingMsg = '', myRating = null;
function connect(queue) {
  ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`);
  ws.onopen = () => {
    ws.send(JSON.stringify({ t: 'join', name: cfg.name, mode: queue === 'range' ? 'range' : cfg.mode, map: chosenMap(), queue, team: cfg.team, loadout: cfg.loadout, model: cfg.look.model, look: effLook(), token }));
    setInterval(() => { if (ws.readyState === 1) ws.send(JSON.stringify({ t: 'ping', ts: performance.now() })); }, 2000);
  };
  ws.onmessage = wsHandler;
  ws.onclose = () => { if (playing || searching) showMessage('Disconnected', 'The server connection was lost.'); };
  ws.onerror = () => showMessage('Cannot connect', 'Is the server running?');
}
let toastTimer = 0;
function toast(msg, ms = 3200) {
  const t = $('toast');
  t.textContent = msg; t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), ms);
}

function wsHandler(e) {
  {
    const m = JSON.parse(e.data);
    if (m.t === 'sp') { if (ws && ws.readyState === 1) ws.send(JSON.stringify({ t: 'sq', n: m.n })); return; } // server round-trip probe
    if (m.t === 'notice') { toast(m.msg); return; }
    if (m.t === 'riv') { // lifetime head-to-head against another real player
      if (account) { account.rivals = account.rivals || {}; account.rivals[m.key] = { n: m.n, k: m.k, d: m.d }; }
      if (m.k + m.d >= 2) toast(`\u2694 ${m.n}  \u00b7  you ${m.k} \u2013 ${m.d} them${m.k + 2 <= m.d ? '  \u00b7  NEMESIS' : m.d + 2 <= m.k ? '  \u00b7  YOUR RIVAL FEARS YOU' : ''}`, 3600);
      return;
    }
    if (m.t === 'welcome' && m.spec) {
      spec = true; myId = -1; myTeam = 0; playing = true; inFfa = m.mode === 'ffa'; showroom.visible = false;
      document.body.classList.add('spec');
      enterMap(m.map);
      for (const id of ['games', 'search']) $(id).classList.add('hidden');
      $('menu').classList.add('hidden');
      $('hud').classList.remove('hidden');
      $('specbar').classList.remove('hidden');
      $('scB').classList.toggle('ffa', inFfa); $('scR').classList.toggle('ffa', inFfa);
    } else if (m.t === 'welcome') {
      myId = m.id; myTeam = m.team; meLoadout = m.loadout; playing = true;
      inFfa = m.mode === 'ffa'; inRange = !!m.range; yawInit = false; showroom.visible = false;
      document.body.classList.toggle('range', inRange);
      rs = { shots: 0, hits: 0, heads: 0, kills: 0 };
      setViewGun(m.look ? sanitizeLook(m.look) : effLook());
      ranked = !!m.ranked; meModel = m.model || meModel; myRating = m.rating;
      enterMap(m.map);
      me.speed = (MODELS[m.model] || MODELS[DEFAULT_MODEL]).speed;
      const sp = spawnPoint(m.team, 0, m.mode);
      yaw = sp.yaw;
      buildSpellHud();
      $('search').classList.add('hidden');
      $('menu').classList.add('hidden');
      $('hud').classList.remove('hidden');
      // ranked: we could not lock the mouse while searching, so ask for a click
      if (!locked) { $('pausetitle').textContent = 'MATCH FOUND'; $('pausesub').textContent = 'Click to take control.'; $('pause').classList.remove('hidden'); }
      $('scB').classList.toggle('mine', !inFfa && myTeam === 0);
      $('scR').classList.toggle('mine', !inFfa && myTeam === 1);
      $('scB').classList.toggle('ffa', inFfa);
      $('scR').classList.toggle('ffa', inFfa);
    } else if (m.t === 's') onSnapshot(m);
    else if (m.t === 'pong') pingMs = Math.round(performance.now() - m.ts);
    else if (m.t === 'full') showMessage('Match is full', 'Try again in a moment.');
    else if (m.t === 'queue') {
      $('search').classList.remove('hidden');
      $('searchtime').textContent = `${m.waited}s`;
      $('searchinfo').textContent = m.searching > 1 ? `${m.searching} players searching on this map` : 'Looking for players near your rating...';
    } else if (m.t === 'error') { searching = false; showMessage('Cannot join', m.msg || 'Something went wrong.'); }
    else if (m.t === 'xp') {
      if (account) { account.xp = m.xp; account.kills = m.kills; account.mwins = m.mwins; if (m.daily) account.daily = m.daily; renderAcct(); }
      const dn = (m.newDaily || []).length ? ` \u00b7 Daily challenge complete! +${m.dailyXp} XP` : '';
      $('xpline').textContent = `+${m.gained + (m.dailyXp || 0)} XP${dn}  \u00b7 Level ${m.level}${m.up ? ' \u2014 LEVEL UP!' : ''}${m.unlocked && m.unlocked.length ? ` \u00b7 Unlocked: ${m.unlocked.join(', ')}` : ''}`;
    }
    else if (m.t === 'rating') {
      myRating = m.rating;
      ratingMsg = `${m.delta >= 0 ? '+' : ''}${m.delta} rating \u2192 ${m.rating} (${m.rank})`;
      if (account) { account.rating = m.rating; account.rank = m.rank; if (m.won) account.wins++; else account.losses++; renderAcct(); }
      $('ratingline').textContent = `RANKED  ${ratingMsg}`;
    }
  }
}

// ------------------------------------------------------------------ leaderboard + profile
let lbBy = 'wins', lbTimer = 0;
async function loadLeaderboard() {
  for (const b of document.querySelectorAll('#lbtabs button')) b.classList.toggle('on', b.dataset.by === lbBy);
  const box = $('lblist');
  let j;
  try { j = await (await fetch(`/api/leaderboard?by=${lbBy}`, { cache: 'no-store' })).json(); } catch { box.innerHTML = '<div class="empty">Could not load the leaderboard.</div>'; return; }
  const unit = lbBy === 'kills' ? 'kills' : lbBy === 'rating' ? 'rating' : 'wins';
  if (!j.rows.length) { box.innerHTML = '<div class="empty">Nobody here yet. Sign in and play a match to get on the board.</div>'; return; }
  box.innerHTML = j.rows.map((r, i) => {
    const me = account && r.username.toLowerCase() === account.username.toLowerCase();
    return `<div class="lbrow${me ? ' me' : ''}"><span class="pos">${i + 1}</span><span class="nm">${esc(r.username)} <em>Lv ${levelFor(r.xp || 0)}</em></span><b>${r.value}</b><small>${unit}</small></div>`;
  }).join('');
  $('lbnote').classList.toggle('hidden', !!j.persistent);
}
for (const b of document.querySelectorAll('#lbtabs button')) b.onclick = () => { lbBy = b.dataset.by; loadLeaderboard(); };
$('lbbtn').onclick = () => { $('lb').classList.remove('hidden'); loadLeaderboard(); lbTimer = setInterval(loadLeaderboard, 10000); };
$('lbclose').onclick = () => { $('lb').classList.add('hidden'); clearInterval(lbTimer); };

function renderProfile() {
  const box = $('profbody');
  if (!account) { box.innerHTML = '<div class="empty">Sign in to keep a profile: level, kills, wins and rank.</div>'; return; }
  const a = account, lv = levelFor(a.xp || 0);
  const lo = xpForLevel(lv), hi = xpForLevel(lv + 1);
  const pct = lv >= MAX_LEVEL ? 100 : Math.round(((a.xp - lo) / (hi - lo)) * 100);
  const kd = a.deaths ? (a.kills / a.deaths).toFixed(2) : String(a.kills || 0);
  const next = [];
  for (const [k, label] of [['helm', 'Helmet'], ['shoulder', 'Shoulders'], ['back', 'Back'], ['mat', 'Material'], ['gun', 'Rifle skin'], ['fx', 'Kill effect']]) {
    LOOK_UNLOCK[k].forEach((req, i) => { if (req === lv + 1) next.push(LOOK_PARTS[k][i]); });
  }
  box.innerHTML = `<div class="who"><b>${esc(a.username)}</b><span class="rankpill">${esc(a.rank)}</span></div>
    <div class="lvl"><b>Level ${lv}</b><div class="xpbar"><i style="width:${pct}%"></i></div><small>${lv >= MAX_LEVEL ? 'MAX' : `${a.xp - lo} / ${hi - lo} XP to level ${lv + 1}${next.length ? ` &middot; unlocks ${esc(next.join(', '))}` : ''}`}</small></div>
    <div class="statgrid">
      <div><b>${a.mwins || 0}</b><small>match wins</small></div><div><b>${a.mplayed || 0}</b><small>matches</small></div>
      <div><b>${a.kills || 0}</b><small>kills</small></div><div><b>${a.deaths || 0}</b><small>deaths</small></div>
      <div><b>${kd}</b><small>K/D</small></div><div><b>${a.rating}</b><small>rating</small></div>
      <div><b>${a.wins}-${a.losses}</b><small>ranked W-L</small></div><div><b>${a.xp || 0}</b><small>total XP</small></div>
    </div>${rivalsHtml(a)}`;
}
function rivalsHtml(a) {
  const rows = Object.values(a.rivals || {}).sort((x, y) => (y.k + y.d) - (x.k + x.d)).slice(0, 6);
  if (!rows.length) return '<h4 class="rvh">Rivals</h4><div class="hint">Play other real players and your head-to-head record shows up here.</div>';
  return `<h4 class="rvh">Rivals</h4>${rows.map((r) => `<div class="lbrow"><span class="nm">${esc(r.n)} <em>${r.k > r.d ? 'you lead' : r.d > r.k ? 'they lead' : 'even'}</em></span><b>${r.k} \u2013 ${r.d}</b></div>`).join('')}`;
}
// ------------------------------------------------------------------ daily challenges
let dailyTimer = 0;
function renderDaily() {
  const k = dayKey();
  const d = account && account.daily && account.daily.day === k ? account.daily : { prog: {}, done: [] };
  const left = msUntilDailyReset();
  $('dailybody').innerHTML = dailyFor(k).map((c) => {
    const have = Math.min(c.goal, Math.floor(d.prog[c.stat] || 0)), done = d.done.includes(c.id);
    return `<div class="dq ${done ? 'done' : ''}"><div class="top"><b>${esc(c.text)}</b><span class="xp">${done ? '\u2713 ' : '+'}${c.xp} XP</span></div><div class="bar"><i style="width:${Math.round((have / c.goal) * 100)}%"></i></div><small>${have} / ${c.goal}</small></div>`;
  }).join('');
  $('dailynote').textContent = `${account ? '' : 'Sign in to track progress. '}New challenges in ${Math.floor(left / 3600000)}h ${Math.floor((left % 3600000) / 60000)}m. Kills and damage on bots do not count; Practice range counts nothing.`;
}
$('dailybtn').onclick = () => { renderDaily(); $('daily').classList.remove('hidden'); dailyTimer = setInterval(renderDaily, 30000); };
$('dailyclose').onclick = () => { $('daily').classList.add('hidden'); clearInterval(dailyTimer); };

// Admin is its own page (/admin), served by the server itself.
$('adminbtn').onclick = () => { location.href = '/admin'; };

$('profbtn').onclick = () => { renderProfile(); $('prof').classList.remove('hidden'); };
$('profclose').onclick = () => $('prof').classList.add('hidden');

let specShown = -2;
function specCycle(dir) {
  if (!latest) return;
  const alive = latest.p.filter((p) => p.a);
  if (!alive.length) return;
  const i = alive.findIndex((p) => p.id === specId);
  specId = alive[(i + dir + alive.length * 2) % alive.length].id;
}
$('specnext').onclick = () => specCycle(1);
$('specprev').onclick = () => specCycle(-1);
$('specleave').onclick = () => location.reload();

function startSpectate(roomId) {
  searching = false;
  ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`);
  ws.onopen = () => {
    ws.send(JSON.stringify({ t: 'spectate', room: roomId }));
    setInterval(() => { if (ws.readyState === 1) ws.send(JSON.stringify({ t: 'ping', ts: performance.now() })); }, 2000);
  };
  ws.onmessage = wsHandler;
  ws.onclose = () => { if (playing) showMessage('Disconnected', 'The server connection was lost.'); };
}
async function loadGames() {
  const box = $('gamelist');
  let games = [];
  try { games = (await (await fetch('/api/games', { cache: 'no-store' })).json()).games || []; } catch { box.innerHTML = '<div class="empty">Could not load games.</div>'; return; }
  if (!games.length) { box.innerHTML = '<div class="empty">No live games right now. Games with real players show up here.</div>'; return; }
  box.innerHTML = '';
  for (const g of games) {
    const d = document.createElement('div');
    d.className = 'g';
    const mode = g.mode === 'ffa' ? 'Free for all' : `${g.mode}v${g.mode}`;
    const score = g.mode === 'ffa' ? '' : ` &middot; ${g.sc[0]}-${g.sc[1]}`;
    d.innerHTML = `<div class="tx"><b>${esc(g.mapName)}</b> &middot; ${mode}${g.ranked ? ' &middot; RANKED' : ''}${score}<small>${esc(g.humans.join(', '))} &middot; ${g.watching} watching</small></div><button>WATCH</button>`;
    d.querySelector('button').onclick = () => startSpectate(g.id);
    box.appendChild(d);
  }
}
let gamesTimer = 0;
$('watchbtn').onclick = () => { $('games').classList.remove('hidden'); loadGames(); gamesTimer = setInterval(loadGames, 4000); };
const closeGames = () => { $('games').classList.add('hidden'); clearInterval(gamesTimer); };
$('gamesclose').onclick = closeGames;
$('gamesrefresh').onclick = loadGames;

function showMessage(title, sub) {
  playing = false;
  if (document.pointerLockElement) document.exitPointerLock();
  $('msgt').textContent = title;
  $('msgs').textContent = sub;
  $('msg').classList.remove('hidden');
  $('pause').classList.add('hidden');
  $('search').classList.add('hidden');
  $('pickover').classList.add('hidden');
}

function onSnapshot(d) {
  const now = performance.now();
  d.byId = {};
  for (const p of d.p) d.byId[p.id] = p;
  d.pl = d.p;
  if (d.dc && d.dc.length) { // decoys are drawn like players but are not in the roster
    const extra = d.dc.map((x) => (d.byId[x.id] = { ...x, a: 1, hp: 100, mh: 100, sf: 0, sh: 0, n: '', k: 0, d: 0, b: 1, dcy: 1 }));
    d.pl = d.p.concat(extra);
  }
  snaps.push({ t: now, d });
  if (snaps.length > 110) snaps.shift(); // ~3.5 s of history for the kill-cam
  latest = d; snapAt = now;
  phase = phaseOverride || d.ph; phaseT = d.pt;

  const mp = d.byId[myId];
  if (d.me && d.me.lo && d.me.lo.join() !== meLoadout.join()) { meLoadout = d.me.lo; buildSpellHud(); }
  if (d.me && d.me.md && d.me.md !== meModel) { meModel = d.me.md; me.speed = (MODELS[meModel] || MODELS[DEFAULT_MODEL]).speed; }
  if (mp) {
    meAlive = !!mp.a && !deadOverride; meHp = mp.hp; meMax = mp.mh || 100; meSf = mp.sf || 0; meBf = mp.bf || 0;
    if (!yawInit) { yawInit = true; yaw = mp.yaw; pitch = 0; } // face the way the server spawned us
  }
  meRespawn = d.me ? d.me.rs || 0 : 0;
  syncZones(d.zn || []);

  if (d.me) {
    const px = me.x, py = me.y, pz = me.z;
    Object.assign(me, toState(d.me.st));
    meCd = d.me.cd; cdAt = now;
    if (performance.now() > armHold) meArmed = d.me.ar === undefined ? -1 : d.me.ar;
    pending = pending.filter((i) => i.seq > d.me.ack);
    if (d.me.am !== undefined) meAmmo = Math.max(0, d.me.am - pending.filter((i) => i.shoot && !i.sk).length);
    if (meAlive && phase !== 'countdown') for (const i of pending) stepPlayer(me, i, DT);
    const ox = px - me.x, oy = py - me.y, oz = pz - me.z;
    if (Math.hypot(ox, oy, oz) < 3) { errOff.x += ox; errOff.y += oy; errOff.z += oz; }
    else { errOff.x = errOff.y = errOff.z = 0; }
  }
  for (const ev of d.ev) {
    if (ev.k === 'kill' && ev.a === myId && ev.v !== myId && d.byId[ev.v] && d.byId[ev.v].tm !== myTeam) gainT = performance.now();
    handleEvent(ev, d);
  }
  updateRoster(d);
  updatePickWindow();
}

function nameOf(id) { const p = latest && latest.byId[id]; return p ? p.n : '?'; }

function handleEvent(ev, d) {
  const cam = camera.position;
  if (ev.k === 'shot') {
    if (ev.id === myId) return;
    const shooter = d.byId[ev.id];
    if (ev.sk && (ev.sk === 'shockwave' || ev.sk === 'polymorph' || ev.sk === 'grapple')) return; // those draw their own beam
    if (ev.sk) { addTracer([ev.ox, ev.oy - 0.25, ev.oz], [ev.ex, ev.ey, ev.ez], SKILL_COLOR[ev.sk] || 0xffffff, 0.3, 0.035); return; }
    addTracer([ev.ox, ev.oy - 0.25, ev.oz], [ev.ex, ev.ey, ev.ez], ev.oc ? 0xffd24a : ev.bd ? 0xb36bff : shooter ? colorOf(shooter.tm) : 0xffffff, ev.bd || ev.oc ? 0.25 : 0.1, ev.bd || ev.oc ? 0.03 : 0.012);
    const dist = Math.hypot(ev.ox - cam.x, ev.oz - cam.z);
    const vol = 0.04 * clamp(1 - dist / 60, 0, 1);
    if (vol > 0.002) SFX.shot(vol / 0.04 * 0.5);
  } else if (ev.k === 'hit') {
    if (ev.a === myId) {
      const h = $('hitm');
      h.classList.toggle('head', !!ev.head);
      h.classList.add('on');
      setTimeout(() => h.classList.remove('on'), 90);
      rs.hits++; if (ev.head) rs.heads++;
      hitSound(ev.tg, !!ev.head);
      const vp = d.byId[ev.v];
      if (vp) addFloater(vp.x, vp.y + (ev.head ? 1.9 : 1.4), vp.z, ev.dmg, !!ev.head);
    }
    if (ev.v === myId) {
      const f = $('flash');
      f.classList.add('on');
      setTimeout(() => f.classList.remove('on'), 60);
      if (ev.tg === 'oc') SFX.hurtOver(); else SFX.hurt();
      const at = d.byId[ev.a];
      if (at && at.id !== myId) showDamageDir(at.x, at.z);
    }
  } else if (ev.k === 'kill') {
    const row = document.createElement('div');
    const a = d.byId[ev.a], v = d.byId[ev.v];
    const col = (p) => (!p ? '#fff' : inFfa ? (p.id === myId ? '#6fa3ff' : cssOf(p.tm)) : p.tm === 0 ? '#6fa3ff' : '#ff7a62');
    row.innerHTML = `<span style="color:${col(a)}">${nameOf(ev.a)}</span> ${ev.head ? '&#127919;' : '&#10140;'} <span style="color:${col(v)}">${nameOf(ev.v)}</span>`;
    $('killfeed').appendChild(row);
    setTimeout(() => row.remove(), 5000);
    if (ev.a === myId) { SFX.kill(); rs.kills++; }
    if (v && a && ev.a !== ev.v) killFx(a.b ? 0 : decodeLook(a.md, a.lk).fx, ev.x ?? v.x, ev.y ?? v.y, ev.z ?? v.z, colorOf(a.tm));
    if (ev.v === myId && ev.a !== myId) startKillCam(ev.a);
  } else if (ev.k === 'spell') {
    if (ev.s === 'shockwave') {
      addTracer([ev.ox, ev.oy - 0.25, ev.oz], [ev.ex, ev.ey, ev.ez], 0xffb347, 0.3, 0.05);
      ring(ev.ex, ev.ey - 0.9, ev.ez, 0xffb347, 2.2, 0.4);
      SFX.whoosh(250, 0.07); beep(110, 0.2, 'sine', 0.08, -50);
    }
    else if (ev.s === 'heal') { ring(ev.x, ev.y, ev.z, 0x4ade80, 1.2, 0.7, true); beep(520, 0.25, 'sine', 0.06, 400); }
    else if (ev.s === 'shield') { ring(ev.x, ev.y, ev.z, 0x7fe9ff, 1.4, 0.5); beep(700, 0.2, 'triangle', 0.05, -300); }
    else if (ev.s === 'dash') { ring(ev.x, ev.y, ev.z, 0xffffff, 1.6, 0.3); beep(250, 0.15, 'sawtooth', 0.04, 400); }
    else if (ev.s === 'nova') { ring(ev.x, ev.y, ev.z, 0x6ab8ff, ev.r + 0.5, 0.5); beep(180, 0.3, 'triangle', 0.07, 500); }
    else if (ev.s === 'firepool') { ring(ev.tx, 0, ev.tz, 0xff7a1a, ev.r + 0.5, 0.6); beep(120, 0.35, 'sawtooth', 0.07, 200); }
    else if (ev.s === 'bind') { ring(ev.x, ev.y, ev.z, 0xb36bff, 1.4, 0.5, true); beep(420, 0.1, 'triangle', 0.05, 200); }
    else if (ev.s === 'pushback') {
      ring(ev.x, ev.y, ev.z, 0xffb347, ev.r, 0.45);
      ring(ev.x, ev.y + 0.9, ev.z, 0xffe0a0, ev.r * 0.7, 0.3);
      beep(100, 0.3, 'sawtooth', 0.08, -40);
    }
    else if (ev.s === 'blink') { ring(ev.fx, ev.y, ev.fz, 0xb5e8ff, 1.6, 0.35); ring(ev.x, ev.y, ev.z, 0xb5e8ff, 1.6, 0.35, true); beep(900, 0.12, 'sine', 0.05, -500); }
    else if (ev.s === 'grapple') { addTracer([ev.ox, ev.oy, ev.oz], [ev.ex, ev.ey, ev.ez], 0xd8d8d8, 0.4, 0.03); ring(ev.ex, ev.ey - 0.9, ev.ez, 0xffffff, 1.2, 0.3); beep(220, 0.18, 'square', 0.05, 300); }
    else if (ev.s === 'smoke') { ring(ev.tx, 0, ev.tz, 0xc8ccd2, ev.r + 0.5, 0.5); beep(150, 0.25, 'triangle', 0.05, -60); }
    else if (ev.s === 'decoy') { ring(ev.x, ev.y, ev.z, 0xe2b84a, 1.4, 0.4, true); beep(500, 0.1, 'triangle', 0.04, 150); }
    else if (ev.s === 'slowtrap') { ring(ev.tx, 0, ev.tz, 0x6ab8ff, ev.r + 0.4, 0.4); SFX.trapPlace(); }
    else if (ev.s === 'gravity') { ring(ev.tx, 0, ev.tz, 0xa070ff, ev.r + 0.5, 0.6); SFX.gravity(); }
    else if (ev.s === 'overcharge') { ring(ev.x, ev.y, ev.z, 0xffd24a, 1.5, 0.5, true); SFX.overcharge(); }
    else if (ev.s === 'polymorph') { addTracer([ev.ox, ev.oy - 0.25, ev.oz], [ev.ex, ev.ey, ev.ez], 0xff9be8, 0.3, 0.05); ring(ev.ex, ev.ey - 0.9, ev.ez, 0xff9be8, 1.8, 0.4); beep(700, 0.25, 'triangle', 0.07, -400); }
    else if (ev.s === 'barbed') { ring(ev.x, ev.y, ev.z, 0xd01030, 1.5, 0.5, true); beep(200, 0.2, 'sawtooth', 0.05, -80); }
  } else if (ev.k === 'trapped') {
    ring(ev.x, 0, ev.z, 0x6ab8ff, 2.4, 0.4); SFX.trap();
  } else if (ev.k === 'marked') {
    const v = d.byId[ev.v]; if (v) ring(v.x, v.y, v.z, 0xffd24a, 1.4, 0.4, true);
    if (v) SFX.mark();
  } else if (ev.k === 'poly') {
    const v = d.byId[ev.v]; if (v) { ring(v.x, v.y, v.z, 0xff9be8, 1.6, 0.5, true); SFX.poly(); }
  } else if (ev.k === 'decoypop') {
    ring(ev.x, ev.y, ev.z, 0xe2b84a, 1.8, 0.35);
    beep(700, 0.1, 'square', 0.05, -400);
  } else if (ev.k === 'pushed') {
    const v = d.byId[ev.v];
    if (v) { ring(v.x, v.y, v.z, 0xffb347, 2, 0.35); beep(120, 0.2, 'square', 0.06, -50); }
  } else if (ev.k === 'bound') {
    const v = d.byId[ev.v];
    if (v) { ring(v.x, v.y, v.z, 0xb36bff, 1.4, 0.6); beep(150, 0.25, 'square', 0.06, -60); }
  } else if (ev.k === 'respawn') {
    const v = d.byId[ev.v];
    if (v) ring(v.x, v.y, v.z, 0xffffff, 1.8, 0.5, true);
    if (ev.v === myId && v) { yaw = v.yaw; pitch = 0; errOff.x = errOff.y = errOff.z = 0; }
  }
}

let rosterHtml = '';
function updateRoster(d) {
  const pct = (p) => Math.min(100, Math.round((p.hp / (p.mh || 100)) * 100));
  let html;
  if (inFfa) {
    // leaderboard: most kills first
    const list = [...d.p].sort((a, b) => b.k - a.k || a.d - b.d);
    html = list.map((p) => `<div class="r ${p.a ? '' : 'dead'}"><span class="nm" style="color:${p.id === myId ? '#6fa3ff' : cssOf(p.tm)}">${esc(p.n)}${p.id === myId ? ' (you)' : p.b ? ' &#9881;' : ''}</span>` +
      `<b class="kc">${p.k}</b></div>`).join('');
    const top = list[0], second = list.find((p) => p.id !== myId);
    const mine = spec ? list[0] : d.byId[myId];
    $('scB').textContent = mine ? mine.k : 0;
    $('scR').textContent = (top && top.id !== myId ? top : second || top) ? (top && top.id !== myId ? top : second || top).k : 0;
    $('rd').textContent = `FREE FOR ALL · FIRST TO ${d.kt}`;
  } else {
    const mine = d.p.filter((p) => p.tm === myTeam), theirs = d.p.filter((p) => p.tm !== myTeam);
    const row = (p) => `<div class="r ${p.a ? '' : 'dead'}"><span class="nm" style="color:${p.tm === 0 ? '#6fa3ff' : '#ff7a62'}">${esc(p.n)}${p.id === myId ? ' (you)' : p.b ? ' &#9881;' : ''}</span>` +
      `<span class="bar"><i style="width:${pct(p)}%;background:${p.tm === myTeam ? '#4ade80' : '#ff5436'}"></i></span></div>`;
    html = mine.map(row).join('') + '<hr>' + theirs.map(row).join('');
    $('scB').textContent = d.sc[0];
    $('scR').textContent = d.sc[1];
    $('rd').textContent = `ROUND ${d.rd} · FIRST TO 3`;
  }
  if (html !== rosterHtml) { rosterHtml = html; $('roster').innerHTML = html; }
}

// ------------------------------------------------------------------ input
const held = (act) => !!keys[binds[act]];
/** A key / mouse button / wheel notch went down: cast skills, queue a shot (semi-auto: one press = one shot). */
function pressCode(code) {
  keys[code] = true;
  if (code === binds.skill1) castQ = true;
  if (code === binds.skill2) castE = true;
  if (code === binds.skill3) castR = true;
  if (code === binds.shoot) shootBuf = 0.14; // short buffer so fast clicks are not lost
}
window.addEventListener('keydown', (e) => {
  if (!playing || listening) return;
  if (e.code === 'Tab') e.preventDefault();
  if (e.repeat) return;
  if (spec) { if (e.code === 'ArrowRight' || e.code === 'KeyD') specCycle(1); else if (e.code === 'ArrowLeft' || e.code === 'KeyA') specCycle(-1); return; }
  if (locked || e.code !== binds.shoot) pressCode(e.code);
  if (e.code === 'Space' || e.code === binds.jump || e.code.startsWith('Arrow')) e.preventDefault();
});
window.addEventListener('keyup', (e) => { keys[e.code] = false; });
window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; shootBuf = 0; });
canvas.addEventListener('mousedown', (e) => {
  if (!playing || listening) return;
  e.preventDefault();
  if (spec) { specCycle(e.button === 2 ? -1 : 1); return; }
  if (!locked) { lockPointer(); return; }
  pressCode(`Mouse${e.button}`);
});
window.addEventListener('mouseup', (e) => { keys[`Mouse${e.button}`] = false; if (e.button > 2 && locked) e.preventDefault(); });
window.addEventListener('auxclick', (e) => { if (locked) e.preventDefault(); });
// Mouse wheel binds: each notch is a quick press and release.
window.addEventListener('wheel', (e) => {
  if (!playing || !locked || listening || !e.deltaY) return;
  e.preventDefault();
  const code = e.deltaY < 0 ? 'WheelUp' : 'WheelDown';
  pressCode(code);
  setTimeout(() => { keys[code] = false; }, 90);
}, { passive: false });
window.addEventListener('contextmenu', (e) => e.preventDefault());
// Raw (unaccelerated) mouse where the browser supports it, plain pointer lock otherwise.
function lockPointer() {
  try {
    const r = canvas.requestPointerLock({ unadjustedMovement: true });
    if (r && r.catch) r.catch(() => canvas.requestPointerLock());
  } catch { canvas.requestPointerLock(); }
}
let ignoreMoves = 0;
window.addEventListener('mousemove', (e) => {
  if (!locked || !playing) return;
  if (ignoreMoves > 0) { ignoreMoves--; return; } // first events after locking can carry a bogus jump
  if (Math.abs(e.movementX) > 400 || Math.abs(e.movementY) > 400) return; // browser glitch spike, not a real flick
  const s = 0.0022 * cfg.sens;
  yaw -= e.movementX * s;
  pitch = clamp(pitch - e.movementY * s, -1.5, 1.5);
});
document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === canvas;
  if (locked) ignoreMoves = 3;
  if (!locked) shootBuf = 0;
  $('pause').classList.toggle('hidden', locked || !playing || pickOpen || !$('binds').classList.contains('hidden') || !$('xh').classList.contains('hidden'));
});

function startGame(queue) {
  if (queue === 'ranked' && isFfaMode()) return;
  if (queue === 'range') cfg.mode = cfg.mode; // (the range ignores the chosen mode and map)
  if (queue === 'ranked' && !account) { openAuth('login'); return; }
  if (cfg.loadout.length !== SLOT_COUNT) return;
  cfg.name = ($('name').value || 'Player').trim().slice(0, 14) || 'Player';
  for (const k of ['name', 'mode', 'sens', 'quality', 'map', 'ffaMap', 'team']) store.set(k, cfg[k]);
  store.set('loadout3', cfg.loadout);
  audio();
  if (queue === 'ranked') { searching = true; $('search').classList.remove('hidden'); $('searchtime').textContent = '0s'; }
  else { $('menu').classList.add('hidden'); lockPointer(); }
  connect(queue);
}
$('quick').onclick = () => startGame('quick');
$('ranked').onclick = () => startGame('ranked');
$('rangebtn').onclick = () => startGame('range');
$('searchcancel').onclick = () => { try { ws.send(JSON.stringify({ t: 'cancel' })); } catch { /* ignore */ } location.reload(); };
$('resume').onclick = () => { lockPointer(); $('pause').classList.add('hidden'); };
$('leave').onclick = () => location.reload();
function openReport() {
  const list = latest ? latest.p.filter((p) => !p.b && p.id !== myId) : [];
  if (!list.length) { toast('There is nobody else to report in this match.'); return; }
  $('repwho').innerHTML = list.map((p) => `<option value="${p.id}">${esc(p.n)}</option>`).join('');
  $('report').classList.remove('hidden');
}
$('reportbtn').onclick = openReport;
$('endreport').onclick = openReport;
$('repclose').onclick = () => $('report').classList.add('hidden');
$('repsend').onclick = () => {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify({ t: 'report', id: Number($('repwho').value), reason: $('repwhy').value }));
  $('report').classList.add('hidden');
};
$('endleave').onclick = () => location.reload();
$('playagain').onclick = () => {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify({ t: 'rematch' }));
  $('playagain').disabled = true; $('playagain').textContent = 'READY';
  lockPointer(); // the click is the user gesture the browser needs, so the next match starts with no menu in the way
};

// ------------------------------------------------------------------ 15 second pick window after a match
let pickOpen = false;
const pickSt = { loadout: [...cfg.loadout] };
let lastSentPick = '';
function sendPick() {
  if (pickSt.loadout.length !== SLOT_COUNT) return;
  const key = JSON.stringify(pickSt.loadout);
  if (key === lastSentPick) return;
  lastSentPick = key;
  cfg.loadout = [...pickSt.loadout];
  store.set('loadout3', cfg.loadout);
  if (ws && ws.readyState === 1) ws.send(JSON.stringify({ t: 'pick', loadout: pickSt.loadout }));
}
function renderPickOverlay() {
  renderPicker({ slots: 'pslots', spells: 'pspellpick' }, pickSt, () => { renderPickOverlay(); sendPick(); });
}
function updatePickWindow() {
  const want = phase === 'matchEnd' && !spec;
  if (want && !pickOpen) {
    pickOpen = true;
    pickSt.loadout = [...meLoadout]; pickSt.holes = [];
    lastSentPick = JSON.stringify(pickSt.loadout);
    if (document.pointerLockElement) document.exitPointerLock();
    $('pause').classList.add('hidden');
    $('ratingline').textContent = ranked ? (ratingMsg ? `RANKED  ${ratingMsg}` : 'RANKED  updating your rating...') : '';
    renderPickOverlay();
    $('playagain').disabled = false; $('playagain').textContent = 'PLAY AGAIN'; $('rvnote').textContent = '';
    $('pickover').classList.remove('hidden');
  } else if (!want && pickOpen) {
    pickOpen = false;
    ratingMsg = '';
    $('xpline').textContent = '';
    $('pickover').classList.add('hidden');
    if (!locked) { $('pausetitle').textContent = 'NEXT MATCH'; $('pausesub').textContent = 'Click to take control.'; $('pause').classList.remove('hidden'); }
  }
}

// ------------------------------------------------------------------ fixed-step update (60 Hz)
function step() {
  if (!playing || spec || !ws || ws.readyState !== 1) return;
  fireCd = Math.max(0, fireCd - DT);
  shootBuf = Math.max(0, shootBuf - DT);
  if (!meAlive || phase === 'countdown') { castQ = castE = castR = false; meArmed = -1; return; }
  const sheep = (meSf & 32) !== 0; // polymorphed: the server ignores shots and skills, so don't predict them either
  if (sheep) { castQ = castE = castR = false; shootBuf = 0; meArmed = -1; }
  const inp = {
    seq: ++seq,
    mx: (held('right') ? 1 : 0) - (held('left') ? 1 : 0),
    mz: (held('forward') ? 1 : 0) - (held('back') ? 1 : 0),
    yaw, pitch,
    jump: held('jump'),
    crouch: held('crouch') || held('crouch2') || (binds.crouch2 === 'ShiftLeft' && !!keys.ShiftRight),
    shoot: false,
    q: castQ, e: castE, r: castR,
  };
  // aimed skills: the key arms them (press again to put away); the next shot fires them
  {
    const tNow = performance.now();
    [inp.q, inp.e, inp.r].forEach((pressed, i) => {
      const sp = SPELLS[meLoadout[i]];
      if (!pressed || !sp || !sp.aim) return;
      const rem = Math.max(0, (meCd[i] || 0) - (tNow - cdAt) / 1000);
      if (meArmed === i) meArmed = -1; else if (rem <= 0.05) { meArmed = i; SFX.arm(); }
      armHold = tNow + 300;
    });
  }
  if (shootBuf > 0 && locked && phase === 'live' && fireCd <= 0) {
    shootBuf = 0;
    if (meAmmo > 0 || meArmed >= 0) inp.shoot = true;
    else { fireCd = 0.25; SFX.dry(); gainT = -performance.now() - 900; } // dry click: flash NO AMMO
  }
  // Tell the server which moment of the world we are looking at, so it can rewind enemies to match.
  if (inp.shoot || inp.q || inp.e || inp.r) inp.vt = viewTick(performance.now());
  castQ = castE = castR = false;
  stepPlayer(me, inp, DT);
  pending.push(inp);
  if (pending.length > 120) pending.shift();
  ws.send(JSON.stringify({ t: 'in', ...inp }));
  if (inp.shoot) {
    fireCd = FIRE_INTERVAL;
    if (meArmed >= 0) { // this shot carries the armed skill: no ammo, no rifle damage
      inp.sk = true;
      localSkillShot(meLoadout[meArmed]);
      meArmed = -1; armHold = performance.now() + 300;
    } else { meAmmo = Math.max(0, meAmmo - 1); rs.shots++; localShot(); }
  }
}

function localSkillShot(id) {
  const [dx, dy, dz] = lookDir(yaw, pitch);
  const ex = me.x, ey = me.y + eyeH(me), ez = me.z;
  let t = rayWorld(ex, ey, ez, dx, dy, dz, 80);
  if (!Number.isFinite(t)) t = 80;
  const rx = Math.cos(yaw), rz = -Math.sin(yaw);
  const start = [ex + rx * 0.25 + dx * 0.7, ey - 0.22 + dy * 0.7, ez + rz * 0.25 + dz * 0.7];
  addTracer(start, [ex + dx * t, ey + dy * t, ez + dz * t], SKILL_COLOR[id] || 0xffffff, 0.3, 0.035);
  flashT = 0.05;
  kick = 0.09;
  SFX.whoosh(900, 0.06); beep(180, 0.1, 'sine', 0.08, -60);
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
  shotCount++;
  const [dx, dy, dz] = lookDir(yaw, pitch);
  const ex = me.x, ey = me.y + eyeH(me), ez = me.z;
  let t = rayWorld(ex, ey, ez, dx, dy, dz, 80);
  if (!Number.isFinite(t)) t = 80;
  const rx = Math.cos(yaw), rz = -Math.sin(yaw);
  const start = [ex + rx * 0.25 + dx * 0.7, ey - 0.22 + dy * 0.7, ez + rz * 0.25 + dz * 0.7];
  const bindShot = (meBf & 8) !== 0, overShot = (meBf & 4) !== 0;
  addTracer(start, [ex + dx * t, ey + dy * t, ez + dz * t], overShot ? 0xffd24a : bindShot ? 0xb36bff : colorOf(myTeam), bindShot || overShot ? 0.25 : 0.1, bindShot || overShot ? 0.03 : 0.012);
  flashT = 0.04;
  kick = 0.07;
  SFX.shot();
}

// ------------------------------------------------------------------ rendering
const setText = (el, v) => { if (el.textContent !== v) el.textContent = v; };

// Kill-cam: after you die, replay the last ~2.5 s from your killer's eyes using the stored snapshots.
let kc = null; // { killer, t0, from, dur }
const KC_BACK = 2500, KC_DUR = 3200;
function startKillCam(killerId) {
  if (spec || kc || !snaps.length || killerId === myId) return;
  kc = { killer: killerId, t0: performance.now(), from: performance.now() - KC_BACK, dur: KC_DUR };
}
const kcTime = (now) => kc.from + (now - kc.t0) * (KC_BACK / KC_DUR) * 1.0; // replay runs a bit slower than real time
function snapAtTime(t) {
  for (let i = snaps.length - 1; i >= 0; i--) if (snaps[i].t <= t) return snaps[i].d;
  return snaps[0].d;
}

function sampleRemote(id, now) {
  if (!snaps.length) return null;
  const rt = now - INTERP_MS;
  let a = null, b = null;
  for (let i = snaps.length - 1; i >= 0; i--) {
    if (snaps[i].t <= rt) { a = snaps[i]; b = snaps[i + 1] || null; break; }
  }
  if (!a) { a = snaps[0]; b = null; }
  let pa = a.d.byId[id], pb = b ? b.d.byId[id] : null;
  if (!pa && !pb) return null;
  if (pa && pa.hid && pb && !pb.hid) pa = pb; // just came into view: do not slide in from where they were last seen
  if (pb && pb.hid && pa && !pa.hid) pb = pa;
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
let fpsEma = 60, slowWindows = 0, winFrames = 0, winMs = 0, toastT = 0;
function trackPerformance(rawMs) {
  fpsEma += (1000 / Math.max(1, rawMs) - fpsEma) * 0.05;
  winFrames++; winMs += rawMs;
  if (winMs < 2500) return;
  const avg = winMs / winFrames;
  winFrames = 0; winMs = 0;
  // Slow machine on High graphics: switch to Fast by itself after two slow windows in a row.
  if (playing && cfg.quality === 'high' && avg > 30) {
    if (++slowWindows >= 2) {
      cfg.quality = 'low'; store.set('quality', 'low'); applyQuality();
      slowWindows = 0; toastT = performance.now() + 5000;
    }
  } else slowWindows = 0;
}

function frame(now) {
  trackPerformance(now - last);
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
    drawFrame(false);
    return;
  }
  if (viewOffsetOn) { camera.clearViewOffset(); viewOffsetOn = false; }
  if (preview) preview.group.visible = false;

  world.update(now, camera);
  // entities
  const seen = new Set();
  let spectateTarget = null;
  if (kc && (meAlive || phase === 'countdown' || now - kc.t0 > kc.dur || !ents.has(kc.killer))) { kc = null; }
  const kcNow = kc ? kcTime(now) : 0;
  const view = kc ? snapAtTime(kcNow) : latest;
  const sampleT = kc ? kcNow + INTERP_MS : now;
  for (const pd of (view.pl || view.p)) {
    seen.add(pd.id);
    if (pd.hid) { const h = ents.get(pd.id); if (h) h.group.visible = false; continue; } // server hides enemies you cannot see
    let ent = ents.get(pd.id);
    const pLook = decodeLook(pd.md, pd.lk);
    const lkKey = `${lookKey(pLook)}|${pLook.gun}`;
    if (ent && ent.lkKey !== lkKey) { scene.remove(ent.group); ents.delete(pd.id); ent = null; }
    if (!ent) { ent = makeEntity(pd); ent.lkKey = lkKey; ents.set(pd.id, ent); }
    if (pd.id === myId && !kc) { ent.group.visible = false; continue; }
    const s = sampleRemote(pd.id, sampleT) || pd;
    ent.eye = EYE_H; ent.x = s.x; ent.y = s.y; ent.z = s.z; ent.yaw = s.yaw; ent.pit = s.pit;
    ent.group.visible = !!pd.a && !(kc && pd.id === kc.killer);
    ent.group.position.set(s.x, s.y, s.z);
    if (pd.dcy) { ent.sprite.visible = false; ent.group.rotation.y = s.yaw; ent.group.scale.set(1, 1, 1); ent.shield.visible = false; for (const k in ent.auras) ent.auras[k].visible = false; ent.root.visible = false; continue; }
    ent.group.rotation.y = s.yaw;
    const sheeped = !!(pd.sf & 32);
    if (ent.sheep.visible !== sheeped) { ent.sheep.visible = sheeped; ent.model.visible = !sheeped; ent.gun.visible = !sheeped; }
    const marked = !!pd.mk && pd.mk - 2 === myTeam && pd.tm !== myTeam;
    ent.mk.visible = marked; if (marked) ent.mk.position.y = 3.0 + Math.sin(performance.now() / 180) * 0.12;
    ent.shield.visible = !!pd.sh;
    ent.auras.burn.visible = !!(pd.sf & 4);
    ent.auras.bleed.visible = !!(pd.sf & 8) && !(pd.sf & 4);
    ent.auras.slow.visible = !!(pd.sf & 2) && !(pd.sf & 12);
    ent.root.visible = !!(pd.sf & 1);
    const crouching = !!(pd.sf & 16);
    ent.cy += ((crouching ? 0.78 : 1) - ent.cy) * Math.min(1, dt * 14);
    ent.group.scale.set(1, ent.cy, 1);
    ent.sprite.scale.set(2.2, 0.62 / ent.cy, 1);
    ent.eye = crouching ? 1.25 : EYE_H;
    const ally = !inFfa && pd.tm === myTeam;
    drawTag(ent, pd, ally);
    // teammates' plates show through walls; an enemy's plate is only visible while you can actually see the enemy
    const seeThrough = ally || marked;
    if (ent.plateAlly !== seeThrough) { ent.plateAlly = seeThrough; ent.sprite.material.depthTest = !seeThrough; ent.sprite.material.needsUpdate = true; }
    if (pd.a && ally && !spectateTarget) spectateTarget = ent;
  }
  for (const [id, ent] of ents) {
    if (!seen.has(id)) { scene.remove(ent.group); ents.delete(id); }
  }
  if (kc) {
    spectateTarget = ents.get(kc.killer) || null;
  } else if (spec) {
    spectateTarget = null;
    const cur = latest.byId[specId];
    if (!cur || !cur.a) { // followed player died (or none chosen yet): move to the next one alive
      const alive = latest.p.filter((p) => p.a);
      const nx = alive.find((p) => p.tm === (cur ? cur.tm : 0)) || alive[0];
      if (nx) specId = nx.id;
    }
    spectateTarget = ents.get(specId) || null;
    const sp = latest.byId[specId];
    if (sp && specId !== specShown) { specShown = specId; $('specname').textContent = sp.n; $('specname').style.color = cssOf(sp.tm); }
  } else if (!spectateTarget) {
    for (const pd of latest.p) {
      const ent = ents.get(pd.id);
      if (pd.a && pd.id !== myId && ent) { spectateTarget = ent; break; }
    }
  }

  // camera
  const decay = Math.exp(-12 * dt);
  errOff.x *= decay; errOff.y *= decay; errOff.z *= decay;
  if (meAlive && !spec) {
    eyeCur += (eyeH(me) - eyeCur) * Math.min(1, dt * 16);
    camera.position.set(me.x + errOff.x, me.y + eyeCur + errOff.y, me.z + errOff.z);
    camera.rotation.set(pitch, yaw, 0);
    gun.visible = true;
  } else if (spectateTarget) {
    camera.position.set(spectateTarget.x, spectateTarget.y + spectateTarget.eye, spectateTarget.z);
    camera.rotation.set(spectateTarget.pit, spectateTarget.yaw, 0);
    gun.visible = false;
  }

  updateFloaters(now);

  // viewmodel recoil + muzzle flash
  kick = Math.max(0, kick - dt * 0.5);
  flashT = Math.max(0, flashT - dt);
  gun.position.z = GUN_Z + kick * 2;
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

  drawFrame(meAlive);
  updateHud(now);
}

function updateRangeHud() {
  const el = $('rangestats');
  const acc = rs.shots ? Math.round((rs.hits / rs.shots) * 100) : 0;
  const html = `<b>PRACTICE RANGE</b><span>Shots ${rs.shots}</span><span>Hits ${rs.hits}</span><span>Accuracy ${acc}%</span><span>Headshots ${rs.heads}</span><span>Kills ${rs.kills}</span><small>Backspace resets</small>`;
  if (el.innerHTML !== html) el.innerHTML = html;
}
window.addEventListener('keydown', (e) => { if (inRange && playing && e.code === 'Backspace') { rs = { shots: 0, hits: 0, heads: 0, kills: 0 }; e.preventDefault(); } });

function updateHud(now) {
  if (inRange) updateRangeHud();
  if (meAmmo !== ammoShown) { ammoShown = meAmmo; setText($('ammon'), inRange ? '\u221e' : String(meAmmo)); $('ammo').classList.toggle('low', meAmmo <= 3); }
  const gt = gainT > 0 ? now - gainT : -1;
  const ag = $('ammogain');
  if (gainT < 0 && now + gainT < 0) { setText(ag, 'NO AMMO'); ag.style.opacity = '1'; }
  else if (gt >= 0 && gt < 1400) { setText(ag, `+${AMMO_KILL} AMMO`); ag.style.opacity = String(1 - gt / 1400); }
  else ag.style.opacity = '0';
  $('firebar').style.width = `${clamp(fireCd / FIRE_INTERVAL, 0, 1) * 100}%`;
  setText($('hpval'), String(meAlive ? meHp : 0));
  const hf = $('hpfill');
  hf.style.width = `${meAlive ? clamp(meHp / meMax, 0, 1) * 100 : 0}%`;
  { const fr = meHp / meMax; hf.style.backgroundColor = fr > 0.5 ? '#4ade80' : fr > 0.25 ? '#facc15' : '#f87171'; hf.style.color = hf.style.backgroundColor; }

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

  for (let i = 0; i < spells.length; i++) {
    const on = meAlive && meArmed === i;
    spells[i].classList.toggle('armed', on);
    const tag = spells[i].querySelector('.rdy'); const want = on ? 'SHOOT!' : 'READY';
    if (tag.textContent !== want) tag.textContent = want;
  }
  $('crosshair').classList.toggle('armed', meAlive && meArmed >= 0);
  const BUFF_BIT = { barbed: 2, bind: 8, overcharge: 4 };
  for (let i = 0; i < spells.length; i++) spells[i].classList.toggle('buffed', !!(meAlive && (meBf & (BUFF_BIT[meLoadout[i]] || 0))));
  const tags = [];
  if (meAlive) {
    if (meSf & 1) tags.push('<span style="color:#b36bff">ROOTED</span>');
    if (meSf & 2) tags.push('<span style="color:#6ab8ff">SLOWED</span>');
    if (meSf & 4) tags.push('<span style="color:#ff8a3a">BURNING</span>');
    if (meSf & 8) tags.push('<span style="color:#ff4060">BLEEDING</span>');
    if (meBf & 2) tags.push('<span style="color:#ff6a80">BARBED ROUNDS</span>');
    if (meBf & 8) tags.push('<span style="color:#c79bff">BIND: NEXT SHOT ROOTS</span>');
    if (meBf & 4) tags.push('<span style="color:#ffd24a">OVERCHARGE: NEXT SHOT x2</span>');
    if (meArmed >= 0 && SPELLS[meLoadout[meArmed]]) tags.push(`<span style="color:#ffe9a0">${esc(SPELLS[meLoadout[meArmed]].name.toUpperCase())} ARMED: SHOOT TO CAST</span>`);
    if (meSf & 32) tags.push('<span style="color:#fff">BAA! YOU ARE A SHEEP</span>');
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
    small = inFfa ? 'FREE FOR ALL' : `ROUND ${latest.rd}`;
  } else if (phase === 'roundEnd') {
    big = latest.lw === -1 ? 'DRAW' : latest.lw === myTeam ? 'ROUND WON' : 'ROUND LOST';
  } else if (phase === 'matchEnd') {
    big = latest.w === myTeam ? 'VICTORY' : 'DEFEAT';
    small = inFfa && latest.byId && latest.byId[latest.p.find((q) => q.tm === latest.w)?.id] ? `WINNER: ${esc(latest.p.find((q) => q.tm === latest.w).n)} · NEXT MATCH STARTING...` : 'NEXT MATCH STARTING...';
    if (ranked && ratingMsg) big += `<span class="rt">${esc(ratingMsg)}</span>`;
  }
  const banner = $('banner');
  const html = big ? `${big}${small ? `<small>${small}</small>` : ''}` : '';
  if (banner.innerHTML !== html) banner.innerHTML = html;

  const sp = $('spectate');
  sp.classList.toggle('hidden', spec || meAlive || phase === 'countdown');
  if (kc) setText(sp, `KILL CAM \u00b7 ${nameOf(kc.killer)}`);
  else if (inFfa && !meAlive && phase === 'live') setText(sp, `RESPAWNING IN ${Math.max(1, Math.ceil(meRespawn - sinceSnap))}`); else setText(sp, 'SPECTATING');
  $('pickcount').textContent = String(Math.max(0, Math.ceil(phaseT - sinceSnap)));
  if (phase === 'matchEnd') setText($('rvnote'), latest.rh > 1 ? `${latest.rv || 0}/${latest.rh} ready` : '');
  setText($('ping'), `${Math.round(fpsEma)} fps \u00b7 ${pingMs} ms${performance.now() < toastT ? ' \u00b7 switched to Fast graphics' : ''}`);
}

setPreview(effLook());
renderMenu();
renderAcct();
loadAccount();
requestAnimationFrame(frame);

// Small read-only handle used by automated browser tests.
window.__aim = {
  me, errOff, ents, killFx, SFX, hitSound,
  get phase() { return phase; },
  get latest() { return latest; },
  get pending() { return pending; },
  get alive() { return meAlive; },
  get shots() { return shotCount; },
  get mapId() { return worldMapId; },
  get team() { return myTeam; },
  get ranked() { return ranked; },
  forcePhase(p) { phaseOverride = p; if (p) phase = p; updatePickWindow(); },
  get sceneObjects() { let n = 0; scene.traverse((o) => { if (o.isMesh) n++; }); return n; },
  get myId() { return myId; },
  get ffa() { return inFfa; },
  get binds() { return binds; },
  get xh() { return xh; },
  press(code) { pressCode(code); },
  get range() { return inRange; },
  get rs() { return rs; },
  get killcam() { return !!kc; },
  forceDead(v) { deadOverride = v; meAlive = !v; },
  forceKillCam(id) { startKillCam(id); },
  forceFire(v) { locked = v; shootBuf = v ? 0.14 : 0; },
};
