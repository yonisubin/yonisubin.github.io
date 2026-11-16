// World generation: heightmap → land/sea → terrain by latitude/temperature/rainfall →
// hills/mountains → rivers (along hex edges, flowing downhill corner to corner) → features →
// resources → start positions (spread out, with a balance pass) → ruins and barbarian camps.
// Deterministic: everything comes from the seeded RNG passed in.
import { D } from '../data';
import { distance, idx, MapDims, neighbor, neighbors, rowOf, colOf, within } from '../core/hex';
import { pickWeighted, rand, randInt, RngHolder, shuffle } from '../core/rng';
import type { Tile } from '../core/state';
import { mapNoise } from './noise';
import { earthLand } from './earth';

export interface GeneratedMap {
  w: number;
  h: number;
  tiles: Tile[];
  starts: number[];
  camps: number[];
  /** City-state sites. */
  minorStarts: number[];
}

export const MAP_TYPES = [
  'continents', 'pangaea', 'archipelago', 'fractal', 'small_continents', 'terra', 'inland_sea', 'lakes',
  'highlands', 'ice_age', 'tilted_axis', 'great_plains', 'oval', 'north_vs_south', 'skirmish', 'earth',
] as const;
export type MapType = (typeof MAP_TYPES)[number];

export interface MapGenOptions {
  type: MapType;
  w: number;
  h: number;
  players: number;
  ruins: boolean;
  barbarianCamps: number;
  /** City-states to place. */
  minors?: number;
  /** World age (3, 4 or 5 billion years: more or fewer hills and mountains). */
  worldAge?: 3 | 4 | 5;
  temperature?: 'cool' | 'temperate' | 'hot';
  rainfall?: 'arid' | 'normal' | 'wet';
  seaLevel?: 'low' | 'medium' | 'high';
  resources?: 'sparse' | 'standard' | 'abundant' | 'legendary' | 'strategic';
}

/** Per-script knobs on top of the shared generator. */
interface Script {
  land: number;
  mountains: number;
  hills: number;
  tempShift?: number;
  wetShift?: number;
  lakeMax?: number;
  /** Starts only on the biggest landmass (Terra). */
  oneLandmass?: boolean;
  /** Temperature runs east–west instead of north–south. */
  tilted?: boolean;
}

const SCRIPTS: Record<MapType, Script> = {
  continents: { land: 0.34, mountains: 0.06, hills: 0.2 },
  pangaea: { land: 0.36, mountains: 0.06, hills: 0.2 },
  archipelago: { land: 0.28, mountains: 0.04, hills: 0.2 },
  fractal: { land: 0.36, mountains: 0.07, hills: 0.2 },
  small_continents: { land: 0.32, mountains: 0.05, hills: 0.2 },
  terra: { land: 0.36, mountains: 0.06, hills: 0.2, oneLandmass: true },
  inland_sea: { land: 0.55, mountains: 0.06, hills: 0.2 },
  lakes: { land: 0.52, mountains: 0.05, hills: 0.18, lakeMax: 60 },
  highlands: { land: 0.42, mountains: 0.12, hills: 0.4 },
  ice_age: { land: 0.36, mountains: 0.06, hills: 0.2, tempShift: -0.25 },
  tilted_axis: { land: 0.36, mountains: 0.06, hills: 0.2, tilted: true },
  great_plains: { land: 0.42, mountains: 0.02, hills: 0.08, wetShift: -0.08 },
  oval: { land: 0.38, mountains: 0.06, hills: 0.2 },
  north_vs_south: { land: 0.36, mountains: 0.06, hills: 0.2 },
  skirmish: { land: 0.45, mountains: 0.05, hills: 0.22 },
  earth: { land: 0, mountains: 0.07, hills: 0.2 },
};

