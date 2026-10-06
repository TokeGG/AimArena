// Map checks for every entry in maps.js (own ray/BFS helpers; reads map data directly, no sim.js).
import assert from 'node:assert/strict';
import { MAPS, MAP_IDS, DEFAULT_MAP, TEAM_MAP_IDS, FFA_MAP_IDS } from '../maps.js';

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

// Start points used for flood fill: team spawns (team 1 = -x,-z) or the FFA spawns.
const startPoints = (map) => (map.ffa ? map.ffaSpawns : map.spawns.flatMap((s) => [{ x: s.x, z: s.z }, { x: -s.x, z: -s.z }]));

function reachability(map) {
  const A = map.size, N = A * 2;
  const blocked = new Uint8Array(N * N);
  for (let iz = 0; iz < N; iz++) for (let ix = 0; ix < N; ix++) {
    const cx = -A + ix + 0.5, cz = -A + iz + 0.5;
    const inWall = map.walls.some((w) => cx > w.minX - CLEAR && cx < w.maxX + CLEAR && cz > w.minZ - CLEAR && cz < w.maxZ + CLEAR);
    const inHaz = map.hazards.some((h) => Math.hypot(cx - h.x, cz - h.z) < h.r);
    blocked[iz * N + ix] = inWall || inHaz ? 1 : 0;
  }
  const seen = new Uint8Array(N * N), queue = [];
  for (const s of startPoints(map)) {
    const c = Math.floor(s.z + A) * N + Math.floor(s.x + A);
    assert.ok(!blocked[c], `spawn cell blocked in ${map.id} at ${s.x},${s.z}`);
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

// Longest unobstructed eye-height line anywhere in the arena (origins on a 1 m grid, every 3 degrees).
function longestLine(map) {
  const A = map.size, walls = map.walls;
  let best = 0;
  for (let ox = -A + 0.5; ox <= A - 0.5; ox += 1) for (let oz = -A + 0.5; oz <= A - 0.5; oz += 1) {
    if (walls.some((w) => ox > w.minX && ox < w.maxX && oz > w.minZ && oz < w.maxZ && w.h > EYE)) continue;
    for (let a = 0; a < 360; a += 3) {
      const dx = Math.cos(a * Math.PI / 180), dz = Math.sin(a * Math.PI / 180);
      let tEnd = Infinity;
      if (dx > 1e-9) tEnd = Math.min(tEnd, (A - ox) / dx); else if (dx < -1e-9) tEnd = Math.min(tEnd, (-A - ox) / dx);
      if (dz > 1e-9) tEnd = Math.min(tEnd, (A - oz) / dz); else if (dz < -1e-9) tEnd = Math.min(tEnd, (-A - oz) / dz);
      const L = Math.min(tEnd, rayHit(walls, ox, oz, dx, dz, EYE));
      if (L > best) { best = L; longestLine.at = [ox, oz, a]; }
    }
  }
  return best;
}

assert.deepEqual(MAP_IDS, ['olympus', 'foundry', 'frostpeak', 'labyrinth', 'necropolis', 'range']);
assert.equal(DEFAULT_MAP, 'olympus');
assert.deepEqual(TEAM_MAP_IDS, ['olympus', 'foundry', 'frostpeak', 'labyrinth']);
assert.deepEqual(FFA_MAP_IDS, ['necropolis']);

for (const id of MAP_IDS) {
  const map = MAPS[id];
  const ARENA = map.size;
  assert.ok(Number.isFinite(ARENA) && ARENA >= 15 && ARENA <= 60, `${id} size`);
  assert.equal(typeof map.ffa, 'boolean', `${id} ffa`);
  assert.ok(map.walls.length <= 130, `${id} too many walls (${map.walls.length})`);
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
      if (w.kind === 'low') continue; // stepping stones and bridges may sit in lava
      const cx = Math.min(Math.max(h.x, w.minX), w.maxX), cz = Math.min(Math.max(h.z, w.minZ), w.maxZ);
      assert.ok(Math.hypot(h.x - cx, h.z - cz) > h.r + 0.3, `${id} hazard touches a wall`);
    }
  }
  // spawns
  if (map.ffa) {
    assert.ok(Array.isArray(map.ffaSpawns) && map.ffaSpawns.length >= (map.range ? 6 : 12), `${id} needs enough ffaSpawns`);
    assert.ok(!map.spawns, `${id} ffa map must not define team spawns`);
    for (const s of map.ffaSpawns) assert.ok(Number.isFinite(s.x) && Number.isFinite(s.z), `${id} ffa spawn`);
    for (let i = 0; i < map.ffaSpawns.length; i++) for (let j = i + 1; j < map.ffaSpawns.length; j++) {
      const a = map.ffaSpawns[i], b = map.ffaSpawns[j];
      assert.ok(Math.hypot(a.x - b.x, a.z - b.z) >= (map.range ? 6 : 12), `${id} ffa spawns ${i},${j} too close`);
    }
  } else {
    assert.equal(map.spawns.length, 3, `${id} needs 3 spawns`);
    assert.ok(!map.ffaSpawns, `${id} team map must not define ffaSpawns`);
    for (const s of map.spawns) for (const k of ['x', 'z', 'yaw']) assert.ok(Number.isFinite(s[k]), `${id} spawn ${k}`);
    for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) {
      assert.ok(Math.hypot(map.spawns[i].x - map.spawns[j].x, map.spawns[i].z - map.spawns[j].z) >= 2.5, `${id} spawn slots ${i},${j} too close`);
    }
  }
  const pts = startPoints(map);
  for (const s of pts) {
    assert.ok(Math.abs(s.x) < ARENA - 0.5 && Math.abs(s.z) < ARENA - 0.5, `${id} spawn outside arena`);
    for (const w of map.walls) assert.ok(!(s.x > w.minX - 0.5 && s.x < w.maxX + 0.5 && s.z > w.minZ - 0.5 && s.z < w.maxZ + 0.5), `${id} spawn ${s.x},${s.z} inside a wall`);
    for (const h of map.hazards) assert.ok(Math.hypot(s.x - h.x, s.z - h.z) > h.r + 0.5, `${id} spawn in hazard`);
  }
  if (!map.ffa) {
    // team 0 must not see team 1 at round start (low, eye and head height)
    for (const s of map.spawns) for (const o of map.spawns) {
      const a = s, b = { x: -o.x, z: -o.z };
      const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz);
      for (const y of [0.3, EYE, 1.9]) {
        const t = rayHit(map.walls, a.x, a.z, dx / d, dz / d, y, d);
        assert.ok(t < d - 0.1, `${id}: spawn (${a.x},${a.z}) sees (${b.x},${b.z}) at height ${y}`);
      }
    }
    // team spawns face roughly towards the centre of the map
    for (const s of map.spawns) {
      const lx = -Math.sin(s.yaw), lz = -Math.cos(s.yaw), len = Math.hypot(s.x, s.z) || 1;
      assert.ok(lx * (-s.x / len) + lz * (-s.z / len) > 0.5, `${id} spawn (${s.x},${s.z}) yaw does not face the centre`);
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
  const L = longestLine(map);
  if (id === 'labyrinth') assert.ok(L <= 14, `labyrinth has a ${L.toFixed(1)} m sight line (origin x,z,angle ${longestLine.at})`);
  extra = ` longest line ${L.toFixed(1)}m`;
  console.log(`${id}: size ${ARENA}, ${map.ffa ? 'ffa' : 'team'}, ${map.walls.length} walls, ${map.hazards.length} hazards, ${r.pct.toFixed(1)}% reachable${extra}`);
}
console.log('maps: ok');
