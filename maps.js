// Arena maps: pure data, no imports (sim.js imports this module).
// Every map is point-symmetric: each wall/hazard at (x,z) has a twin at (-x,-z).
// size: arena half-extent (arena spans -size..size on x and z). ffa: true = deathmatch-only map.
// Team maps list 3 team-0 spawns {x,z,yaw}; team 1 is derived by the sim as (-x,-z,yaw+PI).
// FFA maps list ffaSpawns {x,z}. Yaw 0 faces -z (look dir = (-sin yaw, -cos yaw)).
const SHIELD_H = 3.5;

const box = (cx, cz, w, d, h, kind) => ({
  minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2, h, kind,
});

// centre: self-symmetric pieces [x,z,w,d,h,kind] at (0,0) only; half: pairs [x,z,w,d,h,kind?] (twin is added)
function build(centre, half) {
  const walls = [];
  for (const [x, z, w, d, h, kind] of centre) walls.push(box(x, z, w, d, h, kind || (h < 2 ? 'low' : 'cover')));
  for (const [x, z, w, d, h, kind] of half) {
    const k = kind || (h < 2 ? 'low' : 'cover');
    walls.push(box(x, z, w, d, h, k));
    walls.push(box(-x, -z, w, d, h, k));
  }
  return walls;
}

const mirrorHaz = (list) => {
  const out = [];
  for (const [x, z, r] of list) {
    out.push({ x, z, r });
    if (x !== 0 || z !== 0) out.push({ x: -x, z: -z, r });
  }
  return out;
};

// ---------------------------------------------------------------- olympus (size 30, north/south teams)
const olympus = {
  id: 'olympus',
  name: 'Temple of Zeus',
  tagline: 'Balanced marble ruins around a central temple',
  size: 30,
  ffa: false,
  spawns: [
    { x: -3, z: -26, yaw: Math.PI },
    { x: 3, z: -26, yaw: Math.PI },
    { x: 0, z: -24.5, yaw: Math.PI },
  ],
  walls: build([[0, 0, 5, 5, 3.5, 'temple']], [
    // protective spawn pocket (shield wall + two back walls per team)
    [0, -19.5, 20, 1.2, SHIELD_H, 'shield'],
    [-10.6, -26.75, 1.2, 6.5, SHIELD_H, 'shield'],
    [10.6, -26.75, 1.2, 6.5, SHIELD_H, 'shield'],
    [-20, -12, 6, 1.5, 3],
    [20, -8, 1.5, 6, 3],
    [-8, -11, 4, 1.2, 1.0],
    [9, -14, 3, 3, 3],
    [-14, -5, 2.5, 2.5, 3],
    [6, -6, 1.2, 5, 3],
    [0, -12, 6, 1.2, 1.0],
    [-26, -4, 4, 1.5, 3],
    [26, -15, 4, 1.5, 3],
  ]),
  hazards: [],
  theme: {
    haze: 0x140f24,
    sky: [[0, '#03040c'], [0.3, '#0a0d24'], [0.46, '#2a1a45'], [0.5, '#5a3560'], [0.56, '#2b1a40'], [1, '#140f24']],
    stars: true,
    marble: 0x77748c, marbleDark: 0x4b485f, sand: 0x5e5148, sandDark: 0x483e39, gold: 0xd4a73a,
    floor: '#4a4458', floorTint: 'rgba(190,180,230,.07)', floorLine: 'rgba(10,6,20,.6)',
    hemi: [0x7084cc, 0x2a2236, 0.95],
    moon: [0xaec2ff, 1.25],
    moonDisc: 0xe8efff, moonHalo: 0x7f95ff,
    torch: 0xff9a45,
    ground: 0x1d1a26, mountain: 0x1c1730, cloud: 0x4a3f6e,
    accent: 0xd4a73a,
  },
};

