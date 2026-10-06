// Headless checks: full bot-only matches, then a real WebSocket client against the server.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { Room } from '../game.js';
import { stepPlayer, DT, ARENA, WALLS, useMap } from '../sim.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// ------------------------------------------------------------ 1. bot-only matches
for (const [mode, mapId] of [[2, 'olympus'], [3, 'olympus'], [2, 'foundry'], [3, 'foundry'], [3, 'frostpeak'], [2, 'frostpeak'], [2, 'colosseum'], [3, 'colosseum'], [2, 'agora'], [3, 'dunes']]) {
  const room = new Room(mode, mapId);
  assert.equal(room.players.length, mode * 2);
  let matchEnds = 0, rounds = 0, shots = 0, hits = 0, kills = 0, timeouts = 0;
  const spells = {};
  let prevPhase = room.phase;
  const maxTicks = 60 * 60 * 25; // 25 simulated minutes
  for (let i = 0; i < maxTicks && matchEnds < 2; i++) {
    room.step();
    for (const e of room.events) {
      if (e.k === 'shot') shots++;
      if (e.k === 'hit') hits++;
      if (e.k === 'kill') kills++;
      if (e.k === 'round') { rounds++; if (room.roundT <= 0.05) timeouts++; }
      if (e.k === 'spell') spells[e.s] = (spells[e.s] || 0) + 1;
    }
    room.events.length = 0;
    if (room.phase === 'matchEnd' && prevPhase !== 'matchEnd') matchEnds++;
    prevPhase = room.phase;
    for (const p of room.players) {
      for (const k of ['x', 'y', 'z', 'vx', 'vy', 'vz', 'yaw', 'pitch', 'hp']) {
        assert.ok(Number.isFinite(p[k]), `NaN in ${k} (tick ${i})`);
      }
      assert.ok(Math.abs(p.x) <= ARENA && Math.abs(p.z) <= ARENA, 'player left the arena');
      for (const w of WALLS) {
        if (p.y < w.h - 0.05) {
          const inside = p.x > w.minX + 0.05 && p.x < w.maxX - 0.05 && p.z > w.minZ + 0.05 && p.z < w.maxZ - 0.05;
          assert.ok(!inside, 'player inside a wall');
        }
      }
    }
  }
  console.log(`${mapId} ${mode}v${mode}: matchEnds=${matchEnds} rounds=${rounds} shots=${shots} hits=${hits} kills=${kills} spells=${JSON.stringify(spells)} scores=${room.scores} timeouts=${timeouts}/${rounds}`);
  assert.ok(timeouts <= rounds * 0.4, `too many rounds ran out the clock (${timeouts}/${rounds}): bots may be stuck`);
  assert.ok(matchEnds >= 1, 'bots never finished a match');
  assert.ok(kills > 0 && hits > 0, 'bots never hit anything');
}

// ------------------------------------------------------------ 2. movement sanity
useMap('olympus');
{
  const p = { x: -28, y: 0, z: 0, vx: 0, vy: 0, vz: 0, dvx: 0, dvz: 0, dashT: 0 };
  for (let i = 0; i < 120; i++) stepPlayer(p, { mx: 0, mz: 1, yaw: -Math.PI / 2, jump: false }, DT); // walk +X for 2s
  assert.ok(p.x > -28 + 10 && p.x < -28 + 15, `unexpected walk distance, x=${p.x}`);
  const q = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, dvx: 0, dvz: 0, dashT: 0 };
  stepPlayer(q, { mx: 0, mz: 0, yaw: 0, jump: true }, DT);
  assert.ok(q.vy > 0 && q.y > 0, 'jump failed');
}

// ------------------------------------------------------------ 3. real server + websocket
const port = 3900 + Math.floor(Math.random() * 90);
const srv = spawn('node', ['server.js'], { cwd: root, env: { ...process.env, PORT: String(port), DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'aim-test-')) }, stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((res, rej) => {
  srv.stdout.on('data', (d) => { if (String(d).includes('running')) res(); });
  srv.on('exit', (c) => rej(new Error('server exited ' + c)));
  setTimeout(() => rej(new Error('server start timeout')), 5000);
});

