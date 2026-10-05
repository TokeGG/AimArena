// Shared deterministic simulation. Used by the server (authoritative) and the
// browser client (prediction), so both must stay free of DOM / Node APIs.

export const TICK_RATE = 60;
export const DT = 1 / TICK_RATE;

export const ARENA = 30; // half-extent of the square arena (metres)
export const PLAYER_R = 0.45;
export const PLAYER_H = 1.8;
export const EYE_H = 1.6;
export const HEAD_Y = 1.45; // hits above this height (relative to feet) are headshots
export const HIT_R = 0.5; // hitscan hit radius (slightly generous)
export const MOVE_SPEED = 7;
export const JUMP_V = 7.5;
export const GRAVITY = 22;
export const MAX_HP = 100;

export const FIRE_INTERVAL = 0.18;
export const BODY_DMG = 22;
export const HEAD_DMG = 45;
export const RANGE = 100;

export const SPELLS = {
  dash: { name: 'Dash', cd: 5, desc: 'Burst of speed in your move direction.' },
  shield: { name: 'Shield', cd: 14, desc: 'Take 60% less damage for 2.5s.' },
  heal: { name: 'Heal', cd: 18, desc: 'Instantly restore 35 HP.' },
  shockwave: { name: 'Shockwave', cd: 12, desc: 'Damage and knock back enemies within 6m.' },
};

// ---------------------------------------------------------------- map
function buildWalls() {
  const walls = [];
  const box = (cx, cz, w, d, h) => ({
    minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2, h,
  });
  walls.push(box(0, 0, 4, 4, 3)); // centre pillar
  // Half the map; every piece is point-mirrored so both teams get an identical layout.
  const half = [
    [10, -8, 6, 1.5, 3],
    [-9, -14, 1.5, 6, 3],
    [0, -19, 8, 1.5, 1.0], // low wall: jump onto it, shoot over it
    [15, -19, 2.5, 2.5, 3],
    [-17, -5, 2.5, 2.5, 3],
    [5, -4, 1.5, 5, 3],
    [-4, -9, 3, 1.5, 1.0],
    [20, -10, 1.5, 8, 3],
  ];
  for (const [x, z, w, d, h] of half) {
    walls.push(box(x, z, w, d, h));
    walls.push(box(-x, -z, w, d, h));
  }
  return walls;
}
export const WALLS = buildWalls();

export function spawnPoint(team, slot, size) {
  const x = (slot - (size - 1) / 2) * 4;
  const z = team === 0 ? -(ARENA - 4) : ARENA - 4;
  return { x, z, yaw: team === 0 ? Math.PI : 0 };
}

// ---------------------------------------------------------------- movement
function floorAt(x, z, y) {
  let f = 0;
  for (const w of WALLS) {
    if (w.h > f && y >= w.h - 0.02 && x >= w.minX && x <= w.maxX && z >= w.minZ && z <= w.maxZ) f = w.h;
  }
  return f;
}

function resolveWalls(p) {
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

  const floor = floorAt(p.x, p.z, p.y);
  const grounded = p.y <= floor + 0.01 && p.vy <= 0;
  const k = Math.min(1, (grounded ? 16 : 3) * dt);
  p.vx += (wx * MOVE_SPEED - p.vx) * k;
  p.vz += (wz * MOVE_SPEED - p.vz) * k;
  if (inp.jump && grounded) p.vy = JUMP_V;
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
export function rayPlayer(ox, oy, oz, dx, dy, dz, p) {
  const a = dx * dx + dz * dz;
  if (a < 1e-9) return null;
  const fx = ox - p.x, fz = oz - p.z;
  const b = 2 * (fx * dx + fz * dz);
  const c = fx * fx + fz * fz - HIT_R * HIT_R;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  if (t < 0) return null;
  const y = oy + dy * t;
  if (y < p.y || y > p.y + PLAYER_H) return null;
  return { t, head: y - p.y > HEAD_Y };
}
