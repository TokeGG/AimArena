import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Room } from './game.js';
import { Lobby } from './lobby.js';
import { attachWebSocket } from './ws-lite.js';
import { createStore } from './store.js';
import { createAuth, makeLimiter, eloDelta, publicProfile, rankFor } from './auth.js';
import { nameAllowed, guestName, ipHash, clientIp, createModeration } from './safety.js';
import crypto from 'node:crypto';
import { DT, SPELLS, MODELS, sanitizeLook, MAPS, TEAM_MAP_IDS, FFA_MAP_IDS, DEFAULT_MAP, DEFAULT_MODEL, SLOT_COUNT, DEFAULT_LOADOUT, LOADOUT_BUDGET, loadoutCost, clampLook, levelFor, unlocksAt, XP_PER_KILL, XP_MATCH, XP_WIN, VERSION, dailyFor, dayKey } from './sim.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const SNAPSHOT_EVERY = 2; // ticks (60 Hz sim -> 30 Hz snapshots)
const SPEC_DELAY = Math.max(0, Number(process.env.SPEC_DELAY ?? 8)); // seconds spectators lag behind the live match
const SPEC_DELAY_SNAPS = Math.round(SPEC_DELAY * 30);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
};

// Only these files are ever served (everything lives in one folder, no subfolders).
const STATIC_FILES = new Set(['index.html', 'main.js', 'world.js', 'sim.js', 'maps.js', 'textures.js', 'character.js', 'weapon.js']);

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

const mod = createModeration(store);
const ADMIN_KEY = String(process.env.ADMIN_KEY || '').trim();
const adminLimit = makeLimiter(8, 60_000);
const sameKey = (a, b) => { const x = crypto.createHash('sha256').update(String(a)).digest(), y = crypto.createHash('sha256').update(String(b)).digest(); return crypto.timingSafeEqual(x, y); };

function readJson(req, limit = 4096) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new Error('too big')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString() || '{}')); } catch { reject(new Error('bad json')); } });
    req.on('error', reject);
  });
}

// Browser-side protections: no framing, no MIME sniffing, and scripts only from this site plus the three.js CDN.
const SEC_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' ws: wss:; font-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'",
};

