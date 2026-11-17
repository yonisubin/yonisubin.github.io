// Practical 16 — "Midterm Review". Combination: a timed button and a fling.
//
//   The same kind of room as practical 14, harder: you start on a ledge behind a glass rail, with
//   a 10 m shaft in its floor and a white east wall across the room. Below is no pool this time but
//   a bottomless pit, with a dry strip along the west wall (y -4). The exit door at the end of the
//   strip opens for 10 s when you press the pedestal on the ledge. Open both ends first (shaft
//   bottom, high on the east wall), press, drop down the shaft, fly west, land on the strip and run
//   for the door.
import type { LevelData } from '../level';
import { box, exitHall, G, lobby, M, note, P, strip, wall } from './kitB';

const L = lobby(0);
const X = exitHall(-11, -30, -4);

export const C16: LevelData = {
  version: 2,
  id: 'c16',
  name: 'Practical 16 — Midterm Review',
  device: 'both',
  next: 'c17',
  info: { number: 16, title: 'Midterm Review', icons: ['timer', 'fling', 'portal'] },
  spawn: L.spawn,
  brushes: [
    ...L.brushes,
    ...wall('x', -17, 9, -9, -8, 0, 8, M, [{ at: 0, width: 2.4, height: 3 }]),
    box([-17, -11, -30], [-16, 8, -8], M),
    box([8, -11, -30], [9, 8, -8], P),
    ...wall('x', -17, 9, -30, -29, -4, 8, M, [{ at: -11, width: 2.4, height: 3 }]),
    box([-17, 8, -30], [9, 9, -8], M),
    // The ledge (y 0) with the shaft (x -1..1, z -15..-11, bottom y -10).
    box([-16, -11, -15], [-1, 0, -9], M, { '+y': P }),
    box([1, -11, -15], [8, 0, -9], M, { '+y': P }),
    box([-1, -11, -11], [1, 0, -9], M, { '+y': P }),
    box([-1, -11, -15.2], [1, 0, -15], M),
    box([-1, -11, -15], [1, -10, -11], P),
    box([-16, 0, -15.2], [8, 1.6, -15], G),
    // The dry strip (x -16..-6, y -4); everything east of it is a bottomless pit.
    box([-16, -5, -29], [-6, -4, -15.2], M),
    ...X.brushes,
  ],
  entities: [
    ...L.entities,
    { id: 'ledgeLight', type: 'light', position: [0, 7.5, -12], props: { intensity: 7, distance: 16 } },
    { id: 'hallLight1', type: 'light', position: [-4, 7.5, -22], props: { intensity: 10, distance: 24 } },
    { id: 'hallLight2', type: 'light', position: [-11, 4, -25], props: { intensity: 7, distance: 16 } },
    { id: 'ped', type: 'pedestalButton', position: [5, 0, -12], props: { seconds: 10 } },
    strip('iTimer', [4.2, 1.6, -9.05], [[5, -11.2], [5, -9.6], [4.2, -9.6]], 0, 'timer', Math.PI),
    { id: 'exitSignal', type: 'indicator', position: [-9.3, -1, -28.95], props: { icon: 'timer' } },
    ...X.entities,
    note('cn16a', [-6, 1.6, -10], 'Ten seconds is generous if you set both ends first and cruel if you do not. The pedestal is on the ledge so that the order is your decision.'),
    note('cn16b', [-15, -2.4, -20], 'The strip is wide enough to land on from any sensible height on the east wall. We wanted the pit to punish hesitation, not aim.'),
  ],
  wiring: [
    { from: 'ped.pressed', to: 'exitDoor.open' },
    { from: 'ped.pressed', to: 'iTimer.on' },
    { from: 'ped.pressed', to: 'exitSignal.on' },
  ],
  triggers: [{ id: 'tLanded', min: [-16, -4, -27], max: [-6, -1, -15.2], event: 'c16.landed', once: true }],
  dialogue: [
    { event: 'chamberStart', lines: ['c16.chamberStart.1', 'c16.chamberStart.2'] },
    { event: 'c16.landed', lines: ['c16.landed.1'] },
    { event: 'exitReached', lines: ['c16.exit.1'] },
  ],
};
