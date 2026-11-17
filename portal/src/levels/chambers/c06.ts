// Practical 06 — "Commute". New idea: platforms on rails.
//
//   A shuttle crosses a 12 m chasm (fall in and a lift in the corner brings you back up). On the far
//   side the plate wants a cube, and the cube is riding a second platform that runs back and forth at
//   head height over the chasm, stopping by a tall pillar. Ride over, put blue on the far side's low
//   west panel and amber on the panel above the pillar, step out on the pillar, take the cube off the
//   platform as it comes past, and walk off the pillar's north end onto the far side.
//
//   z=-30 ┌───────────────────────────[exit]──┐
//         │[white, low]   ( plate )           │  far side, y 0
//   z=-18 ├────────╥──────────────────┬pillar─┤
//         │        ║shuttle    cube ⇄ │ y 3.15│[white, high]
//         │        ║(x 0)    platform │       │  chasm, floor y −4
//   z=-6  ├─lift───╨──────────────────┴───────┤
//   z=0   └──────────────[    ]───────────────┘  start, y 0
//       x=-8                                 x=8
import type { LevelData } from '../level';
import { doorway, exitBay, intake, lamp, metal, panel, shell, strip, white } from './kitA';

const PILLAR_TOP = 3.15;
const inn = intake(0, 0);
const out = exitBay(4, -30, 0, ['plate.pressed']);

export const C06: LevelData = {
  version: 2,
  id: 'c06',
  name: 'Practical 06',
  device: 'both',
  next: 'c07',
  info: { number: 6, title: 'Commute', icons: ['platform', 'cube', 'portal', 'button'] },
  spawn: inn.spawn,
  brushes: [
    ...shell({
      min: [-8, 0, -30],
      max: [8, 9, 0],
      floor: null,
      holes: {
        s: [doorway(0)],
        n: [doorway(4)],
        w: [panel(-28, -20, 0, 3)],
        e: [panel(-16, -11, PILLAR_TOP + 0.3, PILLAR_TOP + 3.6)],
      },
    }),
    // Start floor, chasm (floor 4 m down), far side.
    metal([-8.5, -4.5, -6], [8.5, 0, 0.5]),
    metal([-8.5, -4.5, -30.5], [8.5, 0, -18]),
    metal([-8.5, -4.5, -18], [8.5, -4, -6]),
    // The pillar on the east side of the chasm, joined to the far side.
    white([4, -4, -18], [8, PILLAR_TOP, -9], { '-x': 'metal', '+z': 'metal' }),
    ...inn.brushes,
    ...out.brushes,
  ],
  entities: [
    ...inn.entities,
    lamp('lamp1', [0, 8.4, -6], 9, 18),
    lamp('lamp2', [0, 8.4, -22], 9, 18),
    { id: 'chasmLight', type: 'light', position: [0, -1.5, -12], props: { intensity: 3, distance: 10, color: 0xbfd8ff } },
    { id: 'shuttle', type: 'platform', position: [0, -0.15, -7.3], props: { waypoints: [[0, -0.15, -7.3], [0, -0.15, -16.7]], speed: 2 } },
    { id: 'carrier', type: 'platform', position: [-5, PILLAR_TOP - 0.15, -12.5], props: { waypoints: [[-5, PILLAR_TOP - 0.15, -12.5], [2.74, PILLAR_TOP - 0.15, -12.5]], speed: 1.2 } },
    { id: 'cube1', type: 'cube', position: [-5, PILLAR_TOP + 0.34, -12.5] },
    { id: 'lift', type: 'lift', position: [-6.5, -4.15, -7.5], props: { height: 4 } },
    { id: 'plate', type: 'floorButton', position: [0, 0, -24], props: { accepts: 'cube' } },
    strip('wire', [[0.8, 0, -24], [6.2, 0, -24], [6.2, 0, -29.9]], [6.4, 1.5, -29.98], 0),
    { id: 'liftSign', type: 'decal', position: [-7.98, -2.2, -7.5], yaw: Math.PI / 2, props: { text: 'LIFT ↑', size: [1.2, 0.4], ink: '#c9d2da' } },
    ...out.entities,
  ],
  wiring: [{ from: 'plate.pressed', to: 'wire.on' }, ...(out.wiring ?? [])],
  triggers: [
    { id: 'tFar', min: [-8, 0, -30], max: [8, 2, -18.5], event: 'c06.far', once: true },
    { id: 'tChasm', min: [-8, -4, -18], max: [8, -2, -6], event: 'c06.chasm', once: true },
    { id: 'tPillar', min: [4, PILLAR_TOP, -18], max: [8, PILLAR_TOP + 2, -9], event: 'c06.pillar', once: true },
  ],
  dialogue: [
    { event: 'chamberStart', lines: ['c06.chamberStart.1'] },
    { event: 'c06.chasm', lines: ['c06.chasm.1'] },
    { event: 'c06.far', lines: ['c06.far.1'] },
    { event: 'c06.pillar', lines: ['c06.pillar.1'] },
    { event: 'exitReached', lines: ['c06.exitReached.1'] },
  ],
};
