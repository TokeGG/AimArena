// Shared deterministic simulation. Used by the server (authoritative) and the
// browser client (prediction), so both must stay free of DOM / Node APIs.

export const VERSION = '0.9.2'; // bump on every release; the page warns when main.js and the server differ
export const TICK_RATE = 60;
export const DT = 1 / TICK_RATE;

export const PLAYER_R = 0.45;
export const PLAYER_H = 1.8;
export const EYE_H = 1.6;
export const HEAD_Y = 1.45; // hits above this height (relative to feet) are headshots
// Crouching: slower, lower eyes and a smaller hitbox (no jumping while crouched).
export const CROUCH_H = 1.4;
export const CROUCH_EYE = 1.25;
export const CROUCH_HEAD_Y = 1.1;
export const CROUCH_SPEED = 0.75;
export const eyeH = (p) => (p.crouch ? CROUCH_EYE : EYE_H);
export const HIT_R = 0.5; // hitscan hit radius (slightly generous)
export const MOVE_SPEED = 7;
export const JUMP_V = 7.5;
export const GRAVITY = 22;
export const MAX_HP = 150;

export const FIRE_INTERVAL = 0.5; // one shot every half second
export const AMMO_START = 15;     // rounds at the start of every round / life
export const AMMO_KILL = 5;       // bonus rounds for a kill
export const AMMO_MAX = 30;       // cap
export const BODY_DMG = 22;
export const HEAD_DMG = 45;
export const RANGE = 100;

export const SPELLS = {
  dash: { name: 'Dash', cd: 5, cost: 1, desc: 'Burst of speed in your move direction.' },
  shield: { name: 'Shield', cd: 14, cost: 2, desc: 'Take 40% less damage for 2.5s.' },
  heal: { name: 'Heal', cd: 18, cost: 2, desc: 'Instantly restore 50 HP.' },
  shockwave: { name: 'Shockwave', cd: 10, cost: 2, aim: true, desc: 'Press, then shoot: the enemy you hit is pushed straight back. No damage.' },
  pushback: { name: 'Pushback', cd: 10, cost: 2, desc: 'Blast that shoves every enemy within 7m away from you. No damage.' },
  bind: { name: 'Bind', cd: 11, cost: 2, desc: 'Your next rifle shot roots the enemy it hits for 1.8s (6s to use it).' },
  firepool: { name: 'Fire Pool', cd: 14, cost: 2, aim: true, desc: 'Press, then shoot: ignites the ground where it lands, 3m wide, burns enemies for 5s.' },
  nova: { name: 'Frost Nova', cd: 12, cost: 2, desc: 'Blast within 5m: 12 damage and 3s slow on enemies.' },
  barbed: { name: 'Barbed Rounds', cd: 14, cost: 1, desc: '6s: rifle hits make the target bleed (worse when moving).' },
  blink: { name: 'Blink', cd: 9, cost: 2, desc: 'Teleport 9m forward where you look (stops at walls).' },
  grapple: { name: 'Grapple', cd: 8, cost: 2, aim: true, desc: 'Press, then shoot a wall: hooks it and pulls you there (up to 28m).' },
  smoke: { name: 'Smoke', cd: 14, cost: 1, aim: true, desc: 'Press, then shoot: a smoke cloud where it lands. Blocks sight for 7s.' },
  decoy: { name: 'Decoy', cd: 16, cost: 1, aim: true, desc: 'Press, then shoot: a fake copy of you appears where it lands for 6s. Enemy shots at it are wasted.' },
  slowtrap: { name: 'Slow Trap', cd: 12, cost: 1, aim: true, desc: 'Press, then shoot: plants a mine where it lands (max 2). The first enemy to step on it is slowed for 3s.' },
  mark: { name: 'Mark', cd: 14, cost: 1, aim: true, desc: 'Press, then shoot: the enemy you hit is seen by your team through walls for 5s.' },
  gravity: { name: 'Gravity Well', cd: 16, cost: 2, aim: true, desc: 'Press, then shoot: a field where it lands pulls everything to its centre for 2.5s and slows enemies.' },
  polymorph: { name: 'Polymorph', cd: 18, cost: 2, aim: true, desc: 'Press, then shoot: turns the enemy you hit into a sheep for 2s. They can move but cannot shoot or use skills.' },
  overcharge: { name: 'Overcharge', cd: 14, cost: 2, desc: 'Your next rifle shot deals double damage (6s to use it).' },
};
// `aim: true` skills are armed with their key, then fired by your next shot (no ammo used). The rest cast instantly,
// except Bind / Barbed / Overcharge, which buff your next rifle shot.
// Skill points: you pick 3 skills but can only spend this many points on them.
export const LOADOUT_BUDGET = 5;
export const loadoutCost = (ids) => ids.reduce((a, id) => a + (SPELLS[id] ? SPELLS[id].cost : 9), 0);

