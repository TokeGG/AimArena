// Authoritative game room: players, bots, rounds, hitscan, skills, status effects.
import {
  DT, EYE_H, FIRE_INTERVAL, BODY_DMG, HEAD_DMG, RANGE, SPELLS, MODELS, DEFAULT_MODEL, SLOT_COUNT,
  stepPlayer, lookDir, rayWalls, rayWorld, rayPlayer, spawnPoint,
} from './shared/sim.js';

export const WIN_ROUNDS = 3;
export const ROUND_TIME = 90;
export const MAX_REWIND = 24; // ticks (400 ms at 60 Hz): the most a shot can be rewound

// tuning
const BUFF_TIME = 6;
const BURN_DPS = 14, BURN_LINGER = 1.2, BURN_ON_HIT = 3;
const BLEED_DPS = 6, BLEED_MOVING_MULT = 1.8, BLEED_TIME = 4;
const BIND_TIME = 1.8, BIND_RANGE = 35;
const POOL_RANGE = 30, POOL_RADIUS = 3, POOL_TIME = 5;
const HIT_FIRE_RADIUS = 2.2, HIT_FIRE_TIME = 3.5;
const BLAST_RADIUS = 3, BLAST_DMG = 14;
const NOVA_RADIUS = 5, NOVA_DMG = 12, NOVA_SLOW = 3;

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
  };
}

