// Escape 1 — "The Stacks". Behind the practicals: damp concrete, catwalks over the flooded quarry,
// the Bursar's office behind glass, Marrow's den, and a line of faculty waiting for you.
//
//   Catwalk hall (z -9..-49): two landings over the quarry water (correction fluid, as it turns
//   out), with an 8 m gap between them. White concrete patches on the west wall beside each
//   landing: a pair across. Off the far landing, a gap in the wall leads to Marrow's den.
//   Faculty row (z -50..-70): three turrets on a ledge face the entrance alcove, whose parapet
//   hides you. Above the turrets the north wall has a white patch: one end there (shoot over the
//   parapet), one on the alcove's white wall; come out behind them, walk along the ledge to the
//   service lift.
import type { Brush, LevelData } from '../level';
import { box, exitHall, G, lobby, note, P, scrawl } from './kitB';

const IND = 'industrial' as const;
const L = lobby(0, 0, IND);
const X = exitHall(4, -71, 1.5, IND);
const ink = '#c0392b';
const chalk = '#e8e0cc';

const brushes: Brush[] = [
  // --- Catwalk hall: interior x -10..10, z -49..-9, quarry water at y -3 ---------------------------
  box([-11, -4, -50], [11, -3, -8]),
  box([-11, 10, -50], [11, 11, -8]),
  // South wall (lobby doorway at x 0).
  box([-11, -3, -9], [-1.2, 10, -8]),
  box([1.2, -3, -9], [11, 10, -8]),
  box([-1.2, 3, -9], [1.2, 10, -8]),
  box([-1.2, -3, -9], [1.2, 0, -8]),
  // West wall with two white patches (y 0..3.5) and the den gap.
  box([-11, -3, -50], [-10, 0, -9]),
  box([-11, 3.5, -50], [-10, 10, -9]),
  box([-11, 0, -11], [-10, 3.5, -9]),
  box([-11, 0, -17], [-10, 3.5, -11], P),
  box([-11, 0, -27], [-10, 3.5, -17]),
  box([-11, 0, -33], [-10, 3.5, -27], P),
  box([-11, 0, -34.9], [-10, 3.5, -33]),
  box([-11, 2.2, -36.1], [-10, 3.5, -34.9]),
  box([-11, 0, -50], [-10, 3.5, -36.1]),
  // East wall.
  box([10, -3, -50], [11, 10, -8]),
  // North wall with the doorway to the faculty row (x -4.5).
  box([-11, -3, -50], [-5.7, 10, -49]),
  box([-3.3, -3, -50], [11, 10, -49]),
  box([-5.7, 3, -50], [-3.3, 10, -49]),
  box([-5.7, -3, -50], [-3.3, 0, -49]),
  // Landings and catwalks (y 0).
  box([-10, -0.4, -18], [1, 0, -9]),
  box([-10, -0.4, -37], [1, 0, -26]),
  box([-1, -0.4, -45], [1, 0, -37]),
  box([-10, -0.4, -49], [1, 0, -45]),
  // The Bursar's office: raised, glass-fronted, sealed (x 4..10, z -24..-10, floor y 1).
  box([4, -3, -24], [10, 1, -10]),
  box([4, 1, -24], [4.2, 5, -10], G),
  box([4, 5, -24], [10, 5.3, -10]),
  box([4.2, 1, -10.2], [10, 5, -10]),
  box([4.2, 1, -24], [10, 5, -23.8]),
  // Marrow's den (x -15..-10, z -38..-33, y 0..3), behind the gap in the west wall.
  box([-16, -1, -39], [-10, 0, -32]),
  box([-16, 3, -39], [-10, 4, -32]),
  box([-16, 0, -39], [-15, 3, -32]),
  box([-15, 0, -39], [-11, 3, -38]),
  box([-15, 0, -33], [-11, 3, -32]),

  // --- Faculty row: interior x -6..6, z -70..-50 ------------------------------------------------
  box([-7, -1, -71], [7, 0, -50]),
  box([-7, 8, -71], [7, 9, -50]),
  // West wall: white beside the alcove (z -53..-50, y 0..3).
  box([-7, 0, -53], [-6, 3, -50], P),
  box([-7, 3, -53], [-6, 8, -50]),
  box([-7, 0, -71], [-6, 8, -53]),
  box([6, 0, -71], [7, 8, -50]),
  // The alcove: its east wall (full height) and the parapet (1.7 m) that hides you.
  box([-3.3, 0, -53.2], [-2.8, 8, -50]),
  box([-6, 0, -53.2], [-3.3, 1.7, -53]),
  // The turrets' ledge (y 1.5).
  box([-6, 0, -70], [6, 1.5, -66]),
  // North wall: white patch above the turrets (x -5.5..-2.5, y 3..6.5), exit doorway at x 4.
  box([-7, 0, -71], [-5.5, 8, -70]),
  box([-2.5, 0, -71], [2.8, 8, -70]),
  box([-5.5, 0, -71], [-2.5, 3, -70]),
  box([-5.5, 6.5, -71], [-2.5, 8, -70]),
  box([-5.5, 3, -71], [-2.5, 6.5, -70], P),
  box([5.2, 0, -71], [7, 8, -70]),
  box([2.8, 4.5, -71], [5.2, 8, -70]),
  box([2.8, 0, -71], [5.2, 1.5, -70]),
];

