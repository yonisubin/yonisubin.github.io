import { Rng, hashSeed } from './rng';
import { generateStreets, type StreetWorld } from './suburbs';

// The world layout as plain data: no three.js, no physics. Everything here is cheap to
// generate for the whole 4 km world at startup; meshes and colliders are built from it
// chunk by chunk as the player moves (world/chunks.ts).
//
// The world is a grid of CELLS × CELLS cells, PITCH metres apart, and each cell has a zone:
//
//   downtown — a grid of raised blocks (sidewalk + lot) with towers, roads on every grid line;
//   suburb, beachtown, village — American-style streets grown by suburbs.ts: arterials,
//       winding subdivision streets and cul-de-sacs, houses on lots, strip malls, schools…;
//   countryside (farm, forest) — open terrain crossed by winding country roads;
//   beach / lake — sand and water, no roads.
//
// All roads, downtown's included, live in one street network (streets.ts), built by
// buildStreets() once the terrain exists (country roads follow the land).
//
// Downtown plan view of one cell, all sizes in metres:
//
//   |<- ROAD ->|<------------- BLOCK_SIZE ------------->|
//              | SIDEWALK |<------- LOT ------->| SIDEWALK |
//
// Grid lines (downtown road centre lines) sit at multiples of PITCH: line k is at
// (k − CELLS/2)·PITCH, so line 26 runs through the origin. Cell c spans lines c … c+1.
// North is −Z.

export const CELLS = 52; // cells per side
export const ROAD_WIDTH = 14; // town roads: 4 lanes × 3.5 m (two each way)
export const RURAL_ROAD_WIDTH = 8; // country roads: one lane each way, with narrow shoulders
export const SIDEWALK = 4;
export const LOT = 56;
export const BLOCK_SIZE = LOT + 2 * SIDEWALK; // 64
export const PITCH = BLOCK_SIZE + ROAD_WIDTH; // 78, distance between block centres
export const CURB_HEIGHT = 0.15; // low enough for the character controller to auto-step
/** Half the size of the whole world (grid plus half a road). */
export const WORLD_HALF = (CELLS * PITCH + ROAD_WIDTH) / 2; // ≈ 2035

/** The coastal road runs along this grid line; cells south of it are beach and sea. */
export const COAST_LINE = 46;

// Building styles. The facade shader draws a different window pattern for each.
export const STYLE_GLASS = 0; // curtain-wall office tower
export const STYLE_BRICK = 1; // brick / stucco with punched windows
export const STYLE_CONCRETE = 2; // concrete with ribbon windows
export const STYLE_HOUSE = 3; // house / barn: residential windows on every floor, a door

/** Vertical rhythm per style, shared with the facade shader. */
export const STYLE_METRICS = [
  { groundFloor: 5.0, floor: 3.8 }, // glass
  { groundFloor: 4.5, floor: 3.2 }, // brick
  { groundFloor: 4.5, floor: 3.5 }, // concrete
  { groundFloor: 0.0, floor: 3.0 }, // house (no shop floor)
] as const;
export const PARAPET = 1.0; // wall above the top floor hiding the roof

export type Zone = 'downtown' | 'suburb' | 'village' | 'beachtown' | 'farm' | 'forest' | 'beach' | 'lake';
const TOWN_ZONES: ReadonlySet<Zone> = new Set(['downtown', 'suburb', 'village', 'beachtown']);
export function isTown(zone: Zone): boolean {
  return TOWN_ZONES.has(zone);
}

export interface Building {
  x: number; // footprint centre
  z: number;
  y: number; // base height (top of the block slab in town; the ground in the countryside)
  width: number; // along X
  depth: number; // along Z (before `yaw`)
  /** Turn about Y (rad): width runs along (cos yaw, −sin yaw). Grid-aligned buildings omit it. */
  yaw?: number;
  height: number; // walls, excluding any pitched roof
  style: number;
  color: [number, number, number]; // linear RGB wall colour
  seed: number; // varies window details per building
  /** Pitched roof on top (houses, barns): ridge height and colour. */
  roof?: { height: number; color: [number, number, number] };
  /** Special buildings get a sign (see game/places.ts). */
  kind?: 'hospital';
}

export interface RoofProp {
  kind: 'ac' | 'tank';
  /** The building it sits on (its roof height changes when the block is on a slope). */
  building: Building;
  x: number;
  y: number; // base height
  z: number;
  size: [number, number, number];
}

