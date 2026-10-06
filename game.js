// Authoritative game room: players, bots, rounds, hitscan, skills, status effects.
import {
  DT, eyeH, FIRE_INTERVAL, AMMO_START, AMMO_KILL, AMMO_MAX, BODY_DMG, HEAD_DMG, RANGE, SPELLS, MODELS, DEFAULT_MODEL, SLOT_COUNT,
  LOADOUT_BUDGET, loadoutCost, resolveWalls, PLAYER_R,
  ARENA, WALLS, HAZARDS, DEFAULT_MAP, MAPS, useMap, sanitizeLook, encodeLook, randomLook, stepPlayer, lookDir, rayWalls, rayWorld, rayPlayer, spawnPoint, ffaSpawn, ffaSpawnCount,
} from './sim.js';

export const WIN_ROUNDS = 3;
export const ROUND_TIME = 90;
export const MATCH_END_TIME = 15; // seconds players get to re-pick champion + skills after a match
export const RANGE_PLAYERS = 6; // you + 5 dummies
export const FFA_PLAYERS = 8;   // free-for-all: humans + bots
export const FFA_KILLS = 20;     // first to this many kills wins
export const FFA_TIME = 300;     // or the best score after 5 minutes
/** Custom practice-match settings, clamped. rounds = rounds to win, time = seconds per round (FFA: whole match), kills = FFA target. */
export function cleanCustom(c) {
  const n = (v, lo, hi, d) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Math.max(lo, Math.min(hi, Math.round(Number(v)))) : d);
  c = c && typeof c === 'object' ? c : {};
  return { rounds: n(c.rounds, 1, 7, WIN_ROUNDS), time: n(c.time, 30, 600, ROUND_TIME), kills: n(c.kills, 3, 60, FFA_KILLS), skills: c.skills !== false, hs: c.hs === true, inf: c.inf === true };
}
const RESPAWN_TIME = 3, SPAWN_PROTECT = 1.5;
export const MAX_REWIND = 24; // ticks (400 ms at 60 Hz): the most a shot can be rewound

// tuning
const FIRE_TOLERANCE = 0.06; // seconds
const PLACE_RANGE = 40; // how far a Decoy / Slow Trap can be shot
const BUFF_TIME = 6;
const BURN_DPS = 14, BURN_LINGER = 1.2;
const BLEED_DPS = 6, BLEED_MOVING_MULT = 1.8, BLEED_TIME = 4;
const BIND_TIME = 1.8;
const SHOCK_RANGE = 30, SHOCK_RADIUS = 0.9, SHOCK_PUSH = 24;
const PUSHBACK_RADIUS = 7, PUSHBACK_FORCE = 26;
const HAZARD_BURN = 1.0;
const POOL_RANGE = 30, POOL_RADIUS = 3, POOL_TIME = 5;
const NOVA_RADIUS = 5, NOVA_DMG = 12, NOVA_SLOW = 3;
const BLINK_DIST = 9, GRAPPLE_RANGE = 28, GRAPPLE_SPEED = 30;
const SMOKE_RADIUS = 3.6, SMOKE_TIME = 7, SMOKE_RANGE = 24;
const DECOY_TIME = 6, DECOY_SPEED = 5;
const TRAP_R = 1.5, TRAP_TIME = 45, TRAP_ARM = 0.8, TRAP_SLOW = 3, TRAP_MAX = 2;
const MARK_TIME = 5, MARK_RANGE = 60, MARK_RADIUS = 1.3;
const WELL_R = 4.5, WELL_TIME = 2.5, WELL_PULL = 4.5, WELL_RANGE = 26;
const OVER_MULT = 2;
const CREDIT_MAX = 12, CREDIT_REFILL = 1.05; // inputs a client may process: ~60/s plus a small burst (stops speed hacks that send inputs faster than real time)
const VIS_GRACE = 0.6, NEAR_REVEAL = 3.5, TRAP_REVEAL = 7, KILLER_REVEAL = 3; // visibility culling (anti wall-hack)
const REMATCH_GO = 2; // seconds left on the post-match timer once everyone voted to play again
const POLY_TIME = 2, POLY_RANGE = 40;
let nextDecoyId = 1000000;

const SPELL_IDS = Object.keys(SPELLS);
const MODEL_IDS = Object.keys(MODELS);
const BOT_NAMES = ['Apollo', 'Athena', 'Ares', 'Hermes', 'Zeus', 'Hera', 'Artemis', 'Hades', 'Nike', 'Eros', 'Atlas', 'Helios'];
let nextId = 1;
let nextZoneId = 1;
let botNameIdx = 0;

const rand = (a, b) => a + Math.random() * (b - a);
const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const angDiff = (a, b) => {
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
};
const NEUTRAL = () => ({ seq: 0, mx: 0, mz: 0, yaw: 0, pitch: 0, jump: false, shoot: false, q: false, e: false, r: false, vt: 0 });
const SLOT_FLAG = ['q', 'e', 'r'];

function newAI() {
  return {
    tgt: null, retargetT: 0, strafe: 1, strafeT: 0, seenT: 0, noiseY: 0, noiseP: 0, noiseT: 0,
    stuckT: 0, lx: 0, lz: 0, avoidT: 0, avoidDir: 1, burstT: 0.3, bursting: false,
    navCell: -1, navAt: 0, field: null,
  };
}

function randomLoadout() {
  for (;;) {
    const out = [];
    while (out.length < SLOT_COUNT) {
      const id = pick(SPELL_IDS);
      if (!out.includes(id)) out.push(id);
    }
    if (loadoutCost(out) <= LOADOUT_BUDGET) return out;
  }
}

/** Everyone has the same stats: the model is only the body style of the player's look. */
function applyModel(p, key) {
  const m = MODELS[key] || MODELS[DEFAULT_MODEL];
  p.model = MODELS[key] ? key : DEFAULT_MODEL;
  p.maxHp = m.hp;
  p.speed = m.speed;
  p.healMult = m.healMult || 1;
  p.hp = p.maxHp;
}

function clearStatuses(p) {
  p.rootT = 0; p.slowT = 0; p.burnT = 0; p.bleedT = 0; p.burnSrc = null; p.bleedSrc = null;
  p.bleedBuffT = 0; p.bindBuffT = 0; p.invulnT = 0; p.markT = 0; p.markTeam = -9; p.overT = 0; p.polyT = 0;
}

/** Bot difficulty: aim skill range per level (1 = perfect aim and fastest reactions). */
export const BOT_LEVELS = { easy: [0.2, 0.4], normal: [0.55, 0.85], hard: [0.86, 0.96], insane: [0.985, 1] };
export const BOT_LEVEL_IDS = Object.keys(BOT_LEVELS);
const botSkill = (level) => { const r = BOT_LEVELS[level] || BOT_LEVELS.normal; return rand(r[0], r[1]); };

const newMs = () => ({ shots: 0, hits: 0, heads: 0, dmg: 0, casts: 0, streak: 0, best: 0 }); // per-match recap numbers

function makePlayer(team, slot, isBot, name, level = 'normal') {
  const p = {
    id: nextId++, team, slot, isBot, ws: null, name,
    x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, dvx: 0, dvz: 0, dashT: 0,
    yaw: 0, pitch: 0, alive: true,
    model: DEFAULT_MODEL, look: sanitizeLook(null), maxHp: 150, speed: 7, healMult: 1, hp: 150,
    loadout: randomLoadout(), cd: [0, 0, 0], armed: -1, fireCd: 0, sKills: 0, sDeaths: 0, dHeads: 0, dDmg: 0, dCasts: 0,
    credit: CREDIT_MAX, rttMs: null, strikes: {}, flagT: {}, kicked: false, dyawHist: [], aimLog: [], spawnTick: 0, ammo: AMMO_START, shieldT: 0,
    lastSeq: 0, lastQueued: 0, queue: [], lastInput: NEUTRAL(),
    kills: 0, deaths: 0, lastHurt: -99, respawnT: 0, invulnT: 0,
    hist: [], // recent positions {n,x,y,z} for lag compensation
    ai: newAI(), skill: botSkill(level), ms: newMs(),
  };
  clearStatuses(p);
  if (isBot) { p.look = randomLook(); applyModel(p, p.look.model); }
  return p;
}

