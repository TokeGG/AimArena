// Unit tests for the status-effect skills, using two hand-placed players.
import assert from 'node:assert/strict';
import { Room } from '../game.js';
import { stepPlayer, DT, EYE_H, MODELS } from '../sim.js';

function setup(loadout, model = 'striker') {
  const room = new Room(2);
  const shooter = room.players.find((p) => p.team === 0);
  const enemy = room.players.find((p) => p.team === 1);
  const extra = room.players.find((p) => p.team === 1 && p !== enemy);
  for (const p of room.players) {
    p.isBot = false; // only move when we say so
    if (p !== shooter && p !== enemy && p !== extra) p.alive = false;
  }
  shooter.loadout = loadout;
  room.phase = 'live'; room.phaseT = 0; room.roundT = 999;
  // open lane near z=28 / z=22 (no walls)
  shooter.x = -15; shooter.z = 28; shooter.y = 0;
  enemy.x = -15; enemy.z = 22; enemy.y = 0;
  extra.x = -12.5; extra.z = 22; extra.y = 0; // 2.5m from enemy
  return { room, shooter, enemy, extra };
}

function aimAt(shooter, tx, ty, tz) {
  const dx = tx - shooter.x, dy = ty - (shooter.y + EYE_H), dz = tz - shooter.z;
  return { yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)) };
}

let seq = 0;
function act(room, p, target, flags) {
  const a = aimAt(p, target[0], target[1], target[2]);
  room.queueInput(p, { seq: ++seq, mx: 0, mz: 0, yaw: a.yaw, pitch: a.pitch, jump: false, shoot: false, q: false, e: false, r: false, ...flags });
  room.step();
}
const idle = (room, n) => { for (let i = 0; i < n; i++) room.step(); };

// ---- models are applied
{
  const { room, shooter } = setup(['dash', 'heal', 'shield']);
  const p = room.addHuman ? shooter : null;
  assert.ok(p);
  for (const [k, m] of Object.entries(MODELS)) assert.ok(m.hp > 0 && m.speed > 0, k);
}

// ---- Bind: next rifle shot roots its target, who then cannot move; wears off
{
  const { room, shooter, enemy } = setup(['bind', 'dash', 'heal']);
  act(room, shooter, [enemy.x, 1.0, enemy.z], { q: true });
  assert.ok(shooter.bindBuffT > 5, 'bind buff not active');
  assert.equal(enemy.rootT, 0, 'casting bind itself must not root anyone');
  assert.equal(room.snapshot().p.find((p) => p.id === shooter.id).bf & 8, 8, 'snapshot missing bind buff flag');
  act(room, shooter, [enemy.x, 1.0, enemy.z], { shoot: true });
  assert.ok(enemy.rootT > 1.5, `enemy should be rooted by the next shot (rootT=${enemy.rootT})`);
  assert.equal(shooter.bindBuffT, 0, 'bind buff should be used up by the shot');
  const x0 = enemy.x, z0 = enemy.z;
  for (let i = 0; i < 30; i++) {
    room.queueInput(enemy, { seq: i + 1, mx: 1, mz: 1, yaw: 0, pitch: 0, jump: true, shoot: false });
    room.step();
  }
  assert.ok(Math.hypot(enemy.x - x0, enemy.z - z0) < 0.05, 'rooted player moved');
  assert.equal(enemy.y, 0, 'rooted player jumped');
  // a missed shot still uses the bind up
  const { room: r2, shooter: s2, enemy: e2 } = setup(['bind', 'dash', 'heal']);
  act(r2, s2, [e2.x + 6, 1.0, e2.z], { q: true });
  act(r2, s2, [e2.x + 6, 1.0, e2.z], { shoot: true });
  assert.equal(e2.rootT, 0, 'missed bind shot rooted someone');
  assert.equal(s2.bindBuffT, 0, 'missed shot should still use the bind up');
  // root wears off through stepPlayer
  const st = { x: -28, y: 0, z: 0, vx: 0, vy: 0, vz: 0, dvx: 0, dvz: 0, dashT: 0, rootT: 0.1, slowT: 0 };
  for (let i = 0; i < 10; i++) stepPlayer(st, { mx: 0, mz: 1, yaw: -Math.PI / 2, jump: false }, DT);
  assert.equal(st.rootT, 0);
  for (let i = 0; i < 30; i++) stepPlayer(st, { mx: 0, mz: 1, yaw: -Math.PI / 2, jump: false }, DT);
  assert.ok(st.x > -28 + 1, 'player should move again after the root ends');
}

