// Advanced 1 — "Both Ends, Steeped" (remix of practical 05). Fewer helpers, more hazards: the pit
// is flooded except for one small island holding the cube, the shelf panel is a single aperture
// wide, and the low panel on the east wall is gone. Step (don't run) off the pit's east lip onto
// the island, and put blue high enough on the pit wall that you can walk into it.
import type { LevelData } from '../level';
import { doorway, exitBay, intake, lamp, metal, panel, shell, strip, white } from './kitA';

const SHELF = 3.5;
const PIT = { x0: -7, x1: -1, z0: -14, z1: -8, y: -3 };
const ISLAND = { x0: -3.2, x1: PIT.x1, z0: -12.6, z1: -9.4, top: -2.2 };
const inn = intake(0, 0);
const out = exitBay(-4, -24, SHELF, ['plate.pressed']);

export const ADV1: LevelData = {
  version: 2,
  id: 'adv1',
  name: 'Advanced 1',
  device: 'both',
  next: 'adv2',
  info: { number: 5, title: 'Adv. · Both Ends, Steeped', icons: ['portal', 'liquid', 'cube', 'button'] },
  spawn: inn.spawn,
  brushes: [
    ...shell({
      min: [-8, 0, -24],
      max: [8, 9, 0],
      floor: null,
      holes: { s: [doorway(0)], n: [doorway(-4, SHELF), panel(4.6, 6, SHELF + 0.6, SHELF + 2.9)] },
    }),
    metal([-8.5, -3.5, -24.5], [8.5, 0, PIT.z0]),
    metal([-8.5, -3.5, PIT.z1], [8.5, 0, 0.5]),
    metal([-8.5, -3.5, PIT.z0], [PIT.x0, 0, PIT.z1]),
    metal([PIT.x1, -3.5, PIT.z0], [8.5, 0, PIT.z1], { '-x': 'portalable' }),
    metal([PIT.x0, -3.5, PIT.z0], [PIT.x1, PIT.y, PIT.z1]),
    metal([ISLAND.x0, PIT.y, ISLAND.z0], [ISLAND.x1, ISLAND.top, ISLAND.z1]),
    white([-8, 0, -24], [8, SHELF, -17], { '+z': 'metal' }),
    ...inn.brushes,
    ...out.brushes,
  ],
  entities: [
    ...inn.entities,
    lamp('lamp1', [0, 8.4, -8], 9, 20),
    lamp('lamp2', [0, 8.4, -20], 7, 14),
    { id: 'pitLight', type: 'light', position: [-4, -0.6, -11], props: { intensity: 3, distance: 6, color: 0xc8ff9a } },
    { id: 'acid', type: 'liquid', position: [-4, -2.5, -11], props: { size: [6, 0.5, 6] } },
    { id: 'cube1', type: 'cube', position: [-2.1, ISLAND.top + 0.33, -9.9] },
    { id: 'plate', type: 'floorButton', position: [-0.5, SHELF, -20.5], props: { accepts: 'cube' } },
    strip('wire', [[-1.4, SHELF, -20.5], [-6.2, SHELF, -20.5], [-6.2, SHELF, -23.9]], [-6.4, SHELF + 1.5, -23.98], 0),
    ...out.entities,
  ],
  wiring: [{ from: 'plate.pressed', to: 'wire.on' }, ...(out.wiring ?? [])],
  triggers: [{ id: 'tIsland', min: [ISLAND.x0, ISLAND.top, ISLAND.z0], max: [ISLAND.x1, ISLAND.top + 2, ISLAND.z1], event: 'adv1.island', once: true }],
  dialogue: [
    { event: 'chamberStart', lines: ['adv1.chamberStart.1'] },
    { event: 'adv1.island', lines: ['adv1.island.1'] },
    { event: 'exitReached', lines: ['adv1.exitReached.1'] },
  ],
};