/** Base height of every tile for a map script (higher = more likely land). */
function heightmap(rng: RngHolder, o: MapGenOptions, m: MapDims, seed: number): Float64Array {
  const n = o.w * o.h;
  const height = new Float64Array(n);
  const blobs: { col: number; row: number; r: number; s: number; squash?: number }[] = [];
  const t = o.type;
  if (t === 'pangaea' || t === 'skirmish' || t === 'great_plains') {
    const c = randInt(rng, o.w);
    blobs.push({ col: c, row: o.h / 2, r: o.w * (t === 'skirmish' ? 0.35 : 0.28), s: 0.55 });
    for (let k = 0; k < 3; k++) blobs.push({ col: c + (rand(rng) - 0.5) * o.w * 0.35, row: o.h * (0.3 + rand(rng) * 0.4), r: o.w * 0.14, s: 0.35 });
  } else if (t === 'oval') {
    blobs.push({ col: randInt(rng, o.w), row: o.h / 2, r: o.w * 0.33, s: 1.2, squash: 0.8 });
  } else if (t === 'terra') {
    // The Old World (everyone starts here) and an empty New World across the ocean.
    const c = randInt(rng, o.w);
    blobs.push({ col: c, row: o.h / 2, r: o.w * 0.22, s: 0.65 }, { col: c + o.w * 0.08, row: o.h * 0.35, r: o.w * 0.12, s: 0.35 });
    blobs.push({ col: c + o.w / 2, row: o.h / 2, r: o.w * 0.15, s: 0.55 });
  } else if (t === 'small_continents') {
    const count = 5 + randInt(rng, 3);
    for (let k = 0; k < count; k++) blobs.push({ col: (k * o.w) / count + rand(rng) * 4, row: o.h * (0.25 + rand(rng) * 0.5), r: o.w * 0.08, s: 0.6 });
  } else if (t === 'north_vs_south') {
    blobs.push({ col: randInt(rng, o.w), row: o.h * 0.27, r: o.w * 0.4, s: 0.6, squash: 0.35 }, { col: randInt(rng, o.w), row: o.h * 0.73, r: o.w * 0.4, s: 0.6, squash: 0.35 });
  } else if (t === 'continents' || t === 'highlands' || t === 'ice_age' || t === 'tilted_axis') {
    const count = o.w >= 80 ? 3 : 2;
    const start = rand(rng) * o.w;
    for (let k = 0; k < count; k++) {
      const col = start + (k * o.w) / count + (rand(rng) - 0.5) * o.w * 0.08;
      blobs.push({ col, row: o.h * (0.35 + rand(rng) * 0.3), r: o.w * (0.17 + rand(rng) * 0.04), s: 0.55 });
      blobs.push({ col: col + (rand(rng) - 0.5) * o.w * 0.12, row: o.h * (0.25 + rand(rng) * 0.5), r: o.w * 0.1, s: 0.3 });
    }
  }
  for (let i = 0; i < n; i++) {
    const col = colOf(m, i), row = rowOf(m, i);
    if (t === 'earth') {
      height[i] = earthLand(col, row, o.w, o.h) ? 1 + mapNoise(seed, o.w, col, row, 12, 3) * 0.3 : mapNoise(seed, o.w, col, row, 12, 3) * 0.3;
      continue;
    }
    // Archipelago and fractal are all noise; the others are noise shaped by blobs.
    const freq = t === 'archipelago' ? 18 : t === 'fractal' ? 9 : 7;
    let hgt = mapNoise(seed, o.w, col, row, freq, 5) * (t === 'archipelago' || t === 'fractal' ? 1.2 : 0.8) + mapNoise(seed + 7, o.w, col, row, 16, 3) * 0.25;
    for (const b of blobs) {
      // Wrapped horizontal distance in tile units (rows are 0.866 tile apart vertically).
      let dx = Math.abs(col - b.col) % o.w;
      dx = Math.min(dx, o.w - dx);
      // Continents are taller than wide (north–south), like real ones.
      const dy = (row - b.row) * 0.866 * (b.squash ? 1 / b.squash : 0.55);
      const d = Math.sqrt(dx * dx + dy * dy) / b.r;
      hgt += b.s * 0.8 * Math.exp(-d * d * 1.6);
    }
    if (t === 'inland_sea') {
      // One great sea in the middle of a world of land.
      const dx = (col - o.w / 2) / (o.w * 0.28), dy = (row - o.h / 2) / (o.h * 0.3);
      hgt += 0.6 - Math.exp(-(dx * dx + dy * dy)) * 1.2;
    }
    if (t === 'north_vs_south') {
      // An ocean band along the equator keeps the halves apart.
      const eq = Math.abs(row - o.h / 2) / (o.h / 2);
      if (eq < 0.12) hgt -= 1;
    }
    // Poles: push the top and bottom rows under the sea.
    const lat = Math.abs(row - (o.h - 1) / 2) / ((o.h - 1) / 2);
    hgt -= Math.max(0, lat - 0.7) * 1.5;
    height[i] = hgt;
  }
  return height;
}

