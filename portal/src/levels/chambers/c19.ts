// Practical 19 — "The Archive". The escape: portal out of the trap into the maintenance areas.
//
//   The dais has delivered you to the bottom of the Archive press: a long metal vault whose side
//   walls are two compactor slabs, already closing (about 24 s until they meet). High in the
//   north wall a service hatch has rusted open; through it you can see a white patch on the back
//   wall of a maintenance room. The only white surface in the press is a patch on its south wall
//   behind you. Shoot one end through the hatch, the other behind you, walk through, and drop into
//   the Stacks, where a service lift (and a nervous accountant) are waiting.
import type { LevelData } from '../level';
import { box, M, note, P, room, scrawl, wall } from './kitB';

const IND = 'industrial' as const;

export const C19: LevelData = {
  version: 2,
  id: 'c19',
  name: 'Practical 19 — The Archive',
  device: 'both',
  next: 'escape1',
  info: { number: 19, title: 'The Archive', icons: ['crusher', 'portal'] },
  spawn: { position: [0, 0, -4.5], yaw: 0 },
  brushes: [
    // The press: interior x -8..8 (the slabs fill x -7..-6 and 6..7 at the start), z -20..-2.
    ...room(-8, 8, 0, 6, -20, -2, { walls: M, floor: M, skip: ['n', 's'] }),
    box([-9, 0, -2], [-1.5, 6, -1], M),
    box([1.5, 0, -2], [9, 6, -1], M),
    box([-1.5, 3, -2], [1.5, 6, -1], M),
    box([-1.5, 0, -2], [1.5, 3, -1], P),
    ...wall('x', -9, 9, -21, -20, 0, 6, M, [{ at: 0, width: 4, height: 2, bottom: 4 }]),
    // The maintenance room behind the hatch (floor y 3), industrial.
    ...room(-8, 8, 3, 9, -32, -21, { walls: M, floor: M, skip: ['s', 'n'], theme: IND }),
    box([-9, 6, -21], [9, 10, -20], M, undefined, IND),
    box([-9, 3, -33], [-2, 9, -32], M, undefined, IND),
    box([2, 3, -33], [9, 9, -32], M, undefined, IND),
    box([-2, 3, -33], [2, 4.5, -32], M, undefined, IND),
    box([-2, 8, -33], [2, 9, -32], M, undefined, IND),
    box([-2, 4.5, -33], [2, 8, -32], P, undefined, IND),
  ],
  entities: [
    { id: 'pressLight', type: 'light', position: [0, 5.5, -11], props: { intensity: 6, distance: 16, color: 0xff9a6a } },
    { id: 'slabW', type: 'crusher', position: [-6.5, 3, -11], props: { size: [1, 5.8, 17.6], travel: [6, 0, 0], period: 80 } },
    { id: 'slabE', type: 'crusher', position: [6.5, 3, -11], props: { size: [1, 5.8, 17.6], travel: [-6, 0, 0], period: 80 } },
    scrawl('pressSign', [0, 3.6, -1.97], Math.PI, 'PERMANENT STORAGE · DO NOT OBSTRUCT THE SHELVING', [5, 0.35], '#d8c9a8'),
    { id: 'stacksLight', type: 'light', position: [0, 8, -26], props: { intensity: 5, distance: 16, color: 0xffd9a0 } },
    { id: 'exit', type: 'exitElevator', position: [5.5, 3, -27], yaw: -Math.PI / 2 },
    scrawl('stacksSign', [-7.95, 6, -26], Math.PI / 2, 'MAINTENANCE · AUTHORISED STAFF ONLY', [4.4, 0.4], '#d8c9a8'),
    scrawl('marrow19a', [-1, 4.2, -31.75], 0, 'not this way. THAT way →', [2.4, 0.4], '#c0392b'),
    scrawl('marrow19b', [3.5, 4.5, -31.75], 0, '- M.', [0.8, 0.4], '#c0392b'),
    note('cn19a', [5, 1.6, -3], 'The press closes in about twenty-four seconds. Long enough to read the room once, short enough that you do not read it twice.'),
    note('cn19b', [-5, 4.6, -24], 'The first wall writing is a correction to an arrow. Marrow is helpful before you know her name.'),
  ],
  triggers: [
    { id: 'tStacks', min: [-8, 3, -32], max: [8, 6, -22], event: 'c19.stacks', once: true },
    { id: 'tHalf', min: [-8, 0, -20], max: [8, 6, -2], event: 'c19.press', once: true },
  ],
  dialogue: [
    { event: 'chamberStart', lines: ['c19.chamberStart.1', 'c19.chamberStart.2'] },
    { event: 'c19.press', lines: ['c19.press.1'] },
    { event: 'c19.stacks', lines: ['c19.stacks.1', 'c19.bursar.1', 'c19.bursar.2'] },
    { event: 'death', lines: ['c19.death.1'] },
    { event: 'exitReached', lines: ['c19.exit.1'] },
  ],
};
