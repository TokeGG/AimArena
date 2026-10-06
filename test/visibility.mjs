// Anti wall-hack: enemies you cannot see are sent without their real position. Run: node test/visibility.mjs
import assert from 'node:assert/strict';
import { Room } from '../game.js';
import { rayWalls, useMap } from '../sim.js';

const room = new Room(2, 'olympus');
useMap('olympus');
const A = room.players.find((p) => p.team === 0);
const B = room.players.find((p) => p.team === 1);
const mate = room.players.find((p) => p.team === 0 && p !== A);
for (const p of room.players) { p.isBot = false; p.alive = true; }
room.phase = 'live'; room.phaseT = 0; room.roundT = 999;
const view = (viewer) => room.viewSnapshot(room.snapshot(), viewer);
const entry = (snap, p) => snap.p.find((x) => x.id === p.id);

// pick a hiding spot: far from A, with a solid wall in the way and no teammate watching
A.x = -15; A.z = 28; A.y = 0; mate.x = -15; mate.z = 29; mate.y = 0;
let hide = null;
for (let x = -28; x <= 28 && !hide; x += 2) {
  for (let z = -28; z <= 28 && !hide; z += 2) {
    B.x = x; B.z = z; B.y = 0;
    if (Math.hypot(x - A.x, z - A.z) < 12) continue;
    room.time += 5; // clear any grace period
    const e = entry(view(A), B);
    if (e.hid) hide = { x, z };
  }
}
assert.ok(hide, 'olympus has places an enemy can stand without being seen');

room.time += 5;
B.x = hide.x; B.z = hide.z;
{
  const s = view(A);
  const e = entry(s, B);
  assert.equal(e.hid, 1, 'hidden enemy is flagged');
  assert.notDeepEqual([e.x, e.z], [B.x, B.z], 'a hidden enemy never reveals its true position');
  assert.equal(e.n, B.name); assert.equal(e.k, B.kills); // roster info is still there
  assert.equal(entry(s, A).hid, undefined); assert.equal(entry(s, mate).hid, undefined, 'teammates are always visible');
}
// an open lane is visible
B.x = -15; B.z = 20;
room.time += 5;
assert.equal(entry(view(A), B).hid, undefined, 'enemy in the open is sent normally');
// near the viewer always counts, even round a corner
// last seen position is remembered (stale), then the grace period lets a just-hidden enemy linger briefly
room.time += 5;
B.x = -15; B.z = 20; view(A); // seen here
B.x = hide.x; B.z = hide.z;
room.time += 0.2;
assert.equal(entry(view(A), B).hid, undefined, 'grace period right after losing sight');
room.time += 1;
{
  const e = entry(view(A), B);
  assert.equal(e.hid, 1);
  assert.deepEqual([e.x, e.z], [-15, 20], 'hidden entries carry the position they were last seen at, not the real one');
}
// marked enemies are revealed to the marker's team only
B.markT = 4; B.markTeam = A.team;
room.time += 5;
assert.equal(entry(view(A), B).hid, undefined, 'Mark reveals through walls');
assert.equal(entry(view(mate), B).hid, undefined);
B.markT = 0;
room.time += 5;
// whoever just hit you stays visible (kill-cam)
A.lastAtkId = B.id; A.lastAtkT = room.time;
assert.equal(entry(view(A), B).hid, undefined, 'attacker visible after hitting you');
room.time += 10;
A.lastAtkId = null;
// a teammate's line of sight counts for the whole team
mate.x = B.x; mate.z = B.z - 6; // teammate standing next to the enemy
room.time += 5;
assert.equal(entry(view(A), B).hid, undefined, 'a teammate seeing the enemy shares the sight');
mate.x = -15; mate.z = 29;
// outside live play everything is shown (countdown / between rounds)
room.phase = 'countdown'; room.time += 5;
assert.equal(entry(view(A), B).hid, undefined);
room.phase = 'live';
// range rooms are not culled
{
  const r = new Room('ffa', 'range', { range: true });
  const snap = r.snapshot();
  assert.equal(r.viewSnapshot(snap, r.players[0]), snap);
}
// enemy mines are hidden until you are next to them, your own always show
{
  const t = { id: 1, x: -15, z: 0, r: 1.5, t: 10, m: 10, k: 2, tm: B.team };
  const snap = { ...room.snapshot(), zn: [t] };
  A.x = -15; A.z = 28; mate.x = -15; mate.z = 29;
  assert.equal(room.viewSnapshot(snap, A).zn.length, 0, 'far enemy trap hidden');
  A.z = 3;
  assert.equal(room.viewSnapshot(snap, A).zn.length, 1, 'enemy trap shows when you are close');
  assert.equal(room.viewSnapshot({ ...snap, zn: [{ ...t, tm: A.team }] }, A).zn.length, 1, 'own trap always shows');
}
// FFA: only your own eyes count
{
  const f = new Room('ffa', 'necropolis');
  for (const p of f.players) { p.isBot = false; p.alive = true; }
  f.phase = 'live'; f.phaseT = 0;
  const v = f.players[0];
  f.players[1].x = v.x + 1; f.players[1].z = v.z + 1;
  const s = f.viewSnapshot(f.snapshot(), v);
  assert.equal(s.p.find((x) => x.id === f.players[1].id).hid, undefined, 'close enemy visible in FFA');
  assert.ok(s.p.some((x) => x.hid), 'far enemies in FFA are culled');
}
console.log('visibility: ok');
