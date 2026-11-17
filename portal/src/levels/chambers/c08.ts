// Practical 08 — "Launch". New idea: the fling (fall into a floor aperture, leave a wall one fast).
//
//   A 10 m chasm separates the start from the exit side. On the chasm's edge stands a launch block
//   whose north face is white; you can only see that face from the end of a narrow catwalk on the
//   east side. South of it is a 4 m drop pit (white floor) and a tower 9 m tall (lift). Amber on the
//   launch face (from the catwalk), blue on the pit floor (from the tower), step off the tower: you
//   come out of the launch face at ~17 m/s and fly over the chasm. Fall in and a lift brings you back.
//
//   z=-40 ┌──────────[exit]──────────┐
//         │       (pedestal)         │  exit side, y 0
//   z=-26 ├──────────────────────────┤
//         │   chasm (floor −10)  ┌cw┐│  catwalk x 6..8 to z −22
//   z=-16 │ [lift]  [launch block]│  ││  north face white, y −10..5
//   z=-14 │         ┌──pit───┐    └──┘│
//         │ TOWER   │ y −4   │       │
//   z=-6  │ y 9     └────────┘       │
//         │ [lift]                   │
//   z=0   └──────────[    ]──────────┘
//       x=-8                       x=8
import type { LevelData } from '../level';
import { doorway, exitBay, intake, lamp, metal, shell, strip, white } from './kitA';

const TOWER = 9;
const PIT = { x0: -2, x1: 4, z0: -12, z1: -6, y: -4 };
const CHASM = { z0: -26, z1: -16, y: -10 };
const inn = intake(0, 0);
const out = exitBay(0, -40, 0, ['bell.pressed']);

export const C08: LevelData = {
  version: 2,
  id: 'c08',
  name: 'Practical 08',
  device: 'both',
  next: 'c09',
  info: { number: 8, title: 'Launch', icons: ['fling', 'portal', 'platform'] },
  spawn: inn.spawn,
  brushes: [
    ...shell({ min: [-8, 0, -40], max: [8, 14, 0], floor: null, holes: { s: [doorway(0)], n: [doorway(0)] } }),
    // Start floor around the drop pit.
    metal([-8.5, -4.5, PIT.z1], [8.5, 0, 0.5]),
    metal([-8.5, -4.5, CHASM.z1], [8.5, 0, PIT.z0]),
    metal([-8.5, -4.5, PIT.z0], [PIT.x0, 0, PIT.z1]),
    metal([PIT.x1, -4.5, PIT.z0], [8.5, 0, PIT.z1]),
    white([PIT.x0, -4.5, PIT.z0], [PIT.x1, PIT.y, PIT.z1], { '-y': 'metal' }),
    // Chasm floor, exit side.
    metal([-8.5, CHASM.y - 0.5, CHASM.z0], [8.5, CHASM.y, CHASM.z1]),
    metal([-8.5, -4.5, -40.5], [8.5, 0, CHASM.z0]),
    // Launch block on the chasm's edge: white north face from the chasm floor up.
    metal([-3, CHASM.y, -16.01], [3, 5, -14], { '-z': 'portalable' }),
    // The catwalk along the east wall (the only place the launch face can be seen from).
    metal([6, -0.3, -22], [8, 0, CHASM.z1]),
    // The tower.
    metal([-8, 0, PIT.z0], [-3, TOWER, -4.8]),
    ...inn.brushes,
    ...out.brushes,
  ],
  entities: [
    ...inn.entities,
    lamp('lamp1', [0, 13.4, -6], 10, 22),
    lamp('lamp2', [0, 13.4, -21], 10, 24),
    lamp('lamp3', [0, 13.4, -33], 9, 18),
    { id: 'towerLift', type: 'lift', position: [-5.5, -0.15, -3.5], props: { height: TOWER } },
    { id: 'chasmLift', type: 'lift', position: [-5.5, CHASM.y - 0.15, -17.3], props: { height: -CHASM.y } },
    { id: 'bell', type: 'pedestalButton', position: [3, 0, -33] },
    strip('wire', [[3, 0, -33.4], [3, 0, -37], [1.9, 0, -37], [1.9, 0, -39.9]], [2.1, 1.5, -39.98], 0),
    { id: 'landing', type: 'decal', position: [0, 0.01, -29.5], props: { image: 'arrow', floor: true, size: [1.6, 0.8] }, yaw: -Math.PI / 2 },
    { id: 'catwalkSign', type: 'decal', position: [7.98, 2, -19], yaw: -Math.PI / 2, props: { text: 'VIEWING', size: [1.4, 0.4], ink: '#c9d2da' } },
    ...out.entities,
  ],
  wiring: [{ from: 'bell.pressed', to: 'wire.on' }, ...(out.wiring ?? [])],
  triggers: [
    { id: 'tCatwalk', min: [6, 0, -22], max: [8, 2, -18], event: 'c08.catwalk', once: true },
    { id: 'tTower', min: [-8, TOWER, PIT.z0], max: [-3, TOWER + 2, -4.8], event: 'c08.tower', once: true },
    { id: 'tChasm', min: [-8, CHASM.y, CHASM.z0], max: [8, CHASM.y + 2, CHASM.z1], event: 'c08.chasm', once: true },
    { id: 'tFar', min: [-8, 0, -40], max: [8, 2, -27], event: 'c08.far', once: true },
  ],
  dialogue: [
    { event: 'chamberStart', lines: ['c08.chamberStart.1', 'c08.chamberStart.2'] },
    { event: 'c08.catwalk', lines: ['c08.catwalk.1'] },
    { event: 'c08.tower', lines: ['c08.tower.1'] },
    { event: 'c08.chasm', lines: ['c08.chasm.1'] },
    { event: 'c08.far', lines: ['c08.far.1'] },
    { event: 'exitReached', lines: ['c08.exitReached.1'] },
  ],
};
