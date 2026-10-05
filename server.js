import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Room } from './game.js';
import { attachWebSocket } from './ws-lite.js';
import { DT, SPELLS } from './shared/sim.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const SNAPSHOT_EVERY = 3; // ticks (60 Hz sim -> 20 Hz snapshots)

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
};

function resolveFile(urlPath) {
  let p;
  try { p = decodeURIComponent(urlPath.split('?')[0]); } catch { return null; }
  if (p === '/') p = '/index.html';
  let base, rel;
  if (p.startsWith('/shared/')) { base = path.join(__dirname, 'shared'); rel = p.slice(8); }
  else { base = path.join(__dirname, 'public'); rel = p.slice(1); }
  const full = path.normalize(path.join(base, rel));
  return full.startsWith(base) ? full : null;
}

const server = http.createServer((req, res) => {
  const file = resolveFile(req.url || '/');
  if (!file) { res.writeHead(400).end('bad request'); return; }
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
  if (Array.isArray(raw)) for (const id of raw) if (SPELLS[id] && !out.includes(id)) out.push(id);
  for (const id of ['dash', 'heal', 'shield', 'shockwave']) if (out.length < 2 && !out.includes(id)) out.push(id);
  return out.slice(0, 2);
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
      const p = room.addHuman(ws, cleanName(m.name), cleanLoadout(m.loadout));
      if (!p) { ws.send(JSON.stringify({ t: 'full' })); return; }
      ws.player = p;
      ws.room = room;
      ws.send(JSON.stringify({ t: 'welcome', id: p.id, team: p.team, mode, loadout: p.loadout }));
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
  console.log(`Aim Arena running on http://localhost:${PORT}`);
});