// ---------------------------------------------------------------- foundry (size 20, diagonal corners, lava pit)
const foundry = {
  id: 'foundry',
  name: "Hades' Foundry",
  tagline: 'Tiny corner-to-corner arena around a lava pit',
  size: 20,
  ffa: false,
  // team 0 sits in the north-west corner facing the centre diagonal (yaw -3PI/4)
  spawns: [
    { x: -16, z: -16, yaw: -3 * Math.PI / 4 },
    { x: -13, z: -17.5, yaw: -3 * Math.PI / 4 },
    { x: -17.5, z: -13, yaw: -3 * Math.PI / 4 },
  ],
  walls: build([
    // narrow 1.0 bridge straight across the pit
    [0, 0, 17, 1.2, 1.0, 'low'],
  ], [
    // corner pocket: shield wall closing the corner on the centre side (open to the east)
    [-13, -10, 14, 1.2, SHIELD_H, 'shield'],
    // two more bridges across the pit (twin is the other one)
    [4.5, 0, 1.2, 17, 1.0, 'low'],
    // stepping stones hugging the bridges
    [5.1, -4.5, 2, 2, 1.0, 'low'],
    [-2.9, -4.5, 2, 2, 1.0, 'low'],
    // free stepping stones further out in the lava
    [-5.5, 3.5, 2, 2, 1.0, 'low'],
    // tall pillars around the rim
    [0, -16.5, 1.6, 1.6, 3],
    [-16.5, 0, 1.6, 1.6, 3],
    [10, -14, 1.6, 1.6, 3],
    [14, -6, 1.6, 1.6, 3],
    // low cover along the pit edge
    [-8, -15, 3, 1.2, 1.0],
  ]),
  hazards: mirrorHaz([[0, 0, 7.5]]),
  theme: {
    haze: 0x1a0b0a,
    sky: [[0, '#060203'], [0.3, '#140605'], [0.46, '#3a0f08'], [0.5, '#8a2a0c'], [0.56, '#3a1008'], [1, '#1a0b0a']],
    stars: false,
    marble: 0x6b5a58, marbleDark: 0x3b2f2e, sand: 0x5a3a2e, sandDark: 0x3a2620, gold: 0xe0702a,
    floor: '#3a2a2a', floorTint: 'rgba(255,120,60,.06)', floorLine: 'rgba(10,2,2,.65)',
    hemi: [0xcc6a50, 0x2a1210, 0.85],
    moon: [0xff9a70, 0.9],
    moonDisc: 0xffb070, moonHalo: 0xff5a20,
    torch: 0xff7a2a,
    ground: 0x1a0e0e, mountain: 0x2a100c, cloud: 0x5a2a20,
    accent: 0xff6a1a,
  },
};

// ---------------------------------------------------------------- frostpeak (size 42, west/east teams, huge and open)
const frostpeak = {
  id: 'frostpeak',
  name: 'Frostpeak Ruins',
  tagline: 'Huge open glacier, long sight lines, sniper spires',
  size: 42,
  ffa: false,
  // team 0 at the west end facing +x (yaw -PI/2)
  spawns: [
    { x: -38, z: -3, yaw: -Math.PI / 2 },
    { x: -38, z: 3, yaw: -Math.PI / 2 },
    { x: -40, z: 0, yaw: -Math.PI / 2 },
  ],
  walls: build([
    [0, 0, 6, 6, 3],
  ], [
    // shield screen in front of each base
    [-34, 0, 1.2, 12, SHIELD_H, 'shield'],
    // big rock formations
    [-20, -18, 9, 5, 3],
    [-10, 16, 6, 7, 3],
    [-28, 24, 6, 6, 3],
    [16, -32, 8, 5, 3],
    // long low ridge lines
    [-10, -9, 22, 1.6, 1.0],
    [8, 28, 24, 1.6, 1.0],
    [-14, -30, 1.6, 14, 1.0],
    // isolated sniper pillars
    [-14, 6, 1.6, 1.6, 3],
    [-4, -20, 1.6, 1.6, 3],
    [22, -16, 1.6, 1.6, 3],
  ]),
  hazards: [],
  theme: {
    haze: 0x0b1626,
    sky: [[0, '#02060f'], [0.3, '#06142a'], [0.46, '#12335a'], [0.5, '#4f86a8'], [0.56, '#143250'], [1, '#0b1626']],
    stars: true,
    marble: 0x8fa7c4, marbleDark: 0x51647f, sand: 0x4a6478, sandDark: 0x34495c, gold: 0x9fe8ff,
    floor: '#3b5068', floorTint: 'rgba(190,230,255,.08)', floorLine: 'rgba(5,15,30,.55)',
    hemi: [0x8ab4ff, 0x1e2c40, 1.0],
    moon: [0xcfe4ff, 1.35],
    moonDisc: 0xf2f8ff, moonHalo: 0x8fd0ff,
    torch: 0x7fd8ff,
    ground: 0x121c2c, mountain: 0x1a2b44, cloud: 0x44648a,
    accent: 0x9fe8ff,
  },
};