const ADMIN_PAGE = "<!doctype html>\n<html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">\n<title>Aim Arena Admin</title>\n<style>\n  :root { --gold:#e2b84a; --dim:#a99a78; --line:rgba(226,184,74,.28); }\n  * { box-sizing:border-box; }\n  body { margin:0; background:#0e0a05; color:#f1e8d2; font:15px/1.4 system-ui,Segoe UI,Roboto,sans-serif; padding:24px 16px 60px; }\n  .wrap { max-width:1000px; margin:0 auto; }\n  h1 { font-family:Georgia,serif; letter-spacing:.12em; color:var(--gold); margin:0 0 4px; }\n  a { color:var(--gold); }\n  .card { background:#17110a; border:1px solid var(--line); border-radius:14px; padding:16px; margin:14px 0; }\n  .row { display:flex; gap:8px; flex-wrap:wrap; align-items:center; }\n  input, select, button { font:inherit; color:#f1e8d2; background:#241a0e; border:1px solid var(--line); border-radius:8px; padding:9px 12px; }\n  input { flex:1; min-width:180px; }\n  button { cursor:pointer; } button:hover { border-color:var(--gold); }\n  button.go { background:var(--gold); color:#2b1d03; font-weight:700; border-color:var(--gold); }\n  button.on { border-color:var(--gold); color:var(--gold); }\n  #msg { margin-top:10px; min-height:20px; font-size:14px; }\n  .ok { color:#8be28b; } .bad { color:#ff9a85; } .dim { color:var(--dim); }\n  table { border-collapse:collapse; width:100%; font-size:13px; }\n  th, td { text-align:left; padding:6px 8px; border-bottom:1px solid rgba(226,184,74,.15); vertical-align:top; word-break:break-word; }\n  th { color:var(--gold); }\n  code { background:rgba(0,0,0,.45); padding:1px 5px; border-radius:4px; }\n  .hidden { display:none; }\n  #trace { font:12px/1.5 ui-monospace,Consolas,monospace; color:var(--dim); white-space:pre-wrap; margin-top:8px; }\n</style></head>\n<body><div class=\"wrap\">\n  <h1>ADMIN</h1>\n  <div class=\"dim\"><a href=\"/\">&larr; Back to the game</a> &middot; <span id=\"ver\"></span></div>\n\n  <div class=\"card\">\n    <div class=\"row\">\n      <input id=\"key\" type=\"password\" placeholder=\"Admin key\" autocomplete=\"off\">\n      <button id=\"show\">Show</button>\n      <button id=\"go\" class=\"go\">Unlock</button>\n    </div>\n    <div id=\"msg\" class=\"dim\">Checking the server...</div>\n    <div id=\"trace\"></div>\n  </div>\n\n  <div id=\"panel\" class=\"hidden\">\n    <div class=\"row\" style=\"margin-bottom:10px\">\n      <button data-tab=\"online\" class=\"on\">Online</button>\n      <button data-tab=\"log\">Flags &amp; reports</button>\n      <button data-tab=\"bans\">Bans</button>\n      <button data-tab=\"ban\">Ban someone</button>\n      <button id=\"refresh\">&#8635; Refresh</button>\n      <button id=\"lock\">Lock</button>\n    </div>\n    <div class=\"card\"><div id=\"t-online\"></div><div id=\"t-log\" class=\"hidden\"></div><div id=\"t-bans\" class=\"hidden\"></div>\n      <div id=\"t-ban\" class=\"hidden\">\n        <div class=\"row\" style=\"margin-bottom:8px\">\n          <select id=\"btype\"><option value=\"user\">Account name</option><option value=\"ip\">IP hash</option></select>\n          <input id=\"bid\" placeholder=\"account name or IP hash\">\n        </div>\n        <div class=\"row\">\n          <select id=\"bhours\"><option value=\"1\">1 hour</option><option value=\"24\">1 day</option><option value=\"168\">1 week</option><option value=\"0\">Permanent</option></select>\n          <input id=\"breason\" placeholder=\"reason\">\n          <button id=\"bgo\" class=\"go\">Ban</button>\n        </div>\n      </div>\n    </div>\n  </div>\n</div>\n<script>\n(function () {\n  var $ = function (id) { return document.getElementById(id); };\n  var KEY = 'aim-admin-key';\n  var traceLines = [];\n  function trace(s) { traceLines.push(s); if (traceLines.length > 8) traceLines.shift(); $('trace').textContent = traceLines.join('\\n'); }\n  function esc(t) { return String(t == null ? '' : t).replace(/[&<>\"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', \"'\": '&#39;' }[c]; }); }\n  function say(text, cls) { $('msg').textContent = text; $('msg').className = cls || ''; }\n\n  function api(path, body) {\n    var ac = new AbortController(), timer = setTimeout(function () { ac.abort(); }, 15000);\n    trace((body ? 'POST ' : 'GET ') + path + ' ...');\n    return fetch(path, {\n      method: body ? 'POST' : 'GET', cache: 'no-store', signal: ac.signal,\n      headers: { 'x-admin-key': $('key').value.trim(), 'Content-Type': 'application/json' },\n      body: body ? JSON.stringify(body) : undefined\n    }).then(function (r) {\n      return r.text().then(function (txt) {\n        trace('  -> HTTP ' + r.status + ' (' + txt.length + ' bytes)');\n        try { return JSON.parse(txt); } catch (e) { return { ok: false, error: 'Server answered HTTP ' + r.status + ' but not with data: ' + txt.slice(0, 100) }; }\n      });\n    }).catch(function (e) {\n      trace('  -> failed: ' + (e && e.name));\n      return { ok: false, error: e && e.name === 'AbortError' ? 'The server did not answer in 15 seconds. It may be waking up; try again.' : 'Could not reach the server.' };\n    }).then(function (d) { clearTimeout(timer); return d; });\n  }\n\n  function table(head, rows, empty) {\n    if (!rows.length) return '<div class=\"dim\">' + esc(empty) + '</div>';\n    return '<table><tr>' + head.map(function (h) { return '<th>' + esc(h) + '</th>'; }).join('') + '</tr>' + rows.join('') + '</table>';\n  }\n  function draw(d) {\n    var online = (d.online || []).map(function (o) {\n      return '<tr><td>' + esc(o.name) + '</td><td>' + esc(o.uid || 'guest') + '</td><td><code>' + esc(o.ip) + '</code></td><td>' + esc(o.room) + ' (' + esc(o.mode) + ')</td><td>' +\n        (o.uid ? '<button data-qt=\"user\" data-qid=\"' + esc(o.uid) + '\">Ban account</button> ' : '') + '<button data-qt=\"ip\" data-qid=\"' + esc(o.ip) + '\">Ban IP</button></td></tr>';\n    });\n    $('t-online').innerHTML = table(['Name', 'Account', 'IP hash', 'Room', ''], online, 'Nobody is online right now.');\n    var log = (d.log || []).map(function (e) {\n      return '<tr><td>' + esc(new Date(e.t).toLocaleString()) + '</td><td>' + esc(e.kind) + (e.flag ? ' / ' + esc(e.flag) : '') + (e.reason ? ' / ' + esc(e.reason) : '') + (e.sev ? ' (' + esc(e.sev) + ')' : '') +\n        '</td><td>' + esc(e.who) + (e.by ? '<br><small>by ' + esc(e.by) + '</small>' : '') + '</td><td><code>' + esc(e.ip || '') + '</code></td><td>' + esc(e.detail || '') + '</td></tr>';\n    });\n    $('t-log').innerHTML = table(['When', 'Type', 'Who', 'IP hash', 'Detail'], log, 'Nothing has been flagged or reported yet.');\n    var bans = (d.bans || []).map(function (b) {\n      return '<tr><td>' + esc(b.type) + '</td><td>' + esc(b.id) + '</td><td>' + (b.until ? esc(new Date(b.until).toLocaleString()) : 'permanent') + '</td><td>' + esc(b.reason) + '</td><td><button data-un=\"' + esc(b.type) + '|' + esc(b.id) + '\">Unban</button></td></tr>';\n    });\n    $('t-bans').innerHTML = table(['Type', 'Id', 'Until', 'Reason', ''], bans, 'No active bans.');\n  }\n  function tab(name) {\n    ['online', 'log', 'bans', 'ban'].forEach(function (n) { $('t-' + n).classList.toggle('hidden', n !== name); });\n    Array.prototype.forEach.call(document.querySelectorAll('[data-tab]'), function (b) { b.classList.toggle('on', b.dataset.tab === name); });\n  }\n  function load() {\n    if (!$('key').value.trim()) { say('Type your admin key first.', 'bad'); return Promise.resolve(); }\n    say('Checking the key...', 'dim');\n    return api('/api/admin/log').then(function (d) {\n      if (!d || !d.ok) { say((d && d.error) || 'Failed.', 'bad'); $('panel').classList.add('hidden'); return; }\n      try { sessionStorage.setItem(KEY, $('key').value.trim()); } catch (e) {}\n      say('Unlocked. ' + (d.online || []).length + ' online, ' + (d.log || []).length + ' log entries, ' + (d.bans || []).length + ' bans.', 'ok');\n      $('panel').classList.remove('hidden');\n      try { draw(d); } catch (e) { say('Unlocked, but drawing failed: ' + e.message, 'bad'); }\n    });\n  }\n\n  $('go').onclick = load;\n  $('refresh').onclick = load;\n  $('key').addEventListener('keydown', function (e) { if (e.key === 'Enter') load(); });\n  $('show').onclick = function () { var k = $('key'); k.type = k.type === 'password' ? 'text' : 'password'; $('show').textContent = k.type === 'password' ? 'Show' : 'Hide'; };\n  $('lock').onclick = function () { try { sessionStorage.removeItem(KEY); } catch (e) {} $('key').value = ''; $('panel').classList.add('hidden'); say('Locked.', 'dim'); };\n  document.addEventListener('click', function (e) {\n    var t = e.target.closest ? e.target.closest('button') : null; if (!t) return;\n    if (t.dataset.tab) tab(t.dataset.tab);\n    else if (t.dataset.qt) { $('btype').value = t.dataset.qt; $('bid').value = t.dataset.qid; tab('ban'); $('breason').focus(); }\n    else if (t.dataset.un) { var p = t.dataset.un.split('|'); api('/api/admin/unban', { type: p[0], id: p[1] }).then(load); }\n  });\n  $('bgo').onclick = function () {\n    api('/api/admin/ban', { type: $('btype').value, id: $('bid').value.trim(), hours: Number($('bhours').value), reason: $('breason').value }).then(function (r) {\n      if (!r.ok) { say(r.error || 'Ban failed.', 'bad'); return; }\n      $('bid').value = ''; $('breason').value = ''; load().then(function () { say('Banned.', 'ok'); tab('bans'); });\n    });\n  };\n\n  fetch('/api/admin/ping', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (j) {\n    $('ver').textContent = 'server v' + j.version;\n    if (!j.enabled) { say('Admin is switched off on the server: ADMIN_KEY is not set (or shorter than 12 characters). On Render open Environment, add ADMIN_KEY, save, wait for the redeploy, then reload this page.', 'bad'); return; }\n    say('Admin is on. Enter your key and press Unlock.', 'dim');\n    var saved = ''; try { saved = sessionStorage.getItem(KEY) || ''; } catch (e) {}\n    if (saved) { $('key').value = saved; load(); }\n  }).catch(function () { say('Could not reach the server.', 'bad'); });\n})();\n</script></body></html>\n";

function sendJson(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...SEC_HEADERS });
  res.end(JSON.stringify(obj));
}

