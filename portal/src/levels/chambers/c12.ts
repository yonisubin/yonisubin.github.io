// Practical 12 — "Custody". One special object: the plinth unit (a padded specimen case with a
// brass nameplate: PROPERTY OF THE DEPARTMENT. PLEASE RETURN.). Four rooms, one idea each, all
// about keeping hold of it:
//
//   R1 Custody   (z -9..-20)  the case rests on a cradle plate; lifting it off opens the door (NOT).
//   R2 The Gap   (z -21..-41) a pit across the whole room; white side walls: carry the case through
//                             a pair of openings to the far side.
//   R3 Leaving   (z -42..-50) the door to R4 only stays open while the case sits on its plate. Go
//                             through without it, open a pair from R4 back into R3 (its west wall
//                             is white) and fetch it: the door shuts, the openings don't care.
//   R4 Records   (z -51..-62) the Records Chute. The exit opens once the case is filed. The twist
//                             is in what the Provost reads off its nameplate as it goes down.
import type { LevelData } from '../level';
import { box, exitHall, lobby, M, note, P, room, strip, wall } from './kitB';

const L = lobby(0);
const X = exitHall(0, -63);
const H = { at: 0, width: 2.4, height: 3 };

export const C12: LevelData = {
  version: 2,
  id: 'c12',
  name: 'Practical 12 — Custody',
  device: 'both',
  next: 'c13',
  info: { number: 12, title: 'Custody', icons: ['cube', 'button', 'portal'] },
  spawn: L.spawn,
  brushes: [
    ...L.brushes,
    // R1 (metal: no shortcuts).
    ...room(-6, 6, 0, 4.5, -20, -9, { walls: M, floor: M, skip: ['n', 's'] }),
    ...wall('x', -7, 7, -9, -8, 0, 4.5, M, [H]),
    ...wall('x', -7, 7, -21, -20, 0, 7, M, [H]),
    // R2: white side walls, a pit across z -26..-33.
    ...room(-6, 6, 0, 7, -41, -21, { walls: { w: P, e: P }, skip: ['n', 's', 'floor'] }),
    box([-7, -1, -26], [7, 0, -21]),
    box([-7, -1, -41], [7, 0, -33]),
    ...wall('x', -7, 7, -42, -41, 0, 7, M, [{ at: 0, width: 3, height: 3.5 }]),
    // R3: metal except its west wall.
    ...room(-6, 6, 0, 4.5, -50, -42, { walls: { w: P, e: M }, floor: M, skip: ['n', 's'] }),
    ...wall('x', -7, 7, -51, -50, 0, 5, M, [H]),
    // R4: white side walls.
    ...room(-6, 6, 0, 5, -62, -51, { walls: { w: P, e: P }, floor: M, skip: ['n', 's'] }),
    ...wall('x', -7, 7, -63, -62, 0, 5, M, [H]),
    ...X.brushes,
  ],
  entities: [
    ...L.entities,
    // R1.
    { id: 'r1Light', type: 'light', position: [0, 4, -14.5], props: { intensity: 7, distance: 14 } },
    { id: 'cradle', type: 'floorButton', position: [0, 0, -14.5], props: { accepts: 'cube' } },
    { id: 'plinth', type: 'companionCube', position: [0, 0.46, -14.5] },
    { id: 'notCradle', type: 'gate', position: [0, 0, 0], props: { op: 'not' } },
    { id: 'd1', type: 'door', position: [0, 0, -20.5] },
    strip('i1', [1.6, 2.6, -19.95], [[0, -15.3], [0, -18], [1.6, -18], [1.6, -19.9]], 0, 'check'),
    // R2.
    { id: 'r2LightA', type: 'light', position: [0, 6.5, -23.5], props: { intensity: 7, distance: 16 } },
    { id: 'r2LightB', type: 'light', position: [0, 6.5, -37], props: { intensity: 7, distance: 16 } },
    // R3.
    { id: 'r3Light', type: 'light', position: [0, 4, -46], props: { intensity: 6, distance: 12 } },
    { id: 'leave', type: 'floorButton', position: [2.5, 0, -47.5], props: { accepts: 'cube' } },
    { id: 'd3', type: 'door', position: [0, 0, -50.5] },
    strip('i3', [1.6, 3.2, -49.95], [[2.5, -48.3], [2.5, -49], [1.6, -49], [1.6, -49.9]], 0, 'check'),
    // R4.
    { id: 'r4Light', type: 'light', position: [0, 4.5, -56], props: { intensity: 7, distance: 14 } },
    { id: 'chute', type: 'chute', position: [0, 0.8, -59], props: { size: [1.4, 1.6, 1.4], accepts: 'plinth', event: 'c12.filed' } },
    strip('i4', [1.6, 3.2, -61.95], [[0.8, -59], [1.6, -59], [1.6, -61.9]], 0, 'check'),
    ...X.entities,
    { id: 'plaque', type: 'decal', position: [0, 2.2, -61.98], props: { text: 'RECORDS CHUTE · FILE ALL COURSEWORK', size: [3.6, 0.4], ink: '#22282d' } },
    note('cn12a', [-2, 1.5, -12], 'Custody is taught with a NOT gate: the door listens for the case being gone. The first thing you learn about it is that taking it is the point.'),
    note('cn12b', [5.2, 1.6, -43], 'Room three asks you to leave it behind and then cheat. We liked that the device can keep a promise a door cannot.'),
    note('cn12c', [-3, 1.5, -56], "The nameplate twist is the first time the Provost's 'graduation' slips. Everything after this chamber is built on it."),
  ],
  wiring: [
    { from: 'cradle.pressed', to: 'notCradle.in' },
    { from: 'notCradle.out', to: 'd1.open' },
    { from: 'notCradle.out', to: 'i1.on' },
    { from: 'leave.pressed', to: 'd3.open' },
    { from: 'leave.pressed', to: 'i3.on' },
    { from: 'chute.filed', to: 'exitDoor.open' },
    { from: 'chute.filed', to: 'i4.on' },
  ],
  triggers: [
    { id: 'tGap', min: [-6, 0, -25], max: [6, 4, -21.5], event: 'c12.gap', once: true },
    { id: 'tLeave', min: [-6, 0, -45], max: [6, 4, -42.2], event: 'c12.leave', once: true },
    { id: 'tRecords', min: [-6, 0, -54], max: [6, 4, -51.2], event: 'c12.records', once: true },
  ],
  checkpoints: [{ id: 'c12cp', min: [-6, 0, -45], max: [6, 4, -42.2], spawn: { position: [0, 0, -43], yaw: 0 } }],
  dialogue: [
    { event: 'chamberStart', lines: ['c12.chamberStart.1', 'c12.chamberStart.2'] },
    { event: 'c12.gap', lines: ['c12.gap.1'] },
    { event: 'c12.leave', lines: ['c12.leave.1'] },
    { event: 'c12.records', lines: ['c12.records.1', 'c12.records.2'] },
    { event: 'c12.filed', lines: ['c12.filed.1', 'c12.filed.2', 'c12.filed.3'] },
    { event: 'exitReached', lines: ['c12.exit.1'] },
  ],
};
