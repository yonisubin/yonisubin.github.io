// Advanced 5 — "Return Policy" (remix of practical 09, reversed). The cube is in the north room, past
// the grill AND a trench of liquid; the plate is back in the south room. Walk through the grill (it
// costs you nothing yet), jump the trench, then fold the cube home: amber through the grill onto the
// south room's back wall, blue on the north room's east panel. The exit is back past both hazards.
//
//   z=-26 ┌──────────────────[exit]─┐
//         │ cube          [white]   │  north room (east panel z −22..−18)
//   z=-17 │~~~~~~~~ trench ~~~~~~~~~│
//   z=-12 ├────────[ grill ]────────┤
//         │                 (plate) │  south room
//   z=0   └─[  ]────[white]─────────┘  entrance at x −5, white panel at x −1.5..1.5
//       x=-8                      x=8
import type { LevelData } from '../level';
import { doorway, exitBay, intake, lamp, metal, panel, shell, strip } from './kitA';

const TRENCH = { z0: -17, z1: -15 };
const inn = intake(-5, 0);
const out = exitBay(4, -26, 0, ['plate.pressed']);

export const ADV5: LevelData = {
  version: 2,
  id: 'adv5',
  name: 'Advanced 5',
  device: 'both',
  next: 'adv6',
  info: { number: 9, title: 'Adv. · Return Policy', icons: ['grill', 'liquid', 'cube', 'portal'] },
  spawn: inn.spawn,
  brushes: [
    ...shell({
      min: [-8, 0, -26],
      max: [8, 7, 0],
      floor: null,
      holes: { s: [doorway(-5), panel(-1.5, 1.5, 0, 2.6)], n: [doorway(4)], e: [panel(-22, -18, 0, 3)] },
    }),
    metal([-8.5, -1.5, -26.5], [8.5, 0, TRENCH.z0]),
    metal([-8.5, -1.5, TRENCH.z0], [8.5, -1, TRENCH.z1]),
    metal([-8.5, -1.5, TRENCH.z1], [8.5, 0, 0.5]),
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
    lamp('lamp2', [0, 6.4, -20], 8, 16),
    { id: 'grill', type: 'grill', position: [0, 1.55, -12.25], props: { size: [2.5, 3.1], normal: [0, 0, 1] } },
    { id: 'trench', type: 'liquid', position: [0, -0.3, (TRENCH.z0 + TRENCH.z1) / 2], props: { size: [16, 0.7, TRENCH.z1 - TRENCH.z0] } },
    { id: 'cube1', type: 'cube', position: [-4, 0.33, -22] },
    { id: 'plate', type: 'floorButton', position: [4, 0, -5], props: { accepts: 'cube' } },
    // The wire runs under the partition (through the grill's doorway) to the exit.
    strip('wire', [[4, 0, -5.9], [4, 0, -9], [0.9, 0, -9], [0.9, 0, -14.6]], [1.9, 1.5, -12.52], Math.PI),
    strip('wire2', [[0.9, 0, -17.4], [0.9, 0, -23], [6.2, 0, -23], [6.2, 0, -25.9]], [6.4, 1.5, -25.98], 0),
    ...out.entities,
  ],
  wiring: [{ from: 'plate.pressed', to: 'wire.on' }, { from: 'plate.pressed', to: 'wire2.on' }, ...(out.wiring ?? [])],
  triggers: [{ id: 'tNorth', min: [-8, 0, -26], max: [8, 2.5, TRENCH.z0], event: 'adv5.north', once: true }],
  dialogue: [
    { event: 'chamberStart', lines: ['adv5.chamberStart.1'] },
    { event: 'adv5.north', lines: ['adv5.north.1'] },
    { event: 'exitReached', lines: ['adv5.exitReached.1'] },
  ],
};