const blankTile = (): Tile => ({
  terrain: 'ocean',
  hills: false,
  feature: null,
  resource: null,
  resourceQty: 0,
  improvement: null,
  pillaged: false,
  road: false,
  roadOwner: -1,
  river: 0,
  owner: -1,
  cityId: -1,
  ruin: false,
  camp: false,
  area: 0,
  elevation: 0,
});

export const isWater = (t: Tile) => D.terrains.get(t.terrain)!.water;
export const isLand = (t: Tile) => !isWater(t);
export const isPassableLand = (t: Tile) => isLand(t) && t.terrain !== 'mountain' && t.feature !== 'ice';

export function generateMap(rng: RngHolder, o: MapGenOptions): GeneratedMap {
  const m: MapDims = { w: o.w, h: o.h };
  const n = o.w * o.h;
  const tiles: Tile[] = Array.from({ length: n }, blankTile);
  const seed = randInt(rng, 1 << 30);

  const script = SCRIPTS[o.type] ?? SCRIPTS.continents;
  const height = heightmap(rng, o, m, seed);

  // ---- Land/sea by quantile, so every map has about the same land share. ----
  // (Earth uses its outline as is: land is height ≥ 1.)
  const seaShift = o.seaLevel === 'low' ? 0.05 : o.seaLevel === 'high' ? -0.05 : 0;
  const landShare = Math.min(0.75, script.land + seaShift);
  const sorted = Array.from(height).sort((a, b) => a - b);
  const seaLevel = o.type === 'earth' ? 1 : sorted[Math.floor(n * (1 - landShare))];
  const maxH = sorted[n - 1];
  for (let i = 0; i < n; i++) {
    const row = rowOf(m, i);
    const land = height[i] >= seaLevel && row > 0 && row < o.h - 1;
    tiles[i].terrain = land ? 'grassland' : 'ocean';
    tiles[i].elevation = land ? 0.3 + (0.7 * (height[i] - seaLevel)) / Math.max(1e-6, maxH - seaLevel) : Math.max(0, 0.29 * (height[i] / seaLevel));
  }

  // ---- Small enclosed water bodies become lakes; water next to land is coast. ----
  labelAreas(m, tiles);
  const waterBodies = floodComponents(m, tiles, (t) => !isLandTerrain(t.terrain));
  for (const body of waterBodies) {
    if (body.length <= (script.lakeMax ?? 10)) for (const i of body) tiles[i].terrain = 'lake';
  }
  for (let i = 0; i < n; i++) {
    if (tiles[i].terrain !== 'ocean') continue;
    if (neighbors(m, i).some((j) => isLandTerrain(tiles[j].terrain))) tiles[i].terrain = 'coast';
  }

  // ---- Terrain by temperature and rainfall; hills and mountains by elevation rank. ----
  const landIdx = [...Array(n).keys()].filter((i) => isLandTerrain(tiles[i].terrain));
  // Mountains and hills follow "ridge" noise (|noise − 0.5| small = ridge line) plus elevation,
  // so they form chains instead of rings around each continent's peak.
  const ridge = new Map<number, number>();
  for (const i of landIdx) {
    const r = 1 - Math.abs(mapNoise(seed + 91, o.w, colOf(m, i), rowOf(m, i), 11, 3) - 0.5) * 2;
    ridge.set(i, r * r * 0.75 + tiles[i].elevation * 0.35 + mapNoise(seed + 93, o.w, colOf(m, i), rowOf(m, i), 30, 2) * 0.2);
  }
  const byElev = [...landIdx].sort((a, b) => ridge.get(b)! - ridge.get(a)!);
  // Younger worlds (3 billion years) are rougher; older ones smoother.
  const age = o.worldAge === 3 ? 1.4 : o.worldAge === 5 ? 0.65 : 1;
  const mountainCut = Math.floor(byElev.length * script.mountains * age);
  const hillsCut = mountainCut + Math.floor(byElev.length * script.hills * age);
  byElev.forEach((i, k) => {
    if (k < mountainCut) tiles[i].terrain = 'mountain';
    else if (k < hillsCut) tiles[i].hills = true;
  });
  for (const i of landIdx) {
    if (tiles[i].terrain !== 'mountain' && rand(rng) < 0.05) tiles[i].hills = true;
  }
  const temps = new Float64Array(n);
  const wets = new Float64Array(n);
  for (const i of landIdx) {
    const col = colOf(m, i), row = rowOf(m, i);
    // Tilted axis: the cold "poles" sit east and west instead of north and south.
    const lat = script.tilted ? Math.abs(Math.cos((col / o.w) * Math.PI * 2)) : Math.abs(row - (o.h - 1) / 2) / ((o.h - 1) / 2);
    const tempShift = (script.tempShift ?? 0) + (o.temperature === 'cool' ? -0.12 : o.temperature === 'hot' ? 0.12 : 0);
    const temp = 1 - lat * 1.15 + tempShift + (mapNoise(seed + 31, o.w, col, row, 10, 3) - 0.5) * 0.35 - (tiles[i].elevation - 0.3) * 0.25;
    let wet = mapNoise(seed + 57, o.w, col, row, 15, 4) + (script.wetShift ?? 0) + (o.rainfall === 'arid' ? -0.12 : o.rainfall === 'wet' ? 0.12 : 0);
    if (neighbors(m, i).some((j) => !isLandTerrain(tiles[j].terrain))) wet += 0.08;
    temps[i] = temp;
    wets[i] = wet;
    if (tiles[i].terrain === 'mountain') continue;
    let t: string;
    if (temp < 0.12) t = 'snow';
    else if (temp < 0.3) t = 'tundra';
    else if (temp > 0.6 && wet < 0.4) t = 'desert';
    else if (wet < 0.5) t = 'plains';
    else t = 'grassland';
    tiles[i].terrain = t;
  }

  // ---- Rivers ----
  carveRivers(rng, m, tiles, landIdx.length);

  // ---- Features ----
  for (const i of landIdx) {
    const t = tiles[i];
    if (t.terrain === 'mountain' || t.terrain === 'snow') continue;
    const temp = temps[i], wet = wets[i];
    const r = rand(rng);
    if (t.terrain === 'desert') {
      if (t.river && !t.hills) t.feature = 'floodplains';
      else if (!t.hills && r < 0.035 && !neighbors(m, i).some((j) => isWater(tiles[j]))) t.feature = 'oasis';
      continue;
    }
    if (temp > 0.72 && wet > 0.52 && (t.terrain === 'grassland' || t.terrain === 'plains') && r < 0.75) t.feature = 'jungle';
    else if (wet > 0.5 && r < (o.type === 'great_plains' ? 0.25 : 0.6) && temp > 0.2) t.feature = 'forest';
    else if (t.terrain === 'grassland' && !t.hills && wet > 0.6 && r > 0.9) t.feature = 'marsh';
  }
  for (let i = 0; i < n; i++) {
    const row = rowOf(m, i);
    const icy = o.type === 'ice_age' ? 3 : 1;
    if (tiles[i].terrain === 'ocean' && (row <= icy || row >= o.h - 1 - icy) && (row === 0 || row === o.h - 1 || rand(rng) < 0.5)) tiles[i].feature = 'ice';
  }

  // ---- Resources ----
  placeResources(rng, m, tiles, seed, o.resources === 'sparse' ? 0.6 : o.resources === 'abundant' ? 1.5 : 1);

  // ---- Areas, starts, balance, ruins, camps ----
  labelAreas(m, tiles);
  const starts = placeStarts(rng, m, tiles, o.players, !!script.oneLandmass);
  for (const s of starts) balanceStart(rng, m, tiles, s, o.resources);
  const minorStarts = placeMinorStarts(rng, m, tiles, starts, o.minors ?? 0);
  for (const s of minorStarts) {
    const t = tiles[s];
    if (t.feature && t.feature !== 'floodplains') t.feature = null;
    t.resource = null;
    t.ruin = t.camp = false;
  }
  const all = [...starts, ...minorStarts];
  if (o.ruins) placeRuins(rng, m, tiles, all);
  const camps = placeInitialCamps(rng, m, tiles, starts, minorStarts, o.barbarianCamps);
  return { w: o.w, h: o.h, tiles, starts, camps, minorStarts };
}

