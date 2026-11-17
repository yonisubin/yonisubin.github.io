// Practical 01 — "Intake". New idea: moving, jumping, carrying a cube, a floor button. No device.
//
//   The cube waits on a 0.9 m shelf (jump up), the plate is in the middle of the room, and the
//   plate opens the exit door. Standing on the plate yourself opens the door too, but it closes the
//   moment you step off: 8 m is too far to run in 0.6 s, so the cube has to do the standing.
//
//   z=-18 ┌──────────[exit door]──────────┐  exit bay + elevator north of it
//         │ ┌shelf┐                       │
//         │ │cube │      ( plate )        ├┐ observation window (glass, east wall)
//         │ └─────┘                       ├┘
//   z=0   └────────────[    ]─────────────┘  antechamber + entry elevator south of it
//       x=-7                             x=7
import type { LevelData } from '../level';
import { doorway, exitBay, glass, intake, lamp, metal, shell, strip, white } from './kitA';

const inn = intake(0, 0);
const out = exitBay(0, -18, 0, ['plate.pressed']);

export const C01: LevelData = {
  version: 2,
  id: 'c01',
  name: 'Practical 01',
  device: 'none',
  next: 'c02',
  info: { number: 1, title: 'Intake', icons: ['cube', 'button'] },
  spawn: inn.spawn,
  brushes: [
    ...shell({
      min: [-7, 0, -18],
      max: [7, 6, 0],
      walls: { n: 'portalable', s: 'portalable', e: 'portalable', w: 'portalable' },
      holes: { s: [doorway(0)], n: [doorway(0)], e: [{ a0: -14, a1: -6, y0: 3, y1: 5 }] },
    }),
    // The shelf the cube sits on (one jump high).
    white([-7, 0, -14], [-3, 0.9, -6]),
    // Observation booth behind the glass.
    glass([7, 3, -14], [7.5, 5, -6]),
    ...shell({ min: [7.5, 2.5, -14.5], max: [10, 5.5, -5.5], floor: 'metal', ceiling: 'metal', walls: { w: null }, t: 0.3 }),
    metal([7.5, 2.2, -14.5], [10, 2.5, -5.5]),
    ...inn.brushes,
    ...out.brushes,
  ],
  entities: [
    ...inn.entities,
    lamp('lamp1', [0, 5.4, -9]),
    { id: 'boothLight', type: 'light', position: [8.8, 4.8, -10], props: { intensity: 2, distance: 5, color: 0x9fd0ff } },
    { id: 'boothSign', type: 'decal', position: [9.98, 4.4, -10], yaw: -Math.PI / 2, props: { text: 'REVIEW', size: [1.6, 0.5], ink: '#8fb8d8' } },
    { id: 'cube1', type: 'cube', position: [-6, 1.23, -10] },
    { id: 'plate', type: 'floorButton', position: [2, 0, -10] },
    strip('wire', [[2, 0, -10.9], [2, 0, -16], [1.9, 0, -16], [1.9, 0, -17.9]], [2.1, 1.5, -17.98], 0),
    { id: 'arrowUp', type: 'decal', position: [-2.6, 0.01, -10], yaw: Math.PI / 2, props: { image: 'arrow', floor: true, size: [1.2, 0.6] } },
    ...out.entities,
  ],
  wiring: [{ from: 'plate.pressed', to: 'wire.on' }, ...(out.wiring ?? [])],
  triggers: [
    { id: 'tShelf', min: [-7, 0.8, -14], max: [-3, 3, -6], event: 'c01.shelf', once: true },
    { id: 'tLeave', min: [-1.5, 0, -18], max: [1.5, 3, -16.8], event: 'c01.leaving', once: true },
  ],
  dialogue: [
    { event: 'chamberStart', lines: ['c01.chamberStart.1', 'c01.chamberStart.2'] },
    { event: 'c01.shelf', lines: ['c01.shelf.1'] },
    { event: 'c01.leaving', lines: ['c01.leaving.1'] },
    { event: 'exitReached', lines: ['c01.exitReached.1'] },
  ],
};