export class Room {
  constructor(mode, mapId = DEFAULT_MAP, opts = {}) {
    this.mode = mode;
    this.mapId = MAPS[mapId] ? mapId : DEFAULT_MAP;
    this.ranked = !!opts.ranked;
    this.botLevel = !opts.ranked && BOT_LEVELS[opts.bots] ? opts.bots : 'normal'; // ranked always uses normal bots
    this.onMatchEnd = opts.onMatchEnd || null; // (room, winnerTeam) when a ranked match ends
    this.onLeave = opts.onLeave || null;       // (room, player) just before a human is replaced by a bot
    this.onStats = opts.onStats || null;       // (room, winnerTeam) at the end of every match (account stats / XP)
    this.noStats = !!opts.noStats;             // practice range: nothing counts
    this.onRivalKill = opts.onRivalKill || null; // (room, killer, victim) human vs human, different teams
    this.onFlag = opts.onFlag || null;         // (room, player, kind, detail, 'flag'|'kick') suspicious client behaviour
    this.onForfeit = opts.onForfeit || null;   // (room, player) when a human leaves a ranked match early
    this.ffa = mode === 'ffa';
    this.private = !!opts.private; // custom practice match: solo room, never matched into by Quick Play, no stats
    this.custom = opts.custom ? cleanCustom(opts.custom) : null;
    if (this.custom) this.noStats = true;
    this.winRounds = this.custom ? this.custom.rounds : WIN_ROUNDS;
    this.roundTime = this.custom ? this.custom.time : ROUND_TIME;
    this.ffaTime = this.custom ? this.custom.time : FFA_TIME;
    this.ffaKills = this.custom ? this.custom.kills : FFA_KILLS;
    this.skillsOn = !this.custom || this.custom.skills;
    this.infAmmo = !!(opts.range || (this.custom && this.custom.inf));
    this.hsOnly = !!(this.custom && this.custom.hs);
    this.range = !!opts.range; // solo practice: harmless moving dummies, infinite ammo, never ends
    this.size = this.range ? RANGE_PLAYERS : this.ffa ? FFA_PLAYERS : mode;
    this.players = [];
    this.zones = [];
    this.decoys = [];
    this.phase = 'countdown';
    this.phaseT = 5;
    this.roundT = this.ffa ? this.ffaTime : this.roundTime;
    this.scores = [0, 0];
    this.round = 1;
    this.lastWinner = -1;
    this.winner = -1;
    this.events = [];
    this.tick = 0;
    this.time = 0;
    this.emptyT = 0;
    if (this.range) this.noStats = true;
    this.specs = new Set(); // spectator sockets (watch only, no player)
    if (this.ffa) {
      // free-for-all: every player is their own team (team === slot), so "enemy" simply means "someone else"
      for (let i = 0; i < this.size; i++) this.players.push(makePlayer(i, i, true, BOT_NAMES[botNameIdx++ % BOT_NAMES.length], this.botLevel));
    } else {
      for (const team of [0, 1]) {
        for (let i = 0; i < this.size; i++) {
          this.players.push(makePlayer(team, i, true, BOT_NAMES[botNameIdx++ % BOT_NAMES.length], this.botLevel));
        }
      }
    }
    if (this.range) { this.phaseT = 2; this.roundT = 1e9; this.players.forEach((p, i) => { p.dummy = true; p.name = `Target ${i + 1}`; }); }
    this.resetRound();
  }

  humans() { return this.players.filter((p) => !p.isBot); }
  hasBot() { return this.players.some((p) => p.isBot); }

  // -------------------------------------------------------------- membership
  /** opts.team: 0/1 = that team only, anything else = whichever team has fewer humans. */
  addHuman(ws, name, loadout, model, opts = {}) {
    const humanCount = [0, 0];
    for (const p of this.players) if (!p.isBot) humanCount[p.team]++;
    let order = humanCount[0] <= humanCount[1] ? [0, 1] : [1, 0];
    if (opts.team === 0 || opts.team === 1) order = [opts.team];
    if (this.ffa) order = [-1];
    for (const team of order) {
      const bot = this.players.find((p) => p.isBot && (this.ffa || p.team === team));
      if (bot) {
        bot.isBot = false;
        bot.dummy = false;
        bot.ws = ws;
        bot.name = name;
        bot.loadout = loadout;
        bot.look = sanitizeLook({ ...(opts.look || {}), model });
        applyModel(bot, bot.look.model);
        clearStatuses(bot);
        bot.queue = [];
        bot.lastSeq = 0;
        bot.lastQueued = 0;
        bot.cd = [0, 0, 0];
        bot.kills = 0;
        bot.deaths = 0;
        bot.ms = newMs();
        bot.uid = opts.uid || null;
        bot.pf = opts.pf || null; // [icon, title, titleColour, nameColour] the account is allowed to show
        bot.credit = CREDIT_MAX; bot.rttMs = null; bot.strikes = {}; bot.flagT = {}; bot.kicked = false; bot.aimLog = [];
        bot.rating = opts.rating || 1000;
        bot.startRating = bot.rating;
        this.emptyT = 0;
        return bot;
      }
    }
    return null;
  }

  /** Open slots a human could take on each team: [team0, team1]. */
  openSlots() {
    const o = [0, 0];
    for (const p of this.players) if (p.isBot) o[this.ffa ? 0 : p.team]++;
    return o;
  }

  /** Apply a champion / skill re-pick (only during the post-match window). */
  setPick(p, model, loadout) {
    if (this.phase !== 'matchEnd' || p.isBot) return false;
    const out = [];
    if (Array.isArray(loadout)) for (const id of loadout) if (SPELLS[id] && !out.includes(id) && out.length < SLOT_COUNT) out.push(id);
    if (out.length === SLOT_COUNT && loadoutCost(out) <= LOADOUT_BUDGET) p.nextLoadout = out;
    return true;
  }

  /** PLAY AGAIN vote during the post-match window. */
  setRematch(p) {
    if (this.phase !== 'matchEnd' || p.isBot) return false;
    p.rematch = true;
    return true;
  }

  removeHuman(p) {
    if (this.onLeave) this.onLeave(this, p);
    if (this.ranked && this.onForfeit && p.uid && this.phase !== 'matchEnd' && this.winner < 0) this.onForfeit(this, p);
    p.uid = null;
    p.pf = null;
    p.isBot = true;
    p.ws = null;
    p.name = BOT_NAMES[botNameIdx++ % BOT_NAMES.length];
    p.ai = newAI();
    p.skill = botSkill(this.botLevel);
    p.queue = [];
  }

  queueInput(p, m) {
    const n = (v, lo, hi) => clamp(Number.isFinite(+v) ? +v : 0, lo, hi);
    const seq = m.seq | 0;
    if (seq <= p.lastQueued) return;
    p.lastQueued = seq;
    p.queue.push({
      seq,
      mx: n(m.mx, -1, 1), mz: n(m.mz, -1, 1),
      yaw: n(m.yaw, -1e4, 1e4), pitch: n(m.pitch, -1.55, 1.55),
      jump: !!m.jump, crouch: !!m.crouch, shoot: !!m.shoot, q: !!m.q, e: !!m.e, r: !!m.r,
      vt: Number.isFinite(+m.vt) ? +m.vt : 0, // server tick the shooter was looking at
    });
    if (p.queue.length > 20) { p.queue.shift(); this.strike(p, 'flood', 10, 150, 600, 'sending inputs faster than real time'); }
  }

  /** Count a suspicious event; flag it (and eventually ask to kick) when it keeps happening inside a time window. */
  strike(p, kind, windowSec, flagAt, kickAt, detail) {
    if (p.isBot || this.range) return;
    const arr = p.strikes[kind] || (p.strikes[kind] = []);
    const t = this.time;
    arr.push(t);
    while (arr.length && arr[0] < t - windowSec) arr.shift();
    if (arr.length >= flagAt && t - (p.flagT[kind] === undefined ? -999 : p.flagT[kind]) > 30) {
      p.flagT[kind] = t;
      if (this.onFlag) this.onFlag(this, p, kind, detail, 'flag');
    }
    if (arr.length >= kickAt && !p.kicked) {
      p.kicked = true;
      if (this.onFlag) this.onFlag(this, p, kind, detail, 'kick');
    }
  }

  /** Rewind limit for a shot: what this player's measured round trip could really explain (plus a margin). */
  clampVt(p, vt) {
    if (!(vt > 0)) return vt;
    const rtt = p.rttMs == null ? 150 : p.rttMs;
    const back = Math.min(MAX_REWIND, Math.ceil(rtt * 0.06) + 10);
    return Math.max(vt, this.tick - back);
  }

  /** Aim statistics: a long run of near-perfect headshots is logged for a human to look at (never an automatic ban). */
  aimStat(p, hit) {
    p.aimLog.push(hit ? (hit.head ? 2 : 1) : 0);
    if (p.aimLog.length >= 20) {
      const hits = p.aimLog.filter((v) => v > 0).length, heads = p.aimLog.filter((v) => v === 2).length;
      p.aimLog.length = 0;
      if (hits >= 19 && heads >= 14) { if (this.onFlag) this.onFlag(this, p, 'aim', `${hits}/20 hits, ${heads} headshots`, 'flag'); }
    }
    if (hit && this.tick - p.spawnTick > 60) {
      const mx = Math.max(0, ...p.dyawHist);
      if (mx > 2.2) this.strike(p, 'snap', 600, 4, 1e9, `view snapped ${mx.toFixed(1)} rad right before a hit`);
    }
  }

