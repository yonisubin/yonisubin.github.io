// Advanced 6 — "Archipelago" (remix of practical 10). Four smaller islands instead of three, the cube
// on the third, and no jump at the end: the exit ledge is 4 m past the last island, so the last hop
// is a fold onto the panel on the exit ledge's back wall. Ten apertures, each on a face with no
// room to spare.
import type { LevelData } from '../level';
import { island, type Island } from './c10';
import { doorway, exitBay, intake, lamp, metal, panel, shell, strip } from './kitA';

const ISLANDS: Island[] = [
  { x0: -7, x1: -4, z0: -11, z1: -8, pylon: 'w' },
  { x0: 4, x1: 7, z0: -17, z1: -14, pylon: 'e' },
  { x0: -7, x1: -4, z0: -23, z1: -20, pylon: 'w' },
  { x0: 4, x1: 7, z0: -29, z1: -26, pylon: 'e' },
];
const BASIN = { z0: -33, z1: -6, floor: -2.5, surface: -0.5 };
const inn = intake(0, 0);
const out = exitBay(4, -36, 0, ['plate.pressed']);
const isl = ISLANDS.map((i) => island(i, BASIN.floor));

export const ADV6: LevelData = {
  version: 2,
  id: 'adv6',
  name: 'Advanced 6',
  device: 'both',
  info: { number: 10, title: 'Adv. · Archipelago', icons: ['liquid', 'portal', 'cube', 'button'] },
  spawn: inn.spawn,
  brushes: [
    ...shell({
      min: [-10, 0, -36],
      max: [10, 10, 0],
      floor: null,
      holes: { s: [doorway(0)], n: [panel(-6.3, -4.7, 0, 2.3), doorway(4)], w: [panel(-4, -1.5, 0, 3)] },
    }),
    metal([-10.5, BASIN.floor - 0.5, BASIN.z1], [10.5, 0, 0.5]),
    metal([-10.5, BASIN.floor - 0.5, BASIN.z0], [10.5, BASIN.floor, BASIN.z1]),
    metal([-10.5, BASIN.floor - 0.5, -36.5], [10.5, 0, BASIN.z0]),
    ...isl.flatMap((i) => i.brushes),
    ...inn.brushes,
    ...out.brushes,
  ],
  entities: [
    ...inn.entities,
    lamp('lamp1', [0, 9.4, -9], 9, 20),
    lamp('lamp2', [0, 9.4, -24], 9, 20),
    lamp('lamp3', [0, 9.4, -34], 6, 12),
    { id: 'acid', type: 'liquid', position: [0, BASIN.surface, (BASIN.z0 + BASIN.z1) / 2], props: { size: [20, 1.5, BASIN.z1 - BASIN.z0] } },
    { id: 'cube1', type: 'cube', position: [-4.6, 0.33, -21.5] },
    { id: 'plate', type: 'floorButton', position: [7.8, 0, -34.5], props: { accepts: 'cube' } },
    strip('wire', [[6.9, 0, -34.5], [6.4, 0, -34.5], [6.4, 0, -35.9]], [6.4, 1.6, -35.98], 0),
    ...out.entities,
  ],
  wiring: [{ from: 'plate.pressed', to: 'wire.on' }, ...(out.wiring ?? [])],
  triggers: [{ id: 't3', min: [-7, 0, -23], max: [-4, 2, -20], event: 'adv6.island3', once: true }],
  dialogue: [
    { event: 'chamberStart', lines: ['adv6.chamberStart.1'] },
    { event: 'adv6.island3', lines: ['adv6.island3.1'] },
    { event: 'exitReached', lines: ['adv6.exitReached.1'] },
  ],
};