export const SLOT_KEYS = ['Q', 'E', 'R'];
export const SLOT_COUNT = 3;
export const DEFAULT_LOADOUT = ['dash', 'heal', 'shield'];

// Every character plays exactly the same (100 HP, same speed). The "model" is only the body style you wear;
// the rest of your look (helmet, shoulders, back piece, material, colours) lives in `look` below.
export const MODELS = {
  striker: { name: 'Striker', hp: 150, speed: 7, healMult: 1, blurb: 'Plated combat armour' },
  vanguard: { name: 'Vanguard', hp: 150, speed: 7, healMult: 1, blurb: 'Heavy bulwark frame' },
  phantom: { name: 'Phantom', hp: 150, speed: 7, healMult: 1, blurb: 'Sleek stealth suit' },
  warden: { name: 'Warden', hp: 150, speed: 7, healMult: 1, blurb: 'Long-coat sentinel' },
};
export const DEFAULT_MODEL = 'striker';

// Status tuning (shared so the client HUD and server agree)
export const SLOW_FACTOR = 0.55;

// ---------------------------------------------------------------- map
// Map layouts live in maps.js. The sim works on ONE "current" map at a time (WALLS / HAZARDS):
// the server calls useMap(room.mapId) before it steps a room, the browser calls it once on join.
import { MAPS, MAP_IDS, DEFAULT_MAP, TEAM_MAP_IDS, FFA_MAP_IDS } from './maps.js';
export { MAPS, MAP_IDS, DEFAULT_MAP, TEAM_MAP_IDS, FFA_MAP_IDS };
export const SHIELD_WALL_H = 3.5;
export let WALLS = MAPS[DEFAULT_MAP].walls;
export let HAZARDS = MAPS[DEFAULT_MAP].hazards;
export let ARENA = MAPS[DEFAULT_MAP].size; // half-extent of the current map's square arena (metres)
let curMap = DEFAULT_MAP;
let curDef = MAPS[DEFAULT_MAP];
export function useMap(id) {
  if (id === curMap) return;
  const m = MAPS[id] || MAPS[DEFAULT_MAP];
  curMap = MAPS[id] ? id : DEFAULT_MAP;
  WALLS = m.walls;
  HAZARDS = m.hazards;
  ARENA = m.size;
  curDef = m;
}

/** Team spawn for the current map (team 1 is team 0 rotated 180 degrees). */
export function spawnPoint(team, slot) {
  const list = curDef.spawns || [{ x: 0, z: 0, yaw: 0 }];
  const s = list[slot % list.length];
  return team === 0 ? { x: s.x, z: s.z, yaw: s.yaw } : { x: -s.x, z: -s.z, yaw: s.yaw + Math.PI };
}

/** Free-for-all spawn points of the current map (index wraps). */
export function ffaSpawn(i) {
  const list = curDef.ffaSpawns || [{ x: 0, z: 0 }];
  const s = list[i % list.length];
  return { x: s.x, z: s.z };
}
export const ffaSpawnCount = () => (curDef.ffaSpawns || []).length || 1;

// ---------------------------------------------------------------- movement
function floorAt(x, z, y) {
  let f = 0;
  for (const w of WALLS) {
    if (w.h > f && y >= w.h - 0.02 && x >= w.minX && x <= w.maxX && z >= w.minZ && z <= w.maxZ) f = w.h;
  }
  return f;
}

