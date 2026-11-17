// Escape 2 — "The Registry". Deeper in the Stacks: the records shaft, Marrow's last den, and the
// Registry corridor with one more member of faculty, then the lift up to the Senate.
//
//   Records shaft: a ledge behind a glass rail with a 10 m drop shaft in its floor (white bottom)
//   and, across the hall, one patched-white section of the east wall. Fling off it, west over the
//   pit, onto the dry strip (y -4). Off the strip, a gap in the west wall: Marrow's den, where she
//   explains graduation.
//   Registry corridor (through the strip's north door): a long passage with glass on one side
//   (the filing rooms), a cube at its start, and a turret in a bunker at the far end that sees the
//   whole passage through a low slot. Shield yourself with the cube and set it on the plate in
//   front of the slot; the plate opens the lift door beside the bunker.
import type { Brush, LevelData } from '../level';
import { box, exitHall, G, lobby, M, moveBrushes, note, P, room, scrawl, strip, wall } from './kitB';

const IND = 'industrial' as const;
const L = lobby(0, 0, IND);
const D: [number, number, number] = [-11, -4, -5];
const X = exitHall(-13.75, -50, -4, IND);
const ink = '#c0392b';
const chalk = '#e8e0cc';

const shaftHall: Brush[] = [
  ...wall('x', -17, 9, -9, -8, 0, 8, M, [{ at: 0, width: 2.4, height: 3 }]),
  // West wall with the den gap (z -21.1..-19.9, y -4..-1.8).
  box([-17, -11, -30], [-16, 8, -21.1]),
  box([-17, -11, -19.9], [-16, 8, -8]),
  box([-17, -1.8, -21.1], [-16, 8, -19.9]),
  box([-17, -11, -21.1], [-16, -4, -19.9]),
  // East wall: metal, one patched-white section (z -23..-17, y 0..5).
  box([8, -11, -30], [9, 8, -23]),
  box([8, -11, -17], [9, 8, -8]),
  box([8, -11, -23], [9, 0, -17]),
  box([8, 5, -23], [9, 8, -17]),
  box([8, 0, -23], [9, 5, -17], P),
  ...wall('x', -17, 9, -30, -29, -4, 8, M, [{ at: -11, width: 2.4, height: 3 }]),
  box([-17, -11, -30], [9, -4, -29]),
  box([-17, 8, -30], [9, 9, -8]),
  // Ledge (y 0) with the shaft (x -1..1, z -15..-11, white bottom at y -10), glass rail.
  box([-16, -11, -15], [-1, 0, -9]),
  box([1, -11, -15], [8, 0, -9]),
  box([-1, -11, -11], [1, 0, -9]),
  box([-1, -11, -15.2], [1, 0, -15]),
  box([-1, -11, -15], [1, -10, -11], P),
  box([-16, 0, -15.2], [8, 1.6, -15], G),
  // The dry strip (x -16..-6, y -4).
  box([-16, -5, -29], [-6, -4, -15.2]),
  // Marrow's den (x -21..-17, z -23..-18, y -4..-1).
  box([-22, -5, -24], [-17, -4, -17]),
  box([-22, -1, -24], [-17, 0, -17]),
  box([-22, -4, -24], [-21, -1, -17]),
  box([-21, -4, -24], [-17, -1, -23]),
  box([-21, -4, -18], [-17, -1, -17]),
];

// The Registry corridor: practical 11's passage and bunker, moved here (and given a glass side).
const registry: Brush[] = moveBrushes(
  [
    ...room(-1.2, 1.2, 0, 3.5, -38, -25, { walls: { w: M, e: G }, floor: M, skip: ['n', 's'] }),
    ...room(-4, 4, 0, 4, -44, -38, { walls: M, floor: M, skip: ['n', 's', 'floor'] }),
    ...wall('x', -5, 5, -38, -37, 0, 4, M, [{ at: 0, width: 2.4, height: 3.5 }]),
    ...wall('x', -5, 5, -45, -44, 0, 4, M, [{ at: -2.75, width: 2.4, height: 3 }]),
    box([-5, -1, -44], [-0.6, 0, -38]),
    box([0.6, -1, -44], [5, 0, -38]),
    box([-0.6, -1, -42], [0.6, 0, -38]),
    box([-0.6, -1.8, -44], [0.6, -0.8, -42]),
    box([-1.5, 0.5, -44], [1.5, 2, -41]),
    box([-1.5, 0, -44], [-0.6, 0.5, -42]),
    box([0.6, 0, -44], [1.5, 0.5, -42]),
    box([-1.5, 0, -42], [-0.25, 0.5, -41]),
    box([0.25, 0, -42], [1.5, 0.5, -41]),
    // The filing rooms behind the glass (x 1.4..6, z -37..-25), with rows of cabinets.
    ...room(1.4, 6, 0, 3.5, -37, -25, { walls: M, floor: M, skip: ['w'] }),
    box([3, 0, -35], [3.6, 2.2, -27]),
    box([4.8, 0, -35], [5.4, 2.2, -27]),
  ],
  D,
);

