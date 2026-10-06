// Anti-cheat: speed-hack throttle, rewind clamp, suspicious-behaviour flags, name filter, ban list. Run: node test/anticheat.mjs
import assert from 'node:assert/strict';
import { Room } from '../game.js';
import { DT, EYE_H } from '../sim.js';
import { nameAllowed, isBlockedName, guestName, ipHash, createModeration } from '../safety.js';

function human(opts = {}) {
  const room = new Room(2, 'olympus', opts);
  const p = room.players.find((x) => x.team === 0);
  p.isBot = false;
  for (const o of room.players) if (o !== p) o.alive = false;
  room.phase = 'live'; room.phaseT = 0; room.roundT = 999;
  p.x = -15; p.z = 28; p.y = 0; p.loadout = ['dash', 'heal', 'shield'];
  return { room, p };
}

// ---- speed hack: sending 3 inputs per tick must not move faster than real time
{
  const run = (perTick) => {
    const { room, p } = human();
    const x0 = p.x, z0 = p.z; let seq = 0;
    for (let t = 0; t < 60; t++) {
      for (let k = 0; k < perTick; k++) room.queueInput(p, { seq: ++seq, mx: 1, mz: 0, yaw: 0, pitch: 0 });
      room.step();
    }
    return Math.hypot(p.x - x0, p.z - z0);
  };
  const honest = run(1), cheat = run(3);
  assert.ok(honest > 2, `honest baseline moved (${honest.toFixed(2)} m)`);
  assert.ok(cheat <= honest * 1.2, `3x input flood must not be faster than real time (${cheat.toFixed(2)} vs ${honest.toFixed(2)} m)`);
}

// ---- a short lag spike (queued burst) is still processed in full
{
  const { room, p } = human();
  let seq = 0;
  for (let k = 0; k < 10; k++) room.queueInput(p, { seq: ++seq, mx: 0, mz: 0, yaw: 0, pitch: 0 }); // 10 inputs arrive together
  room.step(); room.step();
  assert.equal(p.lastSeq, 10, 'burst of 10 delayed inputs is caught up quickly');
}

// ---- rewind limit follows the measured round trip
{
  const { room, p } = human();
  room.tick = 1000;
  p.rttMs = 20;
  assert.equal(room.clampVt(p, 1000 - 24), 1000 - 12, '20 ms ping cannot claim a 400 ms rewind');
  p.rttMs = 300;
  assert.equal(room.clampVt(p, 1000 - 24), 1000 - 24, 'a high-ping player keeps the full window');
  assert.equal(room.clampVt(p, 995), 995, 'recent view ticks are untouched');
  assert.equal(room.clampVt(p, 0), 0);
}

// ---- flags
{
  const flags = [];
  const { room, p } = human({ onFlag: (r, pl, kind, detail, sev) => flags.push([kind, sev]) });
  for (let i = 1; i <= 400; i++) room.queueInput(p, { seq: i, mx: 0, mz: 0, yaw: 0, pitch: 0 });
  assert.ok(flags.some((f) => f[0] === 'flood' && f[1] === 'flag'), 'input flood is flagged');
  const f2 = [];
  const b = human({ onFlag: (r, pl, kind, d, sev) => f2.push([kind, sev]) });
  let seq = 0;
  for (let t = 0; t < 700; t++) {
    b.p.fireCd = 0.9; // pretend the weapon was just fired
    b.room.queueInput(b.p, { seq: ++seq, mx: 0, mz: 0, yaw: 0, pitch: 0, shoot: true });
    b.room.step();
    if (t % 30 === 0) b.p.kicked = false;
  }
  assert.ok(f2.some((f) => f[0] === 'rapid'), 'firing during the cooldown is flagged');
}
{ // aim statistics only flag implausibly perfect streaks
  const flags = [];
  const { room, p } = human({ onFlag: (r, pl, kind) => flags.push(kind) });
  for (let i = 0; i < 20; i++) room.aimStat(p, { head: true });
  assert.deepEqual(flags, ['aim']);
  flags.length = 0;
  for (let i = 0; i < 20; i++) room.aimStat(p, i % 2 ? { head: false } : null);
  assert.deepEqual(flags, [], 'normal accuracy is never flagged');
}

// ---- names
for (const ok of ['Alice', 'Glass_Joe', 'Scunthorpe', 'Dickens', 'xX_Pro_Xx', 'Player1']) assert.equal(nameAllowed(ok), true, ok);
for (const bad of ['f u c k', 'sh1t', 'fuuuuck', 'n1gg3r', 'xX_dick_Xx', 'admin', 'Zeus', 'Moderator']) assert.equal(nameAllowed(bad), false, bad);
assert.match(guestName('f_u_c_k'), /^Player\d{3}$/);
assert.equal(guestName('  Bob!! '), 'Bob');
assert.equal(ipHash('1.2.3.4'), ipHash('1.2.3.4')); assert.notEqual(ipHash('1.2.3.4'), ipHash('1.2.3.5')); assert.equal(ipHash('1.2.3.4').length, 12);
assert.ok(isBlockedName('FUCK') && !isBlockedName('Fuji'));

// ---- bans (timed, permanent, unban)
{
  const mem = new Map();
  const store = { get: async (k) => mem.get(k) ?? null, set: async (k, v) => { mem.set(k, v); }, del: async (k) => { mem.delete(k); } };
  const mod = createModeration(store);
  await mod.ready;
  assert.equal(mod.ban('user', 'BadGuy', 0, 'cheating'), true);
  assert.ok(mod.isBanned('user', 'badguy'));
  assert.equal(mod.ban('ip', 'abc123', 1, 'x'), true);
  assert.ok(mod.isBanned('ip', 'ABC123'));
  assert.equal(mod.ban('weird', 'x', 1), false);
  mod.add({ kind: 'flag', who: 'BadGuy', detail: 'test' });
  assert.equal(mod.list()[0].who, 'BadGuy');
  assert.equal(mod.unban('user', 'badguy'), true);
  assert.equal(mod.isBanned('user', 'badguy'), null);
  assert.equal(mod.bans().length, 1);
}

console.log('anticheat: ok');
