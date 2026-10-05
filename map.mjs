// Map checks: spawns never see each other, and every part of the map is reachable on foot.
import assert from 'node:assert/strict';
import { WALLS, ARENA, EYE_H, rayWalls, spawnPoint } from '../sim.js';
import { navField, navReachable } from '../game.js';

for (const n of [2, 3]) {
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const a = spawnPoint(0, i, n), b = spawnPoint(1, j, n);
      for (const hy of [0.3, 1.0, EYE_H, 1.9]) {
        const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz);
        const t = rayWalls(a.x, hy, a.z, dx / d, 0, dz / d, d);
        assert.ok(t < d - 0.1, `spawn ${i} (team 0) sees spawn ${j} (team 1) at height ${hy} in ${n}v${n}`);
      }
      // reachable on foot, both ways
      assert.ok(navReachable(a.x, a.z, b.x, b.z), 'team 0 cannot walk to team 1 spawn');
      assert.ok(navReachable(b.x, b.z, a.x, a.z), 'team 1 cannot walk to team 0 spawn');
    }
  }
}

// point symmetry: every wall has a mirror image
const near = (a, b) => Math.abs(a - b) < 1e-6;
for (const w of WALLS) {
  const m = WALLS.find((o) => near(o.minX, -w.maxX) && near(o.maxX, -w.minX) && near(o.minZ, -w.maxZ) && near(o.maxZ, -w.minZ) && near(o.h, w.h));
  assert.ok(m, `wall at ${w.minX},${w.minZ} has no mirror`);
}

// walls stay inside the arena and no spawn point is inside a wall
for (const w of WALLS) assert.ok(w.minX >= -ARENA && w.maxX <= ARENA && w.minZ >= -ARENA && w.maxZ <= ARENA, 'wall outside arena');
for (const n of [2, 3]) for (let t = 0; t < 2; t++) for (let i = 0; i < n; i++) {
  const s = spawnPoint(t, i, n);
  for (const w of WALLS) assert.ok(!(s.x > w.minX - 0.5 && s.x < w.maxX + 0.5 && s.z > w.minZ - 0.5 && s.z < w.maxZ + 0.5), 'spawn inside a wall');
}

// no sealed pockets: almost every open cell should be reachable from a spawn
const s0 = spawnPoint(0, 0, 3);
const field = navField(Math.floor(s0.z + ARENA) * (ARENA * 2) + Math.floor(s0.x + ARENA));
let reachable = 0, openCells = 0;
const N = ARENA * 2;
for (let iz = 1; iz < N - 1; iz++) for (let ix = 1; ix < N - 1; ix++) {
  const cx = -ARENA + ix + 0.5, cz = -ARENA + iz + 0.5;
  const blocked = WALLS.some((w) => cx > w.minX - 0.6 && cx < w.maxX + 0.6 && cz > w.minZ - 0.6 && cz < w.maxZ + 0.6);
  if (blocked) continue;
  openCells++;
  if (field[iz * N + ix] >= 0) reachable++;
}
assert.ok(reachable / openCells > 0.98, `only ${(100 * reachable / openCells).toFixed(1)}% of open floor is reachable`);
console.log(`map: ok (${WALLS.length} walls, ${(100 * reachable / openCells).toFixed(1)}% of open floor reachable)`);
