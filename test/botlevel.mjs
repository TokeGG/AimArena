import assert from 'node:assert/strict';
import { Room, BOT_LEVELS } from '../game.js';
import { Lobby } from '../lobby.js';

// every level produces bots inside its own skill range, ranked is always normal
for (const [lvl, [lo, hi]] of Object.entries(BOT_LEVELS)) {
  const r = new Room(2, 'olympus', { bots: lvl });
  assert.equal(r.botLevel, lvl);
  assert.ok(r.players.every((p) => p.skill >= lo && p.skill <= hi), `${lvl} bots in range`);
}
assert.equal(new Room(2, 'olympus', { bots: 'insane', ranked: true }).botLevel, 'normal');
assert.equal(new Room(2, 'olympus', { bots: 'nonsense' }).botLevel, 'normal');
const avg = (l) => { const r = new Room(3, 'olympus', { bots: l }); return r.players.reduce((a, p) => a + p.skill, 0) / r.players.length; };
assert.ok(avg('easy') < avg('normal') && avg('normal') < avg('hard') && avg('hard') < avg('insane'));

// players who picked different levels never share a room; same level do
const lobby = new Lobby((mode, map, ranked, bots) => new Room(mode, map, { ranked, bots }));
const mk = (bots) => ({ mode: 2, map: 'olympus', ranked: false, team: -1, rating: 1000, bots, place(room) { const p = room.addHuman({}, 'x', ['dash', 'heal', 'shield'], 'striker', { team: -1 }); if (p) this.room = room; return !!p; } });
const a = mk('easy'), b = mk('insane'), c = mk('easy');
lobby.enter(a); lobby.enter(b); lobby.enter(c);
assert.notEqual(a.room, b.room); assert.equal(a.room, c.room);
console.log('botlevel: ok');