const bearer = (req) => String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');

/** Owner-only moderation API. Disabled unless the ADMIN_KEY env var (12+ characters) is set. */
async function handleAdmin(req, res, route) {
  if (ADMIN_KEY.length < 12) return sendJson(res, 503, { ok: false, error: 'Admin is switched off on the server. On Render open Environment, add ADMIN_KEY (12 or more characters), save and let it redeploy, then type that same key here.' });
  if (!sameKey(String(req.headers['x-admin-key'] || '').trim(), ADMIN_KEY.trim())) {
    // only wrong keys count toward the limit, so using the panel never locks you out
    if (!adminLimit(clientIp(req))) return sendJson(res, 429, { ok: false, error: 'Too many wrong keys. Wait a minute and try again.' });
    return sendJson(res, 401, { ok: false, error: 'Wrong key' });
  }
  if (route === '/api/admin/log' && req.method === 'GET') {
    const online = [...sockets].filter((w) => w.player).map((w) => ({ name: w.player.name, uid: w.player.uid || '', ip: w.ipH || '', room: w.room ? w.room.rid : '-', mode: w.room ? w.room.mode : '-' }));
    return sendJson(res, 200, { ok: true, log: mod.list(200), bans: mod.bans(), online });
  }
  if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'POST only' });
  const body = await readJson(req);
  const type = body.type === 'ip' ? 'ip' : 'user';
  const id = String(body.id || '').toLowerCase().slice(0, 40);
  if (route === '/api/admin/ban') {
    const hours = Math.max(0, Math.min(24 * 365, Number(body.hours) || 0));
    if (!mod.ban(type, id, hours, body.reason)) return sendJson(res, 400, { ok: false, error: 'Bad ban' });
    mod.add({ kind: 'ban', who: id, detail: `${type} ban, ${hours ? `${hours}h` : 'permanent'}: ${String(body.reason || '').slice(0, 80)}` });
    for (const w of sockets) if ((type === 'user' && w.player && w.player.uid === id) || (type === 'ip' && w.ipH === id)) { send(w, { t: 'error', msg: 'You have been removed from the game.' }); setTimeout(() => w.terminate(), 50); }
    return sendJson(res, 200, { ok: true });
  }
  if (route === '/api/admin/unban') return sendJson(res, 200, { ok: mod.unban(type, id) });
  return sendJson(res, 404, { ok: false, error: 'Not found' });
}

