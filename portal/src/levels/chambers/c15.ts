// Practical 15 — "Office Hours". Combination: pellet, a shutter, a cube carried through openings, a
// turret.
//
//   Near side (z -9..-18): a launcher in the ceiling drops a pellet that bounces up and down on the
//   white floor; the receptacle is on the east wall. Floor end under the pellet, west-wall end
//   level with the receptacle: the pellet crosses the room into it, and the wide shutter beyond the
//   pit (z -18..-30) rolls open.
//   Far side (z -31..-44): a white pillar faces you through the shutter. Carry the cube over through
//   a pair (near wall → pillar). A turret in a bunker watches the middle of the far room through a
//   low slot (the same faculty member as practical 11, transferred); come at its plate from the
//   side, or hold the cube low as a shield, and set the cube on the plate in front of the slot: that
//   blinds the turret and opens the exit.
import type { LevelData } from '../level';
import { box, exitHall, lobby, M, note, P, room, strip, wall } from './kitB';

const L = lobby(0);
const X = exitHall(-2.75, -45);

export const C15: LevelData = {
  version: 2,
  id: 'c15',
  name: 'Practical 15 — Office Hours',
  device: 'both',
  next: 'c16',
  info: { number: 15, title: 'Office Hours', icons: ['pellet', 'portal', 'turret', 'cube'] },
  spawn: L.spawn,
  brushes: [
    ...L.brushes,
    ...room(-8, 8, 0, 7, -44, -9, { walls: M, skip: ['n', 's', 'floor', 'w'] }),
    // West wall: white beside the near floor only.
    box([-9, -1, -18], [-8, 7, -8], P),
    box([-9, -1, -45], [-8, 7, -18], M),
    ...wall('x', -9, 9, -9, -8, 0, 7, M, [{ at: 0, width: 2.4, height: 3 }]),
    ...wall('x', -9, 9, -45, -44, 0, 7, M, [{ at: -2.75, width: 2.4, height: 3 }]),
    // The shutter wall (a door 8 m wide, x -4..4).
    ...wall('x', -9, 9, -31, -30, 0, 7, M, [{ at: 0, width: 8, height: 5 }]),
    // The white pillar in the far room (its south face takes an opening).
    box([-3.8, 0, -36.5], [-2.2, 2.6, -35.5], M, { '+z': P }),
    // Near floor (white), pit z -18..-30, far floor (metal) with the bunker recess.
    box([-9, -1, -18], [9, 0, -8], P),
    box([-9, -1, -42], [-0.6, 0, -30]),
    box([0.6, -1, -42], [9, 0, -30]),
    box([-0.6, -1, -42], [0.6, 0, -30]),
    box([-9, -1, -44], [-0.6, 0, -42]),
    box([0.6, -1, -44], [9, 0, -42]),
    box([-0.6, -1.8, -44], [0.6, -0.8, -42]),
    // The bunker hood with its low slot (as in practical 11).
    box([-1.5, 0.5, -44], [1.5, 2, -41]),
    box([-1.5, 0, -44], [-0.6, 0.5, -42]),
    box([0.6, 0, -44], [1.5, 0.5, -42]),
    box([-1.5, 0, -42], [-0.25, 0.5, -41]),
    box([0.25, 0, -42], [1.5, 0.5, -41]),
    ...X.brushes,
  ],
  entities: [
    ...L.entities,
    { id: 'nLight', type: 'light', position: [0, 6.5, -13], props: { intensity: 8, distance: 18 } },
    { id: 'fLight', type: 'light', position: [0, 6.5, -37], props: { intensity: 8, distance: 18 } },
    { id: 'launcher', type: 'pelletLauncher', position: [-5, 6.9, -12], props: { direction: [0, -1, 0], life: 12 } },
    { id: 'catcher', type: 'pelletCatcher', position: [7.9, 1.5, -12], props: { direction: [-1, 0, 0] } },
    { id: 'shutter', type: 'door', position: [0, 0, -30.5], props: { width: 8, height: 5 } },
    strip('iShutter', [7.5, 0.6, -14], [[7.5, -12.6], [7.5, -17.8]], 0, 'check', -Math.PI / 2),
    { id: 'cube1', type: 'cube', position: [4, 0.33, -10] },
    { id: 'tur', type: 'turret', position: [0, -0.19, -43], yaw: 0 },
    { id: 'plate', type: 'floorButton', position: [0, 0, -40.6], props: { accepts: 'cube' } },
    strip('iExit', [-2.75, 3.3, -43.95], [[-0.9, -40.6], [-2.75, -40.6], [-2.75, -43.9]], 0, 'check'),
    ...X.entities,
    note('cn15a', [6.5, 1.6, -9.8], 'Pellets that bounce vertically are easy to read and hard to ignore. The floor under it is the only white floor in the room.'),
    note('cn15b', [-6, 1.6, -33], 'The pillar faces the shutter so that the first thing you see when it opens is the answer. The turret is there to make you walk to it carefully.'),
  ],
  wiring: [
    { from: 'catcher.caught', to: 'shutter.open' },
    { from: 'catcher.caught', to: 'iShutter.on' },
    { from: 'plate.pressed', to: 'exitDoor.open' },
    { from: 'plate.pressed', to: 'iExit.on' },
  ],
  triggers: [
    { id: 'tFar', min: [-8, 0, -35], max: [8, 4, -31.2], event: 'c15.far', once: true },
  ],
  checkpoints: [{ id: 'c15cp', min: [-8, 0, -35], max: [8, 4, -31.2], spawn: { position: [-5, 0, -33], yaw: 0 } }],
  dialogue: [
    { event: 'chamberStart', lines: ['c15.chamberStart.1', 'c15.chamberStart.2'] },
    { event: 'c15.far', lines: ['c15.far.1'] },
    { event: 'exitReached', lines: ['c15.exit.1'] },
  ],
};