// ---------------------------------------------------------------- labyrinth (size 18, generated symmetric maze)
// 9x9 cells of pitch 4 (corridors 2.8 m wide, walls 1.2 m thick). Walls are the closed edges between cells;
// the maze is carved symmetrically (cell (i,j) <-> (8-i,8-j)) from a fixed seed, so it is deterministic.
const LAB = { n: 9, pitch: 4, half: 18, t: 1.2, seed: 0 };
function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function labyrinthWalls(seed = LAB.seed, loops = LAB.loops) {
  const { n, pitch: P, half: H, t } = LAB;
  const rnd = mulberry32(seed);
  // edges: 'V' i,j joins (i,j)-(i+1,j) (wall along z); 'H' i,j joins (i,j)-(i,j+1) (wall along x)
  const key = (k, i, j) => `${k}${i},${j}`;
  const symE = (k, i, j) => (k === 'V' ? ['V', n - 2 - i, n - 1 - j] : ['H', n - 1 - i, n - 2 - j]);
  const open = new Set();
  const forced = new Map(); // edge key -> kind of closed wall
  const setForced = (k, i, j, kind) => { forced.set(key(k, i, j), kind); const [a, b, c] = symE(k, i, j); forced.set(key(a, b, c), kind); };
  setForced('V', 2, 0, 'shield'); setForced('V', 5, 0, 'shield'); setForced('H', 4, 0, 'shield');
  const openEdge = (k, i, j) => { open.add(key(k, i, j)); const [a, b, c] = symE(k, i, j); open.add(key(a, b, c)); };
  openEdge('V', 3, 0); openEdge('V', 4, 0); openEdge('H', 3, 0); openEdge('H', 5, 0);
  const all = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n - 1; i++) all.push(['V', i, j]);
  for (let j = 0; j < n - 1; j++) for (let i = 0; i < n; i++) all.push(['H', i, j]);
  const cand = all.filter(([k, i, j]) => !forced.has(key(k, i, j)) && !open.has(key(k, i, j)));
  for (let i = cand.length - 1; i > 0; i--) { const r = Math.floor(rnd() * (i + 1)); [cand[i], cand[r]] = [cand[r], cand[i]]; }
  const par = Array.from({ length: n * n }, (_, i) => i);
  const find = (a) => { while (par[a] !== a) { par[a] = par[par[a]]; a = par[a]; } return a; };
  const ends = (k, i, j) => (k === 'V' ? [j * n + i, j * n + i + 1] : [j * n + i, (j + 1) * n + i]);
  for (const [k, i, j] of all) if (open.has(key(k, i, j))) { const [a, b] = ends(k, i, j); par[find(a)] = find(b); }
  // limit straight corridors: at most 2 consecutive open edges in a row/column
  const isOpen = (k, i, j) => open.has(key(k, i, j));
  const runOK = (k, i, j) => {
    let run = 1;
    if (k === 'V') { for (let a = i - 1; a >= 0 && isOpen('V', a, j); a--) run++; for (let a = i + 1; a < n - 1 && isOpen('V', a, j); a++) run++; }
    else { for (let a = j - 1; a >= 0 && isOpen('H', i, a); a--) run++; for (let a = j + 1; a < n - 1 && isOpen('H', i, a); a++) run++; }
    return run <= 2;
  };
  const unite = (k, i, j) => { const [a, b] = ends(k, i, j); par[find(a)] = find(b); const [s, x, y] = symE(k, i, j); const [c, d] = ends(s, x, y); par[find(c)] = find(d); };
  for (const [k, i, j] of cand) {
    const [a, b] = ends(k, i, j);
    if (find(a) === find(b)) continue;
    if (!runOK(k, i, j)) continue;
    openEdge(k, i, j); unite(k, i, j);
  }
  // extra loops
  let extra = 0;
  for (const [k, i, j] of cand) {
    if (extra >= loops) break;
    if (isOpen(k, i, j) || !runOK(k, i, j)) continue;
    if (rnd() < 0.5) { openEdge(k, i, j); extra++; }
  }
  // build merged wall runs
  const walls = [];
  const cell = (c) => -H + c * P; // node coordinate of grid line c (0..n)
  const clip = (v) => Math.max(-H, Math.min(H, v));
  const kindAt = (k, i, j) => (isOpen(k, i, j) ? null : forced.get(key(k, i, j)) || 'cover');
  // vertical walls (along z) on lines x = cell(i+1)
  for (let i = 0; i < n - 1; i++) {
    let j = 0;
    while (j < n) {
      const kd = kindAt('V', i, j);
      if (!kd) { j++; continue; }
      let e = j;
      while (e + 1 < n && kindAt('V', i, e + 1) === kd) e++;
      const x = cell(i + 1), z0 = clip(cell(j) - t / 2), z1 = clip(cell(e + 1) + t / 2);
      walls.push({ minX: x - t / 2, maxX: x + t / 2, minZ: z0, maxZ: z1, h: kd === 'shield' ? SHIELD_H : 3, kind: kd });
      j = e + 1;
    }
  }
  for (let j = 0; j < n - 1; j++) {
    let i = 0;
    while (i < n) {
      const kd = kindAt('H', i, j);
      if (!kd) { i++; continue; }
      let e = i;
      while (e + 1 < n && kindAt('H', e + 1, j) === kd) e++;
      const z = cell(j + 1), x0 = clip(cell(i) - t / 2), x1 = clip(cell(e + 1) + t / 2);
      walls.push({ minX: x0, maxX: x1, minZ: z - t / 2, maxZ: z + t / 2, h: kd === 'shield' ? SHIELD_H : 3, kind: kd });
      i = e + 1;
    }
  }
  // pillars on interior grid nodes that no wall touches (breaks diagonal sight lines)
  for (let a = 1; a < n; a++) for (let b = 1; b < n; b++) {
    const x = cell(a), z = cell(b);
    const touched = [['V', a - 1, b - 1], ['V', a - 1, b], ['H', a - 1, b - 1], ['H', a, b - 1]].some(([k, i, j]) => kindAt(k, i, j));
    if (!touched) walls.push({ minX: x - t / 2, maxX: x + t / 2, minZ: z - t / 2, maxZ: z + t / 2, h: 3, kind: 'cover' });
  }
  return walls;
}
LAB.seed = 1266; LAB.loops = 0;
const labyrinth = {
  id: 'labyrinth',
  name: 'Labyrinth of Minos',
  tagline: 'Tight stone maze, doorways everywhere, no long sight lines',
  size: 18,
  ffa: false,
  // team 0 starts in a shielded pocket on the north edge facing south (yaw PI)
  spawns: [
    { x: -4, z: -16, yaw: Math.PI },
    { x: 4, z: -16, yaw: Math.PI },
    { x: 0, z: -16, yaw: Math.PI },
  ],
  walls: labyrinthWalls(),
  hazards: [],
  theme: {
    haze: 0x17120a,
    sky: [[0, '#070502'], [0.3, '#15100a'], [0.46, '#3a2a12'], [0.5, '#8a6a2a'], [0.56, '#33240f'], [1, '#17120a']],
    stars: true,
    marble: 0x8a7b5c, marbleDark: 0x4f4430, sand: 0x6b4f32, sandDark: 0x45331f, gold: 0xe8c04a,
    floor: '#3d3526', floorTint: 'rgba(255,220,140,.06)', floorLine: 'rgba(12,8,2,.65)',
    hemi: [0xc8a860, 0x241a0e, 0.9],
    moon: [0xffe2a0, 1.05],
    moonDisc: 0xfff0c8, moonHalo: 0xe0a840,
    torch: 0xffc24a,
    ground: 0x16110a, mountain: 0x241a0e, cloud: 0x5f4a28,
    accent: 0xe8c04a,
  },
};

