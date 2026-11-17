// Practical 11 — "Faculty". One new idea: sentry turrets.
//
//   lobby (z 0..-8) → hall (z -9..-24): a turret stands with its back to you, guarding a pedestal
//   button that opens the hall's north door. Walk up behind it, lift it (from behind it can't
//   fire), turn it to face a wall and put it down, then press the pedestal.
//   → passage (x ±1.2, z -25..-38): a second turret sits in a bunker at the far end and sees the
//   whole passage through a low slot. Carry the cube in front of you as a shield (look down a
//   little so it covers you), and set it on the cube plate right in front of the slot: the slot is
//   blocked for good and the plate opens the exit door beside the bunker.
import type { LevelData } from '../level';
import { box, exitHall, lobby, M, note, P, room, strip, wall } from './kitB';

const L = lobby(0);
const X = exitHall(-2.75, -45);

export const C11: LevelData = {
  version: 2,
  id: 'c11',
  name: 'Practical 11 — Faculty',
  device: 'both',
  next: 'c12',
  info: { number: 11, title: 'Faculty', icons: ['turret', 'cube', 'button'] },
  spawn: L.spawn,
  brushes: [
    ...L.brushes,
    // The hall.
    ...room(-8, 8, 0, 5, -24, -9, { walls: { n: M, s: M, w: P, e: P }, floor: P, skip: ['s', 'n'] }),
    ...wall('x', -9, 9, -9, -8, 0, 5, M, [{ at: 0, width: 2.4, height: 3 }]),
    ...wall('x', -9, 9, -25, -24, 0, 5, M, [{ at: 0, width: 2.4, height: 3 }]),
    // The passage (metal, no openings) and the end room around the bunker.
    ...room(-1.2, 1.2, 0, 3.5, -38, -25, { walls: M, floor: M, skip: ['n', 's'] }),
    ...room(-4, 4, 0, 4, -44, -38, { walls: M, floor: M, skip: ['n', 's', 'floor'] }),
    ...wall('x', -5, 5, -38, -37, 0, 4, M, [{ at: 0, width: 2.4, height: 3.5 }]),
    ...wall('x', -5, 5, -45, -44, 0, 4, M, [{ at: -2.75, width: 2.4, height: 3 }]),
    // End-room floor with a recess for the bunker turret (x -0.6..0.6, z -44..-42, floor -0.8).
    box([-5, -1, -44], [-0.6, 0, -38]),
    box([0.6, -1, -44], [5, 0, -38]),
    box([-0.6, -1, -42], [0.6, 0, -38]),
    box([-0.6, -1.8, -44], [0.6, -0.8, -42]),
    // The bunker hood: a slot 0.5 wide and 0.5 tall from z -42 to -41.
    box([-1.5, 0.5, -44], [1.5, 2, -41]),
    box([-1.5, 0, -44], [-0.6, 0.5, -42]),
    box([0.6, 0, -44], [1.5, 0.5, -42]),
    box([-1.5, 0, -42], [-0.25, 0.5, -41]),
    box([0.25, 0, -42], [1.5, 0.5, -41]),
    ...X.brushes,
  ],
  entities: [
    ...L.entities,
    { id: 'hallLight', type: 'light', position: [0, 4.5, -16], props: { intensity: 9, distance: 22 } },
    { id: 'tur1', type: 'turret', position: [0, 0.61, -19], yaw: Math.PI },
    { id: 'ped1', type: 'pedestalButton', position: [0, 0, -22] },
    { id: 'door1', type: 'door', position: [0, 0, -24.5] },
    strip('ind1', [1.5, 2.6, -23.95], [[0, -22.3], [1.5, -22.3], [1.5, -23.9]], 0, 'check'),
    { id: 'cube1', type: 'cube', position: [0, 0.33, -26.5] },
    { id: 'passLight', type: 'light', position: [0, 3.2, -31], props: { intensity: 5, distance: 12 } },
    { id: 'tur2', type: 'turret', position: [0, -0.19, -43], yaw: 0 },
    { id: 'plate', type: 'floorButton', position: [0, 0, -40.6], props: { accepts: 'cube' } },
    strip('ind2', [-2.75, 3.3, -43.95], [[-0.9, -40.6], [-2.75, -40.6], [-2.75, -43.9]], 0, 'check'),
    { id: 'endLight', type: 'light', position: [0, 3.7, -40], props: { intensity: 5, distance: 12 } },
    ...X.entities,
    note('cn11a', [1.8, 1.5, -11], 'Turrets are introduced from behind first: the safest view of a new threat is the back of it.'),
    note('cn11b', [0.9, 1.5, -27.5], 'The shield trick only works because the bunker slot is lower than a cube. We tuned the slot until a carried cube covered it.'),
  ],
  wiring: [
    { from: 'ped1.pressed', to: 'door1.open' },
    { from: 'ped1.pressed', to: 'ind1.on' },
    { from: 'plate.pressed', to: 'exitDoor.open' },
    { from: 'plate.pressed', to: 'ind2.on' },
  ],
  triggers: [
    { id: 'tHall', min: [-3, 0, -13], max: [3, 3, -9.5], event: 'c11.hall', once: true },
    { id: 'tPassage', min: [-1.2, 0, -28], max: [1.2, 3, -25], event: 'c11.passage', once: true },
  ],
  checkpoints: [{ id: 'c11cp', min: [-1.2, 0, -27], max: [1.2, 3, -25.2], spawn: { position: [0, 0, -25.6], yaw: 0 } }],
  dialogue: [
    { event: 'chamberStart', lines: ['c11.chamberStart.1', 'c11.chamberStart.2'] },
    { event: 'c11.hall', lines: ['c11.hall.1'] },
    { event: 'c11.passage', lines: ['c11.passage.1'] },
    { event: 'exitReached', lines: ['c11.exit.1'] },
  ],
};