  // -------------------------------------------------------------- rounds
  resetRound() {
    useMap(this.mapId);
    for (const p of this.players) {
      let sp;
      if (this.ffa) {
        const f = ffaSpawn(p.slot * 2 + 1); // spread the starting spots around the map
        sp = { x: f.x, z: f.z, yaw: Math.atan2(f.x, f.z) };
      } else sp = spawnPoint(p.team, p.slot);
      p.respawnT = 0;
      p.x = sp.x; p.y = 0; p.z = sp.z;
      p.vx = p.vy = p.vz = 0; p.crouch = false;
      p.dvx = p.dvz = 0; p.dashT = 0;
      p.yaw = sp.yaw; p.pitch = 0; p.spawnTick = this.tick; p.dyawHist.length = 0;
      p.hp = p.maxHp; p.alive = true;
      p.cd = [0, 0, 0]; p.armed = -1; p.fireCd = 0; p.ammo = AMMO_START; p.shieldT = 0;
      clearStatuses(p);
      p.queue = [];
      p.hist = [];
      p.lastInput = NEUTRAL();
      p.lastInput.yaw = p.yaw;
      p.ai = newAI();
      p.ai.lx = p.x; p.ai.lz = p.z;
    }
    this.zones = [];
    this.decoys = [];
    this.roundT = this.ffa ? this.ffaTime : this.roundTime;
  }

  endRound(w) {
    if (w >= 0) this.scores[w]++;
    this.lastWinner = w;
    this.events.push({ k: 'round', w });
    if (w >= 0 && this.scores[w] >= this.winRounds) {
      this.phase = 'matchEnd';
      this.phaseT = MATCH_END_TIME;
      this.winner = w;
      if (this.ranked && this.onMatchEnd) this.onMatchEnd(this, w);
      if (this.onStats && !this.noStats) this.onStats(this, w);
    } else {
      this.phase = 'roundEnd';
      this.phaseT = 3.5;
    }
  }

  /** FFA: finish the match; the winner is the player with the most kills (fewest deaths breaks ties). */
  endFfa() {
    let best = null;
    for (const p of this.players) {
      if (!best || p.kills > best.kills || (p.kills === best.kills && p.deaths < best.deaths)) best = p;
    }
    this.winner = best ? best.team : -1;
    this.lastWinner = this.winner;
    this.phase = 'matchEnd';
    this.phaseT = MATCH_END_TIME;
    this.events.push({ k: 'round', w: this.winner });
    if (this.onStats && !this.noStats) this.onStats(this, this.winner);
  }

  /** FFA: bring a dead player back at the spawn point farthest from living enemies. */
  respawn(p) {
    const n = ffaSpawnCount();
    const cands = [];
    for (let i = 0; i < n; i++) {
      const f = ffaSpawn(i);
      let nearest = Infinity;
      for (const o of this.players) if (o !== p && o.alive) nearest = Math.min(nearest, Math.hypot(o.x - f.x, o.z - f.z));
      cands.push({ f, score: nearest });
    }
    cands.sort((a, b) => b.score - a.score);
    const c = pick(cands.slice(0, Math.min(3, cands.length))).f;
    p.x = c.x; p.y = 0; p.z = c.z;
    p.vx = p.vy = p.vz = 0; p.dvx = p.dvz = 0; p.dashT = 0; p.crouch = false;
    p.yaw = Math.atan2(c.x, c.z); p.pitch = 0; p.spawnTick = this.tick; p.dyawHist.length = 0;
    p.hp = p.maxHp; p.alive = true; p.fireCd = 0; p.ammo = AMMO_START;
    clearStatuses(p);
    p.invulnT = this.range ? 0 : SPAWN_PROTECT; p.shieldT = this.range ? 0 : SPAWN_PROTECT;
    p.hist = [];
    p.queue = [];
    p.ai = newAI(); p.ai.lx = p.x; p.ai.lz = p.z;
    this.events.push({ k: 'respawn', v: p.id });
  }

  // -------------------------------------------------------------- tick
  step() {
    useMap(this.mapId);
    useNav(this.mapId);
    this.tick++;
    this.time += DT;
    const dt = DT;

    if (this.phase !== 'live') {
      if (this.phase === 'matchEnd' && this.phaseT > REMATCH_GO) { // everyone pressed PLAY AGAIN: skip the rest of the wait
        const hs = this.humans();
        if (hs.length && hs.every((h) => h.rematch)) this.phaseT = REMATCH_GO;
      }
      this.phaseT -= dt;
      if (this.phaseT <= 0) {
        if (this.phase === 'countdown') {
          this.phase = 'live';
          this.phaseT = 0;
        } else if (this.phase === 'roundEnd') {
          this.round++;
          this.resetRound();
          this.phase = 'countdown';
          this.phaseT = 3;
        } else if (this.phase === 'matchEnd') {
          this.scores = [0, 0];
          this.round = 1;
          this.winner = -1;
          this.lastWinner = -1;
          for (const p of this.players) {
            p.kills = 0; p.deaths = 0; p.rematch = false; p.ms = newMs();
            if (p.nextLoadout) { p.loadout = p.nextLoadout; p.nextLoadout = null; }
            if (p.isBot) { p.look = randomLook(); applyModel(p, p.look.model); p.loadout = randomLoadout(); }
            if (!p.isBot) p.startRating = p.rating; // ratings may have changed at the end of the last match
          }
          this.resetRound();
          this.phase = 'countdown';
          this.phaseT = 5;
        }
      }
    }

    for (const p of this.players) {
      p.fireCd = Math.max(0, p.fireCd - dt);
      for (let s = 0; s < SLOT_COUNT; s++) p.cd[s] = Math.max(0, p.cd[s] - dt);
      p.shieldT = Math.max(0, p.shieldT - dt);
      p.bleedBuffT = Math.max(0, p.bleedBuffT - dt);
      p.invulnT = Math.max(0, p.invulnT - dt);
      p.bindBuffT = Math.max(0, p.bindBuffT - dt);
      p.overT = Math.max(0, p.overT - dt);
      p.markT = Math.max(0, p.markT - dt);
      p.polyT = Math.max(0, p.polyT - dt);

      if (this.ffa && this.phase === 'live' && !p.alive) {
        p.respawnT -= dt;
        if (p.respawnT <= 0) this.respawn(p);
      }

      if (this.phase === 'countdown') {
        if (p.queue.length) {
          p.lastSeq = p.queue[p.queue.length - 1].seq;
          p.queue.length = 0;
        }
        continue;
      }
      if (p.isBot) {
        if (!p.alive) continue;
        const inp = this.phase === 'live' ? (p.dummy ? dummyThink(this, p, dt) : botThink(this, p, dt)) : NEUTRAL();
        if (this.phase !== 'live') inp.yaw = p.yaw;
        this.applyInput(p, inp, dt);
      } else {
        p.credit = Math.min(CREDIT_MAX, p.credit + CREDIT_REFILL);
        let n = 0;
        while (p.queue.length && n < 8 && p.credit >= 1) {
          p.credit -= 1;
          const inp = p.queue.shift();
          p.lastSeq = inp.seq;
          n++;
          if (p.alive) this.applyInput(p, inp, DT);
        }
      }
    }

    if (this.phase === 'live') {
      this.tickZones(dt);
      this.tickStatuses(dt);

      this.roundT -= dt;
      if (this.ffa) {
        let top = 0;
        for (const p of this.players) top = Math.max(top, p.kills);
        if (!this.range && (top >= this.ffaKills || this.roundT <= 0)) this.endFfa();
      } else {
        const alive = [0, 0];
        const hp = [0, 0];
        for (const p of this.players) if (p.alive) { alive[p.team]++; hp[p.team] += p.hp; }
        if (alive[0] === 0 || alive[1] === 0 || this.roundT <= 0) {
          let w = -1;
          if (alive[0] === 0 && alive[1] === 0) w = -1;
          else if (alive[1] === 0) w = 0;
          else if (alive[0] === 0) w = 1;
          else if (hp[0] !== hp[1]) w = hp[0] > hp[1] ? 0 : 1;
          this.endRound(w);
        }
      }
    } else {
      if (this.zones.length) this.zones.length = 0;
      if (this.decoys.length) this.decoys.length = 0;
    }

    // Record positions so shots can be rewound to what the shooter saw.
    for (const p of this.players) {
      p.hist.push({ n: this.tick, x: p.x, y: p.y, z: p.z, crouch: p.crouch ? 1 : 0 });
      if (p.hist.length > MAX_REWIND + 16) p.hist.shift();
    }

    // (the server clears `events` after every snapshot broadcast, humans or not)
    if (!this.players.some((p) => !p.isBot)) this.emptyT += dt;
  }