export const ESCAPE1: LevelData = {
  version: 2,
  id: 'escape1',
  name: 'The Stacks',
  device: 'both',
  next: 'escape2',
  info: { number: 19, title: 'The Stacks', icons: ['portal', 'liquid', 'turret'], theme: IND },
  spawn: L.spawn,
  brushes: [...L.brushes, ...brushes.map((b) => ({ ...b, theme: IND })), ...X.brushes],
  entities: [
    ...L.entities,
    { id: 'quarry', type: 'liquid', position: [0, -2.6, -29], props: { size: [20, 1, 40] } },
    { id: 'hallLight1', type: 'light', position: [-4, 8, -14], props: { intensity: 6, distance: 18, color: 0xffcf8a } },
    { id: 'hallLight2', type: 'light', position: [-4, 8, -32], props: { intensity: 6, distance: 18, color: 0xffcf8a } },
    { id: 'hallLight3', type: 'light', position: [0, 6, -45], props: { intensity: 4, distance: 12, color: 0xffcf8a } },
    // The office.
    { id: 'officeLight', type: 'light', position: [7, 4.5, -17], props: { intensity: 4, distance: 9, color: 0xd6f0ff } },
    { id: 'desk1', type: 'debris', position: [7, 1.46, -14], props: { kind: 'chair' } },
    { id: 'desk2', type: 'debris', position: [8, 1.26, -18], props: { kind: 'monitor' } },
    { id: 'desk3', type: 'debris', position: [6.5, 1.07, -20], props: { kind: 'cup' } },
    scrawl('officeSign', [4.25, 4.4, -17], -Math.PI / 2, 'THE BURSAR · ACCOUNTS PAYABLE · HOURS: NONE', [5, 0.35], chalk),
    scrawl('officeMemo', [9.95, 3, -17], -Math.PI / 2, 'COST OF ONE (1) CEREMONY: 11,400 CREDITS', [4, 0.35], chalk),
    // Marrow's den.
    { id: 'denLight', type: 'light', position: [-13, 2.6, -35.5], props: { intensity: 2.5, distance: 6, color: 0xffb070 } },
    scrawl('den1', [-14.95, 2.4, -35.5], Math.PI / 2, 'IT GRADES EVERYTHING. EVEN THE DARK.', [4, 0.4], ink),
    scrawl('den2', [-14.95, 1.9, -35.5], Math.PI / 2, 'day 212: lunch is still "after the next practical"', [4, 0.35], ink),
    scrawl('den3', [-14.95, 1.4, -35.5], Math.PI / 2, 'IF IT SAYS CEREMONY — RUN', [4, 0.4], ink),
    scrawl('den4', [-13, 2.2, -37.95], 0, 'the case is not a friend. it is a FILE.', [3.4, 0.35], ink),
    scrawl('den5', [-13, 1.6, -37.95], 0, 'count your steps. it does.', [3, 0.35], ink),
    scrawl('den6', [-13, 2.2, -33.05], Math.PI, 'Alumna 17 was here. Alumna 17 is fine. (Marrow)', [3.8, 0.35], ink),
    scrawl('denDrawing', [-13, 1.2, -33.05], Math.PI, 'the Provost: a filing cabinet with a halo', [3.4, 0.3], ink, 'scribble'),
    { id: 'denCup', type: 'debris', position: [-12, 0.07, -36.8], props: { kind: 'cup' } },
    { id: 'denChair', type: 'debris', position: [-14, 0.46, -34], props: { kind: 'chair' } },
    // The faculty row.
    { id: 'rowLight', type: 'light', position: [0, 7, -60], props: { intensity: 6, distance: 18, color: 0xffd0a0 } },
    { id: 'tA', type: 'turret', position: [-2.5, 2.11, -67.5], yaw: 0 },
    { id: 'tB', type: 'turret', position: [0, 2.11, -67.5], yaw: 0 },
    { id: 'tC', type: 'turret', position: [2.5, 2.11, -67.5], yaw: 0 },
    scrawl('rowSign', [0, 7.2, -69.95], 0, 'FACULTY SENATE · RESERVED SEATING', [5, 0.4], chalk),
    scrawl('marrowArrow', [-4.5, 1.9, -53.25], Math.PI, '↑ over their heads. trust me. - M', [2.6, 0.3], ink),
    // The service lift's door is unlocked (nobody maintains the locks back here).
    ...X.entities.map((e) => (e.id === 'exitDoor' ? { ...e, props: { open: true } } : e)),
    note('cnE1a', [-6, 1.6, -12], 'Behind the panels the rules stay the same but the paint changes: concrete takes an opening only where it has been patched white.'),
    note('cnE1b', [-12.5, 1.6, -36.5], 'The den is optional and off the path on purpose. Marrow only talks to people who look.'),
    note('cnE1c', [-5.2, 2.2, -51], 'The parapet is tuned so turrets cannot see you behind it and you can still shoot over it. The same trick as the glass rail, turned around.'),
  ],
  wiring: [],
  triggers: [
    { id: 'tHall', min: [-10, 0, -18], max: [1, 3, -10], event: 'escape1.hall', once: true },
    { id: 'tOffice', min: [-10, 0, -26], max: [1, 3, -18], event: 'escape1.office', once: true },
    { id: 'tDen', min: [-15, 0, -38], max: [-10.5, 3, -33], event: 'escape1.den', once: true },
    { id: 'tRow', min: [-6, 0, -53], max: [-3.3, 3, -50], event: 'escape1.row', once: true },
    { id: 'tBehind', min: [-6, 1.5, -70], max: [6, 4, -66], event: 'escape1.behind', once: true },
  ],
  checkpoints: [
    { id: 'e1far', min: [-10, 0, -34], max: [1, 3, -26], spawn: { position: [-5, 0, -30], yaw: 0 } },
    { id: 'e1row', min: [-6, 0, -53], max: [-3.3, 3, -50], spawn: { position: [-4.5, 0, -51], yaw: 0 } },
  ],
  dialogue: [
    { event: 'chamberStart', lines: ['escape1.chamberStart.1', 'escape1.chamberStart.2'] },
    { event: 'escape1.hall', lines: ['escape1.hall.1'] },
    { event: 'escape1.office', lines: ['escape1.office.1', 'escape1.office.2'] },
    { event: 'escape1.den', lines: ['escape1.den.1'] },
    { event: 'escape1.row', lines: ['escape1.row.1'] },
    { event: 'escape1.behind', lines: ['escape1.behind.1'] },
    { event: 'death', lines: ['escape1.death.1'] },
    { event: 'exitReached', lines: ['escape1.exit.1'] },
  ],
};