function randomLoadout() {
  const out = [];
  while (out.length < SLOT_COUNT) {
    const id = pick(SPELL_IDS);
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

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
  p.fireBuffT = 0; p.bleedBuffT = 0; p.blastBuffT = 0;
}

function makePlayer(team, slot, isBot, name) {
  const p = {
    id: nextId++, team, slot, isBot, ws: null, name,
    x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, dvx: 0, dvz: 0, dashT: 0,
    yaw: 0, pitch: 0, alive: true,
    model: DEFAULT_MODEL, maxHp: 100, speed: 7, healMult: 1, hp: 100,
    loadout: randomLoadout(), cd: [0, 0, 0], fireCd: 0, shieldT: 0,
    lastSeq: 0, lastQueued: 0, queue: [], lastInput: NEUTRAL(),
    kills: 0, deaths: 0, lastHurt: -99,
    hist: [], // recent positions {n,x,y,z} for lag compensation
    ai: newAI(), skill: rand(0.55, 0.85),
  };
  clearStatuses(p);
  if (isBot) applyModel(p, pick(MODEL_IDS));
  return p;
}

export class Room {
  constructor(mode) {
    this.mode = mode;
    this.size = mode;
    this.players = [];
    this.zones = [];
    this.phase = 'countdown';
    this.phaseT = 5;
    this.roundT = ROUND_TIME;
    this.scores = [0, 0];
    this.round = 1;
    this.lastWinner = -1;
    this.winner = -1;
    this.events = [];
    this.tick = 0;
    this.time = 0;
    this.emptyT = 0;
    for (const team of [0, 1]) {
      for (let i = 0; i < this.size; i++) {
        this.players.push(makePlayer(team, i, true, BOT_NAMES[botNameIdx++ % BOT_NAMES.length]));
      }
    }
    this.resetRound();
  }

  humans() { return this.players.filter((p) => !p.isBot); }
  hasBot() { return this.players.some((p) => p.isBot); }

  // -------------------------------------------------------------- membership
  addHuman(ws, name, loadout, model) {
    const humanCount = [0, 0];
    for (const p of this.players) if (!p.isBot) humanCount[p.team]++;
    const order = humanCount[0] <= humanCount[1] ? [0, 1] : [1, 0];
    for (const team of order) {
      const bot = this.players.find((p) => p.isBot && p.team === team);
      if (bot) {
        bot.isBot = false;
        bot.ws = ws;
        bot.name = name;
        bot.loadout = loadout;
        applyModel(bot, model);
        clearStatuses(bot);
        bot.queue = [];
        bot.lastSeq = 0;
        bot.lastQueued = 0;
        bot.cd = [0, 0, 0];
        bot.kills = 0;
        bot.deaths = 0;
        this.emptyT = 0;
        return bot;
      }
    }
    return null;
  }

  removeHuman(p) {
    p.isBot = true;
    p.ws = null;
    p.name = BOT_NAMES[botNameIdx++ % BOT_NAMES.length];
    p.ai = newAI();
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
      jump: !!m.jump, shoot: !!m.shoot, q: !!m.q, e: !!m.e, r: !!m.r,
      vt: Number.isFinite(+m.vt) ? +m.vt : 0, // server tick the shooter was looking at
    });
    if (p.queue.length > 20) p.queue.shift();
  }

  // -------------------------------------------------------------- rounds
  resetRound() {
    for (const p of this.players) {
      const sp = spawnPoint(p.team, p.slot, this.size);
      p.x = sp.x; p.y = 0; p.z = sp.z;
      p.vx = p.vy = p.vz = 0;
      p.dvx = p.dvz = 0; p.dashT = 0;
      p.yaw = sp.yaw; p.pitch = 0;
      p.hp = p.maxHp; p.alive = true;
      p.cd = [0, 0, 0]; p.fireCd = 0; p.shieldT = 0;
      clearStatuses(p);
      p.queue = [];
      p.hist = [];
      p.lastInput = NEUTRAL();
      p.lastInput.yaw = p.yaw;
      p.ai = newAI();
      p.ai.lx = p.x; p.ai.lz = p.z;
    }
    this.zones = [];
    this.roundT = ROUND_TIME;
  }

  endRound(w) {
    if (w >= 0) this.scores[w]++;
    this.lastWinner = w;
    this.events.push({ k: 'round', w });
    if (w >= 0 && this.scores[w] >= WIN_ROUNDS) {
      this.phase = 'matchEnd';
      this.phaseT = 8;
      this.winner = w;
    } else {
      this.phase = 'roundEnd';
      this.phaseT = 3.5;
    }
  }

  // -------------------------------------------------------------- tick
  step() {
    this.tick++;
    this.time += DT;
    const dt = DT;

    if (this.phase !== 'live') {
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
          for (const p of this.players) { p.kills = 0; p.deaths = 0; }
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
      p.fireBuffT = Math.max(0, p.fireBuffT - dt);
      p.bleedBuffT = Math.max(0, p.bleedBuffT - dt);
      p.blastBuffT = Math.max(0, p.blastBuffT - dt);

      if (this.phase === 'countdown') {
        if (p.queue.length) {
          p.lastSeq = p.queue[p.queue.length - 1].seq;
          p.queue.length = 0;
        }
        continue;
      }
      if (p.isBot) {
        if (!p.alive) continue;
        const inp = this.phase === 'live' ? botThink(this, p, dt) : NEUTRAL();
        if (this.phase !== 'live') inp.yaw = p.yaw;
        this.applyInput(p, inp, dt);
      } else {
        let n = 0;
        while (p.queue.length && n < 8) {
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
    } else if (this.zones.length) {
      this.zones.length = 0;
    }

    // Record positions so shots can be rewound to what the shooter saw.
    for (const p of this.players) {
      p.hist.push({ n: this.tick, x: p.x, y: p.y, z: p.z });
      if (p.hist.length > MAX_REWIND + 16) p.hist.shift();
    }

    // (the server clears `events` after every snapshot broadcast, humans or not)
    if (!this.players.some((p) => !p.isBot)) this.emptyT += dt;
  }

  applyInput(p, inp, dt) {
    p.lastInput = inp;
    stepPlayer(p, inp, dt);
    p.yaw = inp.yaw;
    p.pitch = inp.pitch;
    if (this.phase !== 'live' || !p.alive) return;
    if (inp.shoot && p.fireCd <= 0) this.shoot(p, inp);
    for (let s = 0; s < SLOT_COUNT; s++) {
      if (inp[SLOT_FLAG[s]] && p.cd[s] <= 0) this.cast(p, s, inp);
    }
  }

  // -------------------------------------------------------------- status effects
  tickZones(dt) {
    for (const z of this.zones) {
      z.t -= dt;
      if (z.t <= 0) continue;
      for (const o of this.players) {
        if (!o.alive || o.team === z.team) continue;
        if (o.y < 1.2 && Math.hypot(o.x - z.x, o.z - z.z) < z.r) this.ignite(o, z.src, BURN_LINGER);
      }
    }
    this.zones = this.zones.filter((z) => z.t > 0);
  }

  tickStatuses(dt) {
    for (const p of this.players) {
      if (!p.alive) continue;
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

  addZone(owner, x, z, r, dur) {
    this.zones.push({ id: nextZoneId++, x, z, r, t: dur, max: dur, team: owner.team, src: owner });
  }

  /** Damage over time: no hit marker, but kills are credited to the source. */
  dot(victim, amount, src) {
    if (!victim.alive) return;
    victim.hp -= amount;
    victim.lastHurt = this.time;
    if (victim.hp <= 0) this.kill(victim, src || victim, false);
  }

  kill(victim, attacker, head) {
    victim.hp = 0;
    victim.alive = false;
    victim.deaths++;
    if (attacker !== victim) attacker.kills++;
    this.events.push({ k: 'kill', a: attacker.id, v: victim.id, head: head ? 1 : 0 });
  }

  // -------------------------------------------------------------- combat
  shoot(p, inp) {
    p.fireCd = FIRE_INTERVAL;
    const [dx, dy, dz] = lookDir(inp.yaw, inp.pitch);
    const ox = p.x, oy = p.y + EYE_H, oz = p.z;
    const tWall = Math.min(rayWalls(ox, oy, oz, dx, dy, dz, RANGE), RANGE);
    const best = this.firstEnemyHit(p, ox, oy, oz, dx, dy, dz, tWall, inp.vt);
    let t = best ? best.t : tWall;
    if (!best && dy < 0) t = Math.min(t, -oy / dy); // floor
    this.events.push({
      k: 'shot', id: p.id, ox: r2(ox), oy: r2(oy), oz: r2(oz),
      ex: r2(ox + dx * t), ey: r2(oy + dy * t), ez: r2(oz + dz * t), hit: best ? 1 : 0,
    });
    if (best) {
      this.damage(best.who, best.head ? HEAD_DMG : BODY_DMG, p, best.head);
      this.onRifleHit(p, best.who);
    }
  }

  /** Nearest living enemy along the ray (enemies rewound to the shooter's view time). */
  firstEnemyHit(p, ox, oy, oz, dx, dy, dz, maxT, vt) {
    let best = null;
    for (const o of this.players) {
      if (o.team === p.team || !o.alive) continue;
      const r = rayPlayer(ox, oy, oz, dx, dy, dz, this.rewound(o, vt));
      if (r && r.t < maxT && (!best || r.t < best.t)) best = { t: r.t, head: r.head, who: o };
    }
    return best;
  }

  /** On-hit effects from Incendiary / Barbed / Explosive Rounds. */
  onRifleHit(p, v) {
    if (p.blastBuffT > 0) {
      this.events.push({ k: 'blast', x: r2(v.x), y: r2(v.y), z: r2(v.z), r: BLAST_RADIUS });
      for (const o of this.players) {
        if (o.team === p.team || !o.alive || o === v) continue;
        if (Math.hypot(o.x - v.x, o.z - v.z) <= BLAST_RADIUS && Math.abs(o.y - v.y) < 3) this.damage(o, BLAST_DMG, p, false);
      }
    }
    if (!v.alive) return;
    if (p.fireBuffT > 0) {
      this.addZone(p, v.x, v.z, HIT_FIRE_RADIUS, HIT_FIRE_TIME);
      this.ignite(v, p, BURN_ON_HIT);
    }
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
          return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, z: a.z + (b.z - a.z) * f };
        }
        return a;
      }
    }
    return h.length ? h[0] : o;
  }

  damage(victim, amount, attacker, head) {
    if (!victim.alive) return;
    if (victim.shieldT > 0) amount *= 0.4;
    victim.hp -= amount;
    victim.lastHurt = this.time;
    this.events.push({ k: 'hit', a: attacker.id, v: victim.id, dmg: Math.round(amount), head: head ? 1 : 0 });
    if (victim.hp <= 0) this.kill(victim, attacker, head);
  }

  cast(p, slot, inp) {
    const id = p.loadout[slot];
    const spell = SPELLS[id];
    if (!spell) return;
    p.cd[slot] = spell.cd;
    const ev = { k: 'spell', id: p.id, s: id, x: r2(p.x), y: r2(p.y), z: r2(p.z) };
    const [dx, dy, dz] = lookDir(inp.yaw, inp.pitch);
    const ox = p.x, oy = p.y + EYE_H, oz = p.z;

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
        p.hp = Math.min(p.maxHp, p.hp + 35 * p.healMult);
        break;
      case 'shockwave':
        for (const o of this.players) {
          if (o.team === p.team || !o.alive) continue;
          const ex = o.x - p.x, ez = o.z - p.z;
          const d = Math.hypot(ex, ez);
          if (d > 6 || Math.abs(o.y - p.y) > 3) continue;
          const nx = d > 0.01 ? ex / d : 0, nz = d > 0.01 ? ez / d : 1;
          o.dvx = nx * 20; o.dvz = nz * 20; o.dashT = 0.25; o.vy = 5;
          this.damage(o, 25, p, false);
        }
        break;
      case 'bind': {
        const tWall = Math.min(rayWalls(ox, oy, oz, dx, dy, dz, BIND_RANGE), BIND_RANGE);
        const best = this.firstEnemyHit(p, ox, oy, oz, dx, dy, dz, tWall, inp.vt);
        let t = best ? best.t : tWall;
        if (!best && dy < 0) t = Math.min(t, -oy / dy);
        if (best) {
          const v = best.who;
          v.rootT = BIND_TIME;
          v.vx = 0; v.vz = 0; v.dashT = 0; v.dvx = 0; v.dvz = 0;
          this.events.push({ k: 'bound', v: v.id });
        }
        ev.ox = r2(ox); ev.oy = r2(oy); ev.oz = r2(oz);
        ev.ex = r2(ox + dx * t); ev.ey = r2(oy + dy * t); ev.ez = r2(oz + dz * t);
        ev.hit = best ? 1 : 0;
        break;
      }
      case 'firepool': {
        let t = Math.min(rayWorld(ox, oy, oz, dx, dy, dz, POOL_RANGE), POOL_RANGE);
        if (!Number.isFinite(t)) t = POOL_RANGE;
        const px = clamp(ox + dx * t, -29, 29), pz = clamp(oz + dz * t, -29, 29);
        this.addZone(p, px, pz, POOL_RADIUS, POOL_TIME);
        ev.tx = r2(px); ev.tz = r2(pz); ev.r = POOL_RADIUS;
        break;
      }
      case 'nova':
        for (const o of this.players) {
          if (o.team === p.team || !o.alive) continue;
          if (Math.hypot(o.x - p.x, o.z - p.z) > NOVA_RADIUS || Math.abs(o.y - p.y) > 3) continue;
          o.slowT = NOVA_SLOW;
          this.damage(o, NOVA_DMG, p, false);
        }
        ev.r = NOVA_RADIUS;
        break;
      case 'incendiary': p.fireBuffT = BUFF_TIME; break;
      case 'barbed': p.bleedBuffT = BUFF_TIME; break;
      case 'explosive': p.blastBuffT = BUFF_TIME; break;
      default: break;
    }
    this.events.push(ev);
  }

  // -------------------------------------------------------------- network payloads
  snapshot() {
    return {
      t: 's', n: this.tick, ph: this.phase, pt: r2(this.phaseT), rt: Math.round(this.roundT * 10) / 10,
      sc: this.scores, rd: this.round, lw: this.lastWinner, w: this.winner, mode: this.mode,
      p: this.players.map((p) => ({
        id: p.id, tm: p.team, n: p.name, b: p.isBot ? 1 : 0, md: p.model,
        x: r3(p.x), y: r3(p.y), z: r3(p.z), yaw: r3(p.yaw), pit: r3(p.pitch),
        hp: Math.ceil(p.hp), mh: p.maxHp, a: p.alive ? 1 : 0, sh: p.shieldT > 0 ? 1 : 0,
        sf: (p.rootT > 0 ? 1 : 0) | (p.slowT > 0 ? 2 : 0) | (p.burnT > 0 ? 4 : 0) | (p.bleedT > 0 ? 8 : 0),
        bf: (p.fireBuffT > 0 ? 1 : 0) | (p.bleedBuffT > 0 ? 2 : 0) | (p.blastBuffT > 0 ? 4 : 0),
        k: p.kills, d: p.deaths,
      })),
      zn: this.zones.map((z) => ({ id: z.id, x: r2(z.x), z: r2(z.z), r: z.r, t: r2(z.t), m: z.max })),
      ev: this.events,
    };
  }

  meFor(p) {
    return {
      id: p.id, ack: p.lastSeq, cd: p.cd.map((v) => r2(v)),
      st: {
        x: p.x, y: p.y, z: p.z, vx: p.vx, vy: p.vy, vz: p.vz, dvx: p.dvx, dvz: p.dvz, dashT: p.dashT,
        rootT: p.rootT, slowT: p.slowT,
      },
    };
  }
}