  applyInput(p, inp, dt) {
    p.lastInput = inp;
    if (!p.isBot) { p.dyawHist.push(Math.abs(angDiff(inp.yaw, p.yaw))); if (p.dyawHist.length > 4) p.dyawHist.shift(); }
    stepPlayer(p, inp, dt);
    p.yaw = inp.yaw;
    p.pitch = inp.pitch;
    if (this.phase !== 'live' || !p.alive || p.polyT > 0) { p.armed = -1; return; } // polymorphed: no shooting, no skills
    if (!p.isBot) {
      inp.vt = this.clampVt(p, inp.vt);
      if (inp.shoot && p.fireCd > FIRE_INTERVAL * 0.35) this.strike(p, 'rapid', 10, 6, 25, 'firing while the weapon is still reloading');
    }
    // skill keys first, so a key and a click that arrive together act in the order the player meant
    for (let s = 0; s < SLOT_COUNT; s++) {
      if (!inp[SLOT_FLAG[s]] || !this.skillsOn) continue;
      const sp = SPELLS[p.loadout[s]];
      if (sp && sp.aim && !p.isBot) { // aimed skill: the key arms it (press again to put it away), the next shot fires it
        if (p.armed === s) p.armed = -1;
        else if (p.cd[s] <= 0) p.armed = s;
      } else if (p.cd[s] <= 0) this.cast(p, s, inp);
    }
    // small tolerance: semi-auto clients send one shot per click, so a packet landing a tick early must not be dropped
    if (inp.shoot && p.fireCd <= FIRE_TOLERANCE) {
      if (p.armed >= 0) this.fireArmed(p, inp);
      else if (p.ammo > 0 || this.infAmmo) this.shoot(p, inp);
    }
  }

  /** The shot that carries an armed skill: costs the shot cooldown but no ammo; the skill itself lands where the shot lands. */
  fireArmed(p, inp) {
    const slot = p.armed;
    p.armed = -1;
    if (!SPELLS[p.loadout[slot]] || p.cd[slot] > 0) return;
    p.fireCd = FIRE_INTERVAL;
    const [dx, dy, dz] = lookDir(inp.yaw, inp.pitch);
    const ox = p.x, oy = p.y + eyeH(p), oz = p.z;
    const tWall = Math.min(rayWalls(ox, oy, oz, dx, dy, dz, RANGE), RANGE);
    const best = this.firstEnemyHit(p, ox, oy, oz, dx, dy, dz, tWall, inp.vt);
    let t = best ? best.t : tWall;
    if (!best && dy < 0) t = Math.min(t, -oy / dy);
    this.events.push({ k: 'shot', id: p.id, ox: r2(ox), oy: r2(oy), oz: r2(oz), ex: r2(ox + dx * t), ey: r2(oy + dy * t), ez: r2(oz + dz * t), hit: 0, sk: p.loadout[slot] });
    this.cast(p, slot, inp, true);
  }

  /** Where a shot from `p` lands on the ground/wall (pulled back a little so things placed there are not inside a wall). */
  landing(p, inp, range) {
    const [dx, dy, dz] = lookDir(inp.yaw, inp.pitch);
    const ox = p.x, oy = p.y + eyeH(p), oz = p.z;
    let t = Math.min(rayWorld(ox, oy, oz, dx, dy, dz, range), range);
    if (!Number.isFinite(t)) t = range;
    const hl = Math.hypot(dx, dz) || 1;
    const back = Math.min(0.7, t);
    const spot = { x: clamp(ox + dx * t - (dx / hl) * back, -ARENA + 1, ARENA - 1), y: 0, z: clamp(oz + dz * t - (dz / hl) * back, -ARENA + 1, ARENA - 1), vx: 0, vz: 0, vy: 0 };
    resolveWalls(spot);
    return spot;
  }

  // -------------------------------------------------------------- status effects
  tickZones(dt) {
    for (const z of this.zones) {
      z.t -= dt;
      if (z.t <= 0 || z.kind === 'smoke') continue;
      if (z.kind === 'trap') {
        if (z.arm > 0) { z.arm -= dt; continue; }
        for (const o of this.players) {
          if (!o.alive || o.team === z.team || o.y > 1.4 || Math.hypot(o.x - z.x, o.z - z.z) > z.r) continue;
          o.slowT = Math.max(o.slowT, TRAP_SLOW);
          z.t = 0;
          this.events.push({ k: 'trapped', v: o.id, x: r2(z.x), z: r2(z.z) });
          break;
        }
        continue;
      }
      if (z.kind === 'well') {
        for (const o of this.players) {
          if (!o.alive || o.y > 3) continue;
          const wx = z.x - o.x, wz = z.z - o.z, d = Math.hypot(wx, wz);
          if (d > z.r || d < 0.4) continue;
          const step = Math.min(WELL_PULL * dt * (o.team === z.team ? 0.5 : 1), d - 0.3);
          o.x += (wx / d) * step; o.z += (wz / d) * step;
          resolveWalls(o);
          if (o.team !== z.team) o.slowT = Math.max(o.slowT, 0.3);
        }
        continue;
      }
      for (const o of this.players) {
        if (!o.alive || o.team === z.team) continue;
        if (o.y < 1.2 && Math.hypot(o.x - z.x, o.z - z.z) < z.r) this.ignite(o, z.src, BURN_LINGER);
      }
    }
    this.zones = this.zones.filter((z) => z.t > 0);
    for (const d of this.decoys) {
      d.t -= dt;
      d.x += -Math.sin(d.yaw) * DECOY_SPEED * dt;
      d.z += -Math.cos(d.yaw) * DECOY_SPEED * dt;
      resolveWalls(d);
    }
    this.decoys = this.decoys.filter((d) => d.t > 0);
  }

  tickStatuses(dt) {
    for (const p of this.players) {
      if (!p.alive) continue;
      for (const h of HAZARDS) {
        if (p.y < 1.0 && Math.hypot(p.x - h.x, p.z - h.z) < h.r) this.ignite(p, null, HAZARD_BURN);
      }
      if (p.burnT > 0) {
        p.burnT -= dt;
        this.dot(p, BURN_DPS * dt, p.burnSrc);
      }
      if (p.alive && p.bleedT > 0) {
        p.bleedT -= dt;
        const moving = Math.hypot(p.vx, p.vz) > 1;
        this.dot(p, BLEED_DPS * (moving ? BLEED_MOVING_MULT : 1) * dt, p.bleedSrc);
      }
    }
  }

  ignite(victim, src, time) {
    victim.burnT = Math.max(victim.burnT, time);
    victim.burnSrc = src;
  }

  addZone(owner, x, z, r, dur, kind) {
    const zone = { id: nextZoneId++, x, z, r, t: dur, max: dur, team: owner.team, src: owner, kind };
    this.zones.push(zone);
    return zone;
  }

  /** Damage over time: no hit marker, but kills are credited to the source. */
  dot(victim, amount, src) {
    if (!victim.alive || victim.invulnT > 0) return;
    victim.hp -= amount;
    victim.lastHurt = this.time;
    if (victim.hp <= 0) this.kill(victim, src || victim, false);
  }

  kill(victim, attacker, head) {
    victim.hp = 0;
    victim.alive = false; victim.armed = -1;
    victim.deaths++;
    victim.sDeaths++;
    victim.ms.streak = 0;
    victim.respawnT = RESPAWN_TIME;
    if (attacker !== victim) {
      attacker.kills++;
      if (attacker.team !== victim.team) { attacker.ms.streak++; attacker.ms.best = Math.max(attacker.ms.best, attacker.ms.streak); }
      if (attacker.team !== victim.team && !victim.isBot) attacker.sKills++; // bot kills are worth no stats/XP
      if (attacker.team !== victim.team && !attacker.isBot && !victim.isBot && attacker.uid && victim.uid && this.onRivalKill && !this.noStats) this.onRivalKill(this, attacker, victim);
      if (attacker.team !== victim.team) attacker.ammo = Math.min(AMMO_MAX, attacker.ammo + AMMO_KILL); // a kill refills your ammo
    }
    this.events.push({ k: 'kill', a: attacker.id, v: victim.id, head: head ? 1 : 0, x: r2(victim.x), y: r2(victim.y), z: r2(victim.z) });
  }

