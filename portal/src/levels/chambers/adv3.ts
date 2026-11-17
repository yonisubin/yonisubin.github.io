// Advanced 3 — "Deep End" (remix of practical 07). The pit floor and the floor before the shelf are
// liquid except for one white pad each: the dive has to land in blue and the launch has to come out
// of amber on the pad, and the climb out of amber must carry you all the way onto the shelf.
import type { LevelData } from '../level';
import { doorway, exitBay, intake, lamp, liquidAround, metal, padded, shell, strip, white } from './kitA';

const SHELF = 7;
const BOARD = 9;
const TOP = 16;
const PIT = { x0: -3, x1: 3, z0: -16, z1: -10, y: -3 };
const inn = intake(0, 0);
const out = exitBay(4, -28, SHELF, ['bell.pressed']);

export const ADV3: LevelData = {
  version: 2,
  id: 'adv3',
  name: 'Advanced 3',
  device: 'both',
  next: 'adv4',
  info: { number: 7, title: 'Adv. · Deep End', icons: ['portal', 'fling', 'liquid'] },
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
    // Before the shelf: a liquid moat (floor 0.4 down) around one white landing pad.
    ...padded(-8.5, 8.5, -28.5, -16, -0.4, -3.5, { x0: -1.5, x1: 1.5, z0: -20, z1: -17 }, 0),
    metal([-8.5, -3.5, -16], [PIT.x0, 0, -10]),
    metal([PIT.x1, -3.5, -16], [8.5, 0, -10]),
    // The pit is flooded too, except for one white pad in the middle.
    ...padded(PIT.x0, PIT.x1, PIT.z0, PIT.z1, PIT.y - 0.4, -3.5, { x0: -1.5, x1: 1.5, z0: -14.5, z1: -11.5 }, PIT.y),
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
    ...liquidAround('pitAcid', PIT.x0, PIT.x1, PIT.z0, PIT.z1, PIT.y - 0.05, 0.4, { x0: -1.5, x1: 1.5, z0: -14.5, z1: -11.5 }),
    ...liquidAround('moat', -8, 8, -21, -16, -0.05, 0.4, { x0: -1.5, x1: 1.5, z0: -20, z1: -17 }),
    { id: 'lift', type: 'lift', position: [-5.5, -0.15, -9], props: { height: BOARD } },
    { id: 'bell', type: 'pedestalButton', position: [0, SHELF, -25] },
    strip('wire', [[0.4, SHELF, -25], [6.2, SHELF, -25], [6.2, SHELF, -27.9]], [6.4, SHELF + 1.5, -27.98], 0),
    { id: 'boardSign', type: 'decal', position: [-4.5, BOARD + 0.01, -11], props: { text: 'MIND THE GAP', floor: true, size: [2.4, 0.4], ink: '#c8a23a' } },
    ...out.entities,
  ],
  wiring: [{ from: 'bell.pressed', to: 'wire.on' }, ...(out.wiring ?? [])],
  triggers: [
    { id: 'tBoard', min: [-8, BOARD, -16], max: [PIT.x0, BOARD + 2, -10.3], event: 'adv3.board', once: true },
    { id: 'tLoop', min: [PIT.x0, BOARD + 1.5, PIT.z0], max: [PIT.x1, TOP, PIT.z1], event: 'adv3.loop', once: true },
    { id: 'tShelf', min: [-8, SHELF, -28], max: [8, SHELF + 2, -21], event: 'adv3.shelf', once: true },
  ],
  dialogue: [
    { event: 'chamberStart', lines: ['adv3.chamberStart.1'] },
    { event: 'adv3.loop', lines: ['adv3.loop.1'] },
    { event: 'exitReached', lines: ['adv3.exitReached.1'] },
  ],
};
