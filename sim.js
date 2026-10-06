// Shared deterministic simulation. Used by the server (authoritative) and the
// browser client (prediction), so both must stay free of DOM / Node APIs.

export const VERSION = '0.8.0'; // bump on every release; the page warns when main.js and the server differ
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
export const MAX_HP = 100;

export const FIRE_INTERVAL = 1.0; // one shot per second
export const AMMO_START = 15;     // rounds at the start of every round / life
export const AMMO_KILL = 5;       // bonus rounds for a kill
export const AMMO_MAX = 30;       // cap
export const BODY_DMG = 22;
export const HEAD_DMG = 45;
export const RANGE = 100;

export const SPELLS = {
  dash: { name: 'Dash', cd: 5, cost: 1, desc: 'Burst of speed in your move direction.' },
  shield: { name: 'Shield', cd: 14, cost: 2, desc: 'Take 40% less damage for 2.5s.' },
  heal: { name: 'Heal', cd: 18, cost: 2, desc: 'Instantly restore 35 HP.' },
  shockwave: { name: 'Shockwave', cd: 10, cost: 2, desc: 'Aimed shot: pushes the first enemy hit back. No damage.' },
  pushback: { name: 'Pushback', cd: 10, cost: 2, desc: 'Blast that shoves every enemy within 7m away from you. No damage.' },
  bind: { name: 'Bind', cd: 11, cost: 2, desc: 'Your next rifle shot roots the enemy it hits for 1.8s (6s to use it).' },
  firepool: { name: 'Fire Pool', cd: 14, cost: 2, desc: 'Ignite the ground where you aim: 3m wide, burns enemies for 5s.' },
  nova: { name: 'Frost Nova', cd: 12, cost: 2, desc: 'Blast within 5m: 12 damage and 3s slow on enemies.' },
  barbed: { name: 'Barbed Rounds', cd: 14, cost: 1, desc: '6s: rifle hits make the target bleed (worse when moving).' },
  blink: { name: 'Blink', cd: 9, cost: 2, desc: 'Teleport 9m forward where you look (stops at walls).' },
  grapple: { name: 'Grapple', cd: 8, cost: 2, desc: 'Hook the wall you aim at and pull yourself to it (up to 28m).' },
  smoke: { name: 'Smoke', cd: 14, cost: 1, desc: 'Throw a smoke cloud where you aim. Blocks sight for 7s.' },
  decoy: { name: 'Decoy', cd: 16, cost: 1, desc: 'A fake copy of you runs forward for 6s. Enemy shots at it are wasted.' },
};
// Skill points: you pick 3 skills but can only spend this many points on them.
export const LOADOUT_BUDGET = 5;
export const loadoutCost = (ids) => ids.reduce((a, id) => a + (SPELLS[id] ? SPELLS[id].cost : 9), 0);

export const SLOT_KEYS = ['Q', 'E', 'R'];
export const SLOT_COUNT = 3;
export const DEFAULT_LOADOUT = ['dash', 'heal', 'shield'];

// Every character plays exactly the same (100 HP, same speed). The "model" is only the body style you wear;
// the rest of your look (helmet, shoulders, back piece, material, colours) lives in `look` below.
export const MODELS = {
  striker: { name: 'Striker', hp: 100, speed: 7, healMult: 1, blurb: 'Plated combat armour' },
  vanguard: { name: 'Vanguard', hp: 100, speed: 7, healMult: 1, blurb: 'Heavy bulwark frame' },
  phantom: { name: 'Phantom', hp: 100, speed: 7, healMult: 1, blurb: 'Sleek stealth suit' },
  warden: { name: 'Warden', hp: 100, speed: 7, healMult: 1, blurb: 'Long-coat sentinel' },
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
  helm: ['Visor helm', 'Hood', 'Horned', 'Crest', 'Faceplate', 'Bare head'],
  shoulder: ['None', 'Pauldrons', 'Spikes', 'Mantle'],
  back: ['None', 'Jetpack', 'Cape', 'Cables', 'Fins'],
  mat: ['Alloy', 'Brushed steel', 'Carbon weave', 'Hex plating', 'Camo', 'Molten'],
};
export const LOOK_PALETTES = {
  c1: ['#2b2f3a', '#8c939f', '#e8e6df', '#b3282d', '#d9822b', '#d6b24a', '#3f8f5a', '#2d6fd6', '#6a3fc2', '#c95a9a', '#1b1b1f', '#55616b'],
  c2: ['#14161c', '#3a3f4a', '#6b4a2a', '#7a1f24', '#1f3a5a', '#2a4a35', '#4a2a6a', '#b8bcc4', '#d6b24a', '#8c4a2a', '#222a2a', '#5a5f6b'],
  glow: ['#35e0ff', '#7dff6a', '#ff8a1f', '#ff3b5c', '#c27bff', '#ffe14a', '#ffffff', '#4a8bff'],
};
const HEX = /^#[0-9a-f]{6}$/i;
export const DEFAULT_LOOK = { model: 'striker', helm: 0, shoulder: 1, back: 1, mat: 0, c1: '#2b2f3a', c2: '#14161c', glow: '#35e0ff' };
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
    c1: typeof r.c1 === 'string' && HEX.test(r.c1) ? r.c1.toLowerCase() : D.c1,
    c2: typeof r.c2 === 'string' && HEX.test(r.c2) ? r.c2.toLowerCase() : D.c2,
    glow: typeof r.glow === 'string' && HEX.test(r.glow) ? r.glow.toLowerCase() : D.glow,
  };
}
/** Compact string sent in every snapshot: "helm,shoulder,back,mat,c1,c2,glow" (hex without #). */
export const encodeLook = (l) => `${l.helm},${l.shoulder},${l.back},${l.mat},${l.c1.slice(1)},${l.c2.slice(1)},${l.glow.slice(1)}`;
export function decodeLook(model, str) {
  const p = String(str || '').split(',');
  return sanitizeLook({
    model, helm: Number(p[0]), shoulder: Number(p[1]), back: Number(p[2]), mat: Number(p[3]),
    c1: `#${p[4] || ''}`, c2: `#${p[5] || ''}`, glow: `#${p[6] || ''}`,
  });
}
export function randomLook(rnd = Math.random) {
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  return sanitizeLook({
    model: pick(Object.keys(MODELS)),
    helm: Math.floor(rnd() * LOOK_PARTS.helm.length), shoulder: Math.floor(rnd() * LOOK_PARTS.shoulder.length),
    back: Math.floor(rnd() * LOOK_PARTS.back.length), mat: Math.floor(rnd() * LOOK_PARTS.mat.length),
    c1: pick(LOOK_PALETTES.c1), c2: pick(LOOK_PALETTES.c2), glow: pick(LOOK_PALETTES.glow),
  });
}