  // -------------------------------------------------------------- combat
  shoot(p, inp) {
    p.fireCd = FIRE_INTERVAL;
    if (!this.infAmmo) p.ammo--;
    const bindShot = p.bindBuffT > 0; // Bind: this shot roots whoever it hits (used up even on a miss)
    p.bindBuffT = 0;
    const over = p.overT > 0; // Overcharge: this shot deals double damage (used up even on a miss)
    p.overT = 0;
    const [dx, dy, dz] = lookDir(inp.yaw, inp.pitch);
    const ox = p.x, oy = p.y + eyeH(p), oz = p.z;
    const tWall = Math.min(rayWalls(ox, oy, oz, dx, dy, dz, RANGE), RANGE);
    const best = this.firstEnemyHit(p, ox, oy, oz, dx, dy, dz, tWall, inp.vt);
    p.ms.shots++;
    if (best && !best.decoy) { p.ms.hits++; if (best.head) p.ms.heads++; }
    if (!p.isBot) this.aimStat(p, best && !best.decoy ? best : null);
    let t = best ? best.t : tWall;
    if (!best && dy < 0) t = Math.min(t, -oy / dy); // floor
    this.events.push({
      k: 'shot', id: p.id, ox: r2(ox), oy: r2(oy), oz: r2(oz),
      ex: r2(ox + dx * t), ey: r2(oy + dy * t), ez: r2(oz + dz * t), hit: best ? 1 : 0, bd: bindShot ? 1 : 0, oc: over ? 1 : 0,
    });
    if (best && best.decoy) { // the shot is wasted on a decoy; it pops
      this.decoys = this.decoys.filter((d) => d !== best.who);
      this.events.push({ k: 'decoypop', x: r2(best.who.x), y: r2(best.who.y), z: r2(best.who.z) });
    } else if (best) {
      if (bindShot) {
        const v = best.who;
        v.rootT = BIND_TIME;
        v.vx = 0; v.vz = 0; v.dashT = 0; v.dvx = 0; v.dvz = 0;
        this.events.push({ k: 'bound', v: v.id });
      }
      this.damage(best.who, this.hsOnly && !best.head ? 0 : (best.head ? HEAD_DMG : BODY_DMG) * (over ? OVER_MULT : 1), p, best.head, over ? 'oc' : bindShot ? 'bd' : p.bleedBuffT > 0 ? 'bl' : '');
      this.onRifleHit(p, best.who);
    }
  }

  /** Nearest living enemy along the ray (enemies rewound to the shooter's view time). */
  firstEnemyHit(p, ox, oy, oz, dx, dy, dz, maxT, vt, radius) {
    let best = null;
    for (const o of this.players) {
      if (o.team === p.team || !o.alive) continue;
      const r = rayPlayer(ox, oy, oz, dx, dy, dz, this.rewound(o, vt), radius);
      if (r && r.t < maxT && (!best || r.t < best.t)) best = { t: r.t, head: r.head, who: o };
    }
    if (radius === undefined) { // rifle shots can also hit enemy decoys (Shockwave passes through them)
      for (const d of this.decoys) {
        if (d.team === p.team) continue;
        const r = rayPlayer(ox, oy, oz, dx, dy, dz, d);
        if (r && r.t < maxT && (!best || r.t < best.t)) best = { t: r.t, head: false, who: d, decoy: true };
      }
    }
    return best;
  }

  /** On-hit effects from Barbed Rounds. */
  onRifleHit(p, v) {
    if (!v.alive) return;
    if (p.bleedBuffT > 0) { v.bleedT = BLEED_TIME; v.bleedSrc = p; }
  }

