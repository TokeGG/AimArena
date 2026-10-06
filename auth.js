// Accounts, ratings and sessions on top of the key/value store (see store.js).
import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt);

export const START_RATING = 1000;
const SESSION_TTL_SEC = 30 * 24 * 3600;
const USER_RE = /^[A-Za-z0-9_-]{3,14}$/;
const TOKEN_RE = /^[a-f0-9]{64}$/;

/** Rank tier name for a rating. */
export function rankFor(rating) {
  if (rating >= 1800) return 'Olympian';
  if (rating >= 1600) return 'Diamond';
  if (rating >= 1400) return 'Platinum';
  if (rating >= 1200) return 'Gold';
  if (rating >= 1000) return 'Silver';
  return 'Bronze';
}

/** Elo change for me vs opponent. score: 1 win, 0.5 draw, 0 loss. Integer result. */
export function eloDelta(myRating, oppRating, score, k = 32) {
  const expected = 1 / (1 + Math.pow(10, (oppRating - myRating) / 400));
  return Math.round(k * (score - expected));
}

/** Tiny fixed-window in-memory rate limiter. Returns (key) => allowed. */
export function makeLimiter(maxPerWindow, windowMs) {
  const hits = new Map(); // key -> { n, reset }
  let lastSweep = Date.now();
  return (key) => {
    const now = Date.now();
    if (now - lastSweep > windowMs) { // drop expired entries occasionally
      for (const [k, h] of hits) if (h.reset <= now) hits.delete(k);
      lastSweep = now;
    }
    let h = hits.get(key);
    if (!h || h.reset <= now) { h = { n: 0, reset: now + windowMs }; hits.set(key, h); }
    h.n++;
    return h.n <= maxPerWindow;
  };
}

// Sanitised copy of a stored record (no salt/hash).
function sanitize(rec) {
  return {
    username: rec.username, rating: rec.rating, wins: rec.wins,
    losses: rec.losses, matches: rec.matches, created: rec.created,
  };
}

export function publicProfile(user) {
  return {
    username: user.username, rating: user.rating, wins: user.wins,
    losses: user.losses, matches: user.matches, rank: rankFor(user.rating),
  };
}

export function createAuth(store) {
  const userKey = (name) => `u:${String(name).toLowerCase()}`;

  async function loadRecord(username) {
    if (typeof username !== 'string') return null;
    const raw = await store.get(userKey(username));
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
  }

  async function hashPw(password, saltHex) {
    return (await scrypt(password, Buffer.from(saltHex, 'hex'), 64));
  }

  async function newSession(rec) {
    const token = crypto.randomBytes(32).toString('hex');
    await store.set(`s:${token}`, rec.username.toLowerCase(), SESSION_TTL_SEC);
    return token;
  }

  // Per-username promise chains to serialise read-modify-write.
  const chains = new Map();
  function serialise(key, fn) {
    const prev = chains.get(key) || Promise.resolve();
    const run = prev.then(fn, fn);
    const tail = run.catch(() => {});
    chains.set(key, tail);
    tail.then(() => { if (chains.get(key) === tail) chains.delete(key); });
    return run;
  }

  return {
    async signup(username, password) {
      if (typeof username !== 'string' || !USER_RE.test(username)) {
        return { ok: false, error: 'Username must be 3-14 letters, digits, _ or -' };
      }
      if (typeof password !== 'string' || password.length < 6 || password.length > 72) {
        return { ok: false, error: 'Password must be 6-72 characters' };
      }
      // Serialise on the username so two simultaneous signups can't both succeed.
      return serialise(userKey(username), async () => {
        if (await store.get(userKey(username))) return { ok: false, error: 'Username taken' };
        const salt = crypto.randomBytes(16).toString('hex');
        const hash = (await hashPw(password, salt)).toString('hex');
        const rec = {
          username, salt, hash, rating: START_RATING,
          wins: 0, losses: 0, matches: 0, created: Date.now(),
        };
        await store.set(userKey(username), JSON.stringify(rec));
        return { ok: true, token: await newSession(rec), user: sanitize(rec) };
      });
    },

    async login(username, password) {
      const fail = { ok: false, error: 'Wrong username or password' };
      if (typeof username !== 'string' || typeof password !== 'string' || password.length > 72) return fail;
      const rec = await loadRecord(username);
      // Do the same work for unknown users so timing doesn't reveal existence.
      const salt = rec?.salt || '00'.repeat(16);
      const got = await hashPw(password, salt);
      if (!rec) return fail;
      const want = Buffer.from(rec.hash, 'hex');
      if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return fail;
      return { ok: true, token: await newSession(rec), user: sanitize(rec) };
    },

    async userFromToken(token) {
      if (typeof token !== 'string' || !TOKEN_RE.test(token)) return null;
      const name = await store.get(`s:${token}`);
      if (!name) return null;
      return this.getUser(name);
    },

    async logout(token) {
      if (typeof token === 'string' && TOKEN_RE.test(token)) await store.del(`s:${token}`);
    },

    async getUser(username) {
      const rec = await loadRecord(username);
      return rec ? sanitize(rec) : null;
    },

    /** Read user, run mutatorFn(user) (may mutate), write back, return sanitised user. */
    async updateUser(username, mutatorFn) {
      if (typeof username !== 'string') return null;
      return serialise(userKey(username), async () => {
        const rec = await loadRecord(username);
        if (!rec) return null;
        await mutatorFn(rec);
        await store.set(userKey(username), JSON.stringify(rec));
        return sanitize(rec);
      });
    },

    publicProfile,
  };
}