// ---- Pushback: radial shove away from the caster within 7m, no damage, nobody farther is moved
{
  const { room, shooter, enemy, extra } = setup(['pushback', 'dash', 'heal']);
  enemy.x = -15; enemy.z = 24;         // 4 m from the caster: in range
  extra.x = -4; extra.z = 28;          // 11 m away: out of range
  const hp0 = enemy.hp, ehp = extra.hp;
  act(room, shooter, [enemy.x, 1.0, enemy.z], { q: true });
  assert.equal(enemy.hp, hp0, 'pushback must not deal damage');
  assert.ok(enemy.dashT > 0, 'enemy in range was not pushed');
  const away = (enemy.dvx * (enemy.x - shooter.x) + enemy.dvz * (enemy.z - shooter.z));
  assert.ok(away > 0, 'push should point away from the caster');
  assert.equal(extra.dashT, 0, 'enemy out of range was pushed');
  assert.equal(extra.hp, ehp);
  assert.equal(shooter.dashT, 0, 'caster must not push itself');
}

// ---- Shield: 40% less damage
{
  const { room, shooter, enemy } = setup(['shield', 'dash', 'heal']);
  const a = enemy.hp;
  room.damage(enemy, 20, shooter, false);
  assert.equal(a - enemy.hp, 20);
  const b = setup(['shield', 'dash', 'heal']);
  b.enemy.shieldT = 2;
  const h = b.enemy.hp;
  b.room.damage(b.enemy, 20, b.shooter, false);
  assert.ok(Math.abs((h - b.enemy.hp) - 12) < 1e-9, `shield should take 40% off, got ${h - b.enemy.hp}`);
}

// ---- Champions: more health always means slower, and the gaps are big
{
  const list = Object.values(MODELS).sort((x, y) => x.hp - y.hp);
  for (let i = 1; i < list.length; i++) {
    assert.ok(list[i].speed < list[i - 1].speed, `${list[i].name} has more HP than ${list[i - 1].name} but is not slower`);
    assert.ok(list[i].hp - list[i - 1].hp >= 10, 'HP steps too small');
    assert.ok(list[i - 1].speed - list[i].speed >= 0.5, 'speed steps too small');
  }
  assert.ok(list[list.length - 1].hp >= 1.8 * list[0].hp, 'tank vs runner HP spread too small');
}

// ---- Barbed Rounds: bleed, worse while moving
{
  const mk = () => {
    const { room, shooter, enemy } = setup(['barbed', 'dash', 'heal']);
    act(room, shooter, [enemy.x, 1.0, enemy.z], { q: true });
    act(room, shooter, [enemy.x, 1.0, enemy.z], { shoot: true });
    assert.ok(enemy.bleedT > 3, 'target not bleeding');
    return { room, enemy };
  };
  const still = mk();
  const h0 = still.enemy.hp;
  idle(still.room, 60);
  const lostStill = h0 - still.enemy.hp;
  const moving = mk();
  const h1 = moving.enemy.hp;
  moving.enemy.vx = 5; // keep "moving" status for the test
  for (let i = 0; i < 60; i++) { moving.enemy.vx = 5; moving.room.step(); }
  const lostMoving = h1 - moving.enemy.hp;
  assert.ok(lostStill > 3, `bleed too weak (${lostStill})`);
  assert.ok(lostMoving > lostStill * 1.4, `moving bleed (${lostMoving}) should exceed standing bleed (${lostStill})`);
}

