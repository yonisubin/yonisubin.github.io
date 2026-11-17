// Practical 17 — "Finals Week". Everything since practical 11 at once: pellet, fling, turret, timer.
//
//   On the ledge a pellet runs east–west at shoulder height. Its receptacle is in the ceiling: put
//   one end where the pellet strikes the white east wall and the other on the floor under the
//   receptacle. Caught, it slides a white panel out of the metal east wall over the hall.
//   Then it is practical 16 with company: the exit door at the end of the strip opens for 14 s
//   when you press the ledge pedestal; a turret on the strip faces that door with its back to the
//   landing. Ends on the shaft bottom and the panel, press, drop, land, lift the turret and turn it
//   to the wall, run.
import type { LevelData } from '../level';
import { box, exitHall, G, lobby, M, note, P, strip, wall } from './kitB';

const L = lobby(0);
const X = exitHall(-11, -30, -4);

export const C17: LevelData = {
  version: 2,
  id: 'c17',
  name: 'Practical 17 — Finals Week',
  device: 'both',
  next: 'c18',
  info: { number: 17, title: 'Finals Week', icons: ['pellet', 'fling', 'turret', 'timer'] },
  spawn: L.spawn,
  brushes: [
    ...L.brushes,
    ...wall('x', -17, 9, -9, -8, 0, 8, M, [{ at: 0, width: 2.4, height: 3 }]),
    box([-17, -11, -30], [-16, 8, -8], M),
    // East wall: white beside the ledge (the pellet end), metal over the hall (the panel slides out).
    box([8, -11, -15], [9, 8, -8], P),
    box([8, -11, -30], [9, 8, -15], M),
    ...wall('x', -17, 9, -30, -29, -4, 8, M, [{ at: -11, width: 2.4, height: 3 }]),
    box([-17, 8, -30], [9, 9, -8], M),
    // The ledge and the shaft (x -1..1, z -15..-11, bottom y -10).
    box([-16, -11, -15], [-1, 0, -9], M, { '+y': P }),
    box([1, -11, -15], [8, 0, -9], M, { '+y': P }),
    box([-1, -11, -11], [1, 0, -9], M, { '+y': P }),
    box([-1, -11, -15.2], [1, 0, -15], M),
    box([-1, -11, -15], [1, -10, -11], P),
    box([-16, 0, -15.2], [8, 1.6, -15], G),
    // The dry strip; the rest is a bottomless pit.
    box([-16, -5, -29], [-6, -4, -15.2], M),
    ...X.brushes,
  ],
  entities: [
    ...L.entities,
    { id: 'ledgeLight', type: 'light', position: [-4, 7.5, -12], props: { intensity: 8, distance: 18 } },
    { id: 'hallLight', type: 'light', position: [-4, 7.5, -22], props: { intensity: 10, distance: 24 } },
    { id: 'launcher', type: 'pelletLauncher', position: [-15.9, 1.5, -12], props: { direction: [1, 0, 0], life: 12 } },
    { id: 'catcher', type: 'pelletCatcher', position: [-6, 7.9, -12], props: { direction: [0, -1, 0] } },
    { id: 'panel', type: 'panel', position: [8.15, 2.5, -20], props: { size: [0.3, 3, 3], to: [-0.45, 0, 0], tag: 'portalable' } },
    { id: 'ped', type: 'pedestalButton', position: [5, 0, -10.2], props: { seconds: 14 } },
    strip('iTimer', [4.2, 1.6, -9.05], [[5, -9.6], [4.2, -9.6]], 0, 'timer', Math.PI),
    { id: 'tur', type: 'turret', position: [-11, -3.39, -25], yaw: Math.PI },
    { id: 'exitSignal', type: 'indicator', position: [-9.3, -1, -28.95], props: { icon: 'timer' } },
    ...X.entities,
    note('cn17a', [-14, 1.6, -9.8], 'The receptacle is in the ceiling so the floor is the only answer for the second end. A pellet going straight up is the clearest line we have.'),
    note('cn17b', [-15, -2.4, -17], 'This is the exam: every idea since the faculty arrived, in the order you learned them, against one clock.'),
  ],
  wiring: [
    { from: 'catcher.caught', to: 'panel.active' },
    { from: 'ped.pressed', to: 'exitDoor.open' },
    { from: 'ped.pressed', to: 'iTimer.on' },
    { from: 'ped.pressed', to: 'exitSignal.on' },
  ],
  triggers: [
    { id: 'tPanel', min: [-16, 0, -15], max: [8, 4, -9], event: 'c17.start', once: true },
    { id: 'tLanded', min: [-16, -4, -22], max: [-6, -1, -15.2], event: 'c17.landed', once: true },
  ],
  dialogue: [
    { event: 'chamberStart', lines: ['c17.chamberStart.1', 'c17.chamberStart.2'] },
    { event: 'c17.landed', lines: ['c17.landed.1'] },
    { event: 'exitReached', lines: ['c17.exit.1'] },
  ],
};