  /** Where player `o` was at (fractional) server tick `vt`; falls back to now when vt is missing. */
  rewound(o, vt) {
    if (!(vt > 0)) return o;
    const t = clamp(vt, this.tick - MAX_REWIND, this.tick);
    const h = o.hist;
    for (let i = h.length - 1; i >= 0; i--) {
      if (h[i].n <= t) {
        const a = h[i], b = h[i + 1];
        if (b && b.n > a.n) {
          const f = (t - a.n) / (b.n - a.n);
          return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, z: a.z + (b.z - a.z) * f, crouch: a.crouch };
        }
        return a;
      }
    }
    return h.length ? h[0] : o;
  }

  damage(victim, amount, attacker, head, tag) {
    if (!victim.alive || victim.invulnT > 0) return;
    if (victim.shieldT > 0) amount *= 0.6; // Shield: 40% less damage
    if (attacker !== victim && attacker.team !== victim.team && !victim.isBot) { // daily-challenge tallies (bots are worth nothing)
      attacker.dDmg += Math.max(0, Math.min(amount, victim.hp));
      if (head) attacker.dHeads++;
    }
    if (attacker !== victim && attacker.team !== victim.team) attacker.ms.dmg += Math.max(0, Math.min(amount, victim.hp));
    victim.hp -= amount;
    victim.lastHurt = this.time;
    if (attacker !== victim) { victim.lastAtkId = attacker.id; victim.lastAtkT = this.time; }
    const tg = tag === 'oc' || tag === 'bd' ? tag : victim.shieldT > 0 ? 'sh' : tag; // what kind of hit it was, for the sound
    this.events.push({ k: 'hit', a: attacker.id, v: victim.id, dmg: Math.round(amount), head: head ? 1 : 0, ...(tg ? { tg } : {}) });
    if (victim.hp <= 0) this.kill(victim, attacker, head);
  }

  cast(p, slot, inp, aimed = false) {
    const id = p.loadout[slot];
    const spell = SPELLS[id];
    if (!spell) return;
    p.cd[slot] = spell.cd;
    p.dCasts++;
    p.ms.casts++;
    const ev = { k: 'spell', id: p.id, s: id, x: r2(p.x), y: r2(p.y), z: r2(p.z) };
    const [dx, dy, dz] = lookDir(inp.yaw, inp.pitch);
    const ox = p.x, oy = p.y + eyeH(p), oz = p.z;

    switch (id) {
      case 'dash': {
        const s = Math.sin(inp.yaw), c = Math.cos(inp.yaw);
        let wx = -s * inp.mz + c * inp.mx, wz = -c * inp.mz - s * inp.mx;
        const l = Math.hypot(wx, wz);
        if (l < 0.01) { wx = -s; wz = -c; } else { wx /= l; wz /= l; }
        p.dvx = wx * 30; p.dvz = wz * 30; p.dashT = 0.2;
        break;
      }
      case 'shield':
        p.shieldT = 2.5;
        break;
      case 'heal':
        p.hp = Math.min(p.maxHp, p.hp + 50 * p.healMult);
        break;
      case 'shockwave': { // aimed shot: pushes the first enemy hit straight back, no damage
        const tWall = Math.min(rayWalls(ox, oy, oz, dx, dy, dz, SHOCK_RANGE), SHOCK_RANGE);
        const best = this.firstEnemyHit(p, ox, oy, oz, dx, dy, dz, tWall, inp.vt, SHOCK_RADIUS);
        let t = best ? best.t : tWall;
        if (!best && dy < 0) t = Math.min(t, -oy / dy);
        if (best) {
          const v = best.who;
          const hl = Math.hypot(dx, dz) || 1;
          v.dvx = (dx / hl) * SHOCK_PUSH; v.dvz = (dz / hl) * SHOCK_PUSH; v.dashT = 0.3; v.vy = 4;
          this.events.push({ k: 'pushed', v: v.id });
        }
        ev.ox = r2(ox); ev.oy = r2(oy); ev.oz = r2(oz);
        ev.ex = r2(ox + dx * t); ev.ey = r2(oy + dy * t); ev.ez = r2(oz + dz * t);
        ev.hit = best ? 1 : 0;
        break;
      }
      case 'pushback': { // radial blast: shoves every enemy within range away from you, no damage
        let n = 0;
        for (const o of this.players) {
          if (o.team === p.team || !o.alive) continue;
          let ddx = o.x - p.x, ddz = o.z - p.z;
          const dd = Math.hypot(ddx, ddz);
          if (dd > PUSHBACK_RADIUS || Math.abs(o.y - p.y) > 3) continue;
          if (dd < 0.05) { ddx = -Math.sin(inp.yaw); ddz = -Math.cos(inp.yaw); } else { ddx /= dd; ddz /= dd; }
          o.dvx = ddx * PUSHBACK_FORCE; o.dvz = ddz * PUSHBACK_FORCE; o.dashT = 0.3; o.vy = 3;
          o.rootT = 0;
          this.events.push({ k: 'pushed', v: o.id });
          n++;
        }
        ev.r = PUSHBACK_RADIUS;
        ev.n = n;
        break;
      }
      case 'bind': p.bindBuffT = BUFF_TIME; break; // next rifle shot roots its target
      case 'firepool': {
        let t = Math.min(rayWorld(ox, oy, oz, dx, dy, dz, POOL_RANGE), POOL_RANGE);
        if (!Number.isFinite(t)) t = POOL_RANGE;
        const px = clamp(ox + dx * t, -ARENA + 1, ARENA - 1), pz = clamp(oz + dz * t, -ARENA + 1, ARENA - 1);
        this.addZone(p, px, pz, POOL_RADIUS, POOL_TIME);
        ev.tx = r2(px); ev.tz = r2(pz); ev.r = POOL_RADIUS;
        break;
      }
      case 'nova':
        for (const o of this.players) {
          if (o.team === p.team || !o.alive) continue;
          if (Math.hypot(o.x - p.x, o.z - p.z) > NOVA_RADIUS || Math.abs(o.y - p.y) > 3) continue;
          o.slowT = NOVA_SLOW;
          this.damage(o, NOVA_DMG, p, false, 'nv');
        }
        ev.r = NOVA_RADIUS;
        break;
      case 'barbed': p.bleedBuffT = BUFF_TIME; break;
      case 'blink': {
        const hx = -Math.sin(inp.yaw), hz = -Math.cos(inp.yaw);
        const wall = Math.min(rayWalls(p.x, 0.5, p.z, hx, 0, hz, BLINK_DIST + 1), rayWalls(p.x, 1.3, p.z, hx, 0, hz, BLINK_DIST + 1));
        const dist = Math.max(0, Math.min(BLINK_DIST, wall - PLAYER_R - 0.15));
        ev.fx = ev.x; ev.fz = ev.z;
        p.x += hx * dist; p.z += hz * dist;
        resolveWalls(p);
        p.vx *= 0.3; p.vz *= 0.3;
        ev.x = r2(p.x); ev.z = r2(p.z); ev.tx = ev.x; ev.tz = ev.z;
        break;
      }
      case 'grapple': {
        const t = rayWalls(ox, oy, oz, dx, dy, dz, GRAPPLE_RANGE);
        if (!Number.isFinite(t) || t > GRAPPLE_RANGE) { p.cd[slot] = 1; return; } // nothing to hook: no cooldown spent
        const px = ox + dx * t, py = oy + dy * t, pz = oz + dz * t;
        const hl = Math.hypot(px - p.x, pz - p.z) || 1;
        const move = Math.max(0.1, Math.min(0.55, (hl - 1.3) / GRAPPLE_SPEED));
        p.dvx = ((px - p.x) / hl) * GRAPPLE_SPEED; p.dvz = ((pz - p.z) / hl) * GRAPPLE_SPEED; p.dashT = move;
        p.vy = clamp((py - p.y) * 2.2, 2.5, 9);
        ev.ox = r2(ox); ev.oy = r2(oy - 0.25); ev.oz = r2(oz); ev.ex = r2(px); ev.ey = r2(py); ev.ez = r2(pz);
        break;
      }
      case 'smoke': {
        let t = Math.min(rayWorld(ox, oy, oz, dx, dy, dz, SMOKE_RANGE), SMOKE_RANGE);
        if (!Number.isFinite(t)) t = SMOKE_RANGE;
        const px = clamp(ox + dx * t, -ARENA + 1, ARENA - 1), pz = clamp(oz + dz * t, -ARENA + 1, ARENA - 1);
        this.addZone(p, px, pz, SMOKE_RADIUS, SMOKE_TIME, 'smoke');
        ev.tx = r2(px); ev.tz = r2(pz); ev.r = SMOKE_RADIUS;
        break;
      }
      case 'decoy': {
        const at = aimed ? this.landing(p, inp, PLACE_RANGE) : p;
        this.decoys.push({ id: nextDecoyId++, x: at.x, y: at.y, z: at.z, yaw: inp.yaw, pitch: 0, t: DECOY_TIME, team: p.team, model: p.model, look: p.look, crouch: false, hist: [] });
        ev.tx = r2(at.x); ev.tz = r2(at.z);
        break;
      }
      case 'slowtrap': {
        const at = aimed ? this.landing(p, inp, PLACE_RANGE) : p;
        const mine = this.zones.filter((z) => z.kind === 'trap' && z.src === p);
        while (mine.length >= TRAP_MAX) { const old = mine.shift(); old.t = 0; }
        this.addZone(p, at.x, at.z, TRAP_R, TRAP_TIME, 'trap').arm = TRAP_ARM;
        ev.tx = r2(at.x); ev.tz = r2(at.z); ev.r = TRAP_R;
        break;
      }
      case 'mark': {
        const tWall = Math.min(rayWalls(ox, oy, oz, dx, dy, dz, MARK_RANGE), MARK_RANGE);
        const best = this.firstEnemyHit(p, ox, oy, oz, dx, dy, dz, tWall, inp.vt, MARK_RADIUS);
        if (!best) { p.cd[slot] = 1; return; } // nobody under the crosshair: no cooldown spent
        best.who.markT = MARK_TIME; best.who.markTeam = p.team;
        this.events.push({ k: 'marked', v: best.who.id });
        break;
      }
      case 'gravity': {
        let t = Math.min(rayWorld(ox, oy, oz, dx, dy, dz, WELL_RANGE), WELL_RANGE);
        if (!Number.isFinite(t)) t = WELL_RANGE;
        const px = clamp(ox + dx * t, -ARENA + 1, ARENA - 1), pz = clamp(oz + dz * t, -ARENA + 1, ARENA - 1);
        this.addZone(p, px, pz, WELL_R, WELL_TIME, 'well');
        ev.tx = r2(px); ev.tz = r2(pz); ev.r = WELL_R;
        break;
      }
      case 'polymorph': {
        const tWall = Math.min(rayWalls(ox, oy, oz, dx, dy, dz, POLY_RANGE), POLY_RANGE);
        const best = this.firstEnemyHit(p, ox, oy, oz, dx, dy, dz, tWall, inp.vt, SHOCK_RADIUS);
        let t = best ? best.t : tWall;
        if (!best && dy < 0) t = Math.min(t, -oy / dy);
        ev.ox = r2(ox); ev.oy = r2(oy); ev.oz = r2(oz);
        ev.ex = r2(ox + dx * t); ev.ey = r2(oy + dy * t); ev.ez = r2(oz + dz * t);
        ev.hit = best ? 1 : 0;
        if (best) {
          const v = best.who;
          v.polyT = POLY_TIME; v.armed = -1; v.bindBuffT = 0; v.bleedBuffT = 0; v.overT = 0;
          this.events.push({ k: 'poly', v: v.id });
        }
        break;
      }
      case 'overcharge': p.overT = BUFF_TIME; break; // next rifle shot deals double damage
      default: break;
    }
    this.events.push(ev);
  }

  // -------------------------------------------------------------- network payloads
  snapshot() {
    return {
      t: 's', n: this.tick, ph: this.phase, pt: r2(this.phaseT), rt: Math.round(this.roundT * 10) / 10,
      rv: this.phase === 'matchEnd' ? this.humans().filter((h) => h.rematch).length : 0, rh: this.humans().length,
      sc: this.scores, rd: this.round, lw: this.lastWinner, w: this.winner, mode: this.mode, ffa: this.ffa ? 1 : 0, kt: this.ffaKills, wr: this.winRounds,
      ...(this.phase === 'matchEnd' ? { rc: this.players.map((p) => ({ id: p.id, sh: p.ms.shots, hi: p.ms.hits, hd: p.ms.heads, dm: Math.round(p.ms.dmg), cs: p.ms.casts, bs: p.ms.best })) } : {}),
      p: this.players.map((p) => ({
        ...(p.pf ? { pf: p.pf } : {}), id: p.id, tm: p.team, n: p.name, b: p.isBot ? 1 : 0, md: p.model, lk: encodeLook(p.look),
        x: r3(p.x), y: r3(p.y), z: r3(p.z), yaw: r3(p.yaw), pit: r3(p.pitch),
        hp: Math.ceil(p.hp), mh: p.maxHp, a: p.alive ? 1 : 0, sh: p.shieldT > 0 ? 1 : 0,
        sf: (p.rootT > 0 ? 1 : 0) | (p.slowT > 0 ? 2 : 0) | (p.burnT > 0 ? 4 : 0) | (p.bleedT > 0 ? 8 : 0) | (p.crouch ? 16 : 0) | (p.polyT > 0 ? 32 : 0),
        bf: (p.bleedBuffT > 0 ? 2 : 0) | (p.overT > 0 ? 4 : 0) | (p.bindBuffT > 0 ? 8 : 0),
        mk: p.markT > 0 ? p.markTeam + 2 : 0, // team that marked this player (+2 so 0 means unmarked)
        k: p.kills, d: p.deaths,
      })),
      zn: this.zones.map((z) => ({ id: z.id, x: r2(z.x), z: r2(z.z), r: z.r, t: r2(z.t), m: z.max, k: z.kind === 'smoke' ? 1 : z.kind === 'trap' ? 2 : z.kind === 'well' ? 3 : 0, tm: z.team })),
      dc: this.decoys.map((d) => ({ id: d.id, tm: d.team, md: d.model, lk: encodeLook(d.look), x: r3(d.x), y: r3(d.y), z: r3(d.z), yaw: r3(d.yaw), pit: 0 })),
      ev: this.events,
    };
  }

  // -------------------------------------------------------------- visibility (anti wall-hack)
  /** Can anyone on `viewer`'s side see enemy `o` (or is it close, marked or the one shooting them)? */
  canReveal(viewer, pov, o) {
    if (o.markT > 0 && o.markTeam === viewer.team) return true; // Mark shows them through walls
    if (viewer.lastAtkId === o.id && this.time - viewer.lastAtkT < (viewer.alive ? KILLER_REVEAL : KILLER_REVEAL + 2)) return true; // whoever just hit you (kill-cam)
    for (const s of pov) {
      const dx = o.x - s.x, dz = o.z - s.z, d = Math.hypot(dx, dz);
      if (d < NEAR_REVEAL) return true;
      const ox = s.x, oy = s.y + eyeH(s), oz = s.z;
      const px = -dz / (d || 1), pz = dx / (d || 1); // sideways, so a body edge sticking out from behind a corner counts
      for (const side of [0, 0.8, -0.8]) {
        for (const h of [1.5, 0.8]) {
          const tx = o.x + px * side, ty = o.y + h, tz = o.z + pz * side;
          const vx = tx - ox, vy = ty - oy, vz = tz - oz, len = Math.hypot(vx, vy, vz) || 1;
          if (rayWalls(ox, oy, oz, vx / len, vy / len, vz / len, len) >= len - 0.05) return true;
        }
      }
    }
    return false;
  }

  /** The snapshot as `viewer` is allowed to know it: enemies they cannot see are sent without their position. */
  viewSnapshot(snap, viewer) {
    if (this.range || !viewer) return snap;
    const mem = viewer.vis || (viewer.vis = new Map());
    const byId = new Map(this.players.map((p) => [p.id, p]));
    const live = this.phase === 'live';
    let pov = [viewer];
    if (!this.ffa) {
      pov = this.players.filter((o) => o.team === viewer.team && o.alive);
      if (!pov.length) pov = [viewer];
    }
    const out = snap.p.map((sp) => {
      const o = byId.get(sp.id);
      const friendly = o === viewer || (!this.ffa && o.team === viewer.team);
      if (friendly || !live || !o.alive || this.canReveal(viewer, pov, o)) {
        mem.set(sp.id, { x: sp.x, y: sp.y, z: sp.z, yaw: sp.yaw, pit: sp.pit, t: this.time });
        return sp;
      }
      const m = mem.get(sp.id);
      if (m && this.time - m.t < VIS_GRACE) return sp; // just stepped out of sight: keep showing them for a moment
      return { ...sp, x: m ? m.x : 0, y: m ? m.y : -50, z: m ? m.z : 0, yaw: m ? m.yaw : 0, pit: 0, sf: 0, sh: 0, bf: 0, mk: 0, hid: 1 };
    });
    const zn = snap.zn.filter((z) => {
      if (z.k !== 2 || z.tm === viewer.team) return true; // enemy mines stay hidden until you walk close
      return Math.hypot(z.x - viewer.x, z.z - viewer.z) < TRAP_REVEAL;
    });
    const dc = snap.dc.filter((d) => {
      if (d.tm === viewer.team && !this.ffa) return true;
      return live ? this.canReveal(viewer, pov, { x: d.x, y: d.y, z: d.z, id: -1 }) : true;
    });
    return { ...snap, p: out, zn, dc };
  }

  meFor(p) {
    return {
      id: p.id, ack: p.lastSeq, ar: p.armed, rs: r2(p.alive ? 0 : Math.max(0, p.respawnT)), am: this.infAmmo ? 99 : p.ammo, cd: p.cd.map((v) => r2(v)), lo: p.loadout, md: p.model,
      st: {
        x: p.x, y: p.y, z: p.z, vx: p.vx, vy: p.vy, vz: p.vz, dvx: p.dvx, dvz: p.dvz, dashT: p.dashT,
        rootT: p.rootT, slowT: p.slowT,
      },
    };
  }
}