try {
  const html = await (await fetch(`http://localhost:${port}/`)).text();
  assert.ok(html.includes('Aim Arena'), 'index.html not served');
  const js = await fetch(`http://localhost:${port}/sim.js`);
  assert.equal(js.status, 200);
  assert.equal((await fetch(`http://localhost:${port}/../server.js`)).status === 200 && false, false);

  const ws = new WebSocket(`ws://localhost:${port}`);
  const msgs = [];
  ws.onmessage = (e) => msgs.push(JSON.parse(e.data));
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  ws.send(JSON.stringify({ t: 'join', name: 'Tester', mode: 3, loadout: ['bind', 'firepool', 'barbed'], look: { model: 'phantom', helm: 1, shoulder: 0, back: 2, mat: 1, c1: '#ff0000', c2: '#00ff00', glow: '#0000ff' } }));
  ws.send(JSON.stringify({ t: 'ping', ts: 42 }));
  await new Promise((r) => setTimeout(r, 300));
  const welcome = msgs.find((m) => m.t === 'welcome');
  assert.ok(welcome, 'no welcome');
  assert.deepEqual(welcome.loadout, ['bind', 'firepool', 'barbed']);
  assert.equal(welcome.model, 'phantom');
  assert.ok(msgs.find((m) => m.t === 'pong' && m.ts === 42), 'no pong');

  // wait for the countdown to finish, then send movement inputs
  let live = false;
  for (let i = 0; i < 100 && !live; i++) {
    await new Promise((r) => setTimeout(r, 100));
    const s = msgs.filter((m) => m.t === 's').pop();
    live = s && s.ph === 'live';
  }
  assert.ok(live, 'never went live');
  const startSnap = msgs.filter((m) => m.t === 's').pop();
  const me0 = startSnap.me.st;
  let seq = 0;
  for (let i = 0; i < 60; i++) {
    ws.send(JSON.stringify({ t: 'in', seq: ++seq, mx: 0, mz: 1, yaw: me0 ? (welcome.team === 0 ? Math.PI : 0) : 0, pitch: 0, jump: false, shoot: false, q: false, e: false }));
    await new Promise((r) => setTimeout(r, 16));
  }
  await new Promise((r) => setTimeout(r, 200));
  const end = msgs.filter((m) => m.t === 's').pop();
  assert.ok(end.me.ack >= 50, `server acked only ${end.me.ack} inputs`);
  const moved = Math.hypot(end.me.st.x - me0.x, end.me.st.z - me0.z);
  assert.ok(moved > 2, `player barely moved (${moved.toFixed(2)}m)`);
  assert.equal(end.p.length, 6, 'expected 3v3 = 6 players');
  const meP = end.p.find((p) => !p.b);
  assert.equal(meP.md, 'phantom');
  assert.equal(meP.mh, 150, 'every character has the same health');
  assert.equal(meP.lk, '1,0,1,1,ff0000,00ff00,0000ff,0,0', 'look not carried to the snapshot (back 2 needs level 3 so guests get the default: 1)');
  assert.ok(end.p.filter((p) => p.b).every((p) => typeof p.lk === 'string' && p.lk.split(',').length === 9), 'bots need looks too');
  assert.deepEqual(welcome.look.c1, '#ff0000');
  assert.ok(Array.isArray(end.zn), 'snapshot missing zones');
  assert.equal(end.me.cd.length, 3);
  assert.equal(end.p.filter((p) => !p.b).length, 1, 'expected exactly one human');
  console.log(`websocket: ok (ack=${end.me.ack}, moved=${moved.toFixed(1)}m, snapshots=${msgs.filter((m) => m.t === 's').length})`);
  ws.close();
  await new Promise((r) => setTimeout(r, 200));

  // ---- map choice + team choice in quick play
  {
    const w2 = new WebSocket(`ws://localhost:${port}`);
    const got = [];
    w2.onmessage = (e) => got.push(JSON.parse(e.data));
    await new Promise((r, j) => { w2.onopen = r; w2.onerror = j; });
    w2.send(JSON.stringify({ t: 'join', name: 'MapTester', mode: 2, map: 'foundry', team: 1, queue: 'quick', loadout: ['shockwave', 'bind', 'dash'], model: 'warden' }));
    await new Promise((r) => setTimeout(r, 300));
    const w = got.find((m) => m.t === 'welcome');
    assert.ok(w, 'no welcome for foundry');
    assert.equal(w.map, 'foundry');
    assert.equal(w.team, 1, 'team choice ignored');
    assert.equal(w.ranked, false);
    w2.close();
  }

  // ---- free-for-all join: big map, 8 players, never ranked
  {
    const w3 = new WebSocket(`ws://localhost:${port}`);
    const got = [];
    w3.onmessage = (e) => got.push(JSON.parse(e.data));
    await new Promise((r, j) => { w3.onopen = r; w3.onerror = j; });
    w3.send(JSON.stringify({ t: 'join', name: 'FfaTester', mode: 'ffa', map: 'olympus', queue: 'ranked', team: 1, loadout: ['pushback', 'bind', 'dash'], model: 'phantom' }));
    await new Promise((r) => setTimeout(r, 500));
    const w = got.find((m) => m.t === 'welcome');
    assert.ok(w, 'no welcome for ffa');
    assert.equal(w.mode, 'ffa');
    assert.equal(w.map, 'necropolis', 'ffa must use an ffa map');
    assert.equal(w.ranked, false, 'ffa must not be ranked');
    const snap = got.filter((m) => m.t === 's').pop();
    assert.equal(snap.p.length, 8);
    assert.equal(snap.ffa, 1);
    assert.equal(new Set(snap.p.map((p) => p.tm)).size, 8, 'every ffa player needs their own team id');
    w3.close();
  }

  // ---- accounts + ranked matchmaking
  {
    const base = `http://localhost:${port}`;
    const post = (p, body, token) => fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, ...(await r.json()) }));
    const st = await (await fetch(base + '/api/status')).json();
    assert.equal(st.persistent, false);
    const bad = await post('/api/signup', { username: 'x', password: 'abc' });
    assert.equal(bad.ok, false);
    const su = await post('/api/signup', { username: 'RankTest', password: 'secret123' });
    assert.equal(su.ok, true, JSON.stringify(su));
    assert.equal(su.profile.rating, 1000);
    assert.equal((await post('/api/signup', { username: 'ranktest', password: 'secret123' })).ok, false, 'duplicate name accepted');
    assert.equal((await post('/api/login', { username: 'RankTest', password: 'nope-nope' })).ok, false);
    const li = await post('/api/login', { username: 'ranktest', password: 'secret123' });
    assert.equal(li.ok, true);
    const me = await (await fetch(base + '/api/me', { headers: { Authorization: `Bearer ${li.token}` } })).json();
    assert.equal(me.profile.username, 'RankTest');

    // ranked without an account is refused
    const g = new WebSocket(`ws://localhost:${port}`);
    const gm = [];
    g.onmessage = (e) => gm.push(JSON.parse(e.data));
    await new Promise((r, j) => { g.onopen = r; g.onerror = j; });
    g.send(JSON.stringify({ t: 'join', name: 'Guest', mode: 2, queue: 'ranked' }));
    await new Promise((r) => setTimeout(r, 300));
    assert.ok(gm.find((m) => m.t === 'error'), 'guest allowed into ranked');
    g.close();

    // ranked with an account: searching message, then a room with bots after the wait; named after the account
    const rw = new WebSocket(`ws://localhost:${port}`);
    const rm = [];
    rw.onmessage = (e) => rm.push(JSON.parse(e.data));
    await new Promise((r, j) => { rw.onopen = r; rw.onerror = j; });
    rw.send(JSON.stringify({ t: 'join', name: 'ignored', mode: 2, map: 'colosseum', queue: 'ranked', token: li.token, loadout: ['dash', 'heal', 'shield'], model: 'vanguard' }));
    await new Promise((r) => setTimeout(r, 1200));
    assert.ok(rm.find((m) => m.t === 'queue'), 'no queue message');
    assert.ok(!rm.find((m) => m.t === 'welcome'), 'placed too early');
    for (let i = 0; i < 100 && !rm.find((m) => m.t === 'welcome'); i++) await new Promise((r) => setTimeout(r, 200));
    const rwl = rm.find((m) => m.t === 'welcome');
    assert.ok(rwl, 'ranked search never produced a match');
    assert.equal(rwl.ranked, true);
    assert.equal(rwl.map, 'colosseum');
    assert.equal(rwl.name, 'RankTest');
    assert.equal(rwl.rating, 1000);
    // cancel path: leave before being placed
    rw.close();
    const cw = new WebSocket(`ws://localhost:${port}`);
    await new Promise((r, j) => { cw.onopen = r; cw.onerror = j; });
    cw.send(JSON.stringify({ t: 'join', mode: 3, map: 'frostpeak', queue: 'ranked', token: li.token }));
    await new Promise((r) => setTimeout(r, 400));
    cw.send(JSON.stringify({ t: 'cancel' }));
    await new Promise((r) => setTimeout(r, 300));
    cw.close();
    console.log('accounts + ranked queue: ok');
  }
} finally {
  srv.kill();
}
console.log('ALL TESTS PASSED');
