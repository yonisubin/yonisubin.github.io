// Practical 09 — "Clearance". New idea: the clearing field (grill): walk through it and your
// apertures close; carry a cube through it and the cube is erased. Shots pass straight through.
//
//   The cube is in the south room, the plate in the north room, and the only doorway between them
//   is filled by a grill. Look through the grill and put amber on the white panel on the north
//   room's far wall, put blue on the south room's west panel, and walk the cube around the field.
//
//   z=-26 ┌────[white panel]────[exit]─┐
//         │ (plate)    north room      │
//   z=-12 ├────────[ grill ]───────────┤  partition with a glass window either side
//         │[white]     south room cube │
//   z=0   └──────────[    ]────────────┘
//       x=-8                         x=8
import type { LevelData } from '../level';
import { doorway, exitBay, intake, lamp, panel, shell, strip } from './kitA';

const inn = intake(0, 0);
const out = exitBay(4, -26, 0, ['plate.pressed']);

export const C09: LevelData = {
  version: 2,
  id: 'c09',
  name: 'Practical 09',
  device: 'both',
  next: 'c10',
  info: { number: 9, title: 'Clearance', icons: ['grill', 'cube', 'portal', 'button'] },
  spawn: inn.spawn,
  brushes: [
    ...shell({
      min: [-8, 0, -26],
      max: [8, 7, 0],
      floor: 'metal',
      holes: { s: [doorway(0)], n: [panel(-2, 2, 0, 3), doorway(4)], w: [panel(-10, -3, 0, 3)] },
    }),
    // The partition: metal, a doorway (with the grill), two glass windows.
    ...shell({
      min: [-8, 0, -12],
      max: [8, 7, -12],
      floor: null,
      ceiling: null,
      walls: { e: null, w: null, s: null },
      holes: { n: [{ a0: -6.5, a1: -3, y0: 1.2, y1: 3, fill: 'glass' }, doorway(0), { a0: 3, a1: 6.5, y0: 1.2, y1: 3, fill: 'glass' }] },
    }),
    ...inn.brushes,
    ...out.brushes,
  ],
  entities: [
    ...inn.entities,
    lamp('lamp1', [0, 6.4, -6], 8, 16),
    lamp('lamp2', [0, 6.4, -19], 8, 16),
    { id: 'grill', type: 'grill', position: [0, 1.55, -12.25], props: { size: [2.5, 3.1], normal: [0, 0, 1] } },
    { id: 'cube1', type: 'cube', position: [5, 0.33, -5] },
    { id: 'plate', type: 'floorButton', position: [-4, 0, -20], props: { accepts: 'cube' } },
    strip('wire', [[-4, 0, -20.9], [-4, 0, -23], [6.2, 0, -23], [6.2, 0, -25.9]], [6.4, 1.5, -25.98], 0),
    { id: 'notice', type: 'decal', position: [-1.6, 3.6, -11.99], props: { text: 'NO UNREGISTERED ITEMS', size: [3.2, 0.35], ink: '#6c7680' } },
    ...out.entities,
  ],
  wiring: [{ from: 'plate.pressed', to: 'wire.on' }, ...(out.wiring ?? [])],
  triggers: [
    { id: 'tNear', min: [-3, 0, -12], max: [3, 2.5, -9], event: 'c09.near', once: true },
    { id: 'tNorth', min: [-8, 0, -26], max: [8, 2.5, -13], event: 'c09.north', once: true },
  ],
  dialogue: [
    { event: 'chamberStart', lines: ['c09.chamberStart.1', 'c09.chamberStart.2'] },
    { event: 'c09.near', lines: ['c09.near.1'] },
    { event: 'c09.north', lines: ['c09.north.1'] },
    { event: 'exitReached', lines: ['c09.exitReached.1'] },
  ],
};
