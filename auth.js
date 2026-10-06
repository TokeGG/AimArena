// Accounts, ratings and sessions on top of the key/value store (see store.js).
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { dayKey, dailyFor, DAILY_STATS } from './sim.js';

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
/** Today's daily-challenge progress for a stored account (empty when the saved day is old). */
function dailyView(rec) {
  const k = dayKey();
  const d = rec.daily && rec.daily.day === k ? rec.daily : null;
  return { day: k, prog: d ? { ...d.prog } : {}, done: d ? [...d.done] : [] };
}

function sanitize(rec) {
  return {
    daily: dailyView(rec),
    rivals: JSON.parse(JSON.stringify(rec.rivals || {})),
    username: rec.username, rating: rec.rating, wins: rec.wins,
    losses: rec.losses, matches: rec.matches, created: rec.created,
    kills: rec.kills || 0, deaths: rec.deaths || 0, mwins: rec.mwins || 0, mplayed: rec.mplayed || 0, xp: rec.xp || 0,
    prof: rec.prof ? { ...rec.prof } : {}, grants: Array.isArray(rec.grants) ? rec.grants.map((g) => ({ ...g })) : [],
  };
}

export function publicProfile(user) {
  return {
    username: user.username, rating: user.rating, wins: user.wins,
    losses: user.losses, matches: user.matches, rank: rankFor(user.rating),
    kills: user.kills || 0, deaths: user.deaths || 0, mwins: user.mwins || 0, mplayed: user.mplayed || 0, xp: user.xp || 0,
    daily: user.daily || dailyView({}), rivals: user.rivals || {},
    prof: user.prof || {}, grants: user.grants || [],
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

  // Index of every username (the store has no "list keys"), used by the leaderboard.
  const known = new Set();
  let indexLoaded = null;
  async function loadIndex() {
    if (!indexLoaded) {
      indexLoaded = (async () => {
        try { for (const n of JSON.parse((await store.get('idx:users')) || '[]')) known.add(n); } catch { /* start empty */ }
      })();
    }
    await indexLoaded;
  }
  async function ensureIndexed(name) {
    const n = String(name).toLowerCase();
    await loadIndex();
    if (known.has(n)) return;
    known.add(n);
    await serialise('idx', async () => { await store.set('idx:users', JSON.stringify([...known])); });
  }
  let lbCache = { at: 0, rows: [] };

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
        await ensureIndexed(username).catch(() => {});
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
      ensureIndexed(rec.username).catch(() => {}); // accounts made before the leaderboard existed
      return { ok: true, token: await newSession(rec), user: sanitize(rec) };
    },

    async userFromToken(token) {
      if (typeof token !== 'string' || !TOKEN_RE.test(token)) return null;
      const name = await store.get(`s:${token}`);
      if (!name) return null;
      ensureIndexed(name).catch(() => {});
      return this.getUser(name);
    },

    async logout(token) {
      if (typeof token === 'string' && TOKEN_RE.test(token)) await store.del(`s:${token}`);
    },

    async getUser(username) {
      const rec = await loadRecord(username);
      return rec ? sanitize(rec) : null;
    },

    /** Top players. by: 'kills' | 'wins' | 'rating'. Cached for 20 s (loads every indexed account). */
    async leaderboard(by = 'wins', limit = 25) {
      const now = Date.now();
      if (now - lbCache.at > 20000) {
        await loadIndex();
        const rows = (await Promise.all([...known].map((n) => this.getUser(n)))).filter(Boolean);
        lbCache = { at: now, rows };
      }
      const val = (u) => (by === 'kills' ? u.kills : by === 'rating' ? u.rating : u.mwins);
      return lbCache.rows
        .filter((u) => (by === 'rating' ? u.matches > 0 : val(u) > 0))
        .sort((a, b) => val(b) - val(a) || b.rating - a.rating)
        .slice(0, limit)
        .map((u) => ({ username: u.username, value: val(u), rating: u.rating, kills: u.kills, mwins: u.mwins, wins: u.mwins, xp: u.xp, prof: u.prof, grants: u.grants }));
    },

    /** Add match results to an account (kills, deaths, xp, match played / won). */
    async addStats(username, d) {
      let newDaily = [];
      const res = await this.updateUser(username, (u) => {
        u.kills = (u.kills || 0) + (d.kills || 0);
        u.deaths = (u.deaths || 0) + (d.deaths || 0);
        u.xp = (u.xp || 0) + (d.xp || 0);
        if (d.played) { u.mplayed = (u.mplayed || 0) + 1; if (d.won) u.mwins = (u.mwins || 0) + 1; }
        if (d.rivals && typeof d.rivals === 'object') { // rivalry tallies: opponent -> { n: display name, k: my kills of them, d: their kills of me }
          u.rivals = u.rivals || {};
          for (const [key, v] of Object.entries(d.rivals)) {
            if (!/^[a-z0-9_-]{3,14}$/.test(key) || !v) continue;
            const r = u.rivals[key] || { n: String(v.n || key).slice(0, 14), k: 0, d: 0 };
            r.k += Math.max(0, v.k | 0); r.d += Math.max(0, v.d | 0); r.n = String(v.n || r.n).slice(0, 14);
            u.rivals[key] = r;
          }
          const keep = Object.entries(u.rivals).sort((x, y) => (y[1].k + y[1].d) - (x[1].k + x[1].d)).slice(0, 40);
          u.rivals = Object.fromEntries(keep);
        }
        if (d.daily) { // daily challenges: add progress, pay out any that just completed
          const k = dayKey();
          if (!u.daily || u.daily.day !== k) u.daily = { day: k, prog: {}, done: [] };
          for (const s of DAILY_STATS) {
            const v = Number(d.daily[s]);
            if (Number.isFinite(v) && v > 0) u.daily.prog[s] = (u.daily.prog[s] || 0) + v;
          }
          for (const c of dailyFor(k)) {
            if (!u.daily.done.includes(c.id) && (u.daily.prog[c.stat] || 0) >= c.goal) {
              u.daily.done.push(c.id); u.xp = (u.xp || 0) + c.xp; newDaily.push(c.id);
            }
          }
        }
      });
      return res ? { ...res, newDaily } : res;
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
