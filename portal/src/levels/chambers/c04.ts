// Practical 04 — "Errand". New idea: the energy pellet and its receptacle. Device: blue only, amber
// fixed high on the north wall.
//
//   A launcher on the west wall fires a pellet straight across the room at chest height; it bounces
//   off the east wall forever (and kills whoever stands in its way). The only white surface it hits
//   is one panel on the east wall. Put blue there: the pellet comes out of the fixed amber end high on
//   the north wall, crosses the room overhead and lands in the receptacle on the south wall, which
//   opens the exit. A caught pellet stops its launcher, so the room is safe to cross afterwards.
//
//   z=-16 ┌──[amber, high]──────────────[exit door]──┐
//         │                                          │
//   z=-8  │launcher → → → → → → → → → → → → →[white]│
//         │                                          │
//   z=0   └──[receptacle, high]──[    ]──────────────┘
//       x=-8                                       x=8
import type { LevelData } from '../level';
import { PORTAL_Y, doorway, exitBay, intake, lamp, panel, shell, strip } from './kitA';

const LANE = { y: 1.4, z: -8 };
const AMBER = { x: -4, y: 4 + PORTAL_Y };
const inn = intake(0, 0);
const out = exitBay(4, -16, 0, ['catcher.caught']);

export const C04: LevelData = {
  version: 2,
  id: 'c04',
  name: 'Practical 04',
  device: 'a',
  next: 'c05',
  info: { number: 4, title: 'Errand', icons: ['pellet', 'portal'] },
  spawn: inn.spawn,
  brushes: [
    ...shell({
      min: [-8, 0, -16],
      max: [8, 8, 0],
      floor: 'metal',
      holes: {
        s: [doorway(0)],
        n: [panel(AMBER.x - 0.8, AMBER.x + 0.8, 3.9, 6.2), doorway(4)],
        e: [panel(LANE.z - 0.65, LANE.z + 0.65, 0, 2.2)],
      },
    }),
    ...inn.brushes,
    ...out.brushes,
  ],
  entities: [
    ...inn.entities,
    lamp('lamp1', [0, 7.4, -8], 10, 20),
    { id: 'launcher', type: 'pelletLauncher', position: [-8, LANE.y, LANE.z], props: { direction: [1, 0, 0], life: 10 } },
    { id: 'amber', type: 'fixedPortal', position: [AMBER.x, AMBER.y, -16], props: { which: 'b', normal: [0, 0, 1] } },
    // The pellet leaves amber 0.3 m above its centre (it enters blue 0.3 m above blue's centre).
    { id: 'catcher', type: 'pelletCatcher', position: [AMBER.x, AMBER.y + 0.3, 0], props: { direction: [0, 0, -1] } },
    strip('wire', [[AMBER.x, 0, -0.6], [6, 0, -0.6], [6, 0, -15.9]], [6.1, 1.5, -15.98], 0),
    { id: 'warn', type: 'decal', position: [-7.98, 2.6, LANE.z], yaw: Math.PI / 2, props: { image: 'warning', size: [0.8, 0.7], ink: '#d9a521' } },
    { id: 'laneMark', type: 'decal', position: [0, 0.01, LANE.z], props: { text: 'KEEP CLEAR', floor: true, size: [3, 0.5], ink: '#c8a23a' } },
    ...out.entities,
  ],
  wiring: [{ from: 'catcher.caught', to: 'wire.on' }, ...(out.wiring ?? [])],
  triggers: [{ id: 'tLane', min: [-8, 0, -9], max: [8, 2, -7], event: 'c04.lane', once: true }],
  dialogue: [
    { event: 'chamberStart', lines: ['c04.chamberStart.1', 'c04.chamberStart.2'] },
    { event: 'c04.lane', lines: ['c04.lane.1'] },
    { event: 'death', lines: ['c04.death.1'] },
    { event: 'exitReached', lines: ['c04.exitReached.1'] },
  ],
};