async function handleApi(req, res, route) {
  try {
    if (route === '/api/games' && req.method === 'GET') {
      const games = rooms.filter((r) => r.humans().length > 0 && !r.range).map((r) => ({
        id: r.rid, mode: r.mode, map: r.mapId, mapName: MAPS[r.mapId].name, ranked: !!r.ranked, ph: r.phase, rd: r.round, sc: r.scores,
        humans: r.humans().map((p) => p.name), size: r.players.length, watching: r.specs.size,
      })).sort((a, b) => b.humans.length - a.humans.length);
      return sendJson(res, 200, { ok: true, games });
    }
    if (route === '/api/leaderboard' && req.method === 'GET') {
      const by = new URL(req.url, 'http://x').searchParams.get('by');
      const rows = await auth.leaderboard(by === 'kills' || by === 'rating' ? by : 'wins', 25);
      return sendJson(res, 200, { ok: true, by: by === 'kills' || by === 'rating' ? by : 'wins', rows, persistent: store.kind === 'upstash' });
    }
    if (route === '/api/admin/ping') return sendJson(res, 200, { enabled: ADMIN_KEY.trim().length >= 12, version: VERSION });
    if (route === '/api/status') {
      return sendJson(res, 200, { version: VERSION, persistent: store.kind === 'upstash', storage: store.kind, online: onlineCount() });
    }
    if (route === '/api/me' && req.method === 'GET') {
      const u = await auth.userFromToken(bearer(req));
      return u ? sendJson(res, 200, { ok: true, profile: publicProfile(u) }) : sendJson(res, 401, { ok: false, error: 'Not signed in' });
    }
    if (route.startsWith('/api/admin/')) return await handleAdmin(req, res, route);
    if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'POST only' });
    if (!authLimit(clientIp(req))) return sendJson(res, 429, { ok: false, error: 'Too many attempts, wait a minute' });
    if (route === '/api/logout') {
      await auth.logout(bearer(req));
      return sendJson(res, 200, { ok: true });
    }
    if (route === '/api/signup' || route === '/api/login') {
      const body = await readJson(req);
      if (route === '/api/signup' && !nameAllowed(body.username)) return sendJson(res, 400, { ok: false, error: 'That username is not allowed' });
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
  if (route === '/admin' || route === '/admin/' || route === '/admin.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', ...SEC_HEADERS });
    res.end(ADMIN_PAGE);
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
      ...SEC_HEADERS,
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
/** Send a human's pending kills/deaths (and, at match end, the match itself) to their account. */
function flushStats(room, p, matchEnded, winner) {
  if (!p.uid || p.isBot || room.noStats) return;
  const kills = p.sKills, deaths = p.sDeaths;
  const rivals = p.rvDelta && Object.keys(p.rvDelta).length ? p.rvDelta : null;
  p.rvDelta = {};
  const daily = { kills, heads: p.dHeads, damage: Math.round(p.dDmg), casts: p.dCasts };
  p.sKills = 0; p.sDeaths = 0; p.dHeads = 0; p.dDmg = 0; p.dCasts = 0;
  const won = matchEnded && winner === p.team && winner >= 0;
  const xp = kills * XP_PER_KILL + (matchEnded ? XP_MATCH + (won ? XP_WIN : 0) : 0);
  if (matchEnded && room.humans().length >= 2) { daily.played = 1; if (won) daily.wins = 1; } // matches against bots only do not count
  if (!kills && !deaths && !matchEnded && !daily.heads && !daily.damage && !daily.casts) return;
  const before = p.xp || 0;
  p.xp = before + xp;
  auth.addStats(p.uid, { kills, deaths, xp, played: matchEnded, won, daily, rivals }).then((u) => {
    if (!u) return;
    p.xp = u.xp;
    if (matchEnded && p.ws && p.ws.readyState === 1) {
      const lv0 = levelFor(before), lv1 = levelFor(u.xp);
      const unlocked = [];
      for (let l = lv0 + 1; l <= lv1; l++) unlocked.push(...unlocksAt(l));
      p.ws.send(JSON.stringify({ t: 'xp', gained: xp, xp: u.xp, level: lv1, up: lv1 > lv0, unlocked, kills: u.kills, mwins: u.mwins, daily: u.daily, newDaily: u.newDaily || [], dailyXp: dailyFor(dayKey()).filter((c) => (u.newDaily || []).includes(c.id)).reduce((a, c) => a + c.xp, 0) }));
    }
  }).catch((e) => console.error('stats update failed', e && e.message));
}
const onStats = (room, winner) => { for (const p of room.players) flushStats(room, p, true, winner); };
const onLeave = (room, p) => flushStats(room, p, false, -1);
/** Two real players killed each other: keep both sides' lifetime tally and tell them. */
function onRivalKill(room, killer, victim) {
  const upd = (me, opp, iKilled) => {
    me.rivals = me.rivals || {};
    me.rvDelta = me.rvDelta || {};
    const key = opp.uid;
    const r = me.rivals[key] || { n: opp.name, k: 0, d: 0 };
    const dd = me.rvDelta[key] || { n: opp.name, k: 0, d: 0 };
    if (iKilled) { r.k++; dd.k++; } else { r.d++; dd.d++; }
    r.n = opp.name; dd.n = opp.name;
    me.rivals[key] = r; me.rvDelta[key] = dd;
    if (me.ws && me.ws.readyState === 1) me.ws.send(JSON.stringify({ t: 'riv', key, n: opp.name, k: r.k, d: r.d, won: iKilled ? 1 : 0 }));
  };
  upd(killer, victim, true);
  upd(victim, killer, false);
}