export interface Tree {
  x: number;
  y: number; // ground height at the trunk
  z: number;
  scale: number;
  hue: number; // 0..1 foliage colour variation
}

export interface Lamp {
  x: number;
  z: number;
  yaw: number; // radians; the arm points along local +X toward the road
}

export interface Block {
  bx: number;
  bz: number;
  cx: number; // centre
  cz: number;
  zone: Zone;
  park: boolean;
  /** Grass over the lot (parks, suburban gardens). */
  lawn: boolean;
  /** A park with a helipad in the middle (only the block next to the spawn). */
  helipad: boolean;
  buildings: Building[];
  roofProps: RoofProp[];
  trees: Tree[];
  lamps: Lamp[];
}

export interface CityLayout {
  seed: number;
  /** Chebyshev distance in cells from each cell to the nearest town cell (0 in town). */
  townCells: Uint8Array;
  /** Zone of every cell, index bz·CELLS + bx. */
  zones: Zone[];
  /** Downtown blocks (cells in the downtown zone). */
  blocks: Block[];
  /** Block at a cell, or null outside downtown. */
  blockAt(bx: number, bz: number): Block | null;
  /**
   * Every road, plus the suburbs' houses and parcels. Set by buildStreets() right after the
   * terrain is created (see city.ts): country roads follow the land, so they need it.
   */
  streets: StreetWorld;
}

export function cellCenter(c: number): number {
  return (c - (CELLS - 1) / 2) * PITCH;
}
export function lineCoord(k: number): number {
  return (k - CELLS / 2) * PITCH;
}
/** Cell index containing coordinate x (may be outside 0…CELLS-1). */
export function cellOf(x: number): number {
  return Math.floor(x / PITCH + CELLS / 2);
}
/** Kept for older call sites: the centre of block i along one axis. */
export const blockCenter = cellCenter;

// --- Places (deterministic, not random) ---------------------------------------------

/** Downtown centre cell (the old 8×8 city's middle was cell 4; here it's 26). */
export const MID = CELLS / 2;
/** Villages sit on country-road crossings: node (i, k) of the grid, with i and k both ≡ 2 (mod 4) so country roads run through them and connect their streets to the rest of the map. */
export const VILLAGES = [
  { name: 'Eastfield', i: 46, k: 22 },
  { name: 'Westbrook', i: 6, k: 30 },
  { name: 'Pinecrest', i: 42, k: 6 },
];
/** The lake: an ellipse in the northern hills. */
export const LAKE = { x: -560, z: -1250, rx: 300, rz: 200 };

function hash01(seed: number, a: number, b: number): number {
  return (hashSeed(seed, a, b) >>> 0) / 4294967296;
}

/** Normalised ellipse radius (1 on the lake's edge). */
export function lakeRadius(x: number, z: number): number {
  return Math.hypot((x - LAKE.x) / LAKE.rx, (z - LAKE.z) / LAKE.rz);
}

function zoneOf(seed: number, bx: number, bz: number): Zone {
  const x = cellCenter(bx);
  const z = cellCenter(bz);
  if (bz >= COAST_LINE) return 'beach';
  if (lakeRadius(x, z) < 1) return 'lake';
  if (Math.max(Math.abs(x), Math.abs(z)) < 400) return 'downtown';
  if (bz === COAST_LINE - 1 && Math.abs(x) < 900) return 'beachtown';
  for (const v of VILLAGES) {
    if (Math.hypot(x - lineCoord(v.i), z - lineCoord(v.k)) < 120) return 'village';
  }
  // Suburbs: a rough ring around downtown, stretched south toward the beach.
  const jitter = (hash01(seed, bx * 7 + 1, bz * 13 + 5) - 0.5) * 160;
  const r = Math.hypot(x, z > 0 ? z * 0.75 : z);
  if (r + jitter < 1050) return 'suburb';
  // Countryside: hills and forest to the north, farmland elsewhere.
  const north = z + 120 * Math.sin(x / 500);
  return north < -700 ? 'forest' : 'farm';
}

