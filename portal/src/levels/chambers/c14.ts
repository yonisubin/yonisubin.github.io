// Practical 14 — "Momentum". Combination: a fling, then a turret.
//
//   You enter on a ledge (y 0) behind a glass rail, above a hall whose floor is 4 m lower (y -4)
//   and mostly a pool of correction fluid. In the ledge floor is a narrow shaft (2 × 4 m, 10 m deep), with a
//   white bottom. The hall's east wall is white. Put one end at the bottom of the shaft and the
//   other high on the east wall, then drop down the shaft: you leave the wall at ~15 m/s, sail
//   west over the pool and land on the dry strip by the west wall.
//   A turret down there faces the exit pedestal with its back to you. Lift it, turn it to the
//   wall, press the pedestal.
import type { LevelData } from '../level';
import { box, exitHall, G, lobby, M, note, P, strip, wall } from './kitB';

const L = lobby(0);
const X = exitHall(-8, -41, -4);

export const C14: LevelData = {
  version: 2,
  id: 'c14',
  name: 'Practical 14 — Momentum',
  device: 'both',
  next: 'c15',
  info: { number: 14, title: 'Momentum', icons: ['fling', 'liquid', 'turret'] },
  spawn: L.spawn,
  brushes: [
    ...L.brushes,
    // South wall (lobby doorway at x 0), west wall (metal), east wall (white), north wall, ceiling.
    ...wall('x', -13, 9, -9, -8, 0, 8, M, [{ at: 0, width: 2.4, height: 3 }]),
    box([-13, -11, -41], [-12, 8, -8], M),
    box([8, -11, -41], [9, 8, -8], P),
    ...wall('x', -13, 9, -41, -40, -4, 8, M, [{ at: -8, width: 2.4, height: 3 }]),
    box([-13, 8, -41], [9, 9, -8], M),
    // The ledge (y 0) with the shaft (x -1..1, z -15..-11, bottom y -10).
    box([-12, -11, -15], [-1, 0, -9], M, { '+y': P }),
    box([1, -11, -15], [8, 0, -9], M, { '+y': P }),
    box([-1, -11, -11], [1, 0, -9], M, { '+y': P }),
    box([-1, -11, -15.2], [1, 0, -15], M),
    box([-1, -11, -15], [1, -10, -11], P),
    // Glass rail along the ledge edge (too tall to jump, low enough to shoot over).
    box([-12, 0, -15.2], [8, 1.6, -15], G),
    // The hall floor (y -4): dry strip x -12..-4, the pool basin x -4..8 for z -15..-26.
    box([-12, -5, -40], [-4, -4, -15], M),
    box([-4, -6, -26], [8, -5, -15.2], M),
    box([-4, -5, -40], [8, -4, -26], M),
    ...X.brushes,
  ],
  entities: [
    ...L.entities,
    { id: 'ledgeLight', type: 'light', position: [0, 7.5, -12], props: { intensity: 7, distance: 16 } },
    { id: 'hallLight1', type: 'light', position: [-2, 7.5, -22], props: { intensity: 10, distance: 24 } },
    { id: 'hallLight2', type: 'light', position: [-6, 4, -34], props: { intensity: 7, distance: 16 } },
    { id: 'pool', type: 'liquid', position: [2, -4.3, -20.5], props: { size: [12, 1.5, 11] } },
    { id: 'tur', type: 'turret', position: [-8, -3.39, -31], yaw: Math.PI },
    { id: 'ped', type: 'pedestalButton', position: [-8, -4, -35] },
    strip('iX', [-6.3, -1, -39.95], [[-8, -35.8], [-6.3, -35.8], [-6.3, -39.9]], -4, 'check'),
    ...X.entities,
    note('cn14a', [-3, 1.6, -10], 'The rail is exactly tall enough that you cannot jump it and exactly short enough that you can shoot over it. Both numbers took a while.'),
    note('cn14b', [-11, -2.4, -18], 'Landing behind the turret is the reward for flinging well: the chamber teaches you that speed buys you a better angle.'),
  ],
  wiring: [
    { from: 'ped.pressed', to: 'exitDoor.open' },
    { from: 'ped.pressed', to: 'iX.on' },
  ],
  triggers: [
    { id: 'tLanded', min: [-12, -4, -28], max: [-4, -1, -15], event: 'c14.landed', once: true },
    { id: 'tShaft', min: [-1, -9, -15], max: [1, -1, -11], event: 'c14.shaft', once: true },
  ],
  checkpoints: [{ id: 'c14cp', min: [-12, -4, -28], max: [-4, -1, -15], spawn: { position: [-8, -4, -20], yaw: 0 } }],
  dialogue: [
    { event: 'chamberStart', lines: ['c14.chamberStart.1', 'c14.chamberStart.2'] },
    { event: 'c14.shaft', lines: ['c14.shaft.1'] },
    { event: 'c14.landed', lines: ['c14.landed.1'] },
    { event: 'exitReached', lines: ['c14.exit.1'] },
  ],
};