// ---- Fire Pool: ground zone where aimed, burns enemies standing in it
{
  const { room, shooter, enemy } = setup(['firepool', 'dash', 'heal']);
  act(room, shooter, [enemy.x, 0, enemy.z], { q: true });
  assert.equal(room.zones.length, 1, 'no pool');
  assert.ok(Math.hypot(room.zones[0].x - enemy.x, room.zones[0].z - enemy.z) < 1.5, 'pool not where aimed');
  const hp0 = enemy.hp;
  idle(room, 60);
  assert.ok(enemy.hp < hp0 - 8, 'enemy in the pool took no burn damage');
  idle(room, 60 * 6);
  assert.equal(room.zones.length, 0, 'pool did not expire');
}

// ---- Frost Nova: damage + slow within 5m only; slow reduces speed
{
  const { room, shooter, enemy } = setup(['nova', 'dash', 'heal']);
  enemy.z = 25; // 3m away
  const hp0 = enemy.hp;
  act(room, shooter, [enemy.x, 1.0, enemy.z], { q: true });
  assert.ok(enemy.hp < hp0, 'nova did no damage');
  assert.ok(enemy.slowT > 2, 'enemy not slowed');
  const slow = { x: -28, y: 0, z: 0, vx: 0, vy: 0, vz: 0, dvx: 0, dvz: 0, dashT: 0, rootT: 0, slowT: 10, speed: 7 };
  const fast = { ...slow, slowT: 0 };
  for (let i = 0; i < 90; i++) { stepPlayer(slow, { mx: 0, mz: 1, yaw: -Math.PI / 2, jump: false }, DT); stepPlayer(fast, { mx: 0, mz: 1, yaw: -Math.PI / 2, jump: false }, DT); }
  assert.ok(Math.abs(slow.x + 28) < Math.abs(fast.x + 28) * 0.7, 'slow did not reduce distance covered');
  const out = setup(['nova', 'dash', 'heal']);
  out.enemy.z = 18; // 10m away
  const o0 = out.enemy.hp;
  act(out.room, out.shooter, [out.enemy.x, 1.0, out.enemy.z], { q: true });
  assert.equal(out.enemy.hp, o0, 'nova hit outside its radius');
}

// ---- Warden heals 50% more, max HP respected
{
  const { room, shooter } = setup(['heal', 'dash', 'shield']);
  shooter.model = 'warden'; shooter.maxHp = MODELS.warden.hp; shooter.healMult = MODELS.warden.healMult; shooter.hp = 50;
  act(room, shooter, [shooter.x, 1.0, shooter.z - 5], { q: true });
  assert.ok(Math.abs(shooter.hp - (50 + 35 * 1.5)) < 0.01, `warden heal wrong (${shooter.hp})`);
  shooter.hp = shooter.maxHp - 5; shooter.cd[0] = 0;
  act(room, shooter, [shooter.x, 1.0, shooter.z - 5], { q: true });
  assert.equal(shooter.hp, shooter.maxHp, 'heal exceeded max HP');
}

// ---- DoT kills are credited
{
  const { room, shooter, enemy } = setup(['barbed', 'dash', 'heal']);
  act(room, shooter, [enemy.x, 1.0, enemy.z], { q: true });
  act(room, shooter, [enemy.x, 1.0, enemy.z], { shoot: true });
  enemy.hp = 2;
  idle(room, 60);
  assert.equal(enemy.alive, false, 'bleed did not kill');
  assert.equal(shooter.kills, 1, 'bleed kill not credited to shooter');
}