/** Called by rooms when a client does something a real client never does. */
function onFlag(room, p, kind, detail, sev) {
  const ws = p.ws;
  mod.add({ kind: 'flag', sev, flag: kind, who: p.uid || p.name, guest: !p.uid, ip: ws && ws.ipH, room: room.rid, mode: room.mode, detail });
  console.warn(`[anti-cheat] ${sev} ${kind} ${p.uid || p.name}: ${detail}`);
  if (sev === 'kick' && ws) { send(ws, { t: 'error', msg: 'Disconnected: unusual network behaviour.' }); setTimeout(() => ws.terminate(), 50); }
}
let nextRid = 1;
const lobby = new Lobby((mode, mapId, ranked) => { const r = new Room(mode, mapId, { ranked, onMatchEnd, onForfeit, onStats, onLeave, onFlag, onRivalKill }); r.rid = nextRid++; return r; });
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
  return loadoutCost(out) <= LOADOUT_BUDGET ? out : [...DEFAULT_LOADOUT]; // over the point budget: fall back to the default set
}

function cleanModel(raw) {
  return typeof raw === 'string' && Object.hasOwn(MODELS, raw) ? raw : DEFAULT_MODEL;
}

const send = (ws, obj) => { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); };

async function handleJoin(ws, m) {
  if (ws.player || ws.ticket || ws.specRoom) return;
  const isRange = m.mode === 'range';
  const ffa = m.mode === 'ffa' || isRange;
  const mode = ffa ? 'ffa' : m.mode === 3 ? 3 : 2;
  // team modes use team maps, free-for-all uses the big deathmatch map(s)
  const allowed = ffa ? FFA_MAP_IDS : TEAM_MAP_IDS;
  const map = isRange ? 'range' : typeof m.map === 'string' && allowed.includes(m.map) ? m.map : allowed[0];
  const ranked = !ffa && m.queue === 'ranked'; // no ranked free-for-all
  const team = !ffa && (m.team === 0 || m.team === 1) ? m.team : -1;
  let user = null;
  if (typeof m.token === 'string' && m.token) {
    try { user = await auth.userFromToken(m.token); } catch { user = null; }
  }
  if (ranked && !user) { send(ws, { t: 'error', msg: 'Sign in to play ranked.' }); return; }
  if (user && mod.isBanned('user', user.username)) { send(ws, { t: 'error', msg: 'This account is suspended.' }); return; }
  if (ws.readyState !== 1 || ws.player || ws.ticket) return;

  let name = user ? user.username : guestName(m.name);
  if (!user) { // a guest may not pose as a registered player
    let taken = null;
    try { taken = await auth.getUser(name); } catch { taken = null; }
    if (taken) name = guestName('');
  }
  const loadout = cleanLoadout(m.loadout);
  const level = user ? levelFor(user.xp || 0) : 1;
  const look = clampLook({ ...(m.look && typeof m.look === 'object' ? m.look : {}), model: cleanModel(m.look && m.look.model ? m.look.model : m.model) }, level);
  const model = look.model;
  const rating = user ? user.rating : 1000;

  const ticket = {
    mode, map, ranked, team, rating, since: 0,
    place(room) {
      const p = room.addHuman(ws, name, loadout, model, { team, look, uid: user ? user.username : null, rating });
      if (p) { p.xp = user ? user.xp || 0 : 0; p.rivals = user && user.rivals ? JSON.parse(JSON.stringify(user.rivals)) : {}; p.rvDelta = {}; }
      if (!p) return false;
      ws.player = p; ws.room = room; ws.ticket = null;
      send(ws, {
        t: 'welcome', id: p.id, team: p.team, mode, map, ranked, loadout: p.loadout, model: p.model, look: p.look, name,
        rating: user ? rating : null, rank: user ? rankFor(rating) : null, range: !!room.range, level, xp: user ? user.xp || 0 : 0,
      });
      return true;
    },
  };
  if (isRange) { // a private room for this player only (never matched with anyone else, not listed, no stats)
    const room = new Room('ffa', 'range', { range: true, onFlag });
    room.rid = nextRid++;
    lobby.rooms.push(room);
    ticket.place(room);
    return;
  }
  if (!lobby.enter(ticket)) {
    ws.ticket = ticket;
    send(ws, { t: 'queue', waited: 0, searching: lobby.queueInfo(ticket).searching });
  }
}

