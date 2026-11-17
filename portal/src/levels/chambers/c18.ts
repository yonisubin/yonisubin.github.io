// Practical 18 — "Commencement". The long last practical, then the Provost's betrayal.
//
//   R1 (z -9..-25)  a grill (and a glass pane) across the room between the cube and its plate. Carry the cube
//                   round the grill through a pair on the white west wall; the plate opens R1.
//   R2 (z -26..-42) a pellet runs east–west; west-wall end where it lands, south-wall end facing
//                   the receptacle on the north wall; the receptacle opens R2.
//   R3 (z -43..-60) the Commencement Hall: banners, an audience of empty chairs, and a dais in the
//                   middle of the floor. Step onto it and the ceremony begins: the dais sinks into a
//                   shaft that was never on any plan, and the Provost explains what graduation is.
//                   At the bottom the chamber ends (an exitZone, not a booth): practical 19 starts
//                   there, in the Archive press.
import type { LevelData } from '../level';
import { box, lobby, M, note, P, room, scrawl, strip, wall } from './kitB';

const L = lobby(0);

export const C18: LevelData = {
  version: 2,
  id: 'c18',
  name: 'Practical 18 — Commencement',
  device: 'both',
  next: 'c19',
  info: { number: 18, title: 'Commencement', icons: ['cube', 'grill', 'pellet', 'portal'] },
  spawn: L.spawn,
  brushes: [
    ...L.brushes,
    // R1: white west wall, grill at z -17.
    ...room(-8, 8, 0, 6, -25, -9, { walls: { w: P, e: M }, floor: M, skip: ['n', 's'] }),
    // The grill covers x -6..8; a glass pane closes the last 2 m by the west wall.
    box([-8, 0, -17.1], [-6, 6, -16.9], 'glass'),
    ...wall('x', -9, 9, -9, -8, 0, 6, M, [{ at: 0, width: 2.4, height: 3 }]),
    // R1/R2 wall: white west of the door (the pellet's exit end), metal east of it.
    box([-9, 0, -26], [-1.2, 6, -25], P),
    box([1.2, 0, -26], [9, 6, -25], M),
    box([-1.2, 3, -26], [1.2, 6, -25], M),
    // R2 (as practical 13's pellet room).
    ...room(-8, 8, 0, 6, -42, -26, { walls: { w: P, e: M }, floor: M, skip: ['n', 's'] }),
    ...wall('x', -9, 9, -43, -42, 0, 6, M, [{ at: 4, width: 2.4, height: 3 }]),
    // R3: the hall (metal, tall) with a hole for the dais (x -2..2, z -54..-50) and its shaft.
    ...room(-8, 8, 0, 10, -60, -43, { walls: M, skip: ['s', 'floor'] }),
    box([-9, -1, -61], [-2, 0, -43]),
    box([2, -1, -61], [9, 0, -43]),
    box([-2, -1, -50], [2, 0, -43]),
    box([-2, -1, -61], [2, 0, -54]),
    box([-3, -14, -55], [-2, -1, -49]),
    box([2, -14, -55], [3, -1, -49]),
    box([-2, -14, -50], [2, -1, -49]),
    box([-2, -14, -55], [2, -1, -54]),
    box([-2, -15, -54], [2, -14, -50]),
    // The observation gallery the Provost "watches" from: glass high on the north wall.
    box([-4, 6, -60.2], [4, 9, -60], 'glass'),
  ],
  entities: [
    ...L.entities,
    // R1.
    { id: 'r1Light', type: 'light', position: [0, 5.5, -17], props: { intensity: 8, distance: 18 } },
    { id: 'cube1', type: 'cube', position: [4, 0.33, -12], props: { respawn: true } },
    { id: 'grill1', type: 'grill', position: [1, 3, -17], props: { size: [14, 6], normal: [0, 0, 1] } },
    { id: 'plate1', type: 'floorButton', position: [-4, 0, -22], props: { accepts: 'cube' } },
    { id: 'd1', type: 'door', position: [0, 0, -25.5] },
    strip('i1', [1.6, 3.3, -24.95], [[-4, -22.8], [-4, -23.6], [1.6, -23.6], [1.6, -24.9]], 0, 'check'),
    // R2.
    { id: 'r2Light', type: 'light', position: [0, 5.5, -34], props: { intensity: 8, distance: 18 } },
    { id: 'launcher', type: 'pelletLauncher', position: [7.9, 1.5, -34], props: { direction: [-1, 0, 0], life: 14 } },
    { id: 'catcher', type: 'pelletCatcher', position: [-4, 1.5, -41.9], props: { direction: [0, 0, 1] } },
    { id: 'd2', type: 'door', position: [4, 0, -42.5] },
    strip('i2', [5.7, 3.3, -41.95], [[-4, -41.5], [-4, -41], [5.7, -41], [5.7, -41.9]], 0, 'check'),
    // R3: the ceremony.
    { id: 'r3Light1', type: 'light', position: [0, 9, -47], props: { intensity: 9, distance: 20, color: 0xfff1d6 } },
    { id: 'r3Light2', type: 'light', position: [0, 9, -56], props: { intensity: 9, distance: 20, color: 0xfff1d6 } },
    { id: 'shaftLight', type: 'light', position: [0, -10, -52], props: { intensity: 3, distance: 8, color: 0xff7a3d } },
    { id: 'dais', type: 'platform', position: [0, -0.15, -52], props: { waypoints: [[0, -0.15, -52], [0, -12.15, -52]], speed: 0.45, size: [4, 0.3, 4] } },
    { id: 'onDais', type: 'zone', position: [0, 1, -52], props: { size: [4, 2, 4] } },
    { id: 'archive', type: 'exitZone', position: [0, -10.5, -52], props: { size: [4, 3, 4], delay: 4 } },
    scrawl('banner1', [0, 7.6, -59.95], 0, 'COMMENCEMENT · CLASS OF 41', [7, 1], '#22282d'),
    scrawl('banner2', [-7.95, 4.5, -51.5], Math.PI / 2, 'MOTION, MEASURED', [5, 0.8], '#22282d'),
    scrawl('banner3', [7.95, 4.5, -51.5], -Math.PI / 2, 'PERMANENT RECORD', [5, 0.8], '#22282d'),
    { id: 'daisMark', type: 'decal', position: [0, 0.02, -48.2], props: { text: 'PLEASE STAND ON THE DAIS', size: [3.6, 0.5], floor: true, ink: '#a8862f' } },
    ...[-6, -4.5, 4.5, 6].flatMap((x, i) => [
      { id: `chair${i}a`, type: 'debris' as const, position: [x, 0.46, -47] as [number, number, number], props: { kind: 'chair' } },
      { id: `chair${i}b`, type: 'debris' as const, position: [x, 0.46, -49] as [number, number, number], props: { kind: 'chair' } },
    ]),
    note('cn18a', [6.5, 1.6, -11], 'Grill and glass span the whole room so the only way round is through the device. It is the last time the chamber is honest with you.'),
    note('cn18b', [6.5, 1.6, -45], 'The hall is the only place in the curriculum with warm light. We wanted the trap to feel like a reward right up until the floor moves.'),
  ],
  wiring: [
    { from: 'plate1.pressed', to: 'd1.open' },
    { from: 'plate1.pressed', to: 'i1.on' },
    { from: 'catcher.caught', to: 'd2.open' },
    { from: 'catcher.caught', to: 'i2.on' },
    { from: 'onDais.entered', to: 'dais.active' },
  ],
  triggers: [
    { id: 'tR2', min: [-8, 0, -30], max: [8, 4, -26.2], event: 'c18.pellet', once: true },
    { id: 'tHall', min: [-8, 0, -47], max: [8, 4, -43.2], event: 'c18.hall', once: true },
    { id: 'tDais', min: [-2, 0, -54], max: [2, 3, -50], event: 'c18.dais', once: true },
  ],
  checkpoints: [
    { id: 'c18r2', min: [-8, 0, -30], max: [8, 4, -26.2], spawn: { position: [0, 0, -27.5], yaw: 0 } },
    { id: 'c18r3', min: [-8, 0, -47], max: [8, 4, -43.2], spawn: { position: [4, 0, -44.5], yaw: 0 } },
  ],
  dialogue: [
    { event: 'chamberStart', lines: ['c18.chamberStart.1', 'c18.chamberStart.2'] },
    { event: 'c18.pellet', lines: ['c18.pellet.1'] },
    { event: 'c18.hall', lines: ['c18.hall.1', 'c18.hall.2'] },
    // The ceremony speech runs while the dais sinks (about 25 s); the chamber ends at the bottom.
    { event: 'c18.dais', lines: ['c18.dais.1', 'c18.dais.2', 'c18.betrayal.1', 'c18.betrayal.2', 'c18.betrayal.3'] },
    { event: 'exitReached', lines: ['c18.exit.1'] },
  ],
};
