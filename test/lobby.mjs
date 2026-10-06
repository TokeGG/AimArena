import assert from 'node:assert/strict';
import { Room } from '../game.js';
import { Lobby, RANKED_WAIT } from '../lobby.js';

let clock = 0;
const mk = (extra) => ({ mode: 2, map: 'olympus', ranked: false, team: -1, rating: 1000, place(room) { const p = room.addHuman({}, 'x', ['dash', 'heal', 'shield'], 'striker', { team: this.team, rating: this.rating }); if (p) this.player = p; return !!p; }, ...extra });
const lobby = new Lobby((mode, map, ranked) => new Room(mode, map, { ranked }), () => clock);

// quick play: first player makes a room, second joins it on the other team
const a = mk(), b = mk();
assert.ok(lobby.enter(a)); assert.ok(lobby.enter(b));
assert.equal(lobby.rooms.length, 1);
assert.notEqual(a.player.team, b.player.team, 'balanced teams');

// team preference is honoured; a full team forces a new room
const c = mk({ team: 0 }), d = mk({ team: 0 }), e = mk({ team: 0 });
lobby.enter(c); lobby.enter(d);
assert.equal(c.player.team, 0); assert.equal(d.player.team, 0);
lobby.enter(e);
assert.equal(e.player.team, 0);
assert.ok(lobby.rooms.length >= 2, 'third team-0 request needs another room');

// different map / mode / ranked never mix
const f = mk({ map: 'foundry' });
lobby.enter(f);
assert.equal(lobby.rooms.find((r) => r.humans().some((p) => p === f.player)).mapId, 'foundry');

// ranked: waits, then pairs two searchers; a lone searcher gets a bot room after RANKED_WAIT
clock = 1000;
const r1 = mk({ ranked: true, rating: 1000 });
assert.equal(lobby.enter(r1), false, 'ranked player should be queued');
clock += 3000; lobby.tick();
assert.ok(lobby.tickets.includes(r1), 'still searching');
const r2 = mk({ ranked: true, rating: 1100 });
assert.equal(lobby.enter(r2), true, 'second searcher pairs with the first immediately');
assert.ok(r1.player && r2.player && !lobby.tickets.length);
assert.notEqual(r1.player.team, r2.player.team);
assert.equal(r1.player.team === r2.player.team, false);

const lone = mk({ ranked: true, rating: 1000, map: 'colosseum' });
lobby.enter(lone);
clock += (RANKED_WAIT - 1) * 1000; lobby.tick();
assert.ok(!lone.player, 'not yet');
clock += 2000; lobby.tick();
assert.ok(lone.player, 'after the wait a room with bots is created');

// rating band: a far-away rating does not join; after waiting the band widens
const hi = mk({ ranked: true, rating: 1900, map: 'olympus' });
clock += 1000;
lobby.enter(hi);
assert.ok(!hi.player, 'rating 1900 must not be placed into a ~1000 room instantly');
clock += RANKED_WAIT * 1000; lobby.tick();
assert.ok(hi.player, 'eventually placed (new room)');

// cancel removes the ticket
const cc = mk({ ranked: true, map: 'frostpeak' });
lobby.enter(cc); lobby.cancel(cc);
assert.ok(!lobby.tickets.includes(cc));
console.log('lobby: ok');
