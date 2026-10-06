// Arena maps: pure data, no imports (sim.js imports this module).
// Every map is point-symmetric: each wall/hazard at (x,z) has a twin at (-x,-z).
const ARENA = 30;
const SHIELD_H = 3.5;

const box = (cx, cz, w, d, h, kind) => ({
  minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2, h, kind,
});

// Same spawn pocket on every map (shield wall + two back walls per team).
const SPAWN = [
  [0, -19.5, 20, 1.2, SHIELD_H, 'shield'],
  [-10.6, -26.75, 1.2, 6.5, SHIELD_H, 'shield'],
  [10.6, -26.75, 1.2, 6.5, SHIELD_H, 'shield'],
];

// A maze column: wall along z at x, from z0 to z1, with a doorway of width `dw` centred on zd.
const column = (x, z0, z1, zd, dw = 2.4, w = 1.2) => {
  const a = zd - dw / 2, b = zd + dw / 2;
  const out = [];
  if (a > z0) out.push([x, (z0 + a) / 2, w, a - z0, 3]);
  if (b < z1) out.push([x, (b + z1) / 2, w, z1 - b, 3]);
  return out;
};

// centre: self-symmetric pieces [x,z,w,d,h,kind] at (0,0) only; half: pairs [x,z,w,d,h]
function build(centre, half) {
  const walls = [];
  for (const [x, z, w, d, h, kind] of centre) walls.push(box(x, z, w, d, h, kind));
  for (const [x, z, w, d, h, kind] of SPAWN) {
    walls.push(box(x, z, w, d, h, kind));
    walls.push(box(-x, -z, w, d, h, kind));
  }
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

// ---------------------------------------------------------------- olympus
const olympus = {
  id: 'olympus',
  name: 'Temple of Zeus',
  tagline: 'Balanced marble ruins around a central temple',
  walls: build([[0, 0, 5, 5, 3.5, 'temple']], [
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

// ---------------------------------------------------------------- foundry
const foundry = {
  id: 'foundry',
  name: "Hades' Foundry",
  tagline: 'Lava pit in the middle, low-wall bridges and tight flanks',
  walls: build([], [
    // stepping stones ringing the pit
    [6.4, 0, 2, 2, 1.0],
    [4.5, -4.5, 2, 2, 1.0],
    [0, -6.4, 2, 2, 1.0],
    [-4.5, -4.5, 2, 2, 1.0],
    // tall pit-side cover
    [11, -3.5, 1.2, 6, 3],
    [-10, -8, 1.2, 5, 3],
    // front of the base
    [0, -12.5, 9, 1.2, 3],
    [-6, -15.5, 3, 1.2, 1.0],
    [14, -13, 4, 1.2, 1.0],
    // tight flank corridors
    [-23.6, -8, 1.2, 12, 3],
    [-27.2, -10, 1.2, 8, 3],
    [-18, -2, 3, 1.2, 1.0],
    [20, -4.5, 1.5, 4, 3],
    [24, -16, 5, 1.2, 3],
  ]),
  hazards: mirrorHaz([[0, 0, 4.5]]),
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

// ---------------------------------------------------------------- frostpeak
const frostpeak = {
  id: 'frostpeak',
  name: 'Frostpeak Ruins',
  tagline: 'Open ice ruins, long sight lines, jumpable ledges',
  walls: build([], [
    // sniper pillar groups (mirror group sits across the map)
    [-24, -6, 1.6, 1.6, 3],
    [-24, -10.6, 1.6, 1.6, 3],
    [-24, -15.2, 1.6, 1.6, 3],
    // a few broken tall walls
    [8, -10, 1.5, 4, 3],
    [-4, -4, 3, 1.2, 3],
    // scattered ice ledges
    [-14, -13, 3, 3, 1.0],
    [-8, -7, 2.5, 2.5, 1.0],
    [2, -10, 4, 2, 1.0],
    [14, -6, 3, 3, 1.0],
    [20, -14, 2.5, 2.5, 1.0],
    [10, -2, 2, 2, 1.0],
    [-17, -2, 4, 2, 1.0],
    [26, -4, 3, 3, 1.0],
    [-3, -14.5, 3, 2, 1.0],
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

// ---------------------------------------------------------------- labyrinth
// Staggered maze columns across the middle band (doorways never line up), open lanes outside it.
// stub: 3 m-deep tall wall jutting 2.4 m into a 4.8 m corridor from its left (-1) or right (+1) side
const stub = (cl, cr, side, z) => (side < 0 ? [cl + 1.2, z, 2.4, 1.2, 3] : [cr - 1.2, z, 2.4, 1.2, 3]);
const labyHalf = [
  ...column(4, -12, 12, -6),
  ...column(10, -12, 12, 5),
  ...column(16, -12, 12, -4),
  ...column(22, -12, 12, 7),
  // stubs break the long lines along each corridor (alternating sides, 2.4 m left open)
  [-1.7, -9, 3.4, 1.2, 3], [-1.7, -1.5, 3.4, 1.2, 3], [-1.7, 3, 3.4, 1.2, 3],
  ...[[-1, -10], [1, -6], [-1, -2], [1, 2], [-1, 6.5], [1, 10]].map(([sd, z]) => stub(4.6, 9.4, sd, z)),
  ...[[-1, -10], [1, -7.5], [-1, -4], [1, 0], [-1, 1.5], [1, 5], [-1, 8.5], [1, 11]].map(([sd, z]) => stub(10.6, 15.4, sd, z)),
  ...[[-1, -10], [1, -8], [-1, -6.5], [1, -2.5], [-1, 1.5], [1, 4], [-1, 8.5], [1, 11]].map(([sd, z]) => stub(16.6, 21.4, sd, z)),
  // outer lane beyond the last column
  ...[[24.6, -10.5], [28, -7], [24.6, -3.5], [28, 0], [24.6, 3.5], [28, 7], [24.6, 10.5]].map(([x, z]) => [x, z, 4, 1.2, 3]),
  // flank lanes outside the band
  [13, -16, 5, 1.2, 3],
  [-8, -15.5, 4, 1.2, 3],
  [26, -17, 1.2, 4, 3],
];
const labyrinth = {
  id: 'labyrinth',
  name: 'Labyrinth of Minos',
  tagline: 'Close-quarters maze, short sight lines, many flanks',
  walls: build([], labyHalf),
  hazards: [],
  theme: {
    haze: 0x0b1710,
    sky: [[0, '#02070a'], [0.3, '#07140f'], [0.46, '#10301f'], [0.5, '#2f6a4c'], [0.56, '#12301f'], [1, '#0b1710']],
    stars: true,
    marble: 0x6d8068, marbleDark: 0x3c4a3b, sand: 0x4f5a3d, sandDark: 0x353d2a, gold: 0x3fe0b0,
    floor: '#2f4034', floorTint: 'rgba(150,230,190,.06)', floorLine: 'rgba(2,10,6,.65)',
    hemi: [0x6fb89a, 0x16241a, 0.9],
    moon: [0xa8ffd8, 1.1],
    moonDisc: 0xd8fff0, moonHalo: 0x4fd0a0,
    torch: 0x3fe8b0,
    ground: 0x101a12, mountain: 0x132218, cloud: 0x2f5a46,
    accent: 0x3fe0b0,
  },
};

export const MAPS = { olympus, foundry, frostpeak, labyrinth };
export const MAP_IDS = Object.keys(MAPS);
export const DEFAULT_MAP = 'olympus';