// ====================================================================== navigation grid
// 1 m cells; a cell is blocked when a player standing at its centre would touch a wall.
const NAV_CLEAR = 0.6;
const NAV_MAX = 100 * 100; // biggest map is 2 * 48 = 96 cells wide
const navCache = new Map();
let navN = 60, navHalf = 30; // grid width (cells) and half-extent of the current map
let navBlocked = new Uint8Array(navN * navN);
let navMapId = null;
/** Switch the bots' walkability grid to the given map (cached). Called before each room step. */
export function useNav(mapId) {
  if (navMapId === mapId) return;
  navMapId = mapId;
  const half = MAPS[mapId].size, N = half * 2;
  if (!navCache.has(mapId)) {
    const grid = new Uint8Array(N * N);
    const walls = MAPS[mapId].walls, hazards = MAPS[mapId].hazards || [];
    for (let iz = 0; iz < N; iz++) {
      for (let ix = 0; ix < N; ix++) {
        const cx = -half + ix + 0.5, cz = -half + iz + 0.5;
        let b = Math.abs(cx) > half - NAV_CLEAR || Math.abs(cz) > half - NAV_CLEAR;
        if (!b) {
          for (const w of walls) {
            if (cx > w.minX - NAV_CLEAR && cx < w.maxX + NAV_CLEAR && cz > w.minZ - NAV_CLEAR && cz < w.maxZ + NAV_CLEAR) { b = true; break; }
          }
        }
        if (!b) for (const h of hazards) if (Math.hypot(cx - h.x, cz - h.z) < h.r + NAV_CLEAR) { b = true; break; }
        grid[iz * N + ix] = b ? 1 : 0;
      }
    }
    navCache.set(mapId, grid);
  }
  navBlocked = navCache.get(mapId);
  navN = N; navHalf = half;
}
useNav('olympus');
const navCellOf = (x, z) => {
  const ix = clamp(Math.floor(x + navHalf), 0, navN - 1), iz = clamp(Math.floor(z + navHalf), 0, navN - 1);
  return iz * navN + ix;
};
/** Nearest unblocked cell (spiral search) so a bot hugging a wall still has a valid start. */
function navFreeCell(cell) {
  if (!navBlocked[cell]) return cell;
  const cx = cell % navN, cz = Math.floor(cell / navN);
  for (let r = 1; r <= 4; r++) {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const x = cx + dx, z = cz + dz;
        if (x < 0 || z < 0 || x >= navN || z >= navN) continue;
        if (!navBlocked[z * navN + x]) return z * navN + x;
      }
    }
  }
  return cell;
}
const NAV_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
const navQueue = new Int32Array(NAV_MAX);
/** Distance field (in steps) from `goal` over free cells; -1 = unreachable. */
export function navField(goal) {
  const dist = new Int16Array(navN * navN).fill(-1);
  let head = 0, tail = 0;
  goal = navFreeCell(goal);
  dist[goal] = 0;
  navQueue[tail++] = goal;
  while (head < tail) {
    const c = navQueue[head++];
    const cx = c % navN, cz = (c - cx) / navN;
    for (const [dx, dz] of NAV_DIRS) {
      const x = cx + dx, z = cz + dz;
      if (x < 0 || z < 0 || x >= navN || z >= navN) continue;
      const n = z * navN + x;
      if (dist[n] !== -1 || navBlocked[n]) continue;
      if (dx !== 0 && dz !== 0 && (navBlocked[cz * navN + x] || navBlocked[z * navN + cx])) continue; // no corner cutting
      dist[n] = dist[c] + 1;
      navQueue[tail++] = n;
    }
  }
  return dist;
}
/** Is there a walkable route between two points? (used by tests) */
export function navReachable(ax, az, bx, bz) {
  return navField(navCellOf(bx, bz))[navFreeCell(navCellOf(ax, az))] >= 0;
}
/** Next waypoint (x,z) on the way from (x,z) down the distance field, a few steps ahead. */
function navWaypoint(field, x, z, steps = 3) {
  let c = navFreeCell(navCellOf(x, z));
  if (field[c] < 0) return null;
  for (let i = 0; i < steps && field[c] > 0; i++) {
    const cx = c % navN, cz = (c - cx) / navN;
    let best = c, bd = field[c];
    for (const [dx, dz] of NAV_DIRS) {
      const nx = cx + dx, nz = cz + dz;
      if (nx < 0 || nz < 0 || nx >= navN || nz >= navN) continue;
      const n = nz * navN + nx;
      if (field[n] >= 0 && field[n] < bd) { bd = field[n]; best = n; }
    }
    if (best === c) break;
    c = best;
  }
  const cx = c % navN, cz = (c - cx) / navN;
  return { x: -navHalf + cx + 0.5, z: -navHalf + cz + 0.5 };
}

