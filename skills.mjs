// Unit tests for the status-effect skills, using two hand-placed players.
import assert from 'node:assert/strict';
import { Room } from '../game.js';
import { stepPlayer, DT, EYE_H, MODELS } from '../shared/sim.js';

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

// ---- Bind: roots the target, who then cannot move; wears off
{
  const { room, shooter, enemy } = setup(['bind', 'dash', 'heal']);
  act(room, shooter, [enemy.x, 1.0, enemy.z], { q: true });
  assert.ok(enemy.rootT > 1.5, `enemy should be rooted (rootT=${enemy.rootT})`);
  const x0 = enemy.x, z0 = enemy.z;
  for (let i = 0; i < 30; i++) {
    room.queueInput(enemy, { seq: i + 1, mx: 1, mz: 1, yaw: 0, pitch: 0, jump: true, shoot: false });
    room.step();
  }
  assert.ok(Math.hypot(enemy.x - x0, enemy.z - z0) < 0.05, 'rooted player moved');
  assert.equal(enemy.y, 0, 'rooted player jumped');
  // bind misses when aimed off-target
  const { room: r2, shooter: s2, enemy: e2 } = setup(['bind', 'dash', 'heal']);
  act(r2, s2, [e2.x + 6, 1.0, e2.z], { q: true });
  assert.equal(e2.rootT, 0, 'missed bind rooted someone');
  // root wears off through stepPlayer
  const st = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, dvx: 0, dvz: 0, dashT: 0, rootT: 0.1, slowT: 0 };
  for (let i = 0; i < 10; i++) stepPlayer(st, { mx: 0, mz: 1, yaw: 0, jump: false }, DT);
  assert.equal(st.rootT, 0);
  for (let i = 0; i < 30; i++) stepPlayer(st, { mx: 0, mz: 1, yaw: 0, jump: false }, DT);
  assert.ok(st.z < -1, 'player should move again after the root ends');
}

// ---- Incendiary Rounds: fire zone under the target + burning damage
{
  const { room, shooter, enemy } = setup(['incendiary', 'dash', 'heal']);
  act(room, shooter, [enemy.x, 1.0, enemy.z], { q: true });
  assert.ok(shooter.fireBuffT > 5, 'buff not active');
  act(room, shooter, [enemy.x, 1.0, enemy.z], { shoot: true });
  assert.equal(room.zones.length, 1, 'no fire zone created');
  assert.ok(Math.hypot(room.zones[0].x - enemy.x, room.zones[0].z - enemy.z) < 0.01, 'zone not under target');
  assert.ok(enemy.burnT > 0, 'target not burning');
  const hp0 = enemy.hp;
  idle(room, 60);
  assert.ok(hp0 - enemy.hp > 10, `burn did too little damage (${hp0 - enemy.hp})`);
  const snap = room.snapshot();
  assert.ok(snap.zn.length >= 1 && snap.p.some((p) => p.sf & 4), 'snapshot missing zone or burn flag');
  // allies of the caster are not burned
  assert.equal(shooter.burnT, 0);
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

// ---- Explosive Rounds: AoE hits a second enemy within 3m, not one farther away
{
  const { room, shooter, enemy, extra } = setup(['explosive', 'dash', 'heal']);
  act(room, shooter, [enemy.x, 1.0, enemy.z], { q: true });
  const e0 = extra.hp;
  act(room, shooter, [enemy.x, 1.0, enemy.z], { shoot: true });
  assert.ok(extra.hp < e0, 'nearby enemy took no splash damage');
  const far = setup(['explosive', 'dash', 'heal']);
  far.extra.x = -5;
  act(far.room, far.shooter, [far.enemy.x, 1.0, far.enemy.z], { q: true });
  const f0 = far.extra.hp;
  act(far.room, far.shooter, [far.enemy.x, 1.0, far.enemy.z], { shoot: true });
  assert.equal(far.extra.hp, f0, 'distant enemy took splash damage');
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
  const slow = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, dvx: 0, dvz: 0, dashT: 0, rootT: 0, slowT: 10, speed: 7 };
  const fast = { ...slow, slowT: 0 };
  for (let i = 0; i < 90; i++) { stepPlayer(slow, { mx: 0, mz: 1, yaw: 0, jump: false }, DT); stepPlayer(fast, { mx: 0, mz: 1, yaw: 0, jump: false }, DT); }
  assert.ok(Math.abs(slow.z) < Math.abs(fast.z) * 0.7, 'slow did not reduce distance covered');
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

console.log('skills: ok');
