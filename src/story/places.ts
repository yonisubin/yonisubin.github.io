import { LAKE, VILLAGES, lineCoord, type CityLayout } from '../world/layout';
import { ROAD_SPECS } from '../world/streets';
import { WATER_Y, type Terrain } from '../world/terrain';
import type { PlaceId } from './types';

// The story's named places (the garage, the diner, Kane Holdings, the farm…), resolved once
// at startup to real spots in the generated world. Most are "the sidewalk of the street
// nearest to this point", so a character stands on the pavement facing the road; that also
// gives a road point next to it for driving destinations.

export interface Spot {
  x: number;
  z: number;
  /** Standing height (Terrain.surfaceAt). */
  y: number;
  /** Camera-style yaw a character stands at: looking along (−sin, −cos), i.e. toward the road. */
  facing: number;
  /** The nearest point on the road (drive destinations). */
  road: { x: number; z: number };
}

export interface PlaceInputs {
  layout: CityLayout;
  terrain: Terrain;
  spawn: { x: number; z: number };
  helipad: { x: number; z: number };
  /** The police stations (the first is downtown) and the gun store doors. */
  police: { x: number; z: number }[];
  storeDoors: { x: number; z: number }[];
  /** Where the lake's speedboat waits. */
  lakeBoat: { x: number; z: number };
  /** Water surface height, or null on land. */
  water(x: number, z: number): number | null;
}

/** Where each place is approximately (world x, z); resolved to the nearest street's sidewalk. */
const APPROX: Partial<Record<PlaceId, [number, number]>> = {
  garage: [-117, 117],
  diner: [117, -39],
  customer: [520, 330],
  bank: [-195, -39],
  shack: [260, 1500],
  pier: [560, 1500],
  beach: [-300, 1500],
  motel: [-640, 380],
};

export function resolvePlaces(input: PlaceInputs): Record<PlaceId, Spot> {
  const { layout, terrain } = input;
  const net = layout.streets.net;

  /**
   * Stand on the side of the nearest road (preferring streets with sidewalks) that faces
   * (x, z): the sidewalk middle, or 2.5 m off the edge where there's no sidewalk.
   */
  const roadside = (x: number, z: number, sidewalkOnly = true): Spot => {
    let hit = sidewalkOnly ? net.index.nearest(x, z, 600, (e) => ROAD_SPECS[net.edges[e].cls].sidewalk === 0) : null;
    hit ??= net.nearest(x, z, 2000)!;
    const e = net.edges[hit.edge];
    const p = e.pts;
    const dx = p[hit.seg * 2 + 2] - p[hit.seg * 2];
    const dz = p[hit.seg * 2 + 3] - p[hit.seg * 2 + 1];
    const l = Math.hypot(dx, dz) || 1;
    let nx = -dz / l;
    let nz = dx / l;
    if ((x - hit.x) * nx + (z - hit.z) * nz < 0) {
      nx = -nx;
      nz = -nz;
    }
    const spec = ROAD_SPECS[e.cls];
    const off = spec.width / 2 + (spec.sidewalk > 0 ? spec.sidewalk * 0.6 : 2.5);
    const sx = hit.x + nx * off;
    const sz = hit.z + nz * off;
    // Facing the road: camera yaw θ looks along (−sin θ, −cos θ) = (−nx, −nz).
    return { x: sx, z: sz, y: terrain.surfaceAt(sx, sz), facing: Math.atan2(nx, nz), road: { x: hit.x, z: hit.z } };
  };
  /** A spot exactly at (x, z) (no road needed), facing `facing`. */
  const at = (x: number, z: number, facing = 0, y?: number): Spot => {
    const road = net.nearest(x, z, 2000);
    return { x, z, y: y ?? terrain.surfaceAt(x, z), facing, road: road ? { x: road.x, z: road.z } : { x, z } };
  };
  /** From (x, z) walk along (dx, dz) until there's dry land 0.6 m above the water. */
  const shore = (x: number, z: number, dx: number, dz: number): { x: number; z: number } => {
    const l = Math.hypot(dx, dz) || 1;
    for (let s = 0; s < 600; s += 2) {
      const px = x + (dx / l) * s;
      const pz = z + (dz / l) * s;
      if (input.water(px, pz) === null && terrain.heightAt(px, pz) > WATER_Y + 0.6) return { x: px, z: pz };
    }
    return { x: x + (dx / l) * 600, z: z + (dz / l) * 600 };
  };

  const out = {} as Record<PlaceId, Spot>;
  for (const [id, [x, z]] of Object.entries(APPROX) as [PlaceId, [number, number]][]) out[id] = roadside(x, z);

  out.bus = roadside(input.spawn.x, input.spawn.z);
  // The gun store nearest the garage: stand at its door.
  const door = input.storeDoors.reduce((a, b) => (Math.hypot(b.x - out.garage.x, b.z - out.garage.z) < Math.hypot(a.x - out.garage.x, a.z - out.garage.z) ? b : a));
  out.gunstore = at(door.x, door.z);
  out.police = roadside(input.police[0].x, input.police[0].z);
  out.helipad = at(input.helipad.x, input.helipad.z);

  // Kane Holdings: the big-box store nearest the eastern suburbs; its roof for the ledger.
  const big = layout.streets.parcels
    .filter((p) => p.kind === 'bigbox' && p.buildings.length)
    .sort((a, b) => Math.hypot(a.x - 600, a.z + 300) - Math.hypot(b.x - 600, b.z + 300))[0];
  const kx = big ? big.x : 600;
  const kz = big ? big.z : -300;
  out.kane = roadside(kx, kz);
  const bl = big?.buildings[0];
  out.kaneRoof = bl ? at(bl.x, bl.z, 0, terrain.smoothHeight(bl.x, bl.z) + bl.height + 6) : at(kx, kz, 0, terrain.smoothHeight(kx, kz) + 20);

  // Hank's farm: out past Eastfield on a country road.
  const east = VILLAGES[0];
  out.farm = roadside(lineCoord(east.i) + 180, lineCoord(east.k) + 140, false);

  // The lake: the dock on the shore by the speedboat, a point across the water, and the
  // far shore where Rico hides.
  const away = { x: input.lakeBoat.x - LAKE.x, z: input.lakeBoat.z - LAKE.z };
  const dock = shore(input.lakeBoat.x, input.lakeBoat.z, away.x, away.z);
  out.lakeDock = at(dock.x, dock.z, Math.atan2(-away.x, -away.z));
  out.lakeFar = at(LAKE.x - away.x * 0.55, LAKE.z - away.z * 0.55, 0, WATER_Y);
  const hide = shore(LAKE.x, LAKE.z, -away.x, -away.z);
  out.lakeHide = at(hide.x, hide.z, Math.atan2(away.x, away.z));
  return out;
}
