// Authoritative game room: players, bots, rounds, hitscan, spells.
import {
  DT, EYE_H, MAX_HP, FIRE_INTERVAL, BODY_DMG, HEAD_DMG, RANGE, SPELLS,
  stepPlayer, lookDir, rayWalls, rayPlayer, spawnPoint,
} from './shared/sim.js';

export const WIN_ROUNDS = 3;
export const ROUND_TIME = 90;

const SPELL_IDS = Object.keys(SPELLS);
const BOT_NAMES = ['Apollo', 'Athena', 'Ares', 'Hermes', 'Zeus', 'Hera', 'Artemis', 'Hades', 'Nike', 'Eros', 'Atlas', 'Helios'];
let nextId = 1;
let botNameIdx = 0;

const rand = (a, b) => a + Math.random() * (b - a);
const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const angDiff = (a, b) => {
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
};
const NEUTRAL = () => ({ seq: 0, mx: 0, mz: 0, yaw: 0, pitch: 0, jump: false, shoot: false, q: false, e: false });

function newAI() {
  return {
    tgt: null, retargetT: 0, strafe: 1, strafeT: 0, seenT: 0, noiseY: 0, noiseP: 0, noiseT: 0,
    stuckT: 0, lx: 0, lz: 0, avoidT: 0, avoidDir: 1, burstT: 0.3, bursting: false,
  };
}

function randomLoadout() {
  const a = SPELL_IDS[Math.floor(Math.random() * SPELL_IDS.length)];
  let b = a;
  while (b === a) b = SPELL_IDS[Math.floor(Math.random() * SPELL_IDS.length)];
  return [a, b];
}

function makePlayer(team, slot, isBot, name) {
  return {
    id: nextId++, team, slot, isBot, ws: null, name,
    x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, dvx: 0, dvz: 0, dashT: 0,
    yaw: 0, pitch: 0, hp: MAX_HP, alive: true,
    loadout: randomLoadout(), cd: [0, 0], fireCd: 0, shieldT: 0,
    lastSeq: 0, lastQueued: 0, queue: [], lastInput: NEUTRAL(),
    kills: 0, deaths: 0, lastHurt: -99,
    ai: newAI(), skill: rand(0.55, 0.85),
  };
}

export class Room {
  constructor(mode) {
    this.mode = mode;
    this.size = mode;
    this.players = [];
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
  addHuman(ws, name, loadout) {
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
        bot.queue = [];
        bot.lastSeq = 0;
        bot.lastQueued = 0;
        bot.cd = [0, 0];
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
      jump: !!m.jump, shoot: !!m.shoot, q: !!m.q, e: !!m.e,
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
      p.hp = MAX_HP; p.alive = true;
      p.cd = [0, 0]; p.fireCd = 0; p.shieldT = 0;
      p.queue = [];
      p.lastInput = NEUTRAL();
      p.lastInput.yaw = p.yaw;
      p.ai = newAI();
      p.ai.lx = p.x; p.ai.lz = p.z;
    }
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
      p.cd[0] = Math.max(0, p.cd[0] - dt);
      p.cd[1] = Math.max(0, p.cd[1] - dt);
      p.shieldT = Math.max(0, p.shieldT - dt);

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
    if (inp.q && p.cd[0] <= 0) this.cast(p, 0);
    if (inp.e && p.cd[1] <= 0) this.cast(p, 1);
  }

  // -------------------------------------------------------------- combat
  shoot(p, inp) {
    p.fireCd = FIRE_INTERVAL;
    const [dx, dy, dz] = lookDir(inp.yaw, inp.pitch);
    const ox = p.x, oy = p.y + EYE_H, oz = p.z;
    const tWall = Math.min(rayWalls(ox, oy, oz, dx, dy, dz, RANGE), RANGE);
    let best = null;
    for (const o of this.players) {
      if (o.team === p.team || !o.alive) continue;
      const r = rayPlayer(ox, oy, oz, dx, dy, dz, o);
      if (r && r.t < tWall && (!best || r.t < best.t)) best = { t: r.t, head: r.head, who: o };
    }
    let t = best ? best.t : tWall;
    if (!best && dy < 0) t = Math.min(t, -oy / dy); // floor
    this.events.push({
      k: 'shot', id: p.id, ox: r2(ox), oy: r2(oy), oz: r2(oz),
      ex: r2(ox + dx * t), ey: r2(oy + dy * t), ez: r2(oz + dz * t), hit: best ? 1 : 0,
    });
    if (best) this.damage(best.who, best.head ? HEAD_DMG : BODY_DMG, p, best.head);
  }

