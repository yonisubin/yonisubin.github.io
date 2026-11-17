// Practical 13 — "Deadline". Combination: a timed button, then an energy pellet.
//
//   Room A (z -9..-35): a pit across the middle. A pedestal on the near ledge opens the far door
//   for 8 s — too short to get round on foot (there is no way round). Open a pair on the white
//   side wall first (near and far), then press, walk through, and make the door.
//   Room B (z -36..-52): a pellet launcher on the east wall fires west and bounces east–west for
//   ever. Put one end on the west wall where it lands and the other on the south wall, low, facing
//   the receptacle on the north wall: it flies straight in, and the exit door opens.
import type { LevelData } from '../level';
import { box, exitHall, lobby, M, note, P, room, strip, wall } from './kitB';

const L = lobby(0);
const X = exitHall(4, -53);

export const C13: LevelData = {
  version: 2,
  id: 'c13',
  name: 'Practical 13 — Deadline',
  device: 'both',
  next: 'c14',
  info: { number: 13, title: 'Deadline', icons: ['timer', 'pellet', 'portal'] },
  spawn: L.spawn,
  brushes: [
    ...L.brushes,
    // Room A: pit z -15..-28.
    ...room(-8, 8, 0, 6, -35, -9, { walls: { w: P, e: M }, skip: ['n', 's', 'floor'] }),
    box([-9, -1, -15], [9, 0, -8]),
    box([-9, -1, -36], [9, 0, -28]),
    ...wall('x', -9, 9, -9, -8, 0, 6, M, [{ at: 0, width: 2.4, height: 3 }]),
    // A/B wall: white west of the door (the pellet's exit end goes here), metal east of it.
    box([-9, 0, -36], [-1.2, 6, -35], P),
    box([1.2, 0, -36], [9, 6, -35], M),
    box([-1.2, 3, -36], [1.2, 6, -35], M),
    // Room B.
    ...room(-8, 8, 0, 6, -52, -36, { walls: { w: P, e: M, n: M }, floor: M, skip: ['s', 'n'] }),
    ...wall('x', -9, 9, -53, -52, 0, 6, M, [{ at: 4, width: 2.4, height: 3 }]),
    ...X.brushes,
  ],
  entities: [
    ...L.entities,
    { id: 'aLight1', type: 'light', position: [0, 5.5, -12], props: { intensity: 7, distance: 16 } },
    { id: 'aLight2', type: 'light', position: [0, 5.5, -31], props: { intensity: 7, distance: 16 } },
    { id: 'ped', type: 'pedestalButton', position: [4, 0, -13], props: { seconds: 8 } },
    { id: 'dA', type: 'door', position: [0, 0, -35.5] },
    strip('iA', [1.7, 3.3, -34.95], [[4, -13.8], [4, -14.6], [7.5, -14.6], [7.5, -34], [1.7, -34], [1.7, -34.9]], 0, 'timer'),
    { id: 'bLight', type: 'light', position: [0, 5.5, -44], props: { intensity: 8, distance: 18 } },
    { id: 'launcher', type: 'pelletLauncher', position: [7.9, 1.5, -44], props: { direction: [-1, 0, 0], life: 14 } },
    { id: 'catcher', type: 'pelletCatcher', position: [-4, 1.5, -51.9], props: { direction: [0, 0, 1] } },
    strip('iB', [5.7, 3.3, -51.95], [[-4, -51.5], [-4, -51], [5.7, -51], [5.7, -51.9]], 0, 'check'),
    ...X.entities,
    note('cn13a', [-6.5, 1.6, -10.5], 'Eight seconds is about two seconds more than the walk through the openings. The pit is there so the clock has nothing to argue with.'),
    note('cn13b', [6.5, 1.6, -38], 'The pellet starts bouncing between two walls on purpose: it shows you the line it will follow before you change it.'),
  ],
  wiring: [
    { from: 'ped.pressed', to: 'dA.open' },
    { from: 'ped.pressed', to: 'iA.on' },
    { from: 'catcher.caught', to: 'exitDoor.open' },
    { from: 'catcher.caught', to: 'iB.on' },
  ],
  triggers: [
    { id: 'tRoomB', min: [-2, 0, -40], max: [2, 4, -36.2], event: 'c13.pellet', once: true },
    { id: 'tPressed', min: [3, 0, -14.5], max: [5, 3, -11.5], event: 'c13.timer', once: true },
  ],
  checkpoints: [{ id: 'c13cp', min: [-2, 0, -40], max: [2, 4, -36.2], spawn: { position: [0, 0, -37.5], yaw: 0 } }],
  dialogue: [
    { event: 'chamberStart', lines: ['c13.chamberStart.1'] },
    { event: 'c13.timer', lines: ['c13.timer.1'] },
    { event: 'c13.pellet', lines: ['c13.pellet.1'] },
    { event: 'exitReached', lines: ['c13.exit.1'] },
  ],
};
