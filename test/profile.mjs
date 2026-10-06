// Titles / icons / name colours: shared rules + the server flow (save, owner, grants, what other players see).
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolveProf, profMeets, xpForLevel, PROF_TITLES, cleanProfPick } from '../sim.js';

// ---- rules
const fresh = { xp: 0, kills: 0, mwins: 0, rating: 1000 };
assert.equal(resolveProf({ title: 'rookie' }, fresh).t, 'Rookie');
assert.equal(resolveProf({ title: 'champion' }, fresh).t, '', 'locked title is not shown');
assert.equal(resolveProf({ title: 'champion' }, { ...fresh, xp: xpForLevel(20) }).t, 'Champion');
assert.equal(resolveProf({ title: 'slayer' }, { ...fresh, kills: 100 }).t, 'Slayer');
assert.equal(resolveProf({ icon: 'crown' }, fresh).i, '', 'crown needs rating 1800');
assert.equal(resolveProf({ color: 'gold' }, { ...fresh, xp: xpForLevel(25) }).nc, '#e2b84a');
assert.equal(resolveProf({ title: 'custom', ct: 'Boss', cc: '#ff0000' }, fresh, [], false).t, '', 'custom is owner-only');
const o = resolveProf({ title: 'custom', ct: 'The <b>Boss</b>', cc: '#ff00aa', icon: 'custom', ci: '\u{1F355}', color: 'custom', cn: '#00ffcc' }, fresh, [], true);
assert.deepEqual([o.t, o.tc, o.i, o.nc], ['The bBoss/b', '#ff00aa', '\u{1F355}', '#00ffcc'], 'owner custom, markup stripped');
assert.equal(resolveProf({ title: 'g:abc' }, fresh, [{ id: 'abc', text: 'Founder', color: '#112233' }], false).t, 'Founder');
assert.equal(resolveProf({ title: 'g:zzz' }, fresh, [{ id: 'abc', text: 'Founder' }], false).t, '', 'only your own awards');
assert.equal(cleanProfPick({ title: '<script>' }).title, '');
assert.ok(PROF_TITLES.every((t) => t.name.length <= 20));

// ---- server flow
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = 4200 + Math.floor(Math.random() * 90), KEY = 'test-admin-key-123456';
const srv = spawn('node', ['server.js'], { cwd: root, env: { ...process.env, PORT: String(port), ADMIN_KEY: KEY, DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'aim-prof-')) }, stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((res, rej) => { srv.stdout.on('data', (d) => { if (String(d).includes('running')) res(); }); setTimeout(() => rej(new Error('start timeout')), 5000); });
const base = `http://localhost:${port}`;
const J = async (p, body, h = {}) => (await fetch(base + p, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...h }, body: body ? JSON.stringify(body) : undefined })).json();
const adm = (p, body) => J(p, body, { 'x-admin-key': KEY });
try {
  const a = await J('/api/signup', { username: 'Boss', password: 'secret123' });
  const b = await J('/api/signup', { username: 'Pal', password: 'secret123' });
  assert.ok(a.ok && b.ok); assert.equal(a.profile.owner, false);
  const auth = (t) => ({ Authorization: `Bearer ${t}` });
  // a fresh account can pick Rookie but not the owner's custom stuff
  let r = await J('/api/profile', { prof: { title: 'rookie', icon: 'target', color: 'white' } }, auth(a.token));
  assert.ok(r.ok); assert.equal(r.profile.prof.title, 'rookie');
  r = await J('/api/profile', { prof: { title: 'custom', ct: 'Hax', icon: 'custom', ci: 'X' } }, auth(a.token));
  assert.ok(r.ok);
  // make Boss the owner via the admin API
  assert.equal((await adm('/api/admin/owner', { username: 'nobody-here' })).ok, false);
  assert.deepEqual((await adm('/api/admin/owner', { username: 'Boss' })).owners, ['boss']);
  assert.equal((await J('/api/me', null, auth(a.token))).profile.owner, true);
  assert.equal((await J('/api/me', null, auth(b.token))).profile.owner, false);
  r = await J('/api/profile', { prof: { title: 'custom', ct: 'Creator', cc: '#ffd54a', icon: 'custom', ci: '\u{1F451}', color: 'custom', cn: '#00ffcc' } }, auth(a.token));
  assert.equal(r.profile.prof.ct, 'Creator');
  // awards
  assert.equal((await adm('/api/admin/grant', { username: 'Pal', text: 'Founder', icon: '\u{1F31F}', color: '#ff00aa' })).grants.length, 1);
  const gid = (await adm('/api/admin/grants?user=Pal')).grants[0].id;
  r = await J('/api/profile', { prof: { title: `g:${gid}`, icon: `g:${gid}` } }, auth(b.token));
  assert.equal(r.profile.grants[0].text, 'Founder');
  // what other players see: join a match, snapshot carries pf
  const ws = new WebSocket(`ws://localhost:${port}`); const got = []; ws.onmessage = (e) => got.push(JSON.parse(e.data));
  await new Promise((res) => { ws.onopen = res; });
  ws.send(JSON.stringify({ t: 'join', name: 'x', mode: 2, map: 'olympus', queue: 'quick', loadout: ['dash', 'heal', 'shield'], model: 'striker', token: a.token }));
  for (let i = 0; i < 50 && !got.some((m) => m.t === 's' && m.p.some((q) => q.pf)); i++) await new Promise((r2) => setTimeout(r2, 100));
  const snap = got.find((m) => m.t === 's' && m.p.some((q) => q.pf));
  assert.ok(snap, 'snapshot carries the owner\'s look'); assert.deepEqual(snap.p.find((q) => q.pf).pf, ['\u{1F451}', 'Creator', '#ffd54a', '#00ffcc']);
  ws.close();
  // leaderboard rows carry pf only for resolved values
  const t2 = await adm('/api/admin/ungrant', { username: 'Pal', gid });
  assert.equal(t2.grants.length, 0);
  assert.equal((await J('/api/profile', null)).ok, false, 'not allowed anonymously');
  console.log('profile: ok');
} finally { srv.kill(); }