export function resolveWalls(p) {
  for (let iter = 0; iter < 2; iter++) {
    for (const w of WALLS) {
      if (p.y >= w.h - 0.05) continue; // feet above the top: no horizontal collision
      const cx = Math.min(Math.max(p.x, w.minX), w.maxX);
      const cz = Math.min(Math.max(p.z, w.minZ), w.maxZ);
      const dx = p.x - cx, dz = p.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= PLAYER_R * PLAYER_R) continue;
      if (d2 > 1e-8) {
        const d = Math.sqrt(d2);
        const push = (PLAYER_R - d) / d;
        p.x += dx * push;
        p.z += dz * push;
      } else {
        // centre inside the box: push out along the shallowest axis
        const l = p.x - w.minX, r = w.maxX - p.x, t = p.z - w.minZ, b = w.maxZ - p.z;
        const m = Math.min(l, r, t, b);
        if (m === l) p.x = w.minX - PLAYER_R;
        else if (m === r) p.x = w.maxX + PLAYER_R;
        else if (m === t) p.z = w.minZ - PLAYER_R;
        else p.z = w.maxZ + PLAYER_R;
      }
    }
  }
  const lim = ARENA - PLAYER_R;
  p.x = Math.min(Math.max(p.x, -lim), lim);
  p.z = Math.min(Math.max(p.z, -lim), lim);
}

/**
 * Advance one player by `dt`.
 * p:   { x,y,z, vx,vy,vz, dvx,dvz,dashT }
 * inp: { mx, mz, yaw, jump }   mx: +1 = right, mz: +1 = forward
 */
export function stepPlayer(p, inp, dt) {
  const s = Math.sin(inp.yaw), c = Math.cos(inp.yaw);
  let wx = -s * inp.mz + c * inp.mx;
  let wz = -c * inp.mz - s * inp.mx;
  const l = Math.hypot(wx, wz);
  if (l > 1) { wx /= l; wz /= l; }

  // status effects: rooted = cannot move, jump or dash; slowed = reduced speed
  const rooted = (p.rootT || 0) > 0;
  if (rooted) { wx = 0; wz = 0; p.dashT = 0; p.dvx = 0; p.dvz = 0; }
  p.crouch = !!inp.crouch;
  const speed = (p.speed || MOVE_SPEED) * ((p.slowT || 0) > 0 ? SLOW_FACTOR : 1) * (p.crouch ? CROUCH_SPEED : 1);
  if (p.rootT > 0) p.rootT = Math.max(0, p.rootT - dt);
  if (p.slowT > 0) p.slowT = Math.max(0, p.slowT - dt);

  const floor = floorAt(p.x, p.z, p.y);
  const grounded = p.y <= floor + 0.01 && p.vy <= 0;
  const k = Math.min(1, (grounded ? 16 : 3) * dt);
  p.vx += (wx * speed - p.vx) * k;
  p.vz += (wz * speed - p.vz) * k;
  if (inp.jump && grounded && !rooted && !p.crouch) p.vy = JUMP_V;
  p.vy -= GRAVITY * dt;

  let ny = p.y + p.vy * dt;
  const nf = floorAt(p.x, p.z, p.y);
  if (ny <= nf) { ny = nf; p.vy = 0; }
  p.y = ny;

  p.x += p.vx * dt;
  p.z += p.vz * dt;
  if (p.dashT > 0) {
    p.x += p.dvx * dt;
    p.z += p.dvz * dt;
    p.dashT -= dt;
    if (p.dashT <= 0) { p.dashT = 0; p.dvx = 0; p.dvz = 0; }
  }
  resolveWalls(p);
}

// ---------------------------------------------------------------- rays
export function lookDir(yaw, pitch) {
  const cp = Math.cos(pitch);
  return [-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp];
}

const _t = { min: 0, max: 0 };
function slab(o, d, mn, mx) {
  if (Math.abs(d) < 1e-9) return o >= mn && o <= mx;
  let t1 = (mn - o) / d, t2 = (mx - o) / d;
  if (t1 > t2) { const x = t1; t1 = t2; t2 = x; }
  if (t1 > _t.min) _t.min = t1;
  if (t2 < _t.max) _t.max = t2;
  return _t.min <= _t.max;
}

/** Distance to the nearest wall along the ray, or Infinity. */
export function rayWalls(ox, oy, oz, dx, dy, dz, maxT) {
  let best = Infinity;
  for (const w of WALLS) {
    _t.min = 0; _t.max = maxT;
    if (!slab(ox, dx, w.minX, w.maxX)) continue;
    if (!slab(oy, dy, 0, w.h)) continue;
    if (!slab(oz, dz, w.minZ, w.maxZ)) continue;
    if (_t.min < best) best = _t.min;
  }
  return best;
}

