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

// ---------------------------------------------------------------- colosseum (size 28, north/south teams)
// Gladiator arena: a central plinth, a ring of pillars, low arcs, shielded gates for each team.
const colosseum = {
  id: 'colosseum',
  name: 'Gladiator Colosseum',
  tagline: 'Round sand arena: pillar ring, low arcs, central plinth',
  size: 28,
  ffa: false,
  spawns: [
    { x: -3, z: -25, yaw: Math.PI },
    { x: 3, z: -25, yaw: Math.PI },
    { x: 0, z: -23.2, yaw: Math.PI },
  ],
  walls: build([
    [0, 0, 4, 4, 3.5, 'temple'],
  ], [
    // gates
    [0, -18, 20, 1.2, SHIELD_H, 'shield'],
    [-10.6, -24.75, 1.2, 6.5, SHIELD_H, 'shield'],
    [10.6, -24.75, 1.2, 6.5, SHIELD_H, 'shield'],
    // pillar ring
    [11, 0, 1.6, 1.6, 3],
    [0, 10, 1.6, 1.6, 3],
    [8, 8, 1.6, 1.6, 3],
    [8, -8, 1.6, 1.6, 3],
    // low arcs
    [6, 0, 1.2, 6, 1.0],
    [-4.5, -6, 5, 1.2, 1.0],
    [4.5, -6, 5, 1.2, 1.0],
    // outer flank cover
    [-18, -6, 1.5, 6, 3],
    [-17, 8, 4, 1.5, 3],
  ]),
  hazards: [],
  theme: {
    haze: 0x1c1208,
    sky: [[0, '#0a0603'], [0.3, '#1d1208'], [0.46, '#5a3412'], [0.5, '#d8832a'], [0.56, '#4a2a10'], [1, '#1c1208']],
    stars: false,
    marble: 0xb09a72, marbleDark: 0x6b5a3a, sand: 0x9a7a48, sandDark: 0x6a5230, gold: 0xf0c050,
    floor: '#6a5636', floorTint: 'rgba(255,200,120,.08)', floorLine: 'rgba(30,18,4,.55)',
    hemi: [0xe0b070, 0x3a2812, 1.0],
    moon: [0xffd08a, 1.2],
    moonDisc: 0xffe6b0, moonHalo: 0xf09030,
    torch: 0xffb040,
    ground: 0x2a1c0c, mountain: 0x3a2812, cloud: 0x8a5a2a,
    accent: 0xf0c050,
  },
};

// ---------------------------------------------------------------- agora (size 24, north/south, compact market square)
const agora = {
  id: 'agora',
  name: 'Agora Market',
  tagline: 'Compact square with stalls, fast flanks',
  size: 24,
  ffa: false,
  spawns: [
    { x: -3, z: -21, yaw: Math.PI },
    { x: 3, z: -21, yaw: Math.PI },
    { x: 0, z: -19.2, yaw: Math.PI },
  ],
  walls: build([
    [0, 0, 3, 3, 3],
  ], [
    [0, -14, 18, 1.2, SHIELD_H, 'shield'],
    [-9.6, -20.75, 1.2, 6.5, SHIELD_H, 'shield'],
    [9.6, -20.75, 1.2, 6.5, SHIELD_H, 'shield'],
    // stalls
    [7, 0, 1.2, 5, 3],
    [0, 6, 5, 1.2, 3],
    [-6.5, -6.5, 3, 3, 1.0],
    [6.5, -6.5, 3, 3, 1.0],
    [-12, 0, 1.6, 1.6, 3],
    [12, 8, 1.6, 1.6, 3],
    [-12, 8, 1.6, 1.6, 3],
  ]),
  hazards: [],
  theme: {
    haze: 0x0e1a1f,
    sky: [[0, '#03080c'], [0.3, '#08202a'], [0.46, '#1a5a66'], [0.5, '#4aa8a0'], [0.56, '#145058'], [1, '#0e1a1f']],
    stars: true,
    marble: 0x8aa8a4, marbleDark: 0x47625f, sand: 0x5c6a5a, sandDark: 0x3c4a3c, gold: 0x7ff0d8,
    floor: '#3c5654', floorTint: 'rgba(160,255,230,.07)', floorLine: 'rgba(4,16,14,.6)',
    hemi: [0x70c8c0, 0x1c2e2c, 0.95],
    moon: [0xb0fff0, 1.2],
    moonDisc: 0xe0fff8, moonHalo: 0x50d8c0,
    torch: 0x7ff0d8,
    ground: 0x10201e, mountain: 0x163230, cloud: 0x3a7a72,
    accent: 0x7ff0d8,
  },
};