function isLandTerrain(t: string): boolean {
  return !D.terrains.get(t)!.water;
}

function floodComponents(m: MapDims, tiles: Tile[], inSet: (t: Tile) => boolean): number[][] {
  const seen = new Uint8Array(tiles.length);
  const out: number[][] = [];
  for (let i = 0; i < tiles.length; i++) {
    if (seen[i] || !inSet(tiles[i])) continue;
    const comp: number[] = [];
    const stack = [i];
    seen[i] = 1;
    while (stack.length) {
      const c = stack.pop()!;
      comp.push(c);
      for (const nb of neighbors(m, c))
        if (!seen[nb] && inSet(tiles[nb])) {
          seen[nb] = 1;
          stack.push(nb);
        }
    }
    out.push(comp);
  }
  return out;
}

/** Number every landmass 1..k (water = 0). */
export function labelAreas(m: MapDims, tiles: Tile[]): void {
  for (const t of tiles) t.area = 0;
  const comps = floodComponents(m, tiles, (t) => isLandTerrain(t.terrain));
  comps.forEach((c, k) => c.forEach((i) => (tiles[i].area = k + 1)));
}

// ---- Rivers -------------------------------------------------------------------------------
// A river runs along tile edges, from hex corner to hex corner. A corner is identified by
// (tile a, direction d): the corner between a's edges d and d+1, shared by a, its neighbour in
// direction d (b) and its neighbour in direction d+1 (c). From that corner three edges leave:
//   a–b (edge (a,d)),   far corner (a, d−1)
//   a–c (edge (a,d+1)), far corner (a, d+1)
//   b–c (edge (b,d+2)), far corner (b, d+1)
// A river walks downhill choosing the lowest far corner until a corner touches water.

