// Tiny key/value store with two backends:
//   - Upstash Redis (REST) when UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN are set
//   - A JSON file (or memory only, if the dir is not writable) otherwise
// All values are strings. Interface: get / set / del, plus `kind`.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

const HTTP_TIMEOUT_MS = 4000;
const WRITE_DEBOUNCE_MS = 300;

export function createStore(env = process.env) {
  const url = env.UPSTASH_REDIS_REST_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) return createUpstashStore(url, token);
  return createFileStore(env.DATA_DIR || './data');
}

// ---------- Upstash (REST, command-array protocol) ----------
function createUpstashStore(url, token) {
  async function cmd(args) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), HTTP_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(args),
        signal: ctl.signal,
      });
      let data = null;
      try { data = await res.json(); } catch { /* non-JSON body */ }
      if (!res.ok) throw new Error(`Upstash HTTP ${res.status}${data?.error ? ': ' + data.error : ''}`);
      if (!data || data.error) throw new Error(`Upstash error: ${data?.error || 'bad response'}`);
      return data.result;
    } finally {
      clearTimeout(timer);
    }
  }
  return {
    kind: 'upstash',
    async get(key) { const r = await cmd(['GET', key]); return r == null ? null : String(r); },
    async set(key, value, ttlSec = 0) {
      await cmd(ttlSec > 0 ? ['SET', key, String(value), 'EX', Math.ceil(ttlSec)] : ['SET', key, String(value)]);
    },
    async del(key) { await cmd(['DEL', key]); },
    async flush() { /* nothing buffered */ },
  };
}

// ---------- File / memory fallback ----------
function createFileStore(dir) {
  const file = path.join(dir, 'accounts.json');
  const map = new Map(); // key -> { v: string, exp: number (ms epoch, 0 = never) }
  let persist = true;    // false once we know the dir is unusable -> memory only

  // Load once, synchronously, so the store is ready immediately.
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.accessSync(dir, fs.constants.W_OK);
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      const now = Date.now();
      for (const [k, e] of Object.entries(raw)) {
        if (e && typeof e.v === 'string' && (!e.exp || e.exp > now)) map.set(k, e);
      }
    } catch { /* missing or corrupt file: start empty */ }
  } catch {
    persist = false;
  }

  let timer = null;
  let writing = Promise.resolve();

  async function writeNow() {
    if (!persist) return;
    const now = Date.now();
    const obj = {};
    for (const [k, e] of map) if (!e.exp || e.exp > now) obj[k] = e;
    const tmp = `${file}.${process.pid}.tmp`;
    try {
      await fsp.writeFile(tmp, JSON.stringify(obj));
      await fsp.rename(tmp, file); // atomic replace
    } catch {
      persist = false; // unwritable: continue in memory only
      fsp.unlink(tmp).catch(() => {});
    }
  }

  function schedule() {
    if (!persist || timer) return;
    timer = setTimeout(() => {
      timer = null;
      writing = writing.then(writeNow);
    }, WRITE_DEBOUNCE_MS);
    timer.unref?.(); // don't keep the process alive just for a pending write
  }

  return {
    kind: 'file',
    async get(key) {
      const e = map.get(key);
      if (!e) return null;
      if (e.exp && e.exp <= Date.now()) { map.delete(key); return null; }
      return e.v;
    },
    async set(key, value, ttlSec = 0) {
      map.set(key, { v: String(value), exp: ttlSec > 0 ? Date.now() + ttlSec * 1000 : 0 });
      schedule();
    },
    async del(key) { if (map.delete(key)) schedule(); },
    // Force any pending debounced write to disk now (used on shutdown and in tests).
    async flush() {
      if (timer) { clearTimeout(timer); timer = null; writing = writing.then(writeNow); }
      await writing;
    },
  };
}
