// Practical 07 — "Conservation". New idea: momentum through the fold (and the infinite fall).
//
//   The exit is on a 7 m shelf. A lift takes you up to a diving board 9 m up, beside a pit whose
//   floor (3 m down) is white. Blue on the pit floor, amber on the white floor in front of the
//   shelf, then step off the board: you fall 12 m into blue and come out of amber going up just as
//   fast, high enough to steer onto the shelf. The ceiling over the pit is white too, for applicants
//   who want to find out what falling forever feels like (it feels like 38 m/s).
//
//   z=-28 ┌───────────────────[exit]───┐
//         │  SHELF y 7      (pedestal) │
//   z=-21 ├──────── metal face ────────┤
//         │      [white floor F]       │
//   z=-16 │ BOARD y 9 ┌──pit───┐       │
//         │ (x −8..−3)│ y −3   │       │
//   z=-10 │  [lift]   └────────┘       │
//   z=0   └───────────[    ]───────────┘
//       x=-8                         x=8
import type { LevelData } from '../level';
import { doorway, exitBay, intake, lamp, metal, shell, strip, white } from './kitA';

const SHELF = 7;
const BOARD = 9;
const TOP = 16;
const PIT = { x0: -3, x1: 3, z0: -16, z1: -10, y: -3 };
const inn = intake(0, 0);
const out = exitBay(4, -28, SHELF, ['bell.pressed']);

export const C07: LevelData = {
  version: 2,
  id: 'c07',
  name: 'Practical 07',
  device: 'both',
  next: 'c08',
  info: { number: 7, title: 'Conservation', icons: ['portal', 'fling', 'platform'] },
  spawn: inn.spawn,
  brushes: [
    ...shell({
      min: [-8, 0, -28],
      max: [8, TOP, 0],
      floor: null,
      ceiling: null,
      holes: { s: [doorway(0)], n: [doorway(4, SHELF)] },
    }),
    // Floor around the pit; the floor in front of the shelf is white, the rest metal.
    metal([-8.5, -3.5, -10], [8.5, 0, 0.5]),
    white([-8.5, -3.5, -28.5], [8.5, 0, -16], { '+z': 'metal', '-y': 'metal' }),
    metal([-8.5, -3.5, -16], [PIT.x0, 0, -10]),
    metal([PIT.x1, -3.5, -16], [8.5, 0, -10]),
    white([PIT.x0, -3.5, PIT.z0], [PIT.x1, PIT.y, PIT.z1]),
    // Ceiling: metal, with a white panel right over the pit.
    metal([-8.5, TOP, -28.5], [8.5, TOP + 0.5, PIT.z0]),
    metal([-8.5, TOP, PIT.z1], [8.5, TOP + 0.5, 0.5]),
    metal([-8.5, TOP, PIT.z0], [PIT.x0, TOP + 0.5, PIT.z1]),
    metal([PIT.x1, TOP, PIT.z0], [8.5, TOP + 0.5, PIT.z1]),
    white([PIT.x0, TOP, PIT.z0], [PIT.x1, TOP + 0.5, PIT.z1]),
    // The shelf, and the diving board (ending at the pit's west edge).
    white([-8, 0, -28], [8, SHELF, -21], { '+z': 'metal' }),
    metal([-8, BOARD - 0.4, -16], [PIT.x0, BOARD, -10.3]),
    ...inn.brushes,
    ...out.brushes,
  ],
  entities: [
    ...inn.entities,
    lamp('lamp1', [0, TOP - 0.6, -6], 10, 22),
    lamp('lamp2', [0, TOP - 0.6, -22], 10, 22),
    { id: 'pitLight', type: 'light', position: [0, -1, -13], props: { intensity: 3, distance: 7 } },
    { id: 'lift', type: 'lift', position: [-5.5, -0.15, -9], props: { height: BOARD } },
    { id: 'bell', type: 'pedestalButton', position: [0, SHELF, -25] },
    strip('wire', [[0.4, SHELF, -25], [6.2, SHELF, -25], [6.2, SHELF, -27.9]], [6.4, SHELF + 1.5, -27.98], 0),
    { id: 'boardSign', type: 'decal', position: [-4.5, BOARD + 0.01, -11], props: { text: 'MIND THE GAP', floor: true, size: [2.4, 0.4], ink: '#c8a23a' } },
    ...out.entities,
  ],
  wiring: [{ from: 'bell.pressed', to: 'wire.on' }, ...(out.wiring ?? [])],
  triggers: [
    { id: 'tBoard', min: [-8, BOARD, -16], max: [PIT.x0, BOARD + 2, -10.3], event: 'c07.board', once: true },
    { id: 'tLoop', min: [PIT.x0, BOARD + 1.5, PIT.z0], max: [PIT.x1, TOP, PIT.z1], event: 'c07.loop', once: true },
    { id: 'tShelf', min: [-8, SHELF, -28], max: [8, SHELF + 2, -21], event: 'c07.shelf', once: true },
  ],
  dialogue: [
    { event: 'chamberStart', lines: ['c07.chamberStart.1', 'c07.chamberStart.2'] },
    { event: 'c07.board', lines: ['c07.board.1'] },
    { event: 'c07.loop', lines: ['c07.loop.1', 'c07.loop.2'] },
    { event: 'c07.shelf', lines: ['c07.shelf.1'] },
    { event: 'exitReached', lines: ['c07.exitReached.1'] },
  ],
};