/** Like rayWalls but the floor also stops the ray (used for tracers). */
export function rayWorld(ox, oy, oz, dx, dy, dz, maxT) {
  let best = rayWalls(ox, oy, oz, dx, dy, dz, maxT);
  if (dy < 0) {
    const tf = -oy / dy;
    if (tf > 0 && tf < best && tf <= maxT) best = tf;
  }
  return best;
}

/** Ray vs. a standing player (vertical cylinder). Returns {t, head} or null. */
export function rayPlayer(ox, oy, oz, dx, dy, dz, p, radius = HIT_R) {
  const a = dx * dx + dz * dz;
  if (a < 1e-9) return null;
  const fx = ox - p.x, fz = oz - p.z;
  const b = 2 * (fx * dx + fz * dz);
  const c = fx * fx + fz * fz - radius * radius;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  if (t < 0) return null;
  const y = oy + dy * t;
  const top = p.crouch ? CROUCH_H : PLAYER_H;
  if (y < p.y || y > p.y + top) return null;
  return { t, head: y - p.y > (p.crouch ? CROUCH_HEAD_Y : HEAD_Y) };
}


// ---------------------------------------------------------------- character look (cosmetic only)
export const LOOK_PARTS = {
  helm: ['Visor helm', 'Hood', 'Horned', 'Crest', 'Faceplate', 'Bare head', 'Crown', 'Skull mask'],
  shoulder: ['None', 'Pauldrons', 'Spikes', 'Mantle', 'Orbs', 'Crystals'],
  back: ['None', 'Jetpack', 'Cape', 'Cables', 'Fins', 'Halo', 'Wings'],
  mat: ['Alloy', 'Brushed steel', 'Carbon weave', 'Hex plating', 'Camo', 'Molten', 'Gilded', 'Void'],
  gun: ['Classic AK', 'Redline', 'Jungle Camo', 'Wasteland', 'Frostbite', 'Neon Grid', 'Inferno', 'Toxic', 'Gilded', 'Void Prism'], // rifle skin, seen by everyone
  fx: ['Burst', 'Embers', 'Frost shatter', 'Lightning', 'Confetti', 'Ghost rise', 'Gold coins', 'Void collapse'], // what everyone sees when YOU get a kill
};
export const LOOK_PALETTES = {
  c1: ['#2b2f3a', '#8c939f', '#e8e6df', '#b3282d', '#d9822b', '#d6b24a', '#3f8f5a', '#2d6fd6', '#6a3fc2', '#c95a9a', '#1b1b1f', '#55616b'],
  c2: ['#14161c', '#3a3f4a', '#6b4a2a', '#7a1f24', '#1f3a5a', '#2a4a35', '#4a2a6a', '#b8bcc4', '#d6b24a', '#8c4a2a', '#222a2a', '#5a5f6b'],
  glow: ['#35e0ff', '#7dff6a', '#ff8a1f', '#ff3b5c', '#c27bff', '#ffe14a', '#ffffff', '#4a8bff'],
};
const HEX = /^#[0-9a-f]{6}$/i;
export const DEFAULT_LOOK = { model: 'striker', helm: 0, shoulder: 1, back: 1, mat: 0, fx: 0, gun: 0, c1: '#8c939f', c2: '#3a3f4a', glow: '#35e0ff' };
const intIn = (v, n, d) => (Number.isInteger(v) && v >= 0 && v < n ? v : d);
/** Any input -> a complete, valid look. */
export function sanitizeLook(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const D = DEFAULT_LOOK;
  return {
    model: typeof r.model === 'string' && Object.hasOwn(MODELS, r.model) ? r.model : D.model,
    helm: intIn(r.helm, LOOK_PARTS.helm.length, D.helm),
    shoulder: intIn(r.shoulder, LOOK_PARTS.shoulder.length, D.shoulder),
    back: intIn(r.back, LOOK_PARTS.back.length, D.back),
    mat: intIn(r.mat, LOOK_PARTS.mat.length, D.mat),
    fx: intIn(r.fx, LOOK_PARTS.fx.length, D.fx),
    gun: intIn(r.gun, LOOK_PARTS.gun.length, D.gun),
    c1: typeof r.c1 === 'string' && HEX.test(r.c1) ? r.c1.toLowerCase() : D.c1,
    c2: typeof r.c2 === 'string' && HEX.test(r.c2) ? r.c2.toLowerCase() : D.c2,
    glow: typeof r.glow === 'string' && HEX.test(r.glow) ? r.glow.toLowerCase() : D.glow,
  };
}
/** Compact string sent in every snapshot: "helm,shoulder,back,mat,c1,c2,glow,fx,gun" (hex without #). */
export const encodeLook = (l) => `${l.helm},${l.shoulder},${l.back},${l.mat},${l.c1.slice(1)},${l.c2.slice(1)},${l.glow.slice(1)},${l.fx},${l.gun}`;
export function decodeLook(model, str) {
  const p = String(str || '').split(',');
  return sanitizeLook({
    model, helm: Number(p[0]), shoulder: Number(p[1]), back: Number(p[2]), mat: Number(p[3]),
    c1: `#${p[4] || ''}`, c2: `#${p[5] || ''}`, glow: `#${p[6] || ''}`, fx: Number(p[7]), gun: Number(p[8]),
  });
}
export function randomLook(rnd = Math.random) {
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  return sanitizeLook({
    model: pick(Object.keys(MODELS)),
    helm: Math.floor(rnd() * LOOK_PARTS.helm.length), shoulder: Math.floor(rnd() * LOOK_PARTS.shoulder.length),
    back: Math.floor(rnd() * LOOK_PARTS.back.length), mat: Math.floor(rnd() * LOOK_PARTS.mat.length), fx: Math.floor(rnd() * LOOK_PARTS.fx.length), gun: Math.floor(rnd() * LOOK_PARTS.gun.length),
    c1: pick(LOOK_PALETTES.c1), c2: pick(LOOK_PALETTES.c2), glow: pick(LOOK_PALETTES.glow),
  });
}

