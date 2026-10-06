// Custom practice match settings, scoreboard/recap stats, private rooms.
import assert from 'node:assert/strict';
import { Room, cleanCustom, WIN_ROUNDS } from '../game.js';
import { Lobby } from '../lobby.js';
import { EYE_H } from '../sim.js';

// settings are clamped
const c = cleanCustom({ rounds: 99, time: 1, kills: 'x', skills: false, hs: true, inf: 1 });
assert.equal(c.rounds, 7); assert.equal(c.time, 30); assert.equal(c.kills, 20); assert.equal(c.skills, false); assert.equal(c.hs, true); assert.equal(c.inf, false);
assert.equal(cleanCustom(null).rounds, WIN_ROUNDS);

function setup(custom) {
  const room = new Room(2, 'olympus', { private: true, custom });
  const me = room.players.find((p) => p.team === 0), foe = room.players.find((p) => p.team === 1);
  for (const p of room.players) { p.isBot = false; if (p !== me && p !== foe) p.alive = false; }
  room.phase = 'live'; room.phaseT = 0; room.roundT = 999;
  me.x = -15; me.z = 28; me.y = 0; foe.x = -15; foe.z = 22; foe.y = 0;
  return { room, me, foe };
}
let seq = 0;
const aim = (me, foe, ty) => { const dx = foe.x - me.x, dz = foe.z - me.z; return { yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(ty - (me.y + EYE_H), Math.hypot(dx, dz)) }; };
const fire = (room, me, a, extra = {}) => { me.fireCd = 0; room.queueInput(me, { seq: ++seq, mx: 0, mz: 0, jump: false, shoot: true, q: false, e: false, r: false, ...a, ...extra }); room.step(); };

// rounds to win
{ const { room } = setup({ rounds: 1 }); room.endRound(0); assert.equal(room.phase, 'matchEnd', '1 round to win ends the match'); }
{ const { room } = setup({ rounds: 5 }); room.endRound(0); assert.equal(room.phase, 'roundEnd'); }

// skills off: the key does nothing
{ const { room, me, foe } = setup({ skills: false }); me.loadout = ['heal', 'dash', 'shield']; me.hp = 50;
  const a = aim(me, foe, 1.2); room.queueInput(me, { seq: ++seq, mx: 0, mz: 0, jump: false, shoot: false, q: true, e: false, r: false, ...a }); room.step();
  assert.equal(me.cd[0], 0); assert.ok(me.hp <= 50, 'heal did not fire'); }

// infinite ammo
{ const { room, me, foe } = setup({ inf: true }); me.ammo = 0; fire(room, me, aim(me, foe, 1.2)); assert.equal(room.meFor(me).am, 99); assert.ok(me.ms.shots === 1, 'shot fired with 0 ammo'); }

// headshots only: body does nothing, head hurts; recap numbers count it
{ const { room, me, foe } = setup({ hs: true });
  fire(room, me, aim(me, foe, 1.0));
  assert.equal(foe.hp, foe.maxHp, 'body shot did no damage'); assert.equal(me.ms.hits, 1);
  fire(room, me, aim(me, foe, 1.62));
  assert.ok(foe.hp < foe.maxHp, 'head shot hurts'); assert.ok(me.ms.heads >= 1); assert.ok(me.ms.dmg > 0); }

// normal rules: body shot hurts, kill streak is tracked
{ const { room, me, foe } = setup(null);
  fire(room, me, aim(me, foe, 1.0)); assert.ok(foe.hp < foe.maxHp);
  room.kill(foe, me, false); assert.equal(me.ms.best, 1); assert.equal(foe.ms.streak, 0);
  const snap = room.snapshot(); assert.ok(!snap.rc, 'recap only at match end');
  room.phase = 'matchEnd'; const s2 = room.snapshot(); assert.ok(Array.isArray(s2.rc) && s2.rc.find((r) => r.id === me.id).sh === 1); }

// private rooms are never matched into by Quick Play
{ const lobby = new Lobby((mode, map, ranked, bots) => new Room(mode, map, { ranked, bots }));
  const priv = new Room(2, 'olympus', { private: true }); lobby.rooms.push(priv);
  const t = { mode: 2, map: 'olympus', ranked: false, team: -1, rating: 1000, place(room) { this.room = room; return !!room.addHuman({}, 'x', ['dash', 'heal', 'shield'], 'striker', { team: -1 }); } };
  lobby.enter(t); assert.notEqual(t.room, priv); }
console.log('custom: ok');