// ====================================================================== bot AI
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
  const ex = p.x, ey = p.y + EYE_H, ez = p.z;
  const ddx = t.x - ex, ddy = t.y + 1.2 - ey, ddz = t.z - ez;
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
    inp.shoot = ai.bursting && ai.seenT > 0.25 + (1 - skill) * 0.4 && aimed;
  } else {
    // Chase: head for the target, steer around walls.
    if (moved < 0.03) ai.stuckT += dt; else ai.stuckT = Math.max(0, ai.stuckT - dt);
    if (ai.stuckT > 0.35) { ai.avoidT = 0.9; ai.avoidDir = Math.random() < 0.5 ? -1 : 1; ai.stuckT = 0; }
    let heading = wantYaw;
    const hx = -Math.sin(heading), hz = -Math.cos(heading);
    if (ai.avoidT <= 0 && rayWalls(p.x, 0.6, p.z, hx, 0, hz, 2.5) < 2.5) {
      ai.avoidT = 0.6;
      ai.avoidDir = Math.random() < 0.5 ? -1 : 1;
    }
    if (ai.avoidT > 0) { heading += ai.avoidDir * 1.2; ai.avoidT -= dt; }
    inp.yaw = p.yaw + angDiff(heading, p.yaw) * Math.min(1, 10 * dt);
    inp.pitch = p.pitch * 0.9;
    inp.mz = 1;
    ai.bursting = false;
  }

  for (let s = 0; s < SLOT_COUNT; s++) {
    if (p.cd[s] > 0) continue;
    const id = p.loadout[s];
    let want = false;
    switch (id) {
      case 'heal': want = p.hp < p.maxHp * 0.5; break;
      case 'shield': want = visible && ai.seenT > 0.1 && room.time - p.lastHurt < 1.0; break;
      case 'shockwave': want = visible && dist < 5; break;
      case 'dash': want = visible && Math.random() < 0.01; break;
      case 'nova': want = visible && dist < 4.5; break;
      case 'bind': want = visible && aimed && dist < 30 && ai.seenT > 0.3; break;
      case 'firepool': want = visible && dist < 26 && Math.random() < 0.02; break;
      case 'incendiary': want = visible && ai.seenT > 0.2 && p.fireBuffT <= 0 && dist < 30; break;
      case 'barbed': want = visible && ai.seenT > 0.2 && p.bleedBuffT <= 0 && dist < 30; break;
      case 'explosive': want = visible && ai.seenT > 0.2 && p.blastBuffT <= 0 && dist < 30; break;
      default: break;
    }
    if (want) inp[SLOT_FLAG[s]] = true;
  }
  return inp;
}