// ---------------------------------------------------------------- necropolis (size 48, FFA graveyard city)
// 8 point-symmetric spawn pairs (16 spawns) spread over every district
const NECRO_SPAWNS = [[18, -20], [-44, -28], [-10, -44], [44, -44], [-12, -10], [44, -4], [18, -44], [38, -24]]
  .flatMap(([x, z]) => [{ x, z }, { x: -x, z: -z }]);
const necroHalf = [];
// plaza: low-wall ring (R=8) around the lava well, tall pillars inside the ring
necroHalf.push([-5.2, -8, 6.4, 1.2, 1.0], [5.2, -8, 6.4, 1.2, 1.0], [-8, -5.2, 1.2, 6.4, 1.0], [-8, 5.2, 1.2, 6.4, 1.0]);
necroHalf.push([4.5, -4.5, 1.4, 1.4, 3], [-4.5, -4.5, 1.4, 1.4, 3]);
// crypt alleys (north-west district): tombs and walls on a 7 m grid, away from the moat corner
for (const gx of [-14, -21, -28, -35]) for (const gz of [-14, -21, -28, -35]) {
  if (gx <= -28 && gz <= -28) continue;
  const tomb = ((gx + gz) / 7) % 2 === 0;
  necroHalf.push(tomb ? [gx, gz, 4, 4, 3.5, 'temple'] : [gx, gz, 1.2, 5, 3]);
}
// lava-moat quarter (north-west corner): lava lake, stone island, narrow bridges and stepping stones
necroHalf.push([-37, -37, 5, 5, 1.0], [-37, -37, 1.2, 18, 1.0], [-37, -37, 18, 1.2, 1.0]);
for (const [x, z] of [[-42, -42], [-32, -32], [-42, -32], [-32, -42]]) necroHalf.push([x, z, 2, 2, 1.0]);
// sniper avenue (north-east): pillar rows along the north edge, flanking low parapets
for (const x of [14, 22, 30, 38]) necroHalf.push([x, -44, 1.6, 1.6, 3]);
for (const x of [18, 26, 34, 42]) necroHalf.push([x, -35, 1.6, 1.6, 3]);
necroHalf.push([28, -39.5, 22, 1.2, 1.0], [44, -26, 1.2, 8, 3], [16, -28, 1.2, 8, 3]);
// open courtyard (north-east): planters, a dais with a shrine pillar
necroHalf.push([22, -18, 3, 3, 1.0], [36, -18, 3, 3, 1.0], [29, -26, 6, 6, 1.0], [29, -26, 1.4, 1.4, 3], [30, -13, 6, 1.2, 3]);
const necropolis = {
  id: 'necropolis',
  name: 'Necropolis',
  tagline: 'Sprawling graveyard city for free-for-all deathmatch',
  size: 48,
  ffa: true,
  ffaSpawns: NECRO_SPAWNS,
  walls: build([[0, 0, 2, 2, 1.0, 'low']], necroHalf),
  hazards: mirrorHaz([[0, 0, 3], [-37, -37, 7.5]]),
  theme: {
    haze: 0x07130f,
    sky: [[0, '#010705'], [0.3, '#04140f'], [0.46, '#0d3a2c'], [0.5, '#2f8a6a'], [0.56, '#0c3026'], [1, '#07130f']],
    stars: true,
    marble: 0x6f8a80, marbleDark: 0x364a43, sand: 0x4a5a3a, sandDark: 0x2f3a26, gold: 0x7cffc4,
    floor: '#27382f', floorTint: 'rgba(120,255,190,.06)', floorLine: 'rgba(2,10,6,.65)',
    hemi: [0x58c4a0, 0x10241c, 0.9],
    moon: [0x9cffd8, 1.15],
    moonDisc: 0xd0fff0, moonHalo: 0x38d8a0,
    torch: 0x6dffb8,
    ground: 0x0c1612, mountain: 0x10241c, cloud: 0x2a5a48,
    accent: 0x7cffc4,
  },
};

export const MAPS = { olympus, foundry, frostpeak, labyrinth, necropolis };
export const MAP_IDS = Object.keys(MAPS);
export const DEFAULT_MAP = 'olympus';
export const TEAM_MAP_IDS = MAP_IDS.filter((id) => !MAPS[id].ffa);
export const FFA_MAP_IDS = MAP_IDS.filter((id) => MAPS[id].ffa);
