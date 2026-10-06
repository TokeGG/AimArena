// Spectating: the live-games list shows rooms with real players, spectators receive snapshots (no `me`) and cannot affect the game.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = 4000 + Math.floor(Math.random() * 90);
const srv = spawn('node', ['server.js'], { cwd: root, env: { ...process.env, PORT: String(port), DATA_DIR: path.join(os.tmpdir(), 'aim-spec-' + port), SPEC_DELAY: '0' }, stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((res, rej) => { srv.stdout.on('data', (d) => { if (String(d).includes('running')) res(); }); setTimeout(() => rej(new Error('start timeout')), 5000); });
const open = async () => { const w = new WebSocket(`ws://localhost:${port}`); w.got = []; w.onmessage = (e) => w.got.push(JSON.parse(e.data)); await new Promise((r, j) => { w.onopen = r; w.onerror = j; }); return w; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  let g = await (await fetch(`http://localhost:${port}/api/games`)).json();
  assert.deepEqual(g.games, [], 'no games before anyone plays');

  const p = await open();
  p.send(JSON.stringify({ t: 'join', name: 'Alice', mode: 2, map: 'foundry', loadout: ['bind', 'dash', 'heal'] }));
  await wait(300);
  g = (await (await fetch(`http://localhost:${port}/api/games`)).json()).games;
  assert.equal(g.length, 1);
  assert.equal(g[0].map, 'foundry'); assert.deepEqual(g[0].humans, ['Alice']); assert.equal(g[0].size, 4);

  const s = await open();
  s.send(JSON.stringify({ t: 'spectate', room: 99999 }));
  await wait(200);
  assert.ok(s.got.find((m) => m.t === 'error'), 'unknown room must error');
  s.got.length = 0;
  s.send(JSON.stringify({ t: 'spectate', room: g[0].id }));
  await wait(500);
  const w = s.got.find((m) => m.t === 'welcome');
  assert.ok(w && w.spec && w.map === 'foundry' && w.mode === 2, 'spectator welcome');
  const snaps = s.got.filter((m) => m.t === 's');
  assert.ok(snaps.length >= 5, 'spectator gets snapshots');
  assert.equal(snaps.at(-1).me, undefined);
  assert.equal(snaps.at(-1).p.length, 4);
  assert.equal(snaps.at(-1).p.filter((x) => !x.b).length, 1, 'spectator is not a player');
  // inputs / joins from a spectator are ignored
  s.send(JSON.stringify({ t: 'in', seq: 1, mx: 1, mz: 1, yaw: 0, pitch: 0 }));
  s.send(JSON.stringify({ t: 'join', name: 'Sneaky', mode: 2 }));
  await wait(300);
  const after = (await (await fetch(`http://localhost:${port}/api/games`)).json()).games[0];
  assert.deepEqual(after.humans, ['Alice']); assert.equal(after.watching, 1);
  s.close(); await wait(200);
  assert.equal((await (await fetch(`http://localhost:${port}/api/games`)).json()).games[0].watching, 0);
  p.close();
  console.log('spectate: ok');
} finally { srv.kill(); }
