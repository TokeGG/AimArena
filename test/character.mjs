// Sanity checks for character.js: mesh/triangle budget, bounding cylinder, no NaN.
// Needs the real three.js (e.g. node_modules/three on the dev machine); skips itself otherwise.
import assert from 'node:assert/strict';

let THREE;
try { THREE = await import('three'); } catch (e) {
  console.log('character test skipped: `three` is not resolvable here (', e.code || e.message, ')');
  process.exit(0);
}
const { buildCharacter, lookKey, disposeCharacter } = await import('../character.js');
const { LOOK_PARTS, LOOK_PALETTES, sanitizeLook } = await import('../sim.js');

const models = ['striker', 'vanguard', 'phantom', 'warden'];
const all = [];
for (const model of models) for (let helm = 0; helm < LOOK_PARTS.helm.length; helm++) for (let shoulder = 0; shoulder < LOOK_PARTS.shoulder.length; shoulder++) for (let back = 0; back < LOOK_PARTS.back.length; back++) for (let mat = 0; mat < LOOK_PARTS.mat.length; mat++) all.push({ model, helm, shoulder, back, mat });

let seed = 12345;
const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
// shuffle, take at most 400
for (let i = all.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [all[i], all[j]] = [all[j], all[i]]; }
const sample = all.slice(0, 400);

const keys = new Set();
for (const combo of sample) {
  const look = sanitizeLook({ ...combo, c1: pick(LOOK_PALETTES.c1), c2: pick(LOOK_PALETTES.c2), glow: pick(LOOK_PALETTES.glow) });
  const tag = JSON.stringify(look);
  const g = buildCharacter(look, 0xff3030);
  let meshes = 0, tris = 0;
  g.traverse((o) => {
    if (!o.isMesh) return;
    meshes++;
    const geo = o.geometry;
    tris += (geo.index ? geo.index.count : geo.getAttribute('position').count) / 3;
    for (const v of geo.getAttribute('position').array) assert.ok(Number.isFinite(v), `NaN position ${tag}`);
    assert.ok(o.castShadow, `castShadow ${tag}`);
  });
  assert.ok(meshes >= 1 && meshes <= 7, `mesh count ${meshes} ${tag}`);
  assert.ok(tris < 9000, `triangles ${tris} ${tag}`);
  const b = new THREE.Box3().setFromObject(g);
  assert.ok(b.min.x >= -0.5 && b.max.x <= 0.5 && b.min.z >= -0.5 && b.max.z <= 0.5, `xz bounds ${tag}`);
  assert.ok(b.min.y >= -0.01 && b.max.y <= 1.8, `y bounds ${b.min.y}..${b.max.y} ${tag}`);
  keys.add(lookKey(look));
  disposeCharacter(g);
}
assert.ok(keys.size > 1, 'lookKey should vary');
assert.equal(lookKey(sanitizeLook({ model: 'warden' })), lookKey(sanitizeLook({ model: 'warden' })));
assert.notEqual(lookKey(sanitizeLook({ model: 'warden' })), lookKey(sanitizeLook({ model: 'striker' })));
console.log(`character ok (${sample.length} looks)`);