export function generateCity(seed: number): CityLayout {
  const zones: Zone[] = [];
  for (let bz = 0; bz < CELLS; bz++) for (let bx = 0; bx < CELLS; bx++) zones.push(zoneOf(seed, bx, bz));
  const townCells = townCellDistance(zones);

  const grid: (Block | null)[] = new Array(CELLS * CELLS).fill(null);
  const blocks: Block[] = [];
  for (let bz = 0; bz < CELLS; bz++) {
    for (let bx = 0; bx < CELLS; bx++) {
      const zone = zones[bz * CELLS + bx];
      if (zone !== 'downtown') continue;
      const block = generateBlock(seed, bx, bz, zone);
      grid[bz * CELLS + bx] = block;
      blocks.push(block);
    }
  }
  return {
    seed,
    townCells,
    zones,
    blocks,
    blockAt: (bx, bz) => (bx < 0 || bz < 0 || bx >= CELLS || bz >= CELLS ? null : grid[bz * CELLS + bx]),
    streets: null as unknown as StreetWorld, // filled in by buildStreets()
  };
}

/** Zone of the cell under a world point (clamped to the grid). */
export function zoneAtPoint(layout: Pick<CityLayout, 'zones'>, x: number, z: number): Zone {
  const bx = Math.min(CELLS - 1, Math.max(0, cellOf(x)));
  const bz = Math.min(CELLS - 1, Math.max(0, cellOf(z)));
  return layout.zones[bz * CELLS + bx];
}

/** Downtown's edge: its grid spans lines DOWNTOWN_FIRST … DOWNTOWN_LAST. */
export const DOWNTOWN_FIRST = 21;
export const DOWNTOWN_LAST = 31;
export const DOWNTOWN_HALF = ((DOWNTOWN_LAST - DOWNTOWN_FIRST) * PITCH) / 2; // 390

/**
 * Lay out every road (and the suburbs' houses and parcels) and store them in the layout.
 * `height`: the smooth terrain height, which country roads follow.
 */
export function buildStreets(layout: CityLayout, height: (x: number, z: number) => number): StreetWorld {
  const coastZ = lineCoord(COAST_LINE);
  layout.streets = generateStreets({
    seed: layout.seed,
    zoneAt: (x, z) => zoneAtPoint(layout, x, z),
    height,
    water: (x, z) => lakeRadius(x, z) < 1.12 || z > coastZ + 20,
    half: WORLD_HALF,
    downtownHalf: DOWNTOWN_HALF,
    downtownLines: Array.from({ length: DOWNTOWN_LAST - DOWNTOWN_FIRST + 1 }, (_, k) => lineCoord(DOWNTOWN_FIRST + k)),
    coastZ,
    villages: VILLAGES.map((v) => ({ name: v.name, x: lineCoord(v.i), z: lineCoord(v.k) })),
  });
  return layout.streets;
}

/** Distance in cells (Chebyshev) from every cell to the nearest town cell: breadth-first from all town cells. */
function townCellDistance(zones: Zone[]): Uint8Array {
  const n = CELLS;
  const dist = new Uint8Array(n * n).fill(255);
  const queue: number[] = [];
  zones.forEach((z, i) => {
    if (isTown(z)) {
      dist[i] = 0;
      queue.push(i);
    }
  });
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q];
    const bx = i % n;
    const bz = (i - bx) / n;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const x = bx + dx;
        const z = bz + dz;
        if (x < 0 || z < 0 || x >= n || z >= n) continue;
        const j = z * n + x;
        if (dist[j] > dist[i] + 1) {
          dist[j] = dist[i] + 1;
          queue.push(j);
        }
      }
    }
  }
  return dist;
}

// --- Town blocks ---------------------------------------------------------------------

