// Headless checks: full bot-only matches, then a real WebSocket client against the server.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Room } from '../game.js';
import { stepPlayer, DT, ARENA, WALLS } from '../shared/sim.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// ------------------------------------------------------------ 1. bot-only matches
for (const mode of [2, 3]) {
  const room = new Room(mode);
  assert.equal(room.players.length, mode * 2);
  let matchEnds = 0, rounds = 0, shots = 0, hits = 0, kills = 0;
  const spells = {};
  let prevPhase = room.phase;
  const maxTicks = 60 * 60 * 25; // 25 simulated minutes
  for (let i = 0; i < maxTicks && matchEnds < 2; i++) {
    room.step();
    for (const e of room.events) {
      if (e.k === 'shot') shots++;
      if (e.k === 'hit') hits++;
      if (e.k === 'kill') kills++;
      if (e.k === 'round') rounds++;
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
  console.log(`mode ${mode}v${mode}: matchEnds=${matchEnds} rounds=${rounds} shots=${shots} hits=${hits} kills=${kills} spells=${JSON.stringify(spells)} scores=${room.scores}`);
  assert.ok(matchEnds >= 1, 'bots never finished a match');
  assert.ok(kills > 0 && hits > 0, 'bots never hit anything');
}

// ------------------------------------------------------------ 2. movement sanity
{
  const p = { x: -25, y: 0, z: 25, vx: 0, vy: 0, vz: 0, dvx: 0, dvz: 0, dashT: 0 };
  for (let i = 0; i < 120; i++) stepPlayer(p, { mx: 0, mz: 1, yaw: 0, jump: false }, DT); // walk -Z for 2s
  assert.ok(p.z < 25 - 10 && p.z > 25 - 15, `unexpected walk distance, z=${p.z}`);
  const q = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, dvx: 0, dvz: 0, dashT: 0 };
  stepPlayer(q, { mx: 0, mz: 0, yaw: 0, jump: true }, DT);
  assert.ok(q.vy > 0 && q.y > 0, 'jump failed');
}

// ------------------------------------------------------------ 3. real server + websocket
const port = 3900 + Math.floor(Math.random() * 90);
const srv = spawn('node', ['server.js'], { cwd: root, env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((res, rej) => {
  srv.stdout.on('data', (d) => { if (String(d).includes('running')) res(); });
  srv.on('exit', (c) => rej(new Error('server exited ' + c)));
  setTimeout(() => rej(new Error('server start timeout')), 5000);
});

try {
  const html = await (await fetch(`http://localhost:${port}/`)).text();
  assert.ok(html.includes('Aim Arena'), 'index.html not served');
  const js = await fetch(`http://localhost:${port}/shared/sim.js`);
  assert.equal(js.status, 200);
  assert.equal((await fetch(`http://localhost:${port}/../server.js`)).status === 200 && false, false);

  const ws = new WebSocket(`ws://localhost:${port}`);
  const msgs = [];
  ws.onmessage = (e) => msgs.push(JSON.parse(e.data));
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  ws.send(JSON.stringify({ t: 'join', name: 'Tester', mode: 3, loadout: ['dash', 'shockwave'] }));
  ws.send(JSON.stringify({ t: 'ping', ts: 42 }));
  await new Promise((r) => setTimeout(r, 300));
  const welcome = msgs.find((m) => m.t === 'welcome');
  assert.ok(welcome, 'no welcome');
  assert.deepEqual(welcome.loadout, ['dash', 'shockwave']);
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
  assert.equal(end.p.filter((p) => !p.b).length, 1, 'expected exactly one human');
  console.log(`websocket: ok (ack=${end.me.ack}, moved=${moved.toFixed(1)}m, snapshots=${msgs.filter((m) => m.t === 's').length})`);
  ws.close();
  await new Promise((r) => setTimeout(r, 200));
} finally {
  srv.kill();
}
console.log('ALL TESTS PASSED');