interface Corner {
  a: number;
  d: number;
}

function cornerTiles(m: MapDims, c: Corner): number[] {
  return [c.a, neighbor(m, c.a, c.d), neighbor(m, c.a, c.d + 1)];
}

function cornerKey(m: MapDims, c: Corner): string {
  return cornerTiles(m, c)
    .sort((x, y) => x - y)
    .join(',');
}

function carveRivers(rng: RngHolder, m: MapDims, tiles: Tile[], landCount: number): void {
  const wanted = Math.round(landCount / 40);
  const heightOf = (c: Corner): number => {
    const ts = cornerTiles(m, c);
    if (ts.some((t) => t < 0)) return 99;
    let s = 0;
    for (const t of ts) s += isWater(tiles[t]) ? -1 : tiles[t].elevation;
    return s / 3;
  };
  const touchesWater = (c: Corner) => cornerTiles(m, c).some((t) => t >= 0 && isWater(tiles[t]));
  const setEdge = (a: number, d: number) => {
    const b = neighbor(m, a, d);
    if (b < 0) return;
    tiles[a].river |= 1 << ((d + 6) % 6);
    tiles[b].river |= 1 << ((d + 3) % 6);
  };
  // Sources: high land next to hills/mountains.
  const sources = shuffle(
    rng,
    [...Array(tiles.length).keys()].filter((i) => isLandTerrain(tiles[i].terrain) && tiles[i].terrain !== 'mountain' && tiles[i].elevation > 0.55),
  );
  let made = 0;
  for (const s of sources) {
    if (made >= wanted) break;
    if (tiles[s].river) continue;
    let cur: Corner = { a: s, d: randInt(rng, 6) };
    if (heightOf(cur) > 50) continue;
    const visited = new Set<string>([cornerKey(m, cur)]);
    const edges: [number, number][] = [];
    for (let step = 0; step < 30; step++) {
      if (touchesWater(cur)) break;
      const a = cur.a, d = cur.d;
      const b = neighbor(m, a, d);
      const options: { edge: [number, number]; next: Corner }[] = [
        { edge: [a, d], next: { a, d: (d + 5) % 6 } },
        { edge: [a, (d + 1) % 6], next: { a, d: (d + 1) % 6 } },
      ];
      if (b >= 0) options.push({ edge: [b, (d + 2) % 6], next: { a: b, d: (d + 1) % 6 } });
      let best: (typeof options)[number] | null = null;
      let bestH = Infinity;
      for (const op of options) {
        const k = cornerKey(m, op.next);
        if (visited.has(k)) continue;
        const h = heightOf(op.next) + rand(rng) * 0.03;
        if (h < bestH) {
          bestH = h;
          best = op;
        }
      }
      if (!best || bestH > 50) break;
      edges.push(best.edge);
      visited.add(cornerKey(m, best.next));
      cur = best.next;
    }
    if (edges.length >= 4 && touchesWater(cur)) {
      for (const [a, d] of edges) setEdge(a, d);
      made++;
    }
  }
}

