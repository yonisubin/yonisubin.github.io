import { Rng, hashSeed } from './rng';

// City layout as plain data: no three.js, no physics. Generated per block ("chunk") from
// (seed, blockX, blockZ), so any block can be regenerated on its own — the basis for
// streaming chunks in later. Meshes and colliders are built from this data elsewhere.
//
// Plan view (one grid cell), all sizes in metres:
//
//   |<- ROAD ->|<------------- BLOCK_SIZE ------------->|
//              | SIDEWALK |<------- LOT ------->| SIDEWALK |
//
// Blocks sit on a raised slab (curb height) and are separated by roads at y = 0.

export const BLOCKS = 8; // blocks per side
export const ROAD_WIDTH = 14; // 4 lanes × 3.5 m
export const SIDEWALK = 4;
export const LOT = 56;
export const BLOCK_SIZE = LOT + 2 * SIDEWALK; // 64
export const PITCH = BLOCK_SIZE + ROAD_WIDTH; // 78, distance between block centres
export const CURB_HEIGHT = 0.15; // low enough for the character controller to auto-step
/** Half the size of the whole city, including the outer ring road. */
export const CITY_HALF = (BLOCKS * PITCH + ROAD_WIDTH) / 2;

// Building styles. The facade shader draws a different window pattern for each.
export const STYLE_GLASS = 0; // curtain-wall office tower
export const STYLE_BRICK = 1; // brick / stucco with punched windows
export const STYLE_CONCRETE = 2; // concrete with ribbon windows

/** Vertical rhythm per style, shared with the facade shader. */
export const STYLE_METRICS = [
  { groundFloor: 5.0, floor: 3.8 }, // glass
  { groundFloor: 4.5, floor: 3.2 }, // brick
  { groundFloor: 4.5, floor: 3.5 }, // concrete
] as const;
export const PARAPET = 1.0; // wall above the top floor hiding the roof

export interface Building {
  x: number; // footprint centre
  z: number;
  width: number; // along X
  depth: number; // along Z
  height: number;
  style: number;
  color: [number, number, number]; // linear RGB wall colour
  seed: number; // varies window details per building
}

export interface RoofProp {
  kind: 'ac' | 'tank';
  x: number;
  y: number; // base height
  z: number;
  size: [number, number, number];
}

export interface Tree {
  x: number;
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
  park: boolean;
  buildings: Building[];
  roofProps: RoofProp[];
  trees: Tree[];
  lamps: Lamp[];
}

export interface CityLayout {
  seed: number;
  blocks: Block[];
  /** Road centre-line coordinates (same set for X and Z). */
  roadLines: number[];
}

export function blockCenter(i: number): number {
  return (i - (BLOCKS - 1) / 2) * PITCH;
}

export function generateCity(seed: number): CityLayout {
  const blocks: Block[] = [];
  for (let bz = 0; bz < BLOCKS; bz++) {
    for (let bx = 0; bx < BLOCKS; bx++) blocks.push(generateBlock(seed, bx, bz));
  }
  const roadLines: number[] = [];
  for (let i = 0; i <= BLOCKS; i++) roadLines.push(blockCenter(i) - PITCH / 2);
  return { seed, blocks, roadLines };
}

export function generateBlock(seed: number, bx: number, bz: number): Block {
  const rng = new Rng(hashSeed(seed, bx, bz));
  const cx = blockCenter(bx);
  const cz = blockCenter(bz);

  // "Downtown-ness": 1 at the centre of the city, 0 at the edge. Drives building height.
  const maxDist = Math.hypot(blockCenter(0), blockCenter(0));
  const downtown = 1 - Math.min(1, Math.hypot(cx, cz) / maxDist);

  const park = downtown < 0.85 && rng.chance(0.1);
  const block: Block = { bx, bz, cx, cz, park, buildings: [], roofProps: [], trees: [], lamps: [] };

  addStreetFurniture(block, rng);
  if (park) {
    addParkTrees(block, rng);
    return block;
  }

  // Split the lot into a grid of parcels with randomised split positions.
  const lotMin = -LOT / 2;
  const splitsX = splitSpan(rng, LOT, downtown > 0.6 && rng.chance(0.35) ? 1 : rng.int(2, 3));
  const splitsZ = splitSpan(rng, LOT, downtown > 0.6 && rng.chance(0.35) ? 1 : 2);

  let x0 = lotMin;
  for (const w of splitsX) {
    let z0 = lotMin;
    for (const d of splitsZ) {
      addBuilding(block, rng, cx + x0 + w / 2, cz + z0 + d / 2, w, d, downtown);
      z0 += d;
    }
    x0 += w;
  }
  return block;
}

/** Split `span` metres into `n` random-ish parts that sum exactly to `span`. */
function splitSpan(rng: Rng, span: number, n: number): number[] {
  if (n <= 1) return [span];
  // Weights in [0.8, 1.2] keep the smallest part ≥ 2/3 of an even share (≥ 14 m for 3 parts of 56 m).
  const weights = Array.from({ length: n }, () => rng.range(0.8, 1.2));
  const total = weights.reduce((a, b) => a + b, 0);
  return weights.map((w) => (w / total) * span);
}

function addBuilding(
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
  const style =
    rng.float() < 0.15 + tall * 0.7
      ? STYLE_GLASS
      : rng.chance(0.55)
        ? STYLE_BRICK
        : STYLE_CONCRETE;

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

  const building: Building = {
    x: px,
    z: pz,
    width,
    depth,
    height,
    style,
    color: wallColor(rng, style),
    seed: rng.int(0, 999),
  };
  block.buildings.push(building);

  // Rooftop clutter: AC units on most roofs, water tanks on older brick buildings.
  const roofY = height - PARAPET;
  const acCount = rng.int(1, Math.min(6, Math.floor((width * depth) / 120) + 1));
  for (let i = 0; i < acCount; i++) {
    const sx = rng.range(1.5, 3);
    const sz = rng.range(1.5, 3);
    block.roofProps.push({
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
function addStreetFurniture(block: Block, rng: Rng): void {
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
      } else if (rng.chance(0.85)) {
        block.trees.push({ x, z, scale: rng.range(0.8, 1.2), hue: rng.float() });
      }
    }
  }
}

function addParkTrees(block: Block, rng: Rng): void {
  const count = rng.int(18, 30);
  for (let i = 0; i < count; i++) {
    block.trees.push({
      x: block.cx + rng.range(-LOT / 2 + 3, LOT / 2 - 3),
      z: block.cz + rng.range(-LOT / 2 + 3, LOT / 2 - 3),
      scale: rng.range(0.9, 1.6),
      hue: rng.float(),
    });
  }
}

/**
 * A sidewalk corner two blocks out from the centre, looking down the street toward −Z
 * at the downtown skyline (the very centre is a deep street canyon in permanent shade).
 */
export function spawnPoint(layout: CityLayout): { x: number; z: number } {
  const mid = Math.floor(BLOCKS / 2);
  const block = layout.blocks[(mid + 2) * BLOCKS + mid];
  return { x: block.cx - BLOCK_SIZE / 2 + 2, z: block.cz + BLOCK_SIZE / 2 - 2 };
}
