import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Room } from './game.js';
import { Lobby } from './lobby.js';
import { attachWebSocket } from './ws-lite.js';
import { createStore } from './store.js';
import { createAuth, makeLimiter, eloDelta, publicProfile, rankFor } from './auth.js';
import { DT, SPELLS, MODELS, MAPS, TEAM_MAP_IDS, FFA_MAP_IDS, DEFAULT_MAP, DEFAULT_MODEL, SLOT_COUNT, DEFAULT_LOADOUT, VERSION } from './sim.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const SNAPSHOT_EVERY = 2; // ticks (60 Hz sim -> 30 Hz snapshots)

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
};

// Only these files are ever served (everything lives in one folder, no subfolders).
const STATIC_FILES = new Set(['index.html', 'main.js', 'world.js', 'sim.js', 'maps.js']);

function resolveFile(urlPath) {
  let p;
  try { p = decodeURIComponent(urlPath.split('?')[0]); } catch { return null; }
  if (p === '/') p = '/index.html';
  const name = p.slice(1);
  return STATIC_FILES.has(name) ? path.join(__dirname, name) : null;
}

// ------------------------------------------------------------------ accounts
const store = createStore();
const auth = createAuth(store);
const authLimit = makeLimiter(12, 60_000); // per IP per minute

const clientIp = (req) => String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();

function readJson(req, limit = 4096) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new Error('too big')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString() || '{}')); } catch { reject(new Error('bad json')); } });
    req.on('error', reject);
  });
}

function sendJson(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

const bearer = (req) => String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');

async function handleApi(req, res, route) {
  try {
    if (route === '/api/status') {
      return sendJson(res, 200, { version: VERSION, persistent: store.kind === 'upstash', storage: store.kind, online: onlineCount() });
    }
    if (route === '/api/me' && req.method === 'GET') {
      const u = await auth.userFromToken(bearer(req));
      return u ? sendJson(res, 200, { ok: true, profile: publicProfile(u) }) : sendJson(res, 401, { ok: false, error: 'Not signed in' });
    }
    if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'POST only' });
    if (!authLimit(clientIp(req))) return sendJson(res, 429, { ok: false, error: 'Too many attempts, wait a minute' });
    if (route === '/api/logout') {
      await auth.logout(bearer(req));
      return sendJson(res, 200, { ok: true });
    }
    if (route === '/api/signup' || route === '/api/login') {
      const body = await readJson(req);
      const r = await (route === '/api/signup' ? auth.signup(body.username, body.password) : auth.login(body.username, body.password));
      if (!r.ok) return sendJson(res, 400, r);
      return sendJson(res, 200, { ok: true, token: r.token, profile: publicProfile(r.user) });
    }
    return sendJson(res, 404, { ok: false, error: 'Not found' });
  } catch (err) {
    console.error('api error', route, err && err.message);
    return sendJson(res, 500, { ok: false, error: 'Server error, try again' });
  }
}

const server = http.createServer((req, res) => {
  const route = (req.url || '').split('?')[0];
  if (route === '/version') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
    res.end(JSON.stringify({ version: VERSION }));
    return;
  }
  if (route.startsWith('/api/')) { handleApi(req, res, route); return; }
  const file = resolveFile(req.url || '/');
  if (!file) { res.writeHead(404).end('not found'); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404).end('not found'); return; }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  });
});

// ------------------------------------------------------------------ ranked bookkeeping
function teamAvg(room, team) {
  const ps = room.players.filter((p) => p.team === team);
  return ps.reduce((a, p) => a + (p.isBot || !p.uid ? 1000 : p.rating), 0) / Math.max(1, ps.length);
}

/** Apply a rating change to a human's account and tell their client. */
function applyRating(player, delta, won) {
  if (!player.uid) return;
  const uid = player.uid;
  player.rating = Math.max(0, player.rating + delta);
  auth.updateUser(uid, (u) => {
    u.rating = Math.max(0, u.rating + delta);
    u.matches++;
    if (won) u.wins++; else u.losses++;
  }).then((u) => {
    if (u && player.ws && player.ws.readyState === 1) {
      player.ws.send(JSON.stringify({ t: 'rating', delta, rating: u.rating, rank: rankFor(u.rating), won: !!won }));
    }
  }).catch((e) => console.error('rating update failed', e && e.message));
}

function onMatchEnd(room, winner) {
  for (const p of room.players) {
    if (p.isBot || !p.uid) continue;
    const mine = teamAvg(room, p.team), theirs = teamAvg(room, 1 - p.team);
    const won = winner === p.team;
    applyRating(p, eloDelta(mine, theirs, won ? 1 : 0), won);
  }
}

function onForfeit(room, p) { // left a ranked match before it ended: counts as a loss
  const mine = teamAvg(room, p.team), theirs = teamAvg(room, 1 - p.team);
  applyRating(p, eloDelta(mine, theirs, 0), false);
}

// ------------------------------------------------------------------ lobby + sockets
const lobby = new Lobby((mode, mapId, ranked) => new Room(mode, mapId, { ranked, onMatchEnd, onForfeit }));
const rooms = lobby.rooms;
const sockets = new Set();
const onlineCount = () => [...sockets].filter((w) => w.player).length;