// ---------------------------------------------------------------- progression (XP, levels, unlockable looks)
export const XP_PER_KILL = 5, XP_MATCH = 40, XP_WIN = 60, MAX_LEVEL = 30;
/** Level needed for each option of a look part (index = option). Level 1 options are free for everybody, guests included. */
export const LOOK_UNLOCK = {
  helm: [1, 1, 4, 8, 12, 1, 18, 22],
  shoulder: [1, 1, 5, 9, 15, 24],
  back: [1, 1, 3, 7, 11, 16, 27],
  mat: [1, 1, 4, 7, 10, 14, 20, 26],
  fx: [1, 3, 6, 9, 12, 16, 20, 25],
  gun: [1, 2, 4, 6, 8, 11, 14, 17, 20, 24],
};
/** Level for an XP total: 60 xp -> 2, 240 -> 3, 540 -> 4 ... */
export const levelFor = (xp) => Math.min(MAX_LEVEL, 1 + Math.floor(Math.sqrt(Math.max(0, xp || 0) / 60)));
export const xpForLevel = (lv) => (lv <= 1 ? 0 : (lv - 1) * (lv - 1) * 60);
/** Swap any option the player has not unlocked yet for the default one. */
export function clampLook(look, level) {
  const l = sanitizeLook(look);
  for (const k of Object.keys(LOOK_UNLOCK)) if (LOOK_UNLOCK[k][l[k]] > level) l[k] = DEFAULT_LOOK[k];
  return l;
}
/** Names of the options that unlock exactly when reaching `level`. */
export function unlocksAt(level) {
  const out = [];
  for (const k of Object.keys(LOOK_UNLOCK)) LOOK_UNLOCK[k].forEach((req, i) => { if (req === level) out.push(LOOK_PARTS[k][i]); });
  return out;
}

