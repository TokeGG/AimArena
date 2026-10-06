// Tests for store.js + auth.js. Run: node test/auth.mjs
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { createStore } from '../store.js';
import { createAuth, rankFor, eloDelta, makeLimiter, publicProfile, START_RATING } from '../auth.js';

// ---- pure helpers ----
assert.equal(eloDelta(1000, 1000, 1), 16);
assert.equal(eloDelta(1000, 1000, 0), -16);
assert.equal(eloDelta(1000, 1000, 0.5), 0);
assert.equal(eloDelta(1200, 1000, 1) + eloDelta(1000, 1200, 0), 0);
assert.ok(eloDelta(1000, 1400, 1) > 16); // upset pays more
for (const [r, name] of [[0, 'Bronze'], [999, 'Bronze'], [1000, 'Silver'], [1199, 'Silver'],
  [1200, 'Gold'], [1399, 'Gold'], [1400, 'Platinum'], [1599, 'Platinum'],
  [1600, 'Diamond'], [1799, 'Diamond'], [1800, 'Olympian'], [3000, 'Olympian']]) {
  assert.equal(rankFor(r), name, `rankFor(${r})`);
}
{
  const lim = makeLimiter(3, 50);
  assert.deepEqual([lim('a'), lim('a'), lim('a'), lim('a')], [true, true, true, false]);
  assert.equal(lim('b'), true);
  await new Promise((r) => setTimeout(r, 70));
  assert.equal(lim('a'), true);
}

// ---- shared auth scenario, run against any store ----
async function scenario(store) {
  const auth = createAuth(store);

  const s = await auth.signup('Alice_1', 'hunter22');
  assert.equal(s.ok, true);
  assert.match(s.token, /^[a-f0-9]{64}$/);
  assert.equal(s.user.username, 'Alice_1');
  assert.equal(s.user.rating, START_RATING);
  assert.ok(!('hash' in s.user) && !('salt' in s.user));

  // duplicates, case-insensitive
  assert.deepEqual(await auth.signup('alice_1', 'otherpass'), { ok: false, error: 'Username taken' });
  assert.equal((await auth.signup('ALICE_1', 'otherpass')).ok, false);

  // bad inputs
  for (const bad of ['ab', 'a'.repeat(15), 'bad name', 'bad!', '', null, undefined, 42]) {
    assert.equal((await auth.signup(bad, 'goodpass')).ok, false, `username ${bad}`);
  }
  for (const bad of ['short', 'x'.repeat(73), '', null, undefined, 123456]) {
    assert.equal((await auth.signup('Bobby', bad)).ok, false, `password ${bad}`);
  }
  assert.equal(await auth.getUser('Bobby'), null);

  // login
  const l = await auth.login('ALICE_1', 'hunter22');
  assert.equal(l.ok, true);
  assert.equal(l.user.username, 'Alice_1');
  const wrongPw = await auth.login('alice_1', 'nope-nope');
  const noUser = await auth.login('ghost', 'nope-nope');
  assert.equal(wrongPw.ok, false);
  assert.deepEqual(wrongPw, noUser); // no user enumeration
  assert.equal(wrongPw.error, 'Wrong username or password');

  // sessions
  assert.equal((await auth.userFromToken(l.token)).username, 'Alice_1');
  assert.equal(await auth.userFromToken('zz'), null);
  assert.equal(await auth.userFromToken('a'.repeat(64)), null);
  assert.equal(await auth.userFromToken(undefined), null);
  await auth.logout(l.token);
  assert.equal(await auth.userFromToken(l.token), null);
  assert.equal((await auth.userFromToken(s.token)).username, 'Alice_1'); // other session intact

  // updateUser serialisation
  await Promise.all(Array.from({ length: 20 }, () =>
    auth.updateUser('alice_1', (u) => { u.wins += 1; u.matches += 1; })));
  const u = await auth.getUser('Alice_1');
  assert.equal(u.wins, 20);
  assert.equal(u.matches, 20);
  assert.ok(!('hash' in u));
  assert.equal(await auth.updateUser('nobody', () => {}), null);

  // profile
  assert.deepEqual(publicProfile(u), {
    username: 'Alice_1', rating: 1000, wins: 20, losses: 0, matches: 20, rank: 'Silver',
  });
  // a login still works after updates (hash preserved)
  assert.equal((await auth.login('alice_1', 'hunter22')).ok, true);
  return auth;
}

