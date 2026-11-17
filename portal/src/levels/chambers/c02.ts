// Practical 02 — "Standing Fold". New idea: a pre-placed pair of openings whose far end flips.
// No device.
//
//   The blue end is fixed on the hub's north wall. The amber end visits three sealed cells in turn
//   (4 s each): the west cell holds a cube, the middle cell a cube-only plate, the east cell the exit
//   door (wired to the plate). Fetch the cube on the west cell's turn, carry it back, ride over on
//   the middle cell's turn and set it down, come back, then ride to the east cell.
//
//   z=-20 ┌── west cell ──┬── middle cell ──┬── east cell ──[exit]┐
//         │  cube         │   (cube plate)  │                     │
//   z=-13 └──[amber 1]────┴───[amber 2]─────┴────[amber 3]────────┘
//                         ┌──[ blue ]───┐ z=-10
//                         │     hub     │
//                         └────[  ]─────┘ z=0, antechamber south
import type { LevelData, Vec3 } from '../level';
import { PORTAL_Y, doorway, exitBay, intake, lamp, metal, shell, strip } from './kitA';

const inn = intake(0, 0);
const out = exitBay(10.75, -20, 0, ['plate.pressed']);
const CELL_X = [-10.75, 0, 10.75];
const spot = (x: number): [Vec3, Vec3] => [[x, PORTAL_Y, -13], [0, 0, -1]];

export const C02: LevelData = {
  version: 2,
  id: 'c02',
  name: 'Practical 02',
  device: 'none',
  next: 'c03',
  info: { number: 2, title: 'Standing Fold', icons: ['portal', 'cube', 'button'] },
  spawn: inn.spawn,
  brushes: [
    // Hub.
    ...shell({
      min: [-5, 0, -10],
      max: [5, 5, 0],
      walls: { n: 'portalable', s: 'portalable', e: 'portalable', w: 'portalable' },
      holes: { s: [doorway(0)] },
    }),
    // The three cells: one long room split by two metal walls.
    ...shell({
      min: [-16, 0, -20],
      max: [16, 5, -13],
      walls: { n: 'portalable', s: 'portalable', e: 'portalable', w: 'portalable' },
      holes: { n: [doorway(10.75)] },
    }),
    metal([-5.5, 0, -20], [-5, 5, -13]),
    metal([5, 0, -20], [5.5, 5, -13]),
    ...inn.brushes,
    ...out.brushes,
  ],
  entities: [
    ...inn.entities,
    lamp('lampHub', [0, 4.6, -5], 7, 12),
    lamp('lampW', [-10.75, 4.6, -16.5], 6, 10),
    lamp('lampM', [0, 4.6, -16.5], 6, 10),
    lamp('lampE', [10.75, 4.6, -16.5], 6, 10),
    { id: 'hubPortal', type: 'fixedPortal', position: [0, PORTAL_Y, -10], props: { which: 'a', normal: [0, 0, 1] } },
    { id: 'flip', type: 'fixedPortal', position: spot(CELL_X[0])[0], props: { which: 'b', normal: [0, 0, -1], cycle: CELL_X.map(spot), period: 4 } },
    { id: 'cube1', type: 'cube', position: [-10.75, 0.33, -15.4] },
    { id: 'plate', type: 'floorButton', position: [0, 0, -16.6], props: { accepts: 'cube' } },
    // The plate's strip runs into the east wall of the middle cell and comes out in the east cell.
    strip('wireM', [[0.8, 0, -16.6], [4.9, 0, -16.6]], [4.97, 1.5, -15.4], -Math.PI / 2),
    strip('wireE', [[5.6, 0, -16.6], [9, 0, -16.6], [9, 0, -19.9]], [8.6, 1.5, -19.98], 0),
    { id: 'hubArrow', type: 'decal', position: [0, 0.01, -8], yaw: Math.PI / 2, props: { image: 'arrow', floor: true, size: [1.2, 0.6] } },
    ...out.entities,
  ],
  wiring: [{ from: 'plate.pressed', to: 'wireM.on' }, { from: 'plate.pressed', to: 'wireE.on' }, ...(out.wiring ?? [])],
  triggers: [
    { id: 'tWest', min: [-16, 0, -20], max: [-5.5, 3, -13], event: 'c02.west', once: true },
    { id: 'tMid', min: [-5, 0, -20], max: [5, 3, -13], event: 'c02.middle', once: true },
    { id: 'tEast', min: [5.5, 0, -20], max: [16, 3, -13], event: 'c02.east', once: true },
  ],
  dialogue: [
    { event: 'chamberStart', lines: ['c02.chamberStart.1', 'c02.chamberStart.2'] },
    { event: 'c02.west', lines: ['c02.west.1'] },
    { event: 'c02.middle', lines: ['c02.middle.1'] },
    { event: 'c02.east', lines: ['c02.east.1'] },
    { event: 'exitReached', lines: ['c02.exitReached.1'] },
  ],
};