const ipConns = new Map();
const MAX_CONN_PER_IP = Number(process.env.MAX_CONN_PER_IP) || 10;
/** Handshake gate: same-site origins only, banned IPs out, and a cap on sockets per address. */
function verifyUpgrade(req) {
  const origin = req.headers.origin;
  if (origin) {
    let host = '';
    try { host = new URL(origin).host; } catch { return false; }
    const ok = [req.headers.host, ...String(process.env.ALLOWED_ORIGINS || '').split(',').map((x) => x.trim()).filter(Boolean)];
    if (!ok.some((a) => a === host || a === origin)) return false;
  }
  const ip = ipHash(clientIp(req));
  if (mod.isBanned('ip', ip)) return false;
  return (ipConns.get(ip) || 0) < MAX_CONN_PER_IP;
}

attachWebSocket(server, (ws, req) => {
  ws.ipH = ipHash(clientIp(req));
  ipConns.set(ws.ipH, (ipConns.get(ws.ipH) || 0) + 1);
  ws.win = { t: 0, n: 0, strikes: 0 };
  ws.player = null;
  ws.room = null;
  ws.ticket = null;
  ws.specRoom = null;
  sockets.add(ws);

  ws.on('message', (raw) => {
    const nowMs = Date.now();
    if (nowMs - ws.win.t > 1000) { ws.win.t = nowMs; ws.win.n = 0; }
    if (++ws.win.n > 150) { // a real client sends about 65 messages a second
      if (ws.win.n === 151 && ++ws.win.strikes >= 5) { mod.add({ kind: 'flag', sev: 'kick', flag: 'spam', who: ws.player ? ws.player.uid || ws.player.name : 'unknown', ip: ws.ipH, detail: 'message flood' }); ws.terminate(); }
      return;
    }
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m !== 'object') return;

    if (m.t === 'in') {
      if (ws.player) ws.room.queueInput(ws.player, m);
    } else if (m.t === 'ping') {
      ws.send(JSON.stringify({ t: 'pong', ts: m.ts }));
    } else if (m.t === 'sq') { // answer to the server's own round-trip probe (used to limit lag-compensation rewind)
      if (ws.probe && m.n === ws.probe.n && ws.player) {
        const rtt = performance.now() - ws.probe.t;
        ws.player.rttMs = ws.player.rttMs == null ? rtt : ws.player.rttMs * 0.8 + rtt * 0.2;
        ws.probe = null;
      }
    } else if (m.t === 'report') {
      handleReport(ws, m);
    } else if (m.t === 'spectate') {
      if (ws.player || ws.ticket || ws.specRoom) return;
      const room = rooms.find((r) => r.rid === m.room && !r.range);
      if (!room || room.specs.size >= 20) { send(ws, { t: 'error', msg: 'That game is no longer available.' }); return; }
      room.specs.add(ws); ws.specRoom = room;
      send(ws, { t: 'welcome', spec: true, id: -1, team: 0, mode: room.mode, map: room.mapId, ranked: !!room.ranked, loadout: [], name: 'Spectator' });
    } else if (m.t === 'join') {
      handleJoin(ws, m).catch((e) => console.error('join error', e && e.message));
    } else if (m.t === 'cancel') {
      if (ws.ticket) { lobby.cancel(ws.ticket); ws.ticket = null; }
    } else if (m.t === 'rematch') {
      if (ws.player) ws.room.setRematch(ws.player);
    } else if (m.t === 'pick') {
      if (ws.player) ws.room.setPick(ws.player, cleanModel(m.model), cleanLoadout(m.loadout));
    }
  });

  ws.on('close', () => {
    sockets.delete(ws);
    ipConns.set(ws.ipH, Math.max(0, (ipConns.get(ws.ipH) || 1) - 1));
    if (ws.ticket) { lobby.cancel(ws.ticket); ws.ticket = null; }
    if (ws.specRoom) { ws.specRoom.specs.delete(ws); ws.specRoom = null; }
    if (ws.player) ws.room.removeHuman(ws.player);
    ws.player = null;
  });
}, verifyUpgrade);