// ====================================================================== bot AI
/** Practice-range targets never shoot. Each slot moves differently: stand, strafe, hop, run laps. */
function dummyThink(room, p, dt) {
  const inp = { seq: 0, mx: 0, mz: 0, yaw: p.yaw, pitch: 0, jump: false, shoot: false, q: false, e: false, r: false, vt: 0 };
  const t = room.time + p.slot * 1.9;
  switch (p.slot % 4) {
    case 1: inp.mx = Math.sin(t * 0.9) > 0 ? 1 : -1; break;                 // strafes left / right
    case 2: inp.mx = Math.sin(t * 1.3) > 0 ? 1 : -1; inp.jump = Math.sin(t * 2.6) > 0.92; break; // strafes and hops
    case 3: inp.mz = 1; inp.yaw = p.yaw + 0.9 * dt; break;                  // runs in circles
    default: break;                                                         // stands still
  }
  return inp;
}

function botThink(room, p, dt) {
  const ai = p.ai, skill = p.skill;
  const inp = { seq: 0, mx: 0, mz: 0, yaw: p.yaw, pitch: p.pitch, jump: false, shoot: false, q: false, e: false, r: false, vt: 0 };

  ai.retargetT -= dt;
  if (ai.retargetT <= 0 || !ai.tgt || !ai.tgt.alive) {
    ai.retargetT = 0.6;
    let best = null, bd = Infinity;
    for (const o of room.players) {
      if (o.team === p.team || !o.alive) continue;
      const d = Math.hypot(o.x - p.x, o.z - p.z);
      if (d < bd) { bd = d; best = o; }
    }
    ai.tgt = best;
  }
  const moved = Math.hypot(p.x - ai.lx, p.z - ai.lz);
  ai.lx = p.x; ai.lz = p.z;
  const t = ai.tgt;
  if (!t) return inp;

  const dx = t.x - p.x, dz = t.z - p.z;
  const dist = Math.hypot(dx, dz);
  const ex = p.x, ey = p.y + eyeH(p), ez = p.z;
  const ddx = t.x - ex, ddy = t.y + (t.crouch ? 0.65 : 1.2) - ey, ddz = t.z - ez;
  const d3 = Math.hypot(ddx, ddy, ddz);
  const visible = rayWalls(ex, ey, ez, ddx / d3, ddy / d3, ddz / d3, d3) >= d3 - 0.3;
  ai.seenT = visible ? ai.seenT + dt : 0;

  const wantYaw = Math.atan2(-dx, -dz);
  const wantPitch = Math.atan2(ddy, Math.hypot(ddx, ddz));
  let aimed = false;

  if (visible) {
    ai.noiseT -= dt;
    if (ai.noiseT <= 0) {
      ai.noiseT = 0.15;
      ai.noiseY = (Math.random() - 0.5) * 2 * (1 - skill) * 0.12;
      ai.noiseP = (Math.random() - 0.5) * 2 * (1 - skill) * 0.08;
    }
    const turn = Math.min(1, (6 + skill * 8) * dt);
    inp.yaw = p.yaw + angDiff(wantYaw + ai.noiseY, p.yaw) * turn;
    inp.pitch = clamp(p.pitch + (wantPitch + ai.noiseP - p.pitch) * turn, -1.4, 1.4);

    inp.mz = dist > 13 ? 1 : dist < 7 ? -1 : 0;
    ai.strafeT -= dt;
    if (ai.strafeT <= 0) { ai.strafeT = rand(0.5, 1.7); ai.strafe = Math.random() < 0.5 ? -1 : 1; }
    inp.mx = ai.strafe;
    if (Math.random() < 0.004) inp.jump = true;

    const err = Math.abs(angDiff(wantYaw, inp.yaw)) + Math.abs(wantPitch - inp.pitch);
    aimed = err < 0.06;
    ai.burstT -= dt;
    if (ai.burstT <= 0) {
      ai.bursting = !ai.bursting;
      ai.burstT = ai.bursting ? rand(0.6, 1.1) : rand(0.25, 0.65);
    }
    inp.shoot = ai.bursting && ai.seenT > 0.15 + (1 - skill) * 0.5 && aimed;
  } else {
    // Chase: head for the target, steer around walls.
    if (moved < 0.03) ai.stuckT += dt; else ai.stuckT = Math.max(0, ai.stuckT - dt);
    if (ai.stuckT > 0.35) { ai.avoidT = 0.9; ai.avoidDir = Math.random() < 0.5 ? -1 : 1; ai.stuckT = 0; }
    // follow the walkable route (distance field from the target), not a straight line
    const tc = navCellOf(t.x, t.z);
    if (!ai.field || tc !== ai.navCell || room.time - ai.navAt > 0.6) {
      ai.field = navField(tc);
      ai.navCell = tc;
      ai.navAt = room.time;
    }
    const wp = navWaypoint(ai.field, p.x, p.z);
    let heading = wp ? Math.atan2(-(wp.x - p.x), -(wp.z - p.z)) : wantYaw;
    if (ai.avoidT > 0) { heading += ai.avoidDir * 1.2; ai.avoidT -= dt; }
    inp.yaw = p.yaw + angDiff(heading, p.yaw) * Math.min(1, 10 * dt);
    inp.pitch = p.pitch * 0.9;
    inp.mz = 1;
    ai.bursting = false;
  }

  // hop over low walls that block the way (a low wall stops a ray at knee height but not at head height)
  if (inp.mz > 0 || inp.mx !== 0 || !visible) {
    const s2 = Math.sin(inp.yaw), c2 = Math.cos(inp.yaw);
    const mxw = -s2 * inp.mz + c2 * inp.mx, mzw = -c2 * inp.mz - s2 * inp.mx;
    const ml = Math.hypot(mxw, mzw);
    if (ml > 0.1) {
      const ux = mxw / ml, uz = mzw / ml;
      if (rayWalls(p.x, 0.5, p.z, ux, 0, uz, 1.1) < 1.1 && rayWalls(p.x, 1.3, p.z, ux, 0, uz, 1.5) > 1.4) inp.jump = true;
    }
  }

  for (let s = 0; s < SLOT_COUNT; s++) {
    if (p.cd[s] > 0) continue;
    const id = p.loadout[s];
    let want = false;
    switch (id) {
      case 'heal': want = p.hp < p.maxHp * 0.5; break;
      case 'shield': want = visible && ai.seenT > 0.1 && room.time - p.lastHurt < 1.0; break;
      case 'shockwave': want = visible && aimed && dist < 20 && ai.seenT > 0.2; break;
      case 'dash': want = visible && Math.random() < 0.01; break;
      case 'pushback': want = visible && dist < 5.5; break;
      case 'nova': want = visible && dist < 4.5; break;
      case 'bind': want = visible && p.bindBuffT <= 0 && dist < 30 && ai.seenT > 0.2; break;
      case 'firepool': want = visible && dist < 26 && Math.random() < 0.02; break;
      case 'barbed': want = visible && ai.seenT > 0.2 && p.bleedBuffT <= 0 && dist < 30; break;
      case 'blink': want = visible && dist > 12 && Math.random() < 0.01; break;
      case 'grapple': want = visible && dist > 16 && Math.random() < 0.008; break;
      case 'smoke': want = visible && room.time - p.lastHurt < 0.5 && Math.random() < 0.08; break;
      case 'decoy': want = visible && room.time - p.lastHurt < 1.0 && Math.random() < 0.1; break;
      case 'slowtrap': want = Math.random() < 0.004 && !visible; break;
      case 'mark': want = visible && aimed && dist < 45 && ai.seenT > 0.2; break;
      case 'gravity': want = visible && dist < 24 && Math.random() < 0.02; break;
      case 'polymorph': want = visible && aimed && dist < 30 && ai.seenT > 0.2; break;
      case 'overcharge': want = visible && aimed && p.overT <= 0 && ai.seenT > 0.3; break;
      default: break;
    }
    if (want) inp[SLOT_FLAG[s]] = true;
  }
  return inp;
}