  damage(victim, amount, attacker, head) {
    if (!victim.alive) return;
    if (victim.shieldT > 0) amount *= 0.4;
    victim.hp -= amount;
    victim.lastHurt = this.time;
    this.events.push({ k: 'hit', a: attacker.id, v: victim.id, dmg: Math.round(amount), head: head ? 1 : 0 });
    if (victim.hp <= 0) {
      victim.hp = 0;
      victim.alive = false;
      victim.deaths++;
      attacker.kills++;
      this.events.push({ k: 'kill', a: attacker.id, v: victim.id, head: head ? 1 : 0 });
    }
  }

  cast(p, slot) {
    const id = p.loadout[slot];
    const spell = SPELLS[id];
    if (!spell) return;
    p.cd[slot] = spell.cd;
    const ev = { k: 'spell', id: p.id, s: id, x: r2(p.x), y: r2(p.y), z: r2(p.z) };
    if (id === 'dash') {
      const li = p.lastInput;
      const s = Math.sin(li.yaw), c = Math.cos(li.yaw);
      let wx = -s * li.mz + c * li.mx, wz = -c * li.mz - s * li.mx;
      const l = Math.hypot(wx, wz);
      if (l < 0.01) { wx = -s; wz = -c; } else { wx /= l; wz /= l; }
      p.dvx = wx * 30; p.dvz = wz * 30; p.dashT = 0.2;
    } else if (id === 'shield') {
      p.shieldT = 2.5;
    } else if (id === 'heal') {
      p.hp = Math.min(MAX_HP, p.hp + 35);
    } else if (id === 'shockwave') {
      for (const o of this.players) {
        if (o.team === p.team || !o.alive) continue;
        const dx = o.x - p.x, dz = o.z - p.z;
        const d = Math.hypot(dx, dz);
        if (d > 6 || Math.abs(o.y - p.y) > 3) continue;
        const nx = d > 0.01 ? dx / d : 0, nz = d > 0.01 ? dz / d : 1;
        o.dvx = nx * 20; o.dvz = nz * 20; o.dashT = 0.25; o.vy = 5;
        this.damage(o, 25, p, false);
      }
    }
    this.events.push(ev);
  }

  // -------------------------------------------------------------- network payloads
  snapshot() {
    return {
      t: 's', n: this.tick, ph: this.phase, pt: r2(this.phaseT), rt: Math.round(this.roundT * 10) / 10,
      sc: this.scores, rd: this.round, lw: this.lastWinner, w: this.winner, mode: this.mode,
      p: this.players.map((p) => ({
        id: p.id, tm: p.team, n: p.name, b: p.isBot ? 1 : 0,
        x: r3(p.x), y: r3(p.y), z: r3(p.z), yaw: r3(p.yaw), pit: r3(p.pitch),
        hp: Math.ceil(p.hp), a: p.alive ? 1 : 0, sh: p.shieldT > 0 ? 1 : 0, k: p.kills, d: p.deaths,
      })),
      ev: this.events,
    };
  }

  meFor(p) {
    return {
      id: p.id, ack: p.lastSeq, cd: p.cd.map((v) => r2(v)),
      st: { x: p.x, y: p.y, z: p.z, vx: p.vx, vy: p.vy, vz: p.vz, dvx: p.dvx, dvz: p.dvz, dashT: p.dashT },
    };
  }
}

// ====================================================================== bot AI
function botThink(room, p, dt) {
  const ai = p.ai, skill = p.skill;
  const inp = { seq: 0, mx: 0, mz: 0, yaw: p.yaw, pitch: p.pitch, jump: false, shoot: false, q: false, e: false };

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
    ai.burstT -= dt;
    if (ai.burstT <= 0) {
      ai.bursting = !ai.bursting;
      ai.burstT = ai.bursting ? rand(0.6, 1.1) : rand(0.25, 0.65);
    }
    inp.shoot = ai.bursting && ai.seenT > 0.25 + (1 - skill) * 0.4 && err < 0.06;
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

  for (let s = 0; s < 2; s++) {
    if (p.cd[s] > 0) continue;
    const id = p.loadout[s];
    let want = false;
    if (id === 'heal') want = p.hp < 50;
    else if (id === 'shield') want = visible && ai.seenT > 0.1 && room.time - p.lastHurt < 1.0;
    else if (id === 'shockwave') want = visible && dist < 5;
    else if (id === 'dash') want = visible && Math.random() < 0.01;
    if (want) { if (s === 0) inp.q = true; else inp.e = true; }
  }
  return inp;
}
