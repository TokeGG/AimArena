// Unit tests for the status-effect skills, using two hand-placed players.
import assert from 'node:assert/strict';
import { Room } from '../game.js';
import { LOOK_PARTS, levelFor, xpForLevel, clampLook, unlocksAt, LOOK_UNLOCK, DEFAULT_LOOK, loadoutCost, LOADOUT_BUDGET, SPELLS, stepPlayer, DT, EYE_H, MODELS, sanitizeLook, randomLook, encodeLook, decodeLook } from '../sim.js';

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
function act(room, p, target, flags, keyOnly = false) {
  const a = aimAt(p, target[0], target[1], target[2]);
  const base = { mx: 0, mz: 0, yaw: a.yaw, pitch: a.pitch, jump: false };
  room.queueInput(p, { seq: ++seq, ...base, shoot: false, q: false, e: false, r: false, ...flags });
  room.step();
  // aimed skills: the key only arms them, the next shot fires them (keyOnly = test the arming step by itself)
  if (!keyOnly && !p.isBot) {
    for (const [k, s] of [['q', 0], ['e', 1], ['r', 2]]) {
      if (flags[k] && SPELLS[p.loadout[s]] && SPELLS[p.loadout[s]].aim && p.armed === s) {
        p.fireCd = 0;
        room.queueInput(p, { seq: ++seq, ...base, shoot: true, q: false, e: false, r: false });
        room.step();
      }
    }
  }
}
const idle = (room, n) => { for (let i = 0; i < n; i++) room.step(); };

// ---- models are applied
{
  const { room, shooter } = setup(['dash', 'heal', 'shield']);
  const p = room.addHuman ? shooter : null;
  assert.ok(p);
  for (const [k, m] of Object.entries(MODELS)) assert.ok(m.hp > 0 && m.speed > 0, k);
}