export function generateBlock(seed: number, bx: number, bz: number, zone: Zone): Block {
  const rng = new Rng(hashSeed(seed, bx, bz));
  const cx = cellCenter(bx);
  const cz = cellCenter(bz);

  const helipad = isHelipadBlock(bx, bz);
  const block: Block = {
    bx,
    bz,
    cx,
    cz,
    zone,
    park: false,
    lawn: false,
    helipad,
    buildings: [],
    roofProps: [],
    trees: [],
    lamps: [],
  };
  const homes = zone !== 'downtown';
  addStreetFurniture(block, rng, homes ? 0.55 : 0.85);

  // "Downtown-ness": 1 at the centre, 0 at the edge of downtown. Drives building height.
  const downtown = zone === 'downtown' ? 1 - Math.min(1, Math.hypot(cx, cz) / 450) : 0;
  block.park = helipad || (zone === 'downtown' ? downtown < 0.85 && rng.chance(0.1) : rng.chance(0.08));
  if (block.park) {
    block.lawn = true;
    addParkTrees(block, rng, helipad ? HELIPAD_CLEAR_RADIUS : 0);
    return block;
  }

  if (zone === 'downtown') {
    // Split the lot into a grid of parcels with randomised split positions.
    const splitsX = splitSpan(rng, LOT, downtown > 0.6 && rng.chance(0.35) ? 1 : rng.int(2, 3));
    const splitsZ = splitSpan(rng, LOT, downtown > 0.6 && rng.chance(0.35) ? 1 : 2);
    forEachParcel(block, splitsX, splitsZ, (px, pz, w, d) => addTowerBuilding(block, rng, px, pz, w, d, downtown));
  } else if (zone === 'beachtown' && rng.chance(0.6)) {
    // Seaside shops and flats: low, pastel stucco.
    forEachParcel(block, splitSpan(rng, LOT, 3), splitSpan(rng, LOT, 2), (px, pz, w, d) =>
      addSeasideBuilding(block, rng, px, pz, w, d),
    );
  } else {
    // Houses with front gardens on a lawn.
    block.lawn = true;
    forEachParcel(block, splitSpan(rng, LOT, 3), splitSpan(rng, LOT, 2), (px, pz, w, d) =>
      addHouse(block, rng, px, pz, w, d),
    );
  }
  return block;
}

function forEachParcel(
  block: Block,
  splitsX: number[],
  splitsZ: number[],
  fn: (px: number, pz: number, w: number, d: number) => void,
): void {
  let x0 = -LOT / 2;
  for (const w of splitsX) {
    let z0 = -LOT / 2;
    for (const d of splitsZ) {
      fn(block.cx + x0 + w / 2, block.cz + z0 + d / 2, w, d);
      z0 += d;
    }
    x0 += w;
  }
}

/** Split `span` metres into `n` random-ish parts that sum exactly to `span`. */
function splitSpan(rng: Rng, span: number, n: number): number[] {
  if (n <= 1) return [span];
  // Weights in [0.8, 1.2] keep the smallest part ≥ 2/3 of an even share (≥ 14 m for 3 parts of 56 m).
  const weights = Array.from({ length: n }, () => rng.range(0.8, 1.2));
  const total = weights.reduce((a, b) => a + b, 0);
  return weights.map((w) => (w / total) * span);
}

function addTowerBuilding(
  block: Block,
  rng: Rng,
  px: number,
  pz: number,
  parcelW: number,
  parcelD: number,
  downtown: number,
): void {
  // Taller and glassier toward the centre.
  const tall = downtown * downtown;
  const style = rng.float() < 0.15 + tall * 0.7 ? STYLE_GLASS : rng.chance(0.55) ? STYLE_BRICK : STYLE_CONCRETE;

  const metrics = STYLE_METRICS[style];
  const minFloors = style === STYLE_GLASS ? 6 : 2;
  const maxFloors = Math.round(5 + tall * 40);
  const floors = rng.int(minFloors, Math.max(minFloors, maxFloors));
  // Height snapped to whole floors so windows line up with the roof.
  const height = metrics.groundFloor + floors * metrics.floor + PARAPET;

  // Gap between neighbours plus a little random setback from the parcel edge.
  const inset = 1 + rng.range(0, 2.5);
  const width = parcelW - inset * 2;
  const depth = parcelD - inset * 2;
  if (width < 8 || depth < 8) return;

  block.buildings.push({
    x: px,
    z: pz,
    y: CURB_HEIGHT,
    width,
    depth,
    height,
    style,
    color: wallColor(rng, style),
    seed: rng.int(0, 999),
  });
  addRoofClutter(block, rng, block.buildings[block.buildings.length - 1], px, pz, width, depth, height, style);
}

function addSeasideBuilding(block: Block, rng: Rng, px: number, pz: number, parcelW: number, parcelD: number): void {
  const metrics = STYLE_METRICS[STYLE_BRICK];
  const height = metrics.groundFloor + rng.int(1, 3) * metrics.floor + PARAPET;
  const inset = 1.2 + rng.range(0, 1.5);
  const width = parcelW - inset * 2;
  const depth = parcelD - inset * 2;
  if (width < 8 || depth < 8) return;
  const pastel = rng.pick<[number, number, number]>([
    [0.75, 0.6, 0.45],
    [0.55, 0.7, 0.75],
    [0.8, 0.72, 0.55],
    [0.75, 0.55, 0.55],
    [0.62, 0.72, 0.6],
    [0.82, 0.8, 0.74],
  ]);
  block.buildings.push({ x: px, z: pz, y: CURB_HEIGHT, width, depth, height, style: STYLE_BRICK, color: pastel, seed: rng.int(0, 999) });
  addRoofClutter(block, rng, block.buildings[block.buildings.length - 1], px, pz, width, depth, height, STYLE_BRICK);
}