// ---------------------------------------------------------------- daily challenges
// Three challenges per day (same for everybody), reset at midnight US Central (about 05:00 UTC).
export const DAILY_POOL = [
  { id: 'kills', stat: 'kills', text: 'Get {n} kills', goals: [8, 14, 22] },
  { id: 'heads', stat: 'heads', text: 'Land {n} headshots', goals: [3, 6, 10] },
  { id: 'wins', stat: 'wins', text: 'Win {n} match{s} with other players', goals: [1, 2, 3] },
  { id: 'played', stat: 'played', text: 'Finish {n} matches with other players', goals: [2, 3, 5] },
  { id: 'casts', stat: 'casts', text: 'Use skills {n} times', goals: [12, 24, 40] },
  { id: 'damage', stat: 'damage', text: 'Deal {n} damage to players', goals: [1200, 2400, 4000] },
];
export const DAILY_XP = [40, 70, 110]; // reward by difficulty tier
export const DAILY_STATS = DAILY_POOL.map((d) => d.stat);
/** Calendar day key that rolls over at midnight US Central (UTC-5). */
export const dayKey = (now = Date.now()) => new Date(now - 5 * 3600 * 1000).toISOString().slice(0, 10);
export const msUntilDailyReset = (now = Date.now()) => 24 * 3600 * 1000 - ((now - 5 * 3600 * 1000) % (24 * 3600 * 1000));
/** The day's three challenges: one easy, one medium, one hard, each a different type. */
export function dailyFor(key) {
  let h = 2166136261;
  for (const ch of String(key)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  const rnd = () => { h = (Math.imul(h ^ (h >>> 15), 2246822507) + 0x9e3779b9) >>> 0; return (h >>> 8) / 16777216; };
  const pool = [...DAILY_POOL];
  const out = [];
  for (let tier = 0; tier < 3; tier++) {
    const d = pool.splice(Math.floor(rnd() * pool.length), 1)[0];
    const goal = d.goals[tier];
    out.push({ id: d.id, stat: d.stat, goal, tier, xp: DAILY_XP[tier], text: d.text.replace('{n}', goal).replace('{s}', goal === 1 ? '' : 'es') });
  }
  return out;
}

// ====================================================================== profile: titles, icons, name colours
// Shared by the server (validates what a player may wear) and the client (editor, display).
// req = what unlocks it: { lv } account level, { kills } lifetime kills, { mwins } match wins, { rating } ranked rating.
export const PROF_TITLES = [
  { id: 'rookie', name: 'Rookie', color: '#b8b8b8', req: { lv: 1 } },
  { id: 'marksman', name: 'Marksman', color: '#8fd18f', req: { lv: 5 } },
  { id: 'duelist', name: 'Duelist', color: '#6fc3ff', req: { lv: 10 } },
  { id: 'gladiator', name: 'Gladiator', color: '#ffb04a', req: { lv: 15 } },
  { id: 'champion', name: 'Champion', color: '#c58bff', req: { lv: 20 } },
  { id: 'legend', name: 'Legend', color: '#ffd54a', req: { lv: MAX_LEVEL } },
  { id: 'slayer', name: 'Slayer', color: '#ff7a62', req: { kills: 100 } },
  { id: 'reaper', name: 'Reaper', color: '#ff4d4d', req: { kills: 1000 } },
  { id: 'victor', name: 'Victor', color: '#8fd18f', req: { mwins: 10 } },
  { id: 'warlord', name: 'Warlord', color: '#ff9a3c', req: { mwins: 50 } },
  { id: 'gold', name: 'Gold Contender', color: '#f5c542', req: { rating: 1200 } },
  { id: 'platinum', name: 'Platinum Contender', color: '#6fe0d0', req: { rating: 1400 } },
  { id: 'diamond', name: 'Diamond Contender', color: '#7fb8ff', req: { rating: 1600 } },
  { id: 'olympian', name: 'Olympian', color: '#ffe9a0', req: { rating: 1800 } },
];
export const PROF_ICONS = [
  { id: 'target', ch: '\u{1F3AF}', name: 'Target', req: { lv: 1 } },
  { id: 'sword', ch: '⚔️', name: 'Swords', req: { lv: 3 } },
  { id: 'shield', ch: '\u{1F6E1}️', name: 'Shield', req: { lv: 5 } },
  { id: 'flame', ch: '\u{1F525}', name: 'Flame', req: { lv: 7 } },
  { id: 'snow', ch: '❄️', name: 'Frost', req: { lv: 9 } },
  { id: 'bolt', ch: '⚡', name: 'Bolt', req: { lv: 11 } },
  { id: 'eagle', ch: '\u{1F985}', name: 'Eagle', req: { lv: 13 } },
  { id: 'wolf', ch: '\u{1F43A}', name: 'Wolf', req: { lv: 15 } },
  { id: 'skull', ch: '\u{1F480}', name: 'Skull', req: { lv: 17 } },
  { id: 'dragon', ch: '\u{1F409}', name: 'Dragon', req: { lv: 20 } },
  { id: 'temple', ch: '\u{1F3DB}️', name: 'Temple', req: { lv: 25 } },
  { id: 'crown', ch: '\u{1F451}', name: 'Crown', req: { rating: 1800 } },
];
export const PROF_COLORS = [
  { id: 'white', hex: '#ffffff', name: 'White', req: { lv: 1 } },
  { id: 'green', hex: '#7be07b', name: 'Green', req: { lv: 3 } },
  { id: 'cyan', hex: '#5fd8f0', name: 'Cyan', req: { lv: 6 } },
  { id: 'yellow', hex: '#ffe14d', name: 'Yellow', req: { lv: 9 } },
  { id: 'orange', hex: '#ff9a3c', name: 'Orange', req: { lv: 12 } },
  { id: 'pink', hex: '#ff7ad0', name: 'Pink', req: { lv: 15 } },
  { id: 'purple', hex: '#b58bff', name: 'Purple', req: { lv: 18 } },
  { id: 'red', hex: '#ff5a4a', name: 'Red', req: { lv: 21 } },
  { id: 'gold', hex: '#e2b84a', name: 'Gold', req: { lv: 25 } },
];
export const OWNER_TITLE = { name: 'OWNER', color: '#ffd54a' };

/** Does an account (stats = { xp, kills, mwins, rating }) meet a requirement? */
export function profMeets(req, s) {
  s = s || {};
  if (req.lv) return levelFor(s.xp || 0) >= req.lv;
  if (req.kills) return (s.kills || 0) >= req.kills;
  if (req.mwins) return (s.mwins || 0) >= req.mwins;
  if (req.rating) return (s.rating || 0) >= req.rating;
  return true;
}
export function profReqText(req) {
  if (req.lv) return `Level ${req.lv}`;
  if (req.kills) return `${req.kills} kills`;
  if (req.mwins) return `${req.mwins} match wins`;
  if (req.rating) return `Rating ${req.rating}`;
  return '';
}
const cleanText = (t, n) => String(t == null ? '' : t).replace(/[\u0000-\u001f\u007f<>&"'`\\]/g, '').replace(/\s+/g, ' ').trim().slice(0, n);
const isHex = (c) => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c);
export const cleanProfText = cleanText;
export const cleanProfIcon = (t) => Array.from(cleanText(t, 16)).slice(0, 3).join('');

/** Reduce whatever the client sent to the fields we store. */
export function cleanProfPick(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const id = (v) => (typeof v === 'string' && /^[a-z0-9:_-]{1,24}$/i.test(v) ? v : '');
  return { title: id(r.title), icon: id(r.icon), color: id(r.color), ct: cleanText(r.ct, 20), cc: isHex(r.cc) ? r.cc : '', ci: cleanProfIcon(r.ci), cn: isHex(r.cn) ? r.cn : '' };
}

/**
 * What a player is actually allowed to display: { i: icon text, t: title text, tc: title colour, nc: name colour }.
 * pick = stored choice; s = stats; grants = [{ id, text, icon, color }] the owner awarded; owner = free-form custom allowed.
 * Anything not unlocked silently falls back to nothing, so the server can run this on every join.
 */
export function resolveProf(pick, s, grants = [], owner = false) {
  const p = cleanProfPick(pick);
  const out = { i: '', t: '', tc: '', nc: '' };
  if (p.title === 'owner' && owner) { out.t = OWNER_TITLE.name; out.tc = OWNER_TITLE.color; }
  else if (p.title === 'custom' && owner && p.ct) { out.t = p.ct; out.tc = p.cc || OWNER_TITLE.color; }
  else if (p.title.startsWith('g:')) { const g = grants.find((x) => `g:${x.id}` === p.title); if (g) { out.t = cleanText(g.text, 20); out.tc = isHex(g.color) ? g.color : '#ffffff'; } }
  else { const t = PROF_TITLES.find((x) => x.id === p.title); if (t && profMeets(t.req, s)) { out.t = t.name; out.tc = t.color; } }
  if (p.icon === 'custom' && owner && p.ci) out.i = p.ci;
  else if (p.icon.startsWith('g:')) { const g = grants.find((x) => `g:${x.id}` === p.icon); if (g && g.icon) out.i = cleanProfIcon(g.icon); }
  else { const ic = PROF_ICONS.find((x) => x.id === p.icon); if (ic && profMeets(ic.req, s)) out.i = ic.ch; }
  if (p.color === 'custom' && owner && p.cn) out.nc = p.cn;
  else { const c = PROF_COLORS.find((x) => x.id === p.color); if (c && profMeets(c.req, s)) out.nc = c.hex; }
  return out;
}