function cleanName(raw) {
  const n = String(raw || '').replace(/[^\w \-]/g, '').trim().slice(0, 14);
  return n || 'Player';
}

function cleanLoadout(raw) {
  const out = [];
  if (Array.isArray(raw)) for (const id of raw) if (SPELLS[id] && !out.includes(id) && out.length < SLOT_COUNT) out.push(id);
  for (const id of [...DEFAULT_LOADOUT, ...Object.keys(SPELLS)]) if (out.length < SLOT_COUNT && !out.includes(id)) out.push(id);
  return out;
}

function cleanModel(raw) {
  return typeof raw === 'string' && Object.hasOwn(MODELS, raw) ? raw : DEFAULT_MODEL;
}

const send = (ws, obj) => { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); };

async function handleJoin(ws, m) {
  if (ws.player || ws.ticket) return;
  const ffa = m.mode === 'ffa';
  const mode = ffa ? 'ffa' : m.mode === 3 ? 3 : 2;
  // team modes use team maps, free-for-all uses the big deathmatch map(s)
  const allowed = ffa ? FFA_MAP_IDS : TEAM_MAP_IDS;
  const map = typeof m.map === 'string' && allowed.includes(m.map) ? m.map : allowed[0];
  const ranked = !ffa && m.queue === 'ranked'; // no ranked free-for-all
  const team = !ffa && (m.team === 0 || m.team === 1) ? m.team : -1;
  let user = null;
  if (typeof m.token === 'string' && m.token) {
    try { user = await auth.userFromToken(m.token); } catch { user = null; }
  }
  if (ranked && !user) { send(ws, { t: 'error', msg: 'Sign in to play ranked.' }); return; }
  if (ws.readyState !== 1 || ws.player || ws.ticket) return;

  const name = user ? user.username : cleanName(m.name);
  const loadout = cleanLoadout(m.loadout);
  const model = cleanModel(m.model);
  const rating = user ? user.rating : 1000;

  const ticket = {
    mode, map, ranked, team, rating, since: 0,
    place(room) {
      const p = room.addHuman(ws, name, loadout, model, { team, uid: user ? user.username : null, rating });
      if (!p) return false;
      ws.player = p; ws.room = room; ws.ticket = null;
      send(ws, {
        t: 'welcome', id: p.id, team: p.team, mode, map, ranked, loadout: p.loadout, model: p.model, name,
        rating: user ? rating : null, rank: user ? rankFor(rating) : null,
      });
      return true;
    },
  };
  if (!lobby.enter(ticket)) {
    ws.ticket = ticket;
    send(ws, { t: 'queue', waited: 0, searching: lobby.queueInfo(ticket).searching });
  }
}

attachWebSocket(server, (ws) => {
  ws.player = null;
  ws.room = null;
  ws.ticket = null;
  sockets.add(ws);

  ws.on('message', (raw) => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m !== 'object') return;

    if (m.t === 'in') {
      if (ws.player) ws.room.queueInput(ws.player, m);
    } else if (m.t === 'ping') {
      ws.send(JSON.stringify({ t: 'pong', ts: m.ts }));
    } else if (m.t === 'join') {
      handleJoin(ws, m).catch((e) => console.error('join error', e && e.message));
    } else if (m.t === 'cancel') {
      if (ws.ticket) { lobby.cancel(ws.ticket); ws.ticket = null; }
    } else if (m.t === 'pick') {
      if (ws.player) ws.room.setPick(ws.player, cleanModel(m.model), cleanLoadout(m.loadout));
    }
  });

  ws.on('close', () => {
    sockets.delete(ws);
    if (ws.ticket) { lobby.cancel(ws.ticket); ws.ticket = null; }
    if (ws.player) ws.room.removeHuman(ws.player);
    ws.player = null;
  });
});

// ------------------------------------------------------------------ main loop
let last = performance.now();
let acc = 0;
let lastQueueTick = 0;
setInterval(() => {
  const now = performance.now();
  acc += (now - last) / 1000;
  last = now;
  let steps = 0;
  while (acc >= DT && steps < 5) {
    for (const room of rooms) {
      room.step();
      if (room.tick % SNAPSHOT_EVERY === 0) broadcast(room);
    }
    acc -= DT;
    steps++;
  }
  if (steps >= 5) acc = 0;
  if (now - lastQueueTick > 500) {
    lastQueueTick = now;
    lobby.tick();
    for (const ws of sockets) if (ws.ticket) send(ws, { t: 'queue', ...lobby.queueInfo(ws.ticket) });
  }
  lobby.sweep();
}, 4);

function broadcast(room) {
  const humans = room.humans();
  if (humans.length) {
    const snap = room.snapshot();
    for (const p of humans) {
      if (p.ws && p.ws.readyState === 1) p.ws.send(JSON.stringify({ ...snap, me: room.meFor(p) }));
    }
  }
  room.events = [];
}

server.listen(PORT, () => {
  console.log(`Aim Arena v${VERSION} running on http://localhost:${PORT} (accounts stored in: ${store.kind})`);
});

const shutdown = async () => { try { await store.flush(); } catch { /* ignore */ } process.exit(0); };
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