/** A detached house set back from the street, with a pitched roof and a garden tree or two. */
function addHouse(block: Block, rng: Rng, px: number, pz: number, parcelW: number, parcelD: number): void {
  const floors = rng.chance(0.6) ? 2 : 1;
  const width = Math.min(parcelW - 5, rng.range(9, 13));
  const depth = Math.min(parcelD - 8, rng.range(8, 11));
  if (width < 7 || depth < 7) return;
  // Front of the house faces the nearer street (the block edge on the parcel's side).
  const towardZ = Math.sign(pz - block.cz) || 1;
  const z = pz + towardZ * (parcelD / 2 - depth / 2 - rng.range(3.5, 5.5));
  const x = px + rng.range(-1, 1) * Math.max(0, (parcelW - width) / 2 - 2);
  const wall = rng.pick<[number, number, number]>([
    [0.78, 0.74, 0.66],
    [0.7, 0.62, 0.5],
    [0.62, 0.66, 0.68],
    [0.8, 0.78, 0.72],
    [0.55, 0.42, 0.32],
    [0.72, 0.68, 0.55],
    [0.5, 0.56, 0.5],
  ]);
  const roofColor = rng.pick<[number, number, number]>([
    [0.12, 0.12, 0.13],
    [0.32, 0.12, 0.08],
    [0.22, 0.16, 0.12],
    [0.2, 0.22, 0.25],
  ]);
  block.buildings.push({
    x,
    z,
    y: CURB_HEIGHT,
    width,
    depth,
    height: floors * STYLE_METRICS[STYLE_HOUSE].floor + 0.4,
    style: STYLE_HOUSE,
    color: wall,
    seed: rng.int(0, 999),
    roof: { height: rng.range(2.2, 3.4), color: roofColor },
  });
  // A garden tree in the back yard.
  if (rng.chance(0.7)) {
    const tz = pz - towardZ * (parcelD / 2 - 3.5);
    block.trees.push({ x: px + rng.range(-parcelW / 3, parcelW / 3), y: CURB_HEIGHT, z: tz, scale: rng.range(0.8, 1.2), hue: rng.float() });
  }
}

function addRoofClutter(
  block: Block,
  rng: Rng,
  building: Building,
  px: number,
  pz: number,
  width: number,
  depth: number,
  height: number,
  style: number,
): void {
  // Rooftop clutter: AC units on most roofs, water tanks on older brick buildings.
  const roofY = height - PARAPET;
  const acCount = rng.int(1, Math.min(6, Math.floor((width * depth) / 120) + 1));
  for (let i = 0; i < acCount; i++) {
    const sx = rng.range(1.5, 3);
    const sz = rng.range(1.5, 3);
    block.roofProps.push({
      building,
      kind: 'ac',
      x: px + rng.range(-width / 2 + 2, width / 2 - 2),
      y: roofY,
      z: pz + rng.range(-depth / 2 + 2, depth / 2 - 2),
      size: [sx, rng.range(1, 1.8), sz],
    });
  }
  if (style === STYLE_BRICK && rng.chance(0.5)) {
    const r = rng.range(1.2, 1.8);
    block.roofProps.push({
      building,
      kind: 'tank',
      x: px + rng.range(-width / 4, width / 4),
      y: roofY,
      z: pz + rng.range(-depth / 4, depth / 4),
      size: [r, rng.range(3, 4), r],
    });
  }
}

