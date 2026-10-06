// Server-level safety checks: security headers, admin API, bans, origin check, name rules, reports. Run: node test/safety.mjs
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = 4100 + Math.floor(Math.random() * 90);
const KEY = 'test-admin-key-123456';
const srv = spawn('node', ['server.js'], { cwd: root, env: { ...process.env, PORT: String(port), ADMIN_KEY: KEY, DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'aim-safe-')) }, stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((res, rej) => { srv.stdout.on('data', (d) => { if (String(d).includes('running')) res(); }); setTimeout(() => rej(new Error('start timeout')), 5000); });
const base = `http://localhost:${port}`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const open = async (origin) => {
  const w = new WebSocket(`ws://localhost:${port}`, origin ? { headers: { Origin: origin } } : undefined);
  w.got = []; w.onmessage = (e) => w.got.push(JSON.parse(e.data));
  await new Promise((r, j) => { w.onopen = r; w.onerror = () => j(new Error('refused')); });
  return w;
};
const post = async (p, body, key = KEY) => (await fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-admin-key': key }, body: JSON.stringify(body) })).json();
try {
  // headers
  const r = await fetch(base + '/');
  assert.match(r.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('x-frame-options'), 'DENY');
  assert.equal((await fetch(base + '/admin.html')).status, 200);
  assert.equal((await fetch(base + '/server.js')).status, 404, 'source files that are not served stay hidden');

  // admin API needs the key
  assert.equal((await fetch(base + '/api/admin/log')).status, 401);
  assert.equal((await fetch(base + '/api/admin/log', { headers: { 'x-admin-key': 'nope-nope-nope-nope' } })).status, 401);
  const log0 = await (await fetch(base + '/api/admin/log', { headers: { 'x-admin-key': KEY } })).json();
  assert.equal(log0.ok, true);

  // signup refuses bad names
  const bad = await (await fetch(base + '/api/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'Admin', password: 'secret123' }) })).json();
  assert.equal(bad.ok, false); assert.match(bad.error, /not allowed/);

  // cross-site websocket is refused, same-site / no-origin is fine
  await assert.rejects(open('https://evil.example'), /refused/);
  const okWs = await open(`http://localhost:${port}`);
  okWs.close();

  // guest names are filtered
  const g = await open();
  g.send(JSON.stringify({ t: 'join', name: 'f u c k', mode: 2, map: 'olympus' }));
  await wait(300);
  const wel = g.got.find((m) => m.t === 'welcome');
  assert.ok(wel && /^Player\d{3}$/.test(wel.name), `filtered guest name (${wel && wel.name})`);

  // oversize frame kills the connection
  const big = await open();
  big.send('x'.repeat(20000));
  await wait(300);
  assert.notEqual(big.readyState, 1, 'oversize message closes the socket');

  // reports
  const a = await open(), b = await open();
  a.send(JSON.stringify({ t: 'join', name: 'Alpha', mode: 2, map: 'olympus', team: 0 }));
  b.send(JSON.stringify({ t: 'join', name: 'Bravo', mode: 2, map: 'olympus', team: 1 }));
  await wait(500);
  const wa = a.got.find((m) => m.t === 'welcome'), wb = b.got.find((m) => m.t === 'welcome');
  assert.ok(wa && wb);
  a.send(JSON.stringify({ t: 'report', id: wb.id, reason: 'cheating' }));
  await wait(300);
  assert.ok(a.got.some((m) => m.t === 'notice'), 'reporter gets a confirmation');
  a.send(JSON.stringify({ t: 'report', id: wa.id, reason: 'cheating' })); // cannot report yourself
  const log1 = await (await fetch(base + '/api/admin/log', { headers: { 'x-admin-key': KEY } })).json();
  assert.ok(log1.log.some((e) => e.kind === 'report' && e.who === 'Bravo' && e.reason === 'cheating'));
  assert.equal(log1.log.filter((e) => e.kind === 'report').length, 1);
  const bravo = log1.online.find((o) => o.name === 'Bravo');
  assert.ok(bravo && /^[0-9a-f]{12}$/.test(bravo.ip), 'only hashed addresses are exposed');

  // banning an address removes the player and refuses new sockets
  assert.equal((await post('/api/admin/ban', { type: 'ip', id: bravo.ip, hours: 1, reason: 'test' })).ok, true);
  await wait(300);
  assert.notEqual(b.readyState, 1, 'banned player is disconnected');
  await assert.rejects(open(), /refused/);
  assert.equal((await post('/api/admin/unban', { type: 'ip', id: bravo.ip })).ok, true);
  (await open()).close();

  // account ban blocks joins
  const su = await (await fetch(base + '/api/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'Troll_1', password: 'secret123' }) })).json();
  assert.equal(su.ok, true);
  await post('/api/admin/ban', { type: 'user', id: 'troll_1', hours: 0, reason: 'test' });
  const t = await open();
  t.send(JSON.stringify({ t: 'join', name: 'x', mode: 2, map: 'olympus', token: su.token }));
  await wait(300);
  assert.ok(t.got.some((m) => m.t === 'error' && /suspended/.test(m.msg)), 'banned account cannot join');
  console.log('safety: ok');
} finally { srv.kill(); }