/** A player reports another human. Three different reporters inside ten minutes raise a flag for review. */
function handleReport(ws, m) {
  if (!ws.player || !ws.room) return;
  const now = Date.now();
  ws.reports = (ws.reports || []).filter((t) => now - t < 600_000);
  if (ws.reports.length >= 3) { send(ws, { t: 'notice', msg: 'You have sent a lot of reports. Try again in a few minutes.' }); return; }
  const target = ws.room.players.find((x) => x.id === (m.id | 0) && !x.isBot && x !== ws.player);
  if (!target) return;
  const reason = ['cheating', 'name', 'other'].includes(m.reason) ? m.reason : 'other';
  const by = ws.player.uid || `${ws.player.name}#${ws.ipH}`;
  ws.reports.push(now);
  mod.add({ kind: 'report', reason, who: target.uid || target.name, by, room: ws.room.rid, ip: target.ws && target.ws.ipH });
  target.repBy = target.repBy || new Map();
  target.repBy.set(by, now);
  for (const [k, t] of target.repBy) if (now - t > 600_000) target.repBy.delete(k);
  if (target.repBy.size >= 3 && !target.repFlagged) {
    target.repFlagged = true;
    mod.add({ kind: 'flag', sev: 'flag', flag: 'reports', who: target.uid || target.name, ip: target.ws && target.ws.ipH, room: ws.room.rid, detail: `${target.repBy.size} different players reported them` });
  }
  send(ws, { t: 'notice', msg: 'Report sent. Thank you.' });
}