/** Plausible wall colours per style, as linear RGB. */
function wallColor(rng: Rng, style: number): [number, number, number] {
  const jitter = (c: [number, number, number], j: number): [number, number, number] => {
    const k = 1 + rng.range(-j, j);
    return [c[0] * k, c[1] * k, c[2] * k];
  };
  if (style === STYLE_GLASS) {
    // Mullion / spandrel colour: dark bronze, steel grey or near-black.
    return jitter(rng.pick<[number, number, number]>([[0.09, 0.08, 0.07], [0.22, 0.23, 0.25], [0.04, 0.05, 0.06]]), 0.15);
  }
  if (style === STYLE_BRICK) {
    return jitter(
      rng.pick<[number, number, number]>([
        [0.32, 0.1, 0.06], // red brick
        [0.4, 0.2, 0.11], // orange brick
        [0.22, 0.12, 0.08], // brown brick
        [0.6, 0.52, 0.4], // sand stucco
        [0.55, 0.55, 0.52], // pale grey stucco
      ]),
      0.1,
    );
  }
  return jitter(rng.pick<[number, number, number]>([[0.45, 0.44, 0.41], [0.36, 0.36, 0.36], [0.5, 0.47, 0.42]]), 0.1);
}

/** Street trees and lamp posts along all four sidewalks of a block. */
function addStreetFurniture(block: Block, rng: Rng, treeChance: number): void {
  const half = BLOCK_SIZE / 2;
  const treeInset = 1.4; // from the curb
  const lampInset = 0.5;
  const sides = [
    { nx: 1, nz: 0 },
    { nx: -1, nz: 0 },
    { nx: 0, nz: 1 },
    { nx: 0, nz: -1 },
  ];
  for (const { nx, nz } of sides) {
    // Positions along the side, skipping the corners so crossings stay clear.
    // Every third slot is a lamp post, the rest are (mostly) trees.
    for (let i = 0, t = -half + 8; t <= half - 8; i++, t += 11) {
      const along = t + rng.range(-1, 1);
      const isLamp = i % 3 === 1;
      const inset = isLamp ? lampInset : treeInset;
      const x = block.cx + nx * (half - inset) + (nz !== 0 ? along : 0);
      const z = block.cz + nz * (half - inset) + (nx !== 0 ? along : 0);
      if (isLamp) {
        // Arm points outward over the road: local +X rotated to face the side normal.
        block.lamps.push({ x, z, yaw: Math.atan2(-nz, nx) });
      } else if (rng.chance(treeChance)) {
        block.trees.push({ x, y: CURB_HEIGHT, z, scale: rng.range(0.8, 1.2), hue: rng.float() });
      }
    }
  }
}

/** Park trees scattered over the lot, keeping a circle of `clearRadius` m free in the middle. */
function addParkTrees(block: Block, rng: Rng, clearRadius: number): void {
  const count = rng.int(18, 30);
  for (let i = 0; i < count; i++) {
    const x = rng.range(-LOT / 2 + 3, LOT / 2 - 3);
    const z = rng.range(-LOT / 2 + 3, LOT / 2 - 3);
    const scale = rng.range(0.9, 1.6);
    const hue = rng.float();
    if (Math.hypot(x, z) < clearRadius) continue;
    block.trees.push({ x: block.cx + x, y: CURB_HEIGHT, z: block.cz + z, scale, hue });
  }
}

/** Trees stay this far (m) from the helipad centre, clear of the 5 m rotor. */
export const HELIPAD_CLEAR_RADIUS = 14;

/** The helipad park is the block just east of the spawn block. */
function isHelipadBlock(bx: number, bz: number): boolean {
  return bx === MID + 1 && bz === MID + 2;
}

/** Centre of the helipad (ground level is the top of the block slab). */
export function helipadPosition(layout: CityLayout): { x: number; z: number } {
  const block = layout.blockAt(MID + 1, MID + 2)!;
  return { x: block.cx, z: block.cz };
}

/**
 * A sidewalk corner two blocks out from the centre, looking down the street toward −Z
 * at the downtown skyline (the very centre is a deep street canyon in permanent shade).
 */
export function spawnPoint(layout: CityLayout): { x: number; z: number } {
  const block = layout.blockAt(MID, MID + 2)!;
  return { x: block.cx - BLOCK_SIZE / 2 + 2, z: block.cz + BLOCK_SIZE / 2 - 2 };
}

export type ParkedCarType = 'sedan' | 'taxi' | 'van';

export interface ParkingSpot {
  x: number;
  z: number;
  yaw: number; // rad; 0 = car facing +X
  type: ParkedCarType;
  colorIndex: number; // into the car paint palette
}

/**
 * A row of parked cars in the outer lane of the street next to the spawn point (in world
 * coordinates). Town roads have four 3.5 m lanes; traffic drives in both lanes each way and
 * changes lanes to get round parked cars.
 */
