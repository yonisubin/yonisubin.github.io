// Practical 03 — "Half a Fold". New idea: the device, but it only fires the blue end; the amber end
// is fixed. The exit sits on a 3.5 m shelf you can't climb; amber waits on the shelf's west wall.
// Put blue on a white panel down below, walk in, step out on the shelf. The shelf's plate wants the
// cube from the floor, so the second trip is made carrying it.
//
//   z=-20 ┌────────────[exit door]─────────────┐  (shelf top y 3.5, plate on it)
//         │[amber]   SHELF       ( plate )     │
//   z=-13 ├────────── metal face ──────────────┤
//         │[white panel]               cube    │
//         │                                    │
//   z=0   └──────────────[    ]────────────────┘
//       x=-8                                 x=8
import type { LevelData } from '../level';
import { PORTAL_Y, doorway, exitBay, glass, intake, lamp, panel, shell, strip, white } from './kitA';

const SHELF = 3.5;
const inn = intake(0, 0);
const out = exitBay(0, -20, SHELF, ['plate.pressed']);

export const C03: LevelData = {
  version: 2,
  id: 'c03',
  name: 'Practical 03',
  device: 'a',
  next: 'c04',
  info: { number: 3, title: 'Half a Fold', icons: ['portal', 'cube', 'button'] },
  spawn: inn.spawn,
  brushes: [
    ...shell({
      min: [-8, 0, -20],
      max: [8, 9, 0],
      holes: {
        s: [panel(-6.5, -2, 0, 3), doorway(0), panel(2, 6.5, 0, 3)],
        n: [doorway(0, SHELF)],
        // White panels on the west wall: one low, one above the shelf where amber lives.
        w: [panel(-19, -14, SHELF, SHELF + 3), panel(-11, -3, 0, 3)],
      },
    }),
    // The shelf: white on top, a dark metal face so it can't be climbed by aperture.
    white([-8, 0, -20], [8, SHELF, -13], { '+z': 'metal' }),
    // Glass rail along the shelf edge, with a gap where you step out.
    glass([-4, SHELF, -13.2], [8, SHELF + 1.1, -13]),
    ...inn.brushes,
    ...out.brushes,
  ],
  entities: [
    ...inn.entities,
    lamp('lamp1', [0, 8.4, -7], 9, 20),
    lamp('lamp2', [0, 8.4, -17], 6, 12),
    { id: 'amber', type: 'fixedPortal', position: [-8, SHELF + PORTAL_Y, -16.5], props: { which: 'b', normal: [1, 0, 0] } },
    { id: 'cube1', type: 'cube', position: [4, 0.33, -6] },
    { id: 'plate', type: 'floorButton', position: [3, SHELF, -16.5], props: { accepts: 'cube' } },
    strip('wire', [[3, SHELF, -17.4], [3, SHELF, -18.8], [1.9, SHELF, -18.8], [1.9, SHELF, -19.9]], [2.1, SHELF + 1.5, -19.98], 0),
    { id: 'hint', type: 'decal', position: [-7.98, 3.4, -7], yaw: Math.PI / 2, props: { text: 'APERTURE SURFACE', size: [2.4, 0.4], ink: '#6c7680' } },
    ...out.entities,
  ],
  wiring: [{ from: 'plate.pressed', to: 'wire.on' }, ...(out.wiring ?? [])],
  triggers: [
    { id: 'tShelf', min: [-8, SHELF, -20], max: [8, SHELF + 3, -13], event: 'c03.shelf', once: true },
    { id: 'tFloor', min: [-8, 0, -12], max: [8, 2, -2], event: 'c03.floor', once: true },
  ],
  dialogue: [
    { event: 'chamberStart', lines: ['c03.chamberStart.1', 'c03.chamberStart.2'] },
    { event: 'c03.floor', lines: ['c03.floor.1'] },
    { event: 'c03.shelf', lines: ['c03.shelf.1'] },
    { event: 'exitReached', lines: ['c03.exitReached.1'] },
  ],
};