// ------------------------------------------------------------------ main loop
let last = performance.now();
let acc = 0;
let lastQueueTick = 0, lastProbe = 0, probeN = 0;
let lastFlush = Date.now();
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
  if (now - lastFlush > 60000) { // save kills/deaths of people who stay in one long match
    lastFlush = now;
    for (const room of rooms) for (const p of room.humans()) flushStats(room, p, false, -1);
  }
  if (now - lastProbe > 2000) {
    lastProbe = now;
    for (const ws of sockets) if (ws.player && ws.readyState === 1) { ws.probe = { n: ++probeN, t: now }; ws.send(JSON.stringify({ t: 'sp', n: probeN })); }
  }
  if (now - lastQueueTick > 500) {
    lastQueueTick = now;
    lobby.tick();
    for (const ws of sockets) if (ws.ticket) send(ws, { t: 'queue', ...lobby.queueInfo(ws.ticket) });
  }
  lobby.sweep();
}, 4);

function broadcast(room) {
  const humans = room.humans();
  if (room.specs.size) room.emptyT = 0; // somebody is watching: keep the room alive
  if (humans.length || room.specs.size) {
    const snap = room.snapshot();
    for (const p of humans) {
      if (p.ws && p.ws.readyState === 1) p.ws.send(JSON.stringify({ ...room.viewSnapshot(snap, p), me: room.meFor(p) }));
    }
    if (!room.range) { // spectators see the match a few seconds late, so nobody can relay enemy positions to a player
      const buf = room.specBuf || (room.specBuf = []);
      buf.push(JSON.stringify(snap));
      if (buf.length > SPEC_DELAY_SNAPS + 2) buf.shift();
      if (room.specs.size && buf.length > SPEC_DELAY_SNAPS) {
        const txt = buf[buf.length - 1 - SPEC_DELAY_SNAPS];
        for (const w of room.specs) if (w.readyState === 1) w.send(txt);
      }
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
