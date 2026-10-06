// Leaderboard API (seeded accounts) + the room hooks that feed account stats.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { Room } from '../game.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// ---- rivalry hook: only real, signed-in players on opposite teams
{
  const seen = [];
  const room = new Room(2, 'olympus', { onRivalKill: (r, k, v) => seen.push([k.uid, v.uid]) });
  const a = room.players.find((p) => p.team === 0), b = room.players.find((p) => p.team === 1), mate = room.players.find((p) => p.team === 0 && p !== a);
  a.isBot = false; a.uid = 'amy'; b.isBot = false; b.uid = 'ben'; mate.isBot = false; mate.uid = 'cat';
  room.kill(b, a, false);
  assert.deepEqual(seen, [['amy', 'ben']]);
  b.alive = true; room.kill(mate, a, false); // teammate
  b.alive = true; room.kill(a, a, false);    // suicide
  assert.equal(seen.length, 1);
  b.uid = null; room.kill(b, a, false);      // guest: no account to track
  assert.equal(seen.length, 1);
  b.uid = 'ben'; b.isBot = true; room.kill(b, a, false); // bot
  assert.equal(seen.length, 1);
}

// ---- room hooks
{
  const calls = [];
  const room = new Room(2, 'olympus', { onStats: (r, w) => calls.push(w) });
  const a = room.players.find((p) => p.team === 0), b = room.players.find((p) => p.team === 1), mate = room.players.find((p) => p.team === 0 && p !== a);
  room.kill(b, a, false); // b is a bot: worth nothing
  assert.equal(a.sKills, 0, 'bot kills give no stats');
  b.isBot = false; b.alive = true; b.sDeaths = 0;
  room.kill(b, a, false);
  room.kill(mate, a, false); // same team: no stat
  room.kill(a, a, false);   // suicide: death only
  assert.equal(a.sKills, 1); assert.equal(b.sDeaths, 1); assert.equal(mate.sDeaths, 1); assert.equal(a.sDeaths, 1);
  room.scores = [2, 0];
  room.endRound(0);
  assert.deepEqual(calls, [0], 'onStats must fire once at match end with the winner');
  const range = new Room(2, 'olympus', { onStats: () => calls.push('x'), noStats: true });
  range.scores = [2, 0]; range.endRound(0);
  assert.deepEqual(calls, [0], 'noStats rooms never report');
  const ffa = new Room('ffa', 'necropolis', { onStats: (r, w) => calls.push(`ffa${w}`) });
  ffa.players[3].kills = 30; ffa.endFfa();
  assert.deepEqual(calls, [0, `ffa${ffa.players[3].team}`]);
}

// ---- HTTP leaderboard from a seeded data file
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aim-lbapi-'));
const rec = (username, kills, mwins, rating = 1000, matches = 3) => ({ v: JSON.stringify({ username, salt: '00', hash: '00', rating, wins: 0, losses: 0, matches, created: 1, kills, deaths: 1, mwins, mplayed: 5, xp: kills * 5 }), exp: 0 });
fs.writeFileSync(path.join(dir, 'accounts.json'), JSON.stringify({
  'u:ann': rec('Ann', 50, 2), 'u:bob': rec('Bob', 10, 9, 1100), 'u:cy': rec('Cy', 0, 0), 'idx:users': { v: JSON.stringify(['ann', 'bob', 'cy']), exp: 0 },
}));
const port = 4100 + Math.floor(Math.random() * 90);
const srv = spawn('node', ['server.js'], { cwd: root, env: { ...process.env, PORT: String(port), DATA_DIR: dir }, stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((res, rej) => { srv.stdout.on('data', (d) => { if (String(d).includes('running')) res(); }); setTimeout(() => rej(new Error('start timeout')), 5000); });
try {
  const get = async (by) => (await (await fetch(`http://localhost:${port}/api/leaderboard${by ? `?by=${by}` : ''}`)).json());
  const k = await get('kills');
  assert.deepEqual(k.rows.map((r) => [r.username, r.value]), [['Ann', 50], ['Bob', 10]]);
  const w = await get('wins');
  assert.deepEqual(w.rows.map((r) => [r.username, r.value]), [['Bob', 9], ['Ann', 2]]);
  const r = await get('rating');
  assert.equal(r.rows[0].username, 'Bob');
  assert.equal((await get()).by, 'wins', 'default sort is wins');
  assert.equal((await get('hax')).by, 'wins');
  assert.ok(!JSON.stringify(k).includes('hash'));
  console.log('leaderboard: ok');
} finally { srv.kill(); }
