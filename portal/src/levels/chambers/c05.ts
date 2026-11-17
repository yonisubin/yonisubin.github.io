// Practical 05 — "Both Ends". New idea: the full device, both colours. Basic placement.
//
//   The exit is on a 3.5 m shelf; the cube is at the bottom of a 3 m pit with white walls, and the
//   shelf's plate wants it. Seen from the pit you can't see the shelf, so the plan has to come first:
//   put amber on the panel above the shelf from the floor, then drop into the pit, take the cube,
//   put blue on a pit wall and walk out onto the shelf. (Two apertures. Most applicants use more.)
//
//   z=-24 ┌──[exit]────────[white panel, high]──┐
//         │   SHELF y 3.5   ( plate )           │
//   z=-17 ├───── metal face ────────────────────┤
//         │ ┌──pit──┐                            │
//         │ │ cube  │ (white walls, floor −3)  [white panel, low]
//         │ └───────┘                            │
//   z=0   └───────────────[    ]────────────────┘
//       x=-8                                   x=8
import type { LevelData } from '../level';
import { doorway, exitBay, intake, lamp, metal, panel, shell, strip, white } from './kitA';

const SHELF = 3.5;
const PIT = { x0: -7, x1: -1, z0: -14, z1: -8, y: -3 };
const inn = intake(0, 0);
const out = exitBay(-4, -24, SHELF, ['plate.pressed']);

export const C05: LevelData = {
  version: 2,
  id: 'c05',
  name: 'Practical 05',
  device: 'both',
  next: 'c06',
  info: { number: 5, title: 'Both Ends', icons: ['portal', 'portal', 'cube', 'button'] },
  spawn: inn.spawn,
  brushes: [
    ...shell({
      min: [-8, 0, -24],
      max: [8, 9, 0],
      floor: null,
      holes: {
        s: [doorway(0)],
        n: [doorway(-4, SHELF), panel(1, 7, SHELF + 0.4, SHELF + 4)],
        e: [panel(-12, -4, 0, 3)],
      },
    }),
    // Floor around the pit (metal on top, white where it lines the pit).
    metal([-8.5, -3.5, -24.5], [8.5, 0, PIT.z0], { '+z': 'portalable' }),
    metal([-8.5, -3.5, PIT.z1], [8.5, 0, 0.5], { '-z': 'portalable' }),
    metal([-8.5, -3.5, PIT.z0], [PIT.x0, 0, PIT.z1], { '+x': 'portalable' }),
    metal([PIT.x1, -3.5, PIT.z0], [8.5, 0, PIT.z1], { '-x': 'portalable' }),
    white([PIT.x0, -3.5, PIT.z0], [PIT.x1, PIT.y, PIT.z1]),
    // The shelf.
    white([-8, 0, -24], [8, SHELF, -17], { '+z': 'metal' }),
    ...inn.brushes,
    ...out.brushes,
  ],
  entities: [
    ...inn.entities,
    lamp('lamp1', [0, 8.4, -8], 10, 20),
    lamp('lamp2', [0, 8.4, -20], 7, 14),
    { id: 'pitLight', type: 'light', position: [-4, -0.6, -11], props: { intensity: 3, distance: 6 } },
    { id: 'cube1', type: 'cube', position: [-5.6, PIT.y + 0.33, -12.6] },
    { id: 'plate', type: 'floorButton', position: [-0.5, SHELF, -20.5], props: { accepts: 'cube' } },
    strip('wire', [[-1.4, SHELF, -20.5], [-6.2, SHELF, -20.5], [-6.2, SHELF, -23.9]], [-6.4, SHELF + 1.5, -23.98], 0),
    ...out.entities,
  ],
  wiring: [{ from: 'plate.pressed', to: 'wire.on' }, ...(out.wiring ?? [])],
  triggers: [
    { id: 'tPit', min: [PIT.x0, PIT.y, PIT.z0], max: [PIT.x1, PIT.y + 2, PIT.z1], event: 'c05.pit', once: true },
    { id: 'tShelf', min: [-8, SHELF, -24], max: [8, SHELF + 3, -17], event: 'c05.shelf', once: true },
  ],
  dialogue: [
    { event: 'chamberStart', lines: ['c05.chamberStart.1', 'c05.chamberStart.2'] },
    { event: 'c05.pit', lines: ['c05.pit.1'] },
    { event: 'c05.shelf', lines: ['c05.shelf.1'] },
    { event: 'exitReached', lines: ['c05.exitReached.1'] },
  ],
};