// ---- Crouch: smaller hitbox, lower head, half speed, no jumping
{
  const { room, shooter, enemy } = setup(['dash', 'heal', 'shield']);
  enemy.crouch = true;
  const hit = () => room.events.some((e) => e.k === 'hit' && e.a === shooter.id && e.v === enemy.id);
  const shotAt = (h) => { room.events = []; shooter.fireCd = 0; act(room, shooter, [enemy.x, h, enemy.z], { shoot: true }); return hit(); };
  assert.equal(shotAt(1.5), false, 'shot above a crouched head should miss');
  assert.equal(shotAt(0.5), true, 'body shot on crouched player should hit');
  room.events = []; shooter.fireCd = 0; enemy.hp = enemy.maxHp;
  act(room, shooter, [enemy.x, 1.0, enemy.z], { shoot: true });
  assert.ok(room.events.some((e) => e.k === 'hit' && e.head), 'crouched head height (>0.8m) should count as a headshot');
  const standing = { x: -28, y: 0, z: 0, vx: 0, vy: 0, vz: 0, dvx: 0, dvz: 0, dashT: 0, rootT: 0, slowT: 0, speed: 7 };
  const crouched = { ...standing };
  for (let i = 0; i < 90; i++) {
    stepPlayer(standing, { mx: 0, mz: 1, yaw: -Math.PI / 2, jump: false }, DT);
    stepPlayer(crouched, { mx: 0, mz: 1, yaw: -Math.PI / 2, jump: false, crouch: true }, DT);
  }
  const ratio = (crouched.x + 28) / (standing.x + 28);
  assert.ok(ratio > 0.4 && ratio < 0.6, `crouch speed ratio ${ratio}`);
  const j = { ...standing, x: -28, z: 0, vx: 0, vz: 0 };
  stepPlayer(j, { mx: 0, mz: 0, yaw: 0, jump: true, crouch: true }, DT);
  assert.equal(j.y, 0, 'crouched player jumped');
}

// ---- Shockwave: aimed shot, pushes the first enemy hit straight back, no damage
{
  const { room, shooter, enemy } = setup(['shockwave', 'dash', 'heal']);
  const hp0 = enemy.hp, z0 = enemy.z;
  act(room, shooter, [enemy.x, 1.0, enemy.z], { q: true });
  assert.equal(enemy.hp, hp0, 'shockwave must not deal damage');
  assert.ok(enemy.dashT > 0 && enemy.dvz < -5, 'enemy should be pushed away from the shooter');
  for (let i = 0; i < 20; i++) { room.queueInput(enemy, { seq: 500 + i, mx: 0, mz: 0, yaw: 0, pitch: 0, jump: false }); room.step(); }
  assert.ok(enemy.z < z0 - 2, `enemy should have moved back (z ${z0} -> ${enemy.z})`);
  const m = setup(['shockwave', 'dash', 'heal']);
  act(m.room, m.shooter, [m.enemy.x + 6, 1.0, m.enemy.z], { q: true });
  assert.equal(m.enemy.dashT, 0, 'missed shockwave pushed someone');
}

// ---- Lava hazard (Hades' Foundry): standing in the pit burns anyone, with no kill credit
{
  const room = new Room(2, 'foundry');
  const p = room.players.find((q) => q.team === 0);
  const foe = room.players.find((q) => q.team === 1);
  for (const o of room.players) { o.isBot = false; if (o !== p && o !== foe) o.alive = false; }
  room.phase = 'live'; room.phaseT = 0; room.roundT = 999;
  p.x = 1; p.z = 1; p.y = 0;
  const hp0 = p.hp;
  idle(room, 60);
  assert.ok(hp0 - p.hp > 8, `lava did too little damage (${hp0 - p.hp})`);
  assert.ok(p.burnT >= 0);
  const q = new Room(2, 'foundry');
  const r = q.players.find((x) => x.team === 0);
  const foe2 = q.players.find((x) => x.team === 1);
  for (const o of q.players) { o.isBot = false; if (o !== r && o !== foe2) o.alive = false; }
  q.phase = 'live'; q.phaseT = 0; q.roundT = 999;
  const h1 = r.hp; // stays on its own spawn, far from the pit
  idle(q, 60);
  assert.equal(r.hp, h1, 'player away from the pit lost HP');
}

console.log('skills: ok');