// ---- file mode ----
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aimauth-'));
{
  const store = createStore({ DATA_DIR: dir });
  assert.equal(store.kind, 'file');
  await store.set('ttl', 'x', 1);
  assert.equal(await store.get('ttl'), 'x');
  await scenario(store);
  await store.flush();
  assert.ok(fs.existsSync(path.join(dir, 'accounts.json')));

  // persistence: a second store on the same dir sees the data
  const store2 = createStore({ DATA_DIR: dir });
  const auth2 = createAuth(store2);
  assert.equal((await auth2.getUser('alice_1')).wins, 20);
  assert.equal((await auth2.login('Alice_1', 'hunter22')).ok, true);
  assert.equal(await store2.get('nothing'), null);
  await store2.del('u:alice_1');
  assert.equal(await store2.get('u:alice_1'), null);
}
{
  // ttl expiry in file mode
  const store = createStore({ DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'aimauth-')) });
  await store.set('k', 'v', 1);
  const realNow = Date.now;
  Date.now = () => realNow() + 2000;
  try { assert.equal(await store.get('k'), null); } finally { Date.now = realNow; }
}
{
  // unwritable dir (a file in the way) -> silent memory fallback
  const blocker = path.join(dir, 'accounts.json');
  const store = createStore({ DATA_DIR: blocker });
  await store.set('a', 'b');
  assert.equal(await store.get('a'), 'b');
  await store.flush();
}

// ---- Upstash mode against a mock server ----
{
  const data = new Map();
  const seen = { auth: new Set(), cmds: [] };
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      seen.auth.add(req.headers.authorization);
      const reply = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
      if (req.method !== 'POST') return reply(405, { error: 'method' });
      if (req.headers.authorization !== 'Bearer secret-token') return reply(401, { error: 'Unauthorized' });
      const [cmd, key, val, opt, ttl] = JSON.parse(body);
      seen.cmds.push(cmd);
      if (cmd === 'GET') return reply(200, { result: data.has(key) ? data.get(key) : null });
      if (cmd === 'SET') {
        data.set(key, val);
        if (opt === 'EX') assert.ok(ttl > 0);
        return reply(200, { result: 'OK' });
      }
      if (cmd === 'DEL') return reply(200, { result: data.delete(key) ? 1 : 0 });
      return reply(400, { error: 'ERR unknown command' });
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    const store = createStore({ UPSTASH_REDIS_REST_URL: url, UPSTASH_REDIS_REST_TOKEN: 'secret-token', DATA_DIR: dir });
    assert.equal(store.kind, 'upstash');
    await scenario(store);
    assert.deepEqual([...seen.auth], ['Bearer secret-token']);
    assert.ok(['GET', 'SET', 'DEL'].every((c) => seen.cmds.includes(c)));
    assert.ok([...data.keys()].some((k) => k === 'u:alice_1'));
    assert.ok([...data.keys()].some((k) => k.startsWith('s:')));

    // a fresh store/auth sees the same remote data
    const auth2 = createAuth(createStore({ UPSTASH_REDIS_REST_URL: url, UPSTASH_REDIS_REST_TOKEN: 'secret-token' }));
    assert.equal((await auth2.getUser('ALICE_1')).wins, 20);

    // errors surface as exceptions
    const bad = createStore({ UPSTASH_REDIS_REST_URL: url, UPSTASH_REDIS_REST_TOKEN: 'wrong' });
    await assert.rejects(bad.get('x'), /401/);
  } finally {
    server.close();
  }
}

fs.rmSync(dir, { recursive: true, force: true });
console.log('auth: ok');
