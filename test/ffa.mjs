// Free-for-all deathmatch: bots only, respawns, kill limit / timer, spawn safety.
import assert from 'node:assert/strict';
import { Room, FFA_PLAYERS, FFA_KILLS, FFA_TIME } from '../game.js';
import { WALLS, ARENA, HAZARDS, useMap, ffaSpawn, ffaSpawnCount } from '../sim.js';

const room = new Room('ffa', 'necropolis');
assert.equal(room.players.length, FFA_PLAYERS);
assert.equal(new Set(room.players.map((p) => p.team)).size, FFA_PLAYERS);
useMap('necropolis');
assert.equal(ARENA, 48, 'ARENA must follow the current map');
assert.ok(ffaSpawnCount() >= 12);

let respawns = 0, kills = 0, matchEnds = 0, prev = room.phase;
let sawDeadThenAlive = false;
const wasDead = new Set();
for (let i = 0; i < 60 * (FFA_TIME + 40) && matchEnds < 1; i++) {
  room.step();
  for (const e of room.events) { if (e.k === 'respawn') respawns++; if (e.k === 'kill') kills++; }
  room.events.length = 0;
  for (const p of room.players) {
    for (const k of ['x', 'y', 'z', 'hp']) assert.ok(Number.isFinite(p[k]), `NaN ${k}`);
    assert.ok(Math.abs(p.x) <= ARENA && Math.abs(p.z) <= ARENA, 'left the arena');
    if (!p.alive) wasDead.add(p.id); else if (wasDead.delete(p.id)) sawDeadThenAlive = true;
    if (p.alive && p.y < 0.05) for (const w of WALLS) {
      assert.ok(!(p.x > w.minX + 0.05 && p.x < w.maxX - 0.05 && p.z > w.minZ + 0.05 && p.z < w.maxZ - 0.05 && w.h > 1.2), 'player inside a wall');
    }
  }
  if (room.phase === 'matchEnd' && prev !== 'matchEnd') matchEnds++;
  prev = room.phase;
}
const top = Math.max(...room.players.map((p) => p.kills));
console.log(`ffa: kills=${kills} respawns=${respawns} top=${top} winnerTeam=${room.winner} time left=${room.roundT.toFixed(0)}s`);
assert.equal(matchEnds, 1, 'ffa match never ended');
assert.ok(kills > 20 && respawns > 10 && sawDeadThenAlive, 'nobody respawned');
assert.ok(top >= FFA_KILLS || room.roundT <= 0, 'match ended too early');
const best = room.players.find((p) => p.team === room.winner);
assert.ok(best && best.kills === top, 'winner is not the top scorer');

// respawn safety: invulnerable briefly and placed on a real spawn point
{
  const r = new Room('ffa', 'necropolis');
  r.phase = 'live'; r.phaseT = 0;
  const v = r.players[0], a = r.players[1];
  r.damage(v, 9999, a, false);
  assert.ok(!v.alive && v.respawnT > 2.5);
  for (let i = 0; i < 60 * 3.2; i++) r.step();
  assert.ok(v.alive, 'did not respawn');
  assert.ok(v.invulnT > 0 || v.hp === v.maxHp);
  const h = v.hp; r.damage(v, 50, a, false);
  if (v.invulnT > 0) assert.equal(v.hp, h, 'spawn protection ignored');
}

// ffa slots: humans take bots, never a team slot
{
  const r = new Room('ffa', 'necropolis');
  assert.deepEqual(r.openSlots(), [FFA_PLAYERS, 0]);
  const p = r.addHuman({}, 'H', ['dash', 'heal', 'shield'], 'striker', { team: 1 });
  assert.ok(p && !p.isBot);
  assert.deepEqual(r.openSlots(), [FFA_PLAYERS - 1, 0]);
}
console.log('ffa: ok');