// ---- Resources ----------------------------------------------------------------------------

export function resourceFits(tile: Tile, resId: string): boolean {
  const r = D.resources.get(resId)!;
  if (!r.terrains.includes(tile.terrain)) return false;
  if (tile.feature === 'ice') return false;
  if (tile.feature && !r.features.includes(tile.feature)) return false;
  if (tile.hills && !r.hills) return false;
  if (r.hillsOnly && !tile.hills) return false;
  return true;
}

function placeResources(rng: RngHolder, m: MapDims, tiles: Tile[], seed: number, amount = 1): void {
  const all = [...D.resources.values()];
  const bonus = all.filter((r) => r.kind === 'bonus');
  const strategic = all.filter((r) => r.kind === 'strategic');
  const luxury = all.filter((r) => r.kind === 'luxury');
  // Luxuries cluster: each luxury is common in a few regions of about 8×6 tiles.
  const regionLikes = (id: string, i: number) => {
    const rc = Math.floor(colOf(m, i) / 8), rr = Math.floor(rowOf(m, i) / 6);
    let h = seed;
    for (const ch of id) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
    h = Math.imul(h ^ rc, 374761393) ^ Math.imul(rr, 668265263);
    return ((h >>> 0) % 100) < 22;
  };
  for (let i = 0; i < tiles.length; i++) {
    const t = tiles[i];
    if (t.terrain === 'mountain' || t.feature === 'ice' || t.terrain === 'ocean') continue;
    const r = rand(rng) / amount;
    let list: typeof all = [];
    let weight: (x: (typeof all)[number]) => number = () => 1;
    if (isWater(t)) {
      if (r < 0.1) list = bonus;
      else if (r < 0.14) list = luxury;
    } else if (r < 0.11) list = bonus;
    else if (r < 0.15) list = strategic;
    else if (r < 0.21) {
      list = luxury;
      weight = (x) => (regionLikes(x.id, i) ? 8 : 1);
    }
    const fits = list.filter((x) => !x.minorOnly && resourceFits(t, x.id));
    if (!fits.length) continue;
    const res = pickWeighted(rng, fits, weight);
    t.resource = res.id;
    t.resourceQty = res.quantity;
  }
}

// ---- Starts ---------------------------------------------------------------------------------

