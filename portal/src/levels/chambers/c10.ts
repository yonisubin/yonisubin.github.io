// Practical 10 — "Steeping". New idea: toxic liquid; placing apertures precisely over a hazard.
//
//   The floor is a basin of toxic liquid with three small islands. Each island carries a pylon with
//   ONE white face exactly big enough for one aperture. Hop island to island by folding from the
//   pylon you just left to the next one (re-using the colour you aren't standing in front of), carry
//   the cube from the first island all the way, then jump the last 2 m gap to the exit ledge.
//
//   z=-36 ┌──────────────────[exit]───┐
//         │ (plate)   exit ledge      │
//   z=-30 ├───────────────────────────┤
//         │ |3 island3                │
//         │              island2  2|  │   liquid everywhere else
//         │ |1 island1 cube           │   (|n = pylon with its white face)
//   z=-6  ├───────────────────────────┤
//         │[white]  start ledge       │
//   z=0   └──────────[    ]──────────┘
//       x=-10                      x=10
import type { Brush, Entity, LevelData, Vec3 } from '../level';
import { doorway, exitBay, intake, lamp, metal, panel, shell, strip } from './kitA';

export interface Island {
  /** Island top, x0..x1 / z0..z1. */
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  /** Which side the pylon stands on: its white face looks back across the island. */
  pylon: 'w' | 'e';
}

const PYLON = { w: 1.4, h: 2.4, t: 0.5 };

/** Island block + pylon; returns brushes and the centre of the pylon's white face (+ its normal). */
export function island(i: Island, floorY: number): { brushes: Brush[]; face: Vec3; normal: Vec3 } {
  const zc = (i.z0 + i.z1) / 2;
  const top = 0;
  const brushes: Brush[] = [metal([i.x0, floorY, i.z0], [i.x1, top, i.z1])];
  if (i.pylon === 'w') {
    brushes.push(metal([i.x0, top, zc - PYLON.w / 2], [i.x0 + PYLON.t, PYLON.h, zc + PYLON.w / 2], { '+x': 'portalable' }));
    return { brushes, face: [i.x0 + PYLON.t, 1.2, zc], normal: [1, 0, 0] };
  }
  brushes.push(metal([i.x1 - PYLON.t, top, zc - PYLON.w / 2], [i.x1, PYLON.h, zc + PYLON.w / 2], { '-x': 'portalable' }));
  return { brushes, face: [i.x1 - PYLON.t, 1.2, zc], normal: [-1, 0, 0] };
}

export const C10_ISLANDS: Island[] = [
  { x0: -6, x1: -2, z0: -12.5, z1: -8.5, pylon: 'w' },
  { x0: 2, x1: 6, z0: -20.5, z1: -16.5, pylon: 'e' },
  { x0: -6, x1: -2, z0: -28, z1: -24, pylon: 'w' },
];

const BASIN = { z0: -30, z1: -6, floor: -2.5, surface: -0.5 };
const inn = intake(0, 0);
const out = exitBay(4, -36, 0, ['plate.pressed']);
const isl = C10_ISLANDS.map((i) => island(i, BASIN.floor));

export const C10: LevelData = {
  version: 2,
  id: 'c10',
  name: 'Practical 10',
  device: 'both',
  next: 'c11',
  info: { number: 10, title: 'Steeping', icons: ['liquid', 'portal', 'cube', 'button'] },
  spawn: inn.spawn,
  brushes: [
    ...shell({ min: [-10, 0, -36], max: [10, 10, 0], floor: null, holes: { s: [doorway(0)], n: [doorway(4)], w: [panel(-4, -1.5, 0, 3)] } }),
    metal([-10.5, BASIN.floor - 0.5, BASIN.z1], [10.5, 0, 0.5]),
    metal([-10.5, BASIN.floor - 0.5, BASIN.z0], [10.5, BASIN.floor, BASIN.z1]),
    metal([-10.5, BASIN.floor - 0.5, -36.5], [10.5, 0, BASIN.z0]),
    ...isl.flatMap((i) => i.brushes),
    ...inn.brushes,
    ...out.brushes,
  ],
  entities: [
    ...inn.entities,
    lamp('lamp1', [0, 9.4, -8], 9, 20),
    lamp('lamp2', [0, 9.4, -22], 9, 20),
    lamp('lamp3', [0, 9.4, -33], 7, 14),
    { id: 'acid', type: 'liquid', position: [0, BASIN.surface, (BASIN.z0 + BASIN.z1) / 2], props: { size: [20, 1.5, BASIN.z1 - BASIN.z0] } },
    { id: 'cube1', type: 'cube', position: [-2.8, 0.33, -10.5] },
    { id: 'plate', type: 'floorButton', position: [-4, 0, -33], props: { accepts: 'cube' } },
    strip('wire', [[-3.1, 0, -33], [6.2, 0, -33], [6.2, 0, -35.9]], [6.4, 1.5, -35.98], 0),
    ...isl.map((i, k): Entity => ({ id: `mark${k + 1}`, type: 'decal', position: [i.face[0] + i.normal[0] * 0.01, 2.1, i.face[2]], yaw: i.normal[0] > 0 ? Math.PI / 2 : -Math.PI / 2, props: { text: String(k + 1), size: [0.4, 0.3], ink: '#2c3136' } })),
    ...out.entities,
  ],
  wiring: [{ from: 'plate.pressed', to: 'wire.on' }, ...(out.wiring ?? [])],
  triggers: [
    { id: 't1', min: [-6, 0, -12.5], max: [-2, 2, -8.5], event: 'c10.island1', once: true },
    { id: 't3', min: [-6, 0, -28], max: [-2, 2, -24], event: 'c10.island3', once: true },
  ],
  dialogue: [
    { event: 'chamberStart', lines: ['c10.chamberStart.1', 'c10.chamberStart.2'] },
    { event: 'c10.island1', lines: ['c10.island1.1'] },
    { event: 'c10.island3', lines: ['c10.island3.1'] },
    { event: 'death', lines: ['c10.death.1'] },
    { event: 'exitReached', lines: ['c10.exitReached.1', 'c10.exitReached.2'] },
  ],
};
