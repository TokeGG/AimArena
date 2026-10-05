// Lag compensation: a shot aimed at where the target WAS (what a laggy shooter saw) must hit
// when the client reports that view tick, and must miss when it does not.
import assert from 'node:assert/strict';
import { Room } from '../game.js';
import { EYE_H } from '../sim.js';

const SPEED_PER_TICK = 0.1; // target strafes 6 m/s
const BEHIND = 12; // ticks of lag (200 ms)

function run(sendVt) {
  const room = new Room(2);
  const shooter = room.players.find((p) => p.team === 0);
  const enemy = room.players.find((p) => p.team === 1);
  for (const p of room.players) {
    p.isBot = false; // humans only move when we feed inputs, so we can place them by hand
    if (p !== shooter && p !== enemy) p.alive = false;
  }
  room.phase = 'live';
  room.phaseT = 0;
  room.roundT = 999;

  shooter.x = -15; shooter.z = 28; shooter.y = 0;
  const ex = (n) => -15 + SPEED_PER_TICK * n;

  // let the target strafe for a while so history fills up
  for (let i = 0; i < 40; i++) {
    enemy.x = ex(room.tick + 1); enemy.z = 22; enemy.y = 0;
    room.step();
  }
  const T = room.tick;
  // shooter aims at the target's position BEHIND ticks ago
  const tx = ex(T - BEHIND), ty = 1.0, tz = 22;
  const dx = tx - shooter.x, dy = ty - (shooter.y + EYE_H), dz = tz - shooter.z;
  const yaw = Math.atan2(-dx, -dz), pitch = Math.atan2(dy, Math.hypot(dx, dz));

  room.queueInput(shooter, { seq: 1, mx: 0, mz: 0, yaw, pitch, jump: false, shoot: true, q: false, e: false, vt: sendVt ? T - BEHIND : 0 });
  enemy.x = ex(room.tick + 1);
  room.step();
  return room.events.some((e) => e.k === 'hit' && e.a === shooter.id && e.v === enemy.id);
}

assert.equal(run(true), true, 'rewound shot at the old position should hit');
assert.equal(run(false), false, 'same shot without rewind should miss a moving target');

// rewind is clamped: a bogus far-past view tick cannot reach more than MAX_REWIND ticks back
{
  const room = new Room(2);
  const p = room.players[0];
  for (let i = 0; i < 100; i++) { p.x = i; room.tick++; p.hist.push({ n: room.tick, x: p.x, y: 0, z: 0 }); if (p.hist.length > 40) p.hist.shift(); }
  const pos = room.rewound(p, 1);
  assert.ok(pos.x >= p.x - 24 - 1, `rewind not clamped (x=${pos.x}, now=${p.x})`);
}
console.log('lag compensation: ok');