// ---------------------------------------------------------------- dunes (size 38, west/east teams, ruined desert)
const dunes = {
  id: 'dunes',
  name: 'Ember Dunes',
  tagline: 'Wide desert ruins, dune ridges and broken arches',
  size: 38,
  ffa: false,
  spawns: [
    { x: -34, z: -3, yaw: -Math.PI / 2 },
    { x: -34, z: 3, yaw: -Math.PI / 2 },
    { x: -35.8, z: 0, yaw: -Math.PI / 2 },
  ],
  walls: build([
    [0, 0, 5, 5, 3],
  ], [
    [-29, 0, 1.2, 12, SHIELD_H, 'shield'],
    [-20, 12, 1.2, 8, 3],
    [-12, -10, 6, 1.2, 1.0],
    [-8, 18, 5, 5, 3],
    [-22, -22, 6, 1.2, 3],
    [-6, -5, 1.6, 1.6, 3],
    [8, -16, 1.2, 6, 1.0],
    [14, 8, 4, 4, 3.5, 'temple'],
    [-14, 28, 1.6, 1.6, 3],
    [2, 30, 1.6, 1.6, 3],
    [-8, -26, 12, 1.2, 1.0],
    [16, -24, 1.6, 1.6, 3],
  ]),
  hazards: [],
  theme: {
    haze: 0x1a0e08,
    sky: [[0, '#0a0402'], [0.3, '#241008'], [0.46, '#6a2a10'], [0.5, '#f08a3a'], [0.56, '#5a2410'], [1, '#1a0e08']],
    stars: false,
    marble: 0xc0966a, marbleDark: 0x7a5a3a, sand: 0xb8884a, sandDark: 0x8a6232, gold: 0xffc060,
    floor: '#8a6a40', floorTint: 'rgba(255,170,90,.09)', floorLine: 'rgba(40,20,4,.5)',
    hemi: [0xf0a860, 0x3a2410, 1.05],
    moon: [0xffb070, 1.3],
    moonDisc: 0xffd0a0, moonHalo: 0xff7a20,
    torch: 0xff9030,
    ground: 0x30200e, mountain: 0x4a2a14, cloud: 0xa05a2a,
    accent: 0xffc060,
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

// ---------------------------------------------------------------- ashpit (size 32, FFA arena around a lava pit)
const ASH_SPAWNS = [[27, -27], [0, -27], [-27, -27], [27, -9], [-27, -9], [13, -14], [-13, -14]]
  .flatMap(([x, z]) => [{ x, z }, { x: -x, z: -z }]);
const ashpit = {
  id: 'ashpit',
  name: 'Ashpit',
  tagline: 'Free-for-all ring around a lava pit, bridges and pillars',
  size: 32,
  ffa: true,
  ffaSpawns: ASH_SPAWNS,
  walls: build([
    [0, 0, 14, 1.2, 1.0, 'low'],
  ], [
    [0, 0, 1.2, 14, 1.0, 'low'],
    [0, -12, 1.6, 1.6, 3],
    [12, 0, 1.6, 1.6, 3],
    [9, -9, 1.6, 1.6, 3],
    [-9, -9, 1.6, 1.6, 3],
    [-20, -18, 6, 1.2, 3],
    [20, -4, 1.2, 6, 3],
    [-22, 2, 4, 4, 3.5, 'temple'],
    [8, -22, 5, 1.2, 1.0],
    [-4, -20, 1.2, 4, 1.0],
  ]),
  hazards: mirrorHaz([[0, 0, 6]]),
  theme: { ...foundry.theme },
};

// ---------------------------------------------------------------- range (size 22, solo practice)
// A small open yard with a few cover pieces; the dummies live here. Not offered in the normal menus.
const range = {
  id: 'range',
  name: 'Practice Range',
  tagline: 'Solo target practice with moving dummies',
  size: 22,
  ffa: true,
  range: true,
  ffaSpawns: [[-16, -14], [0, -18], [16, -14]].flatMap(([x, z]) => [{ x, z }, { x: -x, z: -z }]),
  walls: build([], [
    [11, -10, 4, 1.2, 3], [-6, -12, 1.2, 4, 3], [14, 10, 3, 3, 1.0], [4, -4, 3, 1.2, 1.0], [-14, 4, 1.2, 6, 3],
  ]),
  hazards: [],
  theme: { ...olympus.theme },
};

export const MAPS = { olympus, foundry, frostpeak, colosseum, agora, dunes, necropolis, ashpit, range };
export const MAP_IDS = Object.keys(MAPS);
export const DEFAULT_MAP = 'olympus';
export const TEAM_MAP_IDS = MAP_IDS.filter((id) => !MAPS[id].ffa);
export const FFA_MAP_IDS = MAP_IDS.filter((id) => MAPS[id].ffa && !MAPS[id].range);
