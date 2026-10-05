import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Room } from './game.js';
import { attachWebSocket } from './ws-lite.js';
import { DT, SPELLS, MODELS, DEFAULT_MODEL, SLOT_COUNT, DEFAULT_LOADOUT, VERSION } from './sim.js';

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
const STATIC_FILES = new Set(['index.html', 'main.js', 'world.js', 'sim.js']);

function resolveFile(urlPath) {
  let p;
  try { p = decodeURIComponent(urlPath.split('?')[0]); } catch { return null; }
  if (p === '/') p = '/index.html';
  const name = p.slice(1);
  return STATIC_FILES.has(name) ? path.join(__dirname, name) : null;
}

const server = http.createServer((req, res) => {
  if ((req.url || '').split('?')[0] === '/version') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
    res.end(JSON.stringify({ version: VERSION }));
    return;
  }
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

const rooms = [];

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

attachWebSocket(server, (ws) => {
  ws.player = null;
  ws.room = null;

  ws.on('message', (raw) => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m !== 'object') return;

    if (m.t === 'in') {
      if (ws.player) ws.room.queueInput(ws.player, m);
    } else if (m.t === 'ping') {
      ws.send(JSON.stringify({ t: 'pong', ts: m.ts }));
    } else if (m.t === 'join' && !ws.player) {
      const mode = m.mode === 3 ? 3 : 2;
      let room = rooms.find((r) => r.mode === mode && r.hasBot());
      if (!room) { room = new Room(mode); rooms.push(room); }
      const p = room.addHuman(ws, cleanName(m.name), cleanLoadout(m.loadout), cleanModel(m.model));
      if (!p) { ws.send(JSON.stringify({ t: 'full' })); return; }
      ws.player = p;
      ws.room = room;
      ws.send(JSON.stringify({ t: 'welcome', id: p.id, team: p.team, mode, loadout: p.loadout, model: p.model }));
    }
  });

  ws.on('close', () => {
    if (ws.player) ws.room.removeHuman(ws.player);
    ws.player = null;
  });
});

// ------------------------------------------------------------------ main loop
let last = performance.now();
let acc = 0;
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
  for (let i = rooms.length - 1; i >= 0; i--) if (rooms[i].emptyT > 15) rooms.splice(i, 1);
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
  console.log(`Aim Arena v${VERSION} running on http://localhost:${PORT}`);
});