/** Rough value of a tile for a city (food counts double), ignoring techs. */
export function tileValue(t: Tile): number {
  const ter = D.terrains.get(t.terrain)!;
  if (ter.impassable || t.feature === 'ice') return 0;
  let f = ter.yields.food ?? 0, p = ter.yields.production ?? 0, g = ter.yields.gold ?? 0;
  if (t.hills) {
    f = 0;
    p = 2;
  }
  if (t.feature) {
    const fe = D.features.get(t.feature)!;
    if (fe.replace) {
      f = fe.replace.food ?? 0;
      p = fe.replace.production ?? 0;
      g = fe.replace.gold ?? 0;
    }
    if (fe.add) {
      f += fe.add.food ?? 0;
      p += fe.add.production ?? 0;
    }
  }
  if (t.resource) {
    const r = D.resources.get(t.resource)!;
    f += (r.yields.food ?? 0) + 0.5;
    p += r.yields.production ?? 0;
    g += (r.yields.gold ?? 0) + (r.kind === 'luxury' ? 2 : 0);
  }
  if (t.river) g += 1;
  return f * 2 + p * 1.5 + g;
}

export function siteScore(m: MapDims, tiles: Tile[], s: number): number {
  const t = tiles[s];
  if (!isPassableLand(t) || t.terrain === 'snow') return -1;
  let score = 0;
  for (const j of within(m, s, 2)) if (j !== s) score += tileValue(tiles[j]) * (distance(m, s, j) === 1 ? 1.2 : 0.8);
  if (t.river) score += 6;
  if (neighbors(m, s).some((j) => tiles[j].terrain === 'lake' || tiles[j].feature === 'oasis')) score += 4;
  if (neighbors(m, s).some((j) => tiles[j].terrain === 'coast')) score += 3;
  if (t.hills) score += 3;
  return score;
}