export function parkingSpots(layout: CityLayout): ParkingSpot[] {
  const rng = new Rng(hashSeed(layout.seed, 991, 17));
  const block = layout.blockAt(MID, MID + 2)!;
  const roadCentre = block.cx - PITCH / 2; // the road along Z just west of the spawn block
  const laneX = roadCentre + ROAD_WIDTH / 2 - 1.75; // east parking lane, beside the curb
  const spots: ParkingSpot[] = [];
  // Facing −Z (traffic on the east side of a north–south road drives toward −Z).
  // A car's forward is +X; yawing by +90° turns +X toward −Z.
  const yaw = Math.PI / 2;
  for (let i = 0; i < 5; i++) {
    const type: ParkedCarType = i === 2 ? 'taxi' : i === 4 ? 'van' : 'sedan';
    spots.push({ x: laneX, z: block.cz + 22 - i * 8.5, yaw, type, colorIndex: rng.int(0, 8) });
  }
  return spots;
}

// --- Countryside features (generated per chunk, from the cell's own seed) ----------------

export interface RuralFeatures {
  buildings: Building[];
  /** Forest / hedgerow trees (low-poly, no colliders far away). */
  trees: Tree[];
}

/**
 * Farmsteads and trees for a countryside cell. `ground` gives the terrain height and
 * `clear` says whether a spot is free of roads and water.
 */
export function ruralFeatures(
  seed: number,
  bx: number,
  bz: number,
  zone: Zone,
  ground: (x: number, z: number) => number,
  clear: (x: number, z: number, margin: number) => boolean,
): RuralFeatures {
  const out: RuralFeatures = { buildings: [], trees: [] };
  if (zone !== 'farm' && zone !== 'forest') return out;
  const rng = new Rng(hashSeed(seed, bx + 1000, bz + 2000));
  const cx = cellCenter(bx);
  const cz = cellCenter(bz);

  if (zone === 'forest') {
    // A jittered grid of trees, ~11 m apart, with gaps.
    const step = 9.5;
    for (let gz = -PITCH / 2 + step / 2; gz < PITCH / 2; gz += step) {
      for (let gx = -PITCH / 2 + step / 2; gx < PITCH / 2; gx += step) {
        if (!rng.chance(0.62)) continue;
        const x = cx + gx + rng.range(-3.5, 3.5);
        const z = cz + gz + rng.range(-3.5, 3.5);
        if (!clear(x, z, 10)) continue;
        out.trees.push({ x, y: ground(x, z), z, scale: rng.range(0.8, 1.5), hue: rng.float() });
      }
    }
    return out;
  }

  // Farmland: now and then a farmstead (barn + farmhouse), plus a few hedgerow trees.
  if (rng.chance(0.2)) {
    const fx = cx + rng.range(-12, 12);
    const fz = cz + rng.range(-12, 12);
    if (clear(fx, fz, 30)) {
      const place = (x: number, z: number, w: number, d: number, h: number, color: [number, number, number], roof: [number, number, number], roofH: number) => {
        const base = Math.min(ground(x - w / 2, z - d / 2), ground(x + w / 2, z - d / 2), ground(x - w / 2, z + d / 2), ground(x + w / 2, z + d / 2));
        out.buildings.push({ x, z, y: base - 0.3, width: w, depth: d, height: h + 0.3, style: STYLE_HOUSE, color, seed: rng.int(0, 999), roof: { height: roofH, color: roof } });
      };
      place(fx, fz, rng.range(16, 20), rng.range(10, 12), 6.4, [0.36, 0.07, 0.05], [0.18, 0.18, 0.19], 4.5); // red barn
      place(fx + 20, fz + rng.range(-6, 6), 10, 8, 6.4, [0.8, 0.77, 0.7], [0.3, 0.12, 0.08], 3); // farmhouse
    }
  }
  const hedge = rng.int(2, 7);
  for (let k = 0; k < hedge; k++) {
    const x = cx + rng.range(-PITCH / 2, PITCH / 2);
    const z = cz + rng.range(-PITCH / 2, PITCH / 2);
    if (!clear(x, z, 10)) continue;
    out.trees.push({ x, y: ground(x, z), z, scale: rng.range(0.9, 1.4), hue: rng.float() });
  }
  return out;
}