// ---- aimed skills: the key arms, the next shot fires (no ammo used); the rest are instant
{
  const { room, shooter, enemy } = setup(['shockwave', 'dash', 'smoke']);
  for (const id of ['shockwave', 'firepool', 'grapple', 'smoke', 'decoy', 'slowtrap', 'mark', 'gravity', 'polymorph']) assert.ok(SPELLS[id].aim, `${id} should be an aimed skill`);
  for (const id of ['dash', 'shield', 'heal', 'pushback', 'nova', 'blink', 'bind', 'barbed', 'overcharge']) assert.ok(!SPELLS[id].aim, `${id} should not need a shot`);
  assert.ok(Object.values(SPELLS).filter((s) => s.aim).length + 3 > Object.keys(SPELLS).length / 2, 'most skills should be shot-based');
  const ammo0 = shooter.ammo;
  act(room, shooter, [enemy.x, 1.0, enemy.z], { q: true }, true);
  assert.equal(shooter.armed, 0, 'key should arm the skill');
  assert.equal(shooter.cd[0], 0, 'arming must not start the cooldown');
  assert.equal(room.meFor(shooter).ar, 0, 'armed slot is sent to the client');
  act(room, shooter, [enemy.x, 1.0, enemy.z], { q: true }, true);
  assert.equal(shooter.armed, -1, 'pressing again puts it away');
  act(room, shooter, [enemy.x, 1.0, enemy.z], { q: true }, true);
  act(room, shooter, [enemy.x, 1.0, enemy.z], { r: true }, true);
  assert.equal(shooter.armed, 2, 'arming another skill swaps');
  act(room, shooter, [enemy.x, 1.0, enemy.z], { r: true }, true); // disarm smoke, re-arm shockwave
  act(room, shooter, [enemy.x, 1.0, enemy.z], { q: true }, true);
  assert.equal(shooter.armed, 0);
  shooter.fireCd = 0; shooter.ammo = 0; // no ammo at all: the skill shot still works
  room.events = [];
  act(room, shooter, [enemy.x, 1.0, enemy.z], { shoot: true });
  assert.equal(shooter.armed, -1, 'the shot uses the armed skill up');
  assert.ok(shooter.cd[0] > 5, 'cooldown starts when the skill is fired');
  assert.equal(shooter.ammo, 0, 'a skill shot costs no ammo');
  assert.ok(room.events.some((e) => e.k === 'shot' && e.sk === 'shockwave'), 'skill shot has a tracer event');
  assert.ok(room.events.some((e) => e.k === 'pushed'), 'shockwave landed');
  assert.ok(!room.events.some((e) => e.k === 'hit'), 'a skill shot does not also do rifle damage');
  // instant skills still go off straight away
  shooter.cd = [0, 0, 0]; shooter.loadout = ['dash', 'heal', 'shield']; shooter.hp = 50;
  act(room, shooter, [enemy.x, 1.0, enemy.z], { e: true });
  assert.ok(shooter.hp > 90 && shooter.armed === -1, 'heal is instant');
  // death clears an armed skill
  shooter.loadout = ['smoke', 'dash', 'heal']; shooter.cd = [0, 0, 0];
  act(room, shooter, [enemy.x, 1.0, enemy.z], { q: true }, true);
  assert.equal(shooter.armed, 0);
  room.kill(shooter, enemy, false);
  assert.equal(shooter.armed, -1, 'dead players are not armed');
  // Decoy / Slow Trap land where the shot lands, not at your feet
  shooter.alive = true; shooter.hp = 150; shooter.loadout = ['decoy', 'slowtrap', 'heal']; shooter.cd = [0, 0, 0]; shooter.fireCd = 0;
  room.decoys = [];
  act(room, shooter, [shooter.x, 0, shooter.z - 12], { q: true });
  assert.equal(room.decoys.length, 1);
  assert.ok(Math.abs(room.decoys[0].z - (shooter.z - 12)) < 1.5 && Math.hypot(room.decoys[0].x - shooter.x, room.decoys[0].z - shooter.z) > 8, `decoy should land where aimed (z=${room.decoys[0].z})`);
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

// ---- Characters: identical stats for everyone, the look is only cosmetic
{
  const list = Object.values(MODELS);
  for (const m of list) {
    assert.equal(m.hp, 150); assert.equal(m.speed, 7); assert.equal(m.healMult, 1);
  }
  const room = new Room(2);
  const p = room.players[0];
  p.look = { ...p.look, model: 'vanguard' };
  assert.equal(p.maxHp, 150);
  // look sanitising: garbage in, valid look out
  const bad = sanitizeLook({ model: 'nope', helm: 99, shoulder: -1, back: 'x', mat: 1.5, c1: 'red', c2: '#GGGGGG', glow: '#ABCDEF' });
  assert.deepEqual(bad, { model: 'striker', helm: 0, shoulder: 1, back: 1, mat: 0, fx: 0, gun: 0, c1: '#8c939f', c2: '#3a3f4a', glow: '#abcdef' });
  for (let i = 0; i < 200; i++) {
    const l = randomLook();
    assert.deepEqual(decodeLook(l.model, encodeLook(l)), l);
  }
  // rifle skins: 10 of them, level-gated, tolerated when an older client omits the field
  assert.equal(LOOK_PARTS.gun.length, 10);
  assert.equal(LOOK_UNLOCK.gun.length, LOOK_PARTS.gun.length);
  assert.equal(clampLook({ gun: 9 }, 5).gun, 0, 'level 24 skin must be locked at level 5');
  assert.equal(clampLook({ gun: 9 }, 24).gun, 9);
  assert.equal(clampLook({ gun: 1 }, 1).gun, 0, 'guests only get the classic AK');
  assert.equal(decodeLook('striker', '0,1,1,0,8c939f,3a3f4a,35e0ff,0').gun, 0, 'old 8-field looks still decode');
  assert.equal(decodeLook('striker', '0,1,1,0,8c939f,3a3f4a,35e0ff,0,7').gun, 7);
  assert.equal(sanitizeLook({ gun: 99 }).gun, 0);
  assert.deepEqual(decodeLook('phantom', 'garbage'), sanitizeLook({ model: 'phantom' }));
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

// ---- Heal restores 50 for everyone, max HP respected
{
  const { room, shooter } = setup(['heal', 'dash', 'shield']);
  shooter.hp = 50;
  act(room, shooter, [shooter.x, 1.0, shooter.z - 5], { q: true });
  assert.ok(Math.abs(shooter.hp - 100) < 0.01, `heal wrong (${shooter.hp})`);
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
  assert.equal(shotAt(1.6), false, 'shot above a crouched head should miss');
  assert.equal(shotAt(0.5), true, 'body shot on crouched player should hit');
  room.events = []; shooter.fireCd = 0; enemy.hp = enemy.maxHp;
  act(room, shooter, [enemy.x, 1.25, enemy.z], { shoot: true });
  assert.ok(room.events.some((e) => e.k === 'hit' && e.head), 'crouched head height (>1.1m) should count as a headshot');
  const standing = { x: -28, y: 0, z: 0, vx: 0, vy: 0, vz: 0, dvx: 0, dvz: 0, dashT: 0, rootT: 0, slowT: 0, speed: 7 };
  const crouched = { ...standing };
  for (let i = 0; i < 90; i++) {
    stepPlayer(standing, { mx: 0, mz: 1, yaw: -Math.PI / 2, jump: false }, DT);
    stepPlayer(crouched, { mx: 0, mz: 1, yaw: -Math.PI / 2, jump: false, crouch: true }, DT);
  }
  const ratio = (crouched.x + 28) / (standing.x + 28);
  assert.ok(ratio > 0.68 && ratio < 0.82, `crouch speed ratio ${ratio}`);
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

// ---- Ammo: 15 rounds, one shot per second, kills refill +5 (cap 30), nothing fires when empty
{
  const { room, shooter, enemy } = setup(['dash', 'heal', 'shield']);
  assert.equal(shooter.ammo, 15, 'start ammo');
  const aim = () => act(room, shooter, [enemy.x, 0.9, enemy.z], { shoot: true });
  shooter.fireCd = 0; aim();
  assert.equal(shooter.ammo, 14, 'shot costs one round');
  aim(); // still on cooldown
  assert.equal(shooter.ammo, 14, 'cooldown must block the second shot');
  idle(room, 70);
  shooter.fireCd = 0; enemy.hp = 1; enemy.alive = true;
  aim();
  assert.equal(enemy.alive, false, 'enemy should die');
  assert.equal(shooter.ammo, 13 + 5, 'kill gives +5');
  shooter.ammo = 28; shooter.fireCd = 0; enemy.hp = 1; enemy.alive = true; enemy.invulnT = 0;
  aim();
  assert.equal(shooter.ammo, 30, 'ammo cap');
  shooter.ammo = 0; shooter.fireCd = 0; room.events = [];
  aim();
  assert.ok(!room.events.some((e) => e.k === 'shot'), 'empty gun fired');
}

// ---- New skills: Blink, Grapple, Smoke, Decoy + the skill point budget
{
  assert.equal(LOADOUT_BUDGET, 5);
  assert.equal(loadoutCost(['dash', 'heal', 'shield']), 5);
  assert.ok(loadoutCost(['heal', 'shield', 'bind']) > LOADOUT_BUDGET);
  for (let i = 0; i < 40; i++) assert.ok(loadoutCost(new Room(2).players[0].loadout) <= LOADOUT_BUDGET, 'bot loadout over budget');
  for (const id of ['blink', 'grapple', 'smoke', 'decoy']) assert.ok(SPELLS[id] && SPELLS[id].cost >= 1, id);

  // Blink: 9m along the look direction in the open lane
  {
    const { room, shooter, enemy } = setup(['blink', 'dash', 'heal']);
    const z0 = shooter.z;
    act(room, shooter, [shooter.x, 1.6, shooter.z - 10], { q: true });
    assert.ok(Math.abs((z0 - shooter.z) - 9) < 0.6, `blink distance ${z0 - shooter.z}`);
    assert.ok(shooter.cd[0] > 8);
  }
  // Grapple: no wall in range -> nothing happens and almost no cooldown; wall in range -> pulled toward it
  {
    const { room, shooter } = setup(['grapple', 'dash', 'heal']);
    act(room, shooter, [shooter.x, 20, shooter.z - 1], { q: true }); // aim at the sky
    assert.ok(shooter.cd[0] <= 1.05, 'failed grapple should not spend the cooldown');
    // olympus wall near the middle: find one and aim at it from 15m away
    const { WALLS } = await import('../sim.js');
    const w = WALLS.find((x) => x.h >= 3 && x.maxX - x.minX > 2 && Math.abs(x.minZ + x.maxZ) < 40);
    shooter.x = (w.minX + w.maxX) / 2; shooter.z = w.maxZ + 14; shooter.y = 0; shooter.cd[0] = 0;
    const d0 = Math.hypot(shooter.x - (w.minX + w.maxX) / 2, shooter.z - w.maxZ);
    act(room, shooter, [(w.minX + w.maxX) / 2, 1.5, w.maxZ], { q: true });
    assert.ok(shooter.cd[0] > 7, 'grapple should be on cooldown after hooking');
    for (let i = 0; i < 40; i++) act(room, shooter, [(w.minX + w.maxX) / 2, 1.5, w.maxZ], {});
    const d1 = Math.hypot(shooter.x - (w.minX + w.maxX) / 2, shooter.z - w.maxZ);
    assert.ok(d1 < d0 - 3, `grapple should pull toward the wall (${d0.toFixed(1)} -> ${d1.toFixed(1)})`);
  }
  // Smoke: a zone that does not burn anyone
  {
    const { room, shooter, enemy } = setup(['smoke', 'dash', 'heal']);
    act(room, shooter, [enemy.x, 0, enemy.z], { q: true });
    const z = room.snapshot().zn.find((q) => q.k === 1);
    assert.ok(z && z.r > 3, 'smoke zone missing');
    enemy.x = z.x; enemy.z = z.z;
    const hp0 = enemy.hp;
    idle(room, 60);
    assert.equal(enemy.hp, hp0, 'smoke must not hurt');
    idle(room, 60 * 7);
    assert.equal(room.snapshot().zn.filter((q) => q.k === 1).length, 0, 'smoke should expire');
  }
  // Decoy: runs forward, soaks one enemy shot, no damage to the owner's team
  {
    const { room, shooter, enemy } = setup(['decoy', 'dash', 'heal']);
    enemy.x = -15; enemy.z = 10; shooter.z = 28;
    act(room, shooter, [shooter.x, 0, shooter.z - 10], { q: true });
    assert.equal(room.decoys.length, 1);
    const d = room.decoys[0];
    const zStart = d.z;
    idle(room, 30); // decoys move on their own
    assert.ok(zStart - d.z > 2, 'decoy should run forward');
    assert.equal(room.snapshot().dc.length, 1);
    // the enemy shoots at the decoy: pops it, shooter untouched
    enemy.x = d.x; enemy.z = d.z + 10; enemy.fireCd = 0; shooter.x = d.x + 6; shooter.z = d.z; // keep shooter out of the line
    const hp = shooter.hp;
    act(room, enemy, [d.x, 0.9, d.z], { shoot: true });
    assert.equal(room.decoys.length, 0, 'decoy should pop');
    assert.equal(shooter.hp, hp);
  }
}

// ---- Slow Trap, Mark, Gravity Well, Overcharge, Polymorph
{
  for (const id of ['slowtrap', 'mark', 'gravity', 'overcharge', 'polymorph']) assert.ok(SPELLS[id], id);
  {
    const { room, shooter, enemy } = setup(['slowtrap', 'dash', 'heal']);
    act(room, shooter, [enemy.x, 1, enemy.z], { q: true });
    assert.equal(room.zones.filter((z) => z.kind === 'trap').length, 1);
    shooter.cd[0] = 0; shooter.x += 0.1; act(room, shooter, [enemy.x, 1, enemy.z], { q: true });
    shooter.cd[0] = 0; shooter.x += 0.1; act(room, shooter, [enemy.x, 1, enemy.z], { q: true });
    assert.equal(room.zones.filter((z) => z.kind === 'trap' && z.t > 0).length, 2, 'max 2 traps per owner');
    const zn = room.snapshot().zn.filter((z) => z.k === 2);
    assert.ok(zn.length >= 2);
    const trap = room.zones.find((z) => z.kind === 'trap' && z.t > 0);
    idle(room, 60); // armed
    enemy.x = trap.x; enemy.z = trap.z;
    idle(room, 2);
    assert.ok(enemy.slowT > 2, `trap should slow (${enemy.slowT})`);
    assert.ok(trap.t <= 0, 'trap is consumed'); 
  }
  {
    const { room, shooter, enemy } = setup(['mark', 'dash', 'heal']);
    act(room, shooter, [enemy.x, 1.0, enemy.z], { q: true });
    assert.ok(enemy.markT > 4, 'mark should apply');
    assert.equal(room.snapshot().p.find((p) => p.id === enemy.id).mk, shooter.team + 2);
    const { room: r2, shooter: s2 } = setup(['mark', 'dash', 'heal']);
    act(r2, s2, [s2.x + 30, 1, s2.z], { q: true }); // aimed at nothing
    assert.ok(s2.cd[0] <= 1.1, 'a missed mark must not burn the cooldown');
  }
  {
    const { room, shooter, enemy } = setup(['gravity', 'dash', 'heal']);
    act(room, shooter, [enemy.x + 2, 0.5, enemy.z], { q: true });
    const w = room.zones.find((z) => z.kind === 'well');
    assert.ok(w, 'well created');
    enemy.x = w.x + 3; enemy.z = w.z;
    const d0 = Math.hypot(enemy.x - w.x, enemy.z - w.z);
    idle(room, 40);
    assert.ok(Math.hypot(enemy.x - w.x, enemy.z - w.z) < d0 - 1.5, 'enemy should be dragged toward the well');
  }
  {
    const { room, shooter, enemy } = setup(['overcharge', 'dash', 'heal']);
    act(room, shooter, [enemy.x, 1.0, enemy.z], { q: true });
    assert.equal(room.snapshot().p.find((p) => p.id === shooter.id).bf & 4, 4);
    const hp = enemy.hp;
    act(room, shooter, [enemy.x, 0.9, enemy.z], { shoot: true });
    assert.ok(hp - enemy.hp >= 40, `overcharged shot should be double (${hp - enemy.hp})`);
    assert.equal(shooter.overT, 0);
    assert.equal(room.events.filter((e) => e.k === 'hit').at(-1).tg, 'oc', 'overcharged hits are tagged for the sound');
  }
  {
    const { room, shooter, enemy } = setup(['polymorph', 'dash', 'heal']);
    enemy.loadout = ['dash', 'heal', 'shield']; enemy.cd = [0, 0, 0];
    act(room, shooter, [enemy.x, 1.0, enemy.z], { q: true });
    assert.ok(enemy.polyT > 1.5, 'polymorph applied');
    assert.equal(room.snapshot().p.find((p) => p.id === enemy.id).sf & 32, 32);
    const hp = shooter.hp, ammo = enemy.ammo;
    room.queueInput(enemy, { seq: 500, mx: 0, mz: 0, yaw: aimAt(enemy, shooter.x, 1, shooter.z).yaw, pitch: 0, jump: false, shoot: true, e: true });
    room.step();
    assert.equal(enemy.ammo, ammo, 'a sheep cannot shoot');
    assert.equal(shooter.hp, hp);
    idle(room, 130);
    assert.equal(enemy.polyT, 0);
  }
}

// ---- Daily-challenge tallies: only damage to other humans counts
{
  const { room, shooter, enemy } = setup(['dash', 'heal', 'shield']);
  enemy.isBot = true;
  act(room, shooter, [enemy.x, 1.0, enemy.z], { shoot: true });
  assert.equal(shooter.dDmg, 0, 'damage to bots is worth nothing');
  enemy.isBot = false; shooter.fireCd = 0;
  act(room, shooter, [enemy.x, 1.0, enemy.z], { shoot: true });
  assert.ok(shooter.dDmg >= 20, `human damage tallied (${shooter.dDmg})`);
  shooter.cd[0] = 0; act(room, shooter, [enemy.x, 1, enemy.z], { q: true });
  assert.equal(shooter.dCasts, 1);
}

// ---- hit tags: shielded and bound hits sound different
{
  const { room, shooter, enemy } = setup(['bind', 'dash', 'heal']);
  enemy.shieldT = 2;
  act(room, shooter, [enemy.x, 0.9, enemy.z], { shoot: true });
  assert.equal(room.events.filter((e) => e.k === 'hit').at(-1).tg, 'sh');
  const b = setup(['bind', 'dash', 'heal']);
  act(b.room, b.shooter, [b.enemy.x, 1, b.enemy.z], { q: true });
  act(b.room, b.shooter, [b.enemy.x, 0.9, b.enemy.z], { shoot: true });
  assert.equal(b.room.events.filter((e) => e.k === 'hit').at(-1).tg, 'bd');
  const n = setup(['dash', 'heal', 'shield']);
  act(n.room, n.shooter, [n.enemy.x, 0.9, n.enemy.z], { shoot: true });
  assert.equal(n.room.events.filter((e) => e.k === 'hit').at(-1).tg, undefined, 'plain hits carry no tag');
}

// ---- Rematch vote shortens the post-match wait only when every human agrees
{
  const room = new Room(2, 'olympus');
  const [a, b] = room.players.filter((p) => p.team === 0);
  a.isBot = false; b.isBot = false;
  room.scores = [2, 0]; room.endRound(0);
  assert.equal(room.phase, 'matchEnd');
  assert.equal(room.setRematch(a), true);
  room.step();
  assert.ok(room.phaseT > 10, 'one vote of two must not skip the wait');
  assert.equal(room.snapshot().rv, 1); assert.equal(room.snapshot().rh, 2);
  room.setRematch(b); room.step();
  assert.ok(room.phaseT <= 2, 'everyone voted: start soon');
  for (let i = 0; i < 130; i++) room.step();
  assert.equal(room.phase, 'countdown'); assert.equal(a.rematch, false);
  assert.equal(room.setRematch(a), false, 'cannot vote outside the match-end window');
}

// ---- Progression: levels, unlock gating
{
  assert.equal(levelFor(0), 1); assert.equal(levelFor(59), 1); assert.equal(levelFor(60), 2); assert.equal(levelFor(240), 3);
  assert.equal(levelFor(1e9), 30);
  for (let lv = 2; lv <= 30; lv++) assert.equal(levelFor(xpForLevel(lv)), lv);
  const all = { model: 'phantom', helm: 7, shoulder: 5, back: 6, mat: 7, fx: 7, gun: 9, c1: '#112233', c2: '#445566', glow: '#778899' };
  const l1 = clampLook(all, 1);
  assert.deepEqual([l1.helm, l1.shoulder, l1.back, l1.mat, l1.fx], [DEFAULT_LOOK.helm, DEFAULT_LOOK.shoulder, DEFAULT_LOOK.back, DEFAULT_LOOK.mat, DEFAULT_LOOK.fx]);
  assert.equal(clampLook(all, 24).fx, 0, 'Void collapse needs level 25');
  assert.equal(clampLook(all, 25).fx, 7);
  assert.equal(decodeLook('striker', encodeLook(all)).fx, 7, 'fx survives the snapshot string');
  assert.equal(decodeLook('striker', '0,1,1,0,111111,222222,333333').fx, 0, 'old 7-field strings still decode');
  assert.equal(l1.model, 'phantom'); assert.equal(l1.c1, '#112233');
  assert.deepEqual(clampLook(all, 30), all);
  assert.ok(unlocksAt(4).includes('Horned'));
  for (const k of Object.keys(LOOK_UNLOCK)) assert.ok(LOOK_UNLOCK[k][DEFAULT_LOOK[k]] === 1, 'defaults must be free');
}

console.log('skills: ok');