function placeStarts(rng: RngHolder, m: MapDims, tiles: Tile[], count: number, oneLandmass = false): number[] {
  const areaSize = new Map<number, number>();
  for (const t of tiles) if (t.area) areaSize.set(t.area, (areaSize.get(t.area) ?? 0) + 1);
  // Terra: everyone starts on the biggest landmass.
  const biggest = [...areaSize.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (oneLandmass) for (const k of [...areaSize.keys()]) if (k !== biggest) areaSize.set(k, 0);
  const landTotal = [...areaSize.values()].reduce((a, b) => a + b, 0);
  const candidates: { i: number; s: number }[] = [];
  for (let i = 0; i < tiles.length; i++) {
    const a = tiles[i].area;
    if (!a || (areaSize.get(a) ?? 0) < 25) continue;
    const s = siteScore(m, tiles, i);
    if (s > 0) candidates.push({ i, s });
  }
  candidates.sort((a, b) => b.s - a.s);
  const target = Math.sqrt(landTotal / Math.max(1, count)) * 1.1;
  const maxScore = candidates.length ? candidates[0].s : 1;
  const starts: number[] = [];
  for (let k = 0; k < count; k++) {
    let best = -1, bestV = -Infinity;
    for (const c of candidates) {
      if (starts.includes(c.i)) continue;
      const md = starts.length ? Math.min(...starts.map((s) => distance(m, s, c.i))) : target;
      if (md < 5) continue;
      const v = (c.s / maxScore) * Math.min(1, md / target) + Math.min(1, md / target) * 0.6 + rand(rng) * 0.02;
      if (v > bestV) {
        bestV = v;
        best = c.i;
      }
    }
    if (best < 0) best = candidates.find((c) => !starts.includes(c.i))?.i ?? 0;
    starts.push(best);
  }
  return starts;
}

/** City-state sites: good land as far as possible from every start (and each other). */
function placeMinorStarts(rng: RngHolder, m: MapDims, tiles: Tile[], starts: number[], count: number): number[] {
  const out: number[] = [];
  const cand = [...Array(tiles.length).keys()].filter((i) => tiles[i].area && siteScore(m, tiles, i) > 8);
  for (let k = 0; k < count; k++) {
    let best = -1, bestV = -Infinity;
    for (const i of cand) {
      const md = Math.min(...[...starts, ...out].map((s) => distance(m, s, i)));
      if (md < 6) continue;
      const v = Math.min(md, 12) * 3 + siteScore(m, tiles, i) * 0.3 + rand(rng);
      if (v > bestV) {
        bestV = v;
        best = i;
      }
    }
    if (best < 0) break;
    out.push(best);
  }
  return out;
}

/** Make sure a start has some food, a luxury, horses and iron nearby. */
function balanceStart(rng: RngHolder, m: MapDims, tiles: Tile[], s: number, resources?: MapGenOptions['resources']): void {
  const t = tiles[s];
  if (t.feature && t.feature !== 'floodplains') t.feature = null;
  t.resource = null;
  t.ruin = t.camp = false;
  const near = (r: number) => within(m, s, r).filter((j) => j !== s);
  const ensure = (radius: number, ok: (id: string) => boolean, ids: string[], minCount: number) => {
    let have = near(radius).filter((j) => tiles[j].resource && ok(tiles[j].resource!)).length;
    for (const j of shuffle(rng, near(radius))) {
      if (have >= minCount) break;
      const tj = tiles[j];
      if (tj.resource || !isPassableLand(tj)) continue;
      const fit = ids.find((id) => resourceFits(tj, id));
      if (!fit) continue;
      tj.resource = fit;
      tj.resourceQty = D.resources.get(fit)!.quantity;
      have++;
    }
  };
  const isKind = (kind: string) => (id: string) => D.resources.get(id)!.kind === kind;
  ensure(2, (id) => isKind('bonus')(id) && (D.resources.get(id)!.yields.food ?? 0) > 0, shuffle(rng, ['wheat', 'cattle', 'deer', 'bananas', 'sheep']), 2);
  ensure(3, isKind('luxury'), shuffle(rng, [...D.resources.values()].filter((r) => r.kind === 'luxury').map((r) => r.id)), 1);
  ensure(5, (id) => id === 'horses', ['horses'], 1);
  ensure(5, (id) => id === 'iron', ['iron'], 1);
  if (resources === 'legendary') {
    ensure(2, (id) => isKind('bonus')(id), shuffle(rng, ['wheat', 'cattle', 'deer', 'bananas', 'sheep', 'stone']), 4);
    ensure(3, isKind('luxury'), shuffle(rng, [...D.resources.values()].filter((r) => r.kind === 'luxury' && !r.minorOnly).map((r) => r.id)), 3);
  }
  if (resources === 'strategic' || resources === 'legendary')
    for (const r of ['coal', 'oil', 'aluminum', 'uranium']) ensure(6, (id) => id === r, [r], 1);
  for (const j of near(3)) {
    tiles[j].ruin = false;
    tiles[j].camp = false;
  }
}

function placeRuins(rng: RngHolder, m: MapDims, tiles: Tile[], starts: number[]): void {
  const land = shuffle(rng, [...Array(tiles.length).keys()].filter((i) => isPassableLand(tiles[i])));
  const count = Math.round(land.length / D.rules.ruinsPerLandTiles);
  const placed: number[] = [];
  for (const i of land) {
    if (placed.length >= count) break;
    if (starts.some((s) => distance(m, s, i) < 4)) continue;
    if (placed.some((p) => distance(m, p, i) < 4)) continue;
    tiles[i].ruin = true;
    placed.push(i);
  }
}

function placeInitialCamps(rng: RngHolder, m: MapDims, tiles: Tile[], starts: number[], minorStarts: number[], count: number): number[] {
  const land = shuffle(rng, [...Array(tiles.length).keys()].filter((i) => isPassableLand(tiles[i]) && !tiles[i].ruin));
  const placed: number[] = [];
  for (const i of land) {
    if (placed.length >= count) break;
    // Far from civilizations' starts; city-states can live closer to barbarians.
    if (starts.some((s) => distance(m, s, i) < 8) || minorStarts.some((s) => distance(m, s, i) < 5)) continue;
    // Many camps (raging barbarians) may sit closer together.
    if (placed.some((p) => distance(m, p, i) < (count > 8 ? 4 : 6))) continue;
    tiles[i].camp = true;
    tiles[i].resource = null;
    placed.push(i);
  }
  return placed;
}

export { idx };
