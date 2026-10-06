// Map checks for every entry in maps.js (own ray/BFS helpers: sim.js has a single global map).
import assert from 'node:assert/strict';
import { MAPS, MAP_IDS, DEFAULT_MAP } from '../maps.js';
import { spawnPoint, ARENA, WALLS } from '../sim.js';

const EYE = 1.6, GAP_MIN = 2.2, CLEAR = 0.6, EPS = 1e-6;
const KINDS = ['temple', 'shield', 'cover', 'low'];
const THEME_KEYS = ['haze', 'sky', 'stars', 'marble', 'marbleDark', 'sand', 'sandDark', 'gold', 'floor', 'floorTint',
  'floorLine', 'hemi', 'moon', 'moonDisc', 'moonHalo', 'torch', 'ground', 'mountain', 'cloud', 'accent'];
const near = (a, b) => Math.abs(a - b) < EPS;

// Distance along a ray to the first wall taller than height y (2D slab test), or Infinity.
function rayHit(walls, ox, oz, dx, dz, y, maxT = Infinity) {
  let best = Infinity;
  for (const w of walls) {
    if (w.h <= y) continue;
    let t0 = 0, t1 = maxT, ok = true;
    for (const [o, d, lo, hi] of [[ox, dx, w.minX, w.maxX], [oz, dz, w.minZ, w.maxZ]]) {
      if (Math.abs(d) < 1e-12) { if (o < lo || o > hi) { ok = false; break; } continue; }
      let a = (lo - o) / d, b = (hi - o) / d;
      if (a > b) [a, b] = [b, a];
      t0 = Math.max(t0, a); t1 = Math.min(t1, b);
      if (t0 > t1) { ok = false; break; }
    }
    if (ok && t0 < best) best = t0;
  }
  return best;
}

function reachability(map) {
  const N = ARENA * 2;
  const blocked = new Uint8Array(N * N);
  for (let iz = 0; iz < N; iz++) for (let ix = 0; ix < N; ix++) {
    const cx = -ARENA + ix + 0.5, cz = -ARENA + iz + 0.5;
    const inWall = map.walls.some((w) => cx > w.minX - CLEAR && cx < w.maxX + CLEAR && cz > w.minZ - CLEAR && cz < w.maxZ + CLEAR);
    const inHaz = map.hazards.some((h) => Math.hypot(cx - h.x, cz - h.z) < h.r);
    blocked[iz * N + ix] = inWall || inHaz ? 1 : 0;
  }
  const seen = new Uint8Array(N * N), queue = [];
  for (const n of [2, 3]) for (let t = 0; t < 2; t++) for (let i = 0; i < n; i++) {
    const s = spawnPoint(t, i, n);
    const c = Math.floor(s.z + ARENA) * N + Math.floor(s.x + ARENA);
    assert.ok(!blocked[c], `spawn cell blocked in ${map.id}`);
    if (!seen[c]) { seen[c] = 1; queue.push(c); }
  }
  for (let q = 0; q < queue.length; q++) {
    const c = queue[q], ix = c % N, iz = (c - ix) / N;
    for (const [ax, az] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const jx = ix + ax, jz = iz + az;
      if (jx < 0 || jz < 0 || jx >= N || jz >= N) continue;
      const j = jz * N + jx;
      if (!blocked[j] && !seen[j]) { seen[j] = 1; queue.push(j); }
    }
  }
  let free = 0;
  for (let i = 0; i < N * N; i++) if (!blocked[i]) free++;
  return { pct: 100 * queue.length / free, free, reached: queue.length };
}

// Longest unobstructed eye-height line that stays inside the band |z| < 12 (origins on a 1 m grid, every 3 degrees).
function longestBandLine(walls) {
  let best = 0;
  for (let ox = -29.5; ox <= 29.5; ox += 1) for (let oz = -11.5; oz <= 11.5; oz += 1) {
    if (walls.some((w) => ox > w.minX && ox < w.maxX && oz > w.minZ && oz < w.maxZ && w.h > EYE)) continue;
    for (let a = 0; a < 360; a += 3) {
      const dx = Math.cos(a * Math.PI / 180), dz = Math.sin(a * Math.PI / 180);
      let tEnd = Infinity;
      if (dx > 1e-9) tEnd = Math.min(tEnd, (ARENA - ox) / dx); else if (dx < -1e-9) tEnd = Math.min(tEnd, (-ARENA - ox) / dx);
      if (dz > 1e-9) tEnd = Math.min(tEnd, (12 - oz) / dz); else if (dz < -1e-9) tEnd = Math.min(tEnd, (-12 - oz) / dz);
      { const L = Math.min(tEnd, rayHit(walls, ox, oz, dx, dz, EYE)); if (L > best) { best = L; longestBandLine.at = [ox, oz, a]; } }
    }
  }
  return best;
}