export const ESCAPE2: LevelData = {
  version: 2,
  id: 'escape2',
  name: 'The Registry',
  device: 'both',
  next: 'finale',
  info: { number: 19, title: 'The Registry', icons: ['fling', 'turret', 'cube'], theme: IND },
  spawn: L.spawn,
  brushes: [...L.brushes, ...shaftHall.map((b) => ({ ...b, theme: IND })), ...registry.map((b) => ({ ...b, theme: IND })), ...X.brushes],
  entities: [
    ...L.entities,
    { id: 'ledgeLight', type: 'light', position: [0, 7.5, -12], props: { intensity: 5, distance: 16, color: 0xffcf8a } },
    { id: 'hallLight', type: 'light', position: [-6, 7, -22], props: { intensity: 7, distance: 22, color: 0xffcf8a } },
    scrawl('shaftSign', [-4, 1.4, -9.05], Math.PI, 'RECORDS DROP · DO NOT RIDE', [3.4, 0.4], chalk),
    scrawl('marrowShaft', [7.95, 5.6, -20], -Math.PI / 2, 'jump in the hole. yes really. - M', [3, 0.35], ink),
    // Marrow's den.
    { id: 'denLight', type: 'light', position: [-19, -1.6, -20.5], props: { intensity: 2.5, distance: 6, color: 0xffb070 } },
    scrawl('den1', [-20.95, -2.2, -20.5], Math.PI / 2, 'GRADUATION = THE ARCHIVE', [4, 0.45], ink),
    scrawl('den2', [-20.95, -2.7, -20.5], Math.PI / 2, 'I watched 40 go down on the dais. it played music.', [4, 0.35], ink),
    scrawl('den3', [-20.95, -3.2, -20.5], Math.PI / 2, 'it is not evil. it is ADMINISTRATIVE. worse.', [4, 0.35], ink),
    scrawl('den4', [-19, -2.2, -22.95], 0, 'the core is up top, in the Senate. it cannot be shot.', [3.8, 0.35], ink),
    scrawl('den5', [-19, -2.7, -22.95], 0, 'but it CAN be hit with its own homework. (rockets)', [3.8, 0.35], ink),
    scrawl('den6', [-19, -2.2, -18.05], Math.PI, "I'm going up. if you read this, I didn't make it. or I did and forgot to erase this.", [3.8, 0.3], ink),
    scrawl('denTally', [-19, -3.2, -18.05], Math.PI, '|||| |||| |||| |||| |||| |||| ||', [2.4, 0.3], ink),
    { id: 'denCup', type: 'debris', position: [-18, -3.93, -21.5], props: { kind: 'cup' } },
    // The Registry corridor.
    { id: 'regLight1', type: 'light', position: [-11, -1, -36], props: { intensity: 4, distance: 12, color: 0xffd0a0 } },
    { id: 'regLight2', type: 'light', position: [-11, -0.3, -45], props: { intensity: 4, distance: 12, color: 0xffd0a0 } },
    { id: 'filesLight', type: 'light', position: [-7, -1, -36], props: { intensity: 2.5, distance: 8, color: 0xd6f0ff } },
    scrawl('filesSign', [-9.65, -1.2, -36], Math.PI / 2, 'REGISTRY · TRANSCRIPTS 1–40', [3.4, 0.4], chalk),
    { id: 'cube1', type: 'cube', position: [-11, -3.67, -31.5] },
    { id: 'tur', type: 'turret', position: [-11, -4.19, -48], yaw: 0 },
    { id: 'plate', type: 'floorButton', position: [-11, -4, -45.6], props: { accepts: 'cube' } },
    strip('iExit', [-13.75, -0.7, -48.95], [[-11.9, -45.6], [-13.75, -45.6], [-13.75, -48.9]], -4, 'check'),
    ...X.entities,
    note('cnE2a', [-14, -2.4, -16], 'The second fling of the escape has no clock and no pool: just a long drop, so that the den is a reward and not a detour.'),
    note('cnE2b', [-19.5, -2.4, -19], "Marrow's den explains the boss before the boss explains itself. Players who skip it learn by doing."),
  ],
  wiring: [
    { from: 'plate.pressed', to: 'exitDoor.open' },
    { from: 'plate.pressed', to: 'iExit.on' },
  ],
  triggers: [
    { id: 'tLanded', min: [-16, -4, -27], max: [-6, -1, -15.2], event: 'escape2.landed', once: true },
    { id: 'tDen', min: [-21, -4, -23], max: [-17, -1, -18], event: 'escape2.den', once: true },
    { id: 'tRegistry', min: [-12.2, -4, -33], max: [-9.8, -1, -30], event: 'escape2.registry', once: true },
  ],
  checkpoints: [
    { id: 'e2strip', min: [-16, -4, -27], max: [-6, -1, -15.2], spawn: { position: [-11, -4, -24], yaw: 0 } },
    { id: 'e2reg', min: [-12.2, -4, -33], max: [-9.8, -1, -30], spawn: { position: [-11, -4, -30.5], yaw: 0 } },
  ],
  dialogue: [
    { event: 'chamberStart', lines: ['escape2.chamberStart.1', 'escape2.chamberStart.2'] },
    { event: 'escape2.landed', lines: ['escape2.landed.1'] },
    { event: 'escape2.den', lines: ['escape2.den.1'] },
    { event: 'escape2.registry', lines: ['escape2.registry.1', 'escape2.bursar.1'] },
    { event: 'death', lines: ['escape2.death.1'] },
    { event: 'exitReached', lines: ['escape2.exit.1'] },
  ],
};