assert.deepEqual(MAP_IDS, ['olympus', 'foundry', 'frostpeak', 'labyrinth']);
assert.equal(DEFAULT_MAP, 'olympus');

for (const id of MAP_IDS) {
  const map = MAPS[id];
  // keys / types
  assert.equal(map.id, id);
  assert.ok(typeof map.name === 'string' && map.name.length > 0, `${id} name`);
  assert.ok(typeof map.tagline === 'string' && map.tagline.length > 0 && map.tagline.length <= 60, `${id} tagline`);
  assert.ok(Array.isArray(map.walls) && Array.isArray(map.hazards), `${id} walls/hazards`);
  for (const w of map.walls) {
    for (const k of ['minX', 'maxX', 'minZ', 'maxZ', 'h']) assert.ok(Number.isFinite(w[k]), `${id} wall ${k}`);
    assert.ok(w.minX < w.maxX && w.minZ < w.maxZ, `${id} degenerate wall`);
    assert.ok(KINDS.includes(w.kind), `${id} bad kind ${w.kind}`);
    assert.ok(w.h === 3 || w.h === 1 || w.kind === 'temple' || w.kind === 'shield', `${id} bad height ${w.h}`);
    if (w.kind === 'low') assert.equal(w.h, 1);
    if (w.kind === 'cover') assert.equal(w.h, 3);
    // bounds
    assert.ok(w.minX >= -ARENA - EPS && w.maxX <= ARENA + EPS && w.minZ >= -ARENA - EPS && w.maxZ <= ARENA + EPS, `${id} wall outside arena`);
  }
  // point symmetry (walls and hazards)
  for (const w of map.walls) {
    assert.ok(map.walls.some((o) => near(o.minX, -w.maxX) && near(o.maxX, -w.minX) && near(o.minZ, -w.maxZ) && near(o.maxZ, -w.minZ) && near(o.h, w.h) && o.kind === w.kind),
      `${id}: wall at ${w.minX},${w.minZ} has no mirror`);
  }
  for (const h of map.hazards) {
    assert.ok(map.hazards.some((o) => near(o.x, -h.x) && near(o.z, -h.z) && near(o.r, h.r)), `${id}: hazard at ${h.x},${h.z} has no mirror`);
    assert.ok(Math.abs(h.x) + h.r <= ARENA && Math.abs(h.z) + h.r <= ARENA, `${id} hazard outside arena`);
    for (const w of map.walls) {
      const cx = Math.min(Math.max(h.x, w.minX), w.maxX), cz = Math.min(Math.max(h.z, w.minZ), w.maxZ);
      assert.ok(Math.hypot(h.x - cx, h.z - cz) > h.r + 0.3, `${id} hazard touches a wall`);
    }
  }
  // shield walls identical to olympus' spawn pocket
  const shield = map.walls.filter((w) => w.kind === 'shield');
  assert.equal(shield.length, 6, `${id} shield count`);
  for (const s of MAPS.olympus.walls.filter((w) => w.kind === 'shield')) {
    assert.ok(shield.some((w) => near(w.minX, s.minX) && near(w.maxX, s.maxX) && near(w.minZ, s.minZ) && near(w.maxZ, s.maxZ) && near(w.h, s.h)), `${id} spawn pocket differs`);
  }
  // no non-shield wall inside the spawn pockets (|z| > 23.5 and |x| < 10.6+)
  for (const w of map.walls) if (w.kind !== 'shield') assert.ok(!(Math.abs(w.minZ) > 19 && Math.abs(w.maxZ) > 19 && w.maxX > -11.2 && w.minX < 11.2 && Math.max(Math.abs(w.minZ), Math.abs(w.maxZ)) > 19.5 && Math.min(Math.abs(w.minZ), Math.abs(w.maxZ)) > 19), `${id} wall inside spawn pocket`);

  // spawns: outside walls/hazards (0.5 margin), pairs blocked at eye height
  for (const n of [2, 3]) for (let t = 0; t < 2; t++) for (let i = 0; i < n; i++) {
    const s = spawnPoint(t, i, n);
    for (const w of map.walls) assert.ok(!(s.x > w.minX - 0.5 && s.x < w.maxX + 0.5 && s.z > w.minZ - 0.5 && s.z < w.maxZ + 0.5), `${id} spawn inside a wall`);
    for (const h of map.hazards) assert.ok(Math.hypot(s.x - h.x, s.z - h.z) > h.r + 0.5, `${id} spawn in hazard`);
  }
  for (const n of [2, 3]) for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const a = spawnPoint(0, i, n), b = spawnPoint(1, j, n);
    const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz);
    for (const y of [0.3, EYE, 1.9]) {
      const t = rayHit(map.walls, a.x, a.z, dx / d, dz / d, y, d);
      assert.ok(t < d - 0.1, `${id}: spawn ${i} sees spawn ${j} at height ${y} (${n}v${n})`);
    }
  }
  // Minimum gap: for two walls whose extents overlap along one axis, the free gap between them along
  // the other axis must be 0 (touching) or >= 2.2 m, so a player (and a 0.6 m-clearance bot) can pass.
  // If a third wall fills the gap rectangle, there is no free gap to measure and the pair is skipped.
  const filled = (x0, x1, z0, z1) => map.walls.some((w) => w.minX < x1 - 0.01 && w.maxX > x0 + 0.01 && w.minZ < z1 - 0.01 && w.maxZ > z0 + 0.01);
  for (let i = 0; i < map.walls.length; i++) for (let j = i + 1; j < map.walls.length; j++) {
    const a = map.walls[i], b = map.walls[j];
    const z0 = Math.max(a.minZ, b.minZ), z1 = Math.min(a.maxZ, b.maxZ), x0 = Math.max(a.minX, b.minX), x1 = Math.min(a.maxX, b.maxX);
    const ctx = `(${a.minX},${a.minZ}) (${b.minX},${b.minZ})`;
    if (z1 - z0 > 0.01) {
      const g = x0 - x1; // negative when overlapping
      if (g > 0.01 && g < GAP_MIN - EPS && !filled(x1, x0, z0, z1)) assert.fail(`${id}: x-gap ${g.toFixed(2)} between walls ${i} and ${j} ${ctx}`);
    }
    if (x1 - x0 > 0.01) {
      const g = z0 - z1;
      if (g > 0.01 && g < GAP_MIN - EPS && !filled(x0, x1, z1, z0)) assert.fail(`${id}: z-gap ${g.toFixed(2)} between walls ${i} and ${j} ${ctx}`);
    }
  }
  // theme
  assert.deepEqual(Object.keys(map.theme).sort(), [...THEME_KEYS].sort(), `${id} theme keys`);
  assert.ok(map.theme.sky.length >= 4 && map.theme.sky.every(([p, c]) => p >= 0 && p <= 1 && /^#/.test(c)), `${id} sky`);
  assert.equal(map.theme.hemi.length, 3); assert.equal(map.theme.moon.length, 2);

  // reachability
  const r = reachability(map);
  assert.ok(r.pct >= 95, `${id}: only ${r.pct.toFixed(1)}% of free cells reachable`);
  let extra = '';
  if (id === 'labyrinth') {
    const L = longestBandLine(map.walls);
    assert.ok(L <= 16 /* ~14 m target, slack for diagonals through staggered doorways */, `labyrinth has a ${L.toFixed(1)} m sight line in the middle band (origin x,z,angle ${longestBandLine.at})`);
    extra = ` longest band line ${L.toFixed(1)}m`;
  }
  console.log(`${id}: ${map.walls.length} walls, ${map.hazards.length} hazards, ${r.pct.toFixed(1)}% reachable${extra}`);
}

// olympus must equal the live sim.js layout (set of rounded tuples)
const key = (w) => [w.minX, w.maxX, w.minZ, w.maxZ, w.h].map((v) => v.toFixed(3)).join(',');
const a = new Set(MAPS.olympus.walls.map(key)), b = new Set(WALLS.map(key));
assert.equal(MAPS.olympus.walls.length, WALLS.length, 'olympus wall count');
assert.deepEqual([...a].sort(), [...b].sort(), 'olympus differs from sim.js WALLS');
console.log('maps: ok');
