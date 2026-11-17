// Advanced 2 — "Rush Hour" (remix of practical 06). The chasm is flooded (no lift back), the
// shuttle and the cube's carrier run faster, and the far side's low panel is a single aperture wide.
import type { LevelData } from '../level';
import { doorway, exitBay, intake, lamp, metal, panel, shell, strip, white } from './kitA';

const PILLAR_TOP = 3.15;
const inn = intake(0, 0);
const out = exitBay(4, -30, 0, ['plate.pressed']);

export const ADV2: LevelData = {
  version: 2,
  id: 'adv2',
  name: 'Advanced 2',
  device: 'both',
  next: 'adv3',
  info: { number: 6, title: 'Adv. · Rush Hour', icons: ['platform', 'liquid', 'cube', 'portal'] },
  spawn: inn.spawn,
  brushes: [
    ...shell({
      min: [-8, 0, -30],
      max: [8, 9, 0],
      floor: null,
      holes: {
        s: [doorway(0)],
        n: [doorway(4)],
        w: [panel(-24.7, -23.3, 0, 2.3)],
        e: [panel(-16, -11, PILLAR_TOP + 0.3, PILLAR_TOP + 3.6)],
      },
    }),
    // Start floor, chasm (floor 4 m down), far side.
    metal([-8.5, -4.5, -6], [8.5, 0, 0.5]),
    metal([-8.5, -4.5, -30.5], [8.5, 0, -18]),
    metal([-8.5, -4.5, -18], [8.5, -4, -6]),
    // The pillar on the east side of the chasm, joined to the far side.
    white([4, -4, -18], [8, PILLAR_TOP, -9], { '-x': 'metal', '+z': 'metal' }),
    ...inn.brushes,
    ...out.brushes,
  ],
  entities: [
    ...inn.entities,
    lamp('lamp1', [0, 8.4, -6], 9, 18),
    lamp('lamp2', [0, 8.4, -22], 9, 18),
    { id: 'chasmLight', type: 'light', position: [0, -1.5, -12], props: { intensity: 3, distance: 10, color: 0xc8ff9a } },
    { id: 'shuttle', type: 'platform', position: [0, -0.15, -7.3], props: { waypoints: [[0, -0.15, -7.3], [0, -0.15, -16.7]], speed: 3 } },
    { id: 'carrier', type: 'platform', position: [-5, PILLAR_TOP - 0.15, -12.5], props: { waypoints: [[-5, PILLAR_TOP - 0.15, -12.5], [2.74, PILLAR_TOP - 0.15, -12.5]], speed: 1.6 } },
    { id: 'cube1', type: 'cube', position: [-5, PILLAR_TOP + 0.34, -12.5] },
    { id: 'acid', type: 'liquid', position: [0, -3.4, -12], props: { size: [16, 0.6, 12] } },
    { id: 'plate', type: 'floorButton', position: [0, 0, -24], props: { accepts: 'cube' } },
    strip('wire', [[0.8, 0, -24], [6.2, 0, -24], [6.2, 0, -29.9]], [6.4, 1.5, -29.98], 0),
    ...out.entities,
  ],
  wiring: [{ from: 'plate.pressed', to: 'wire.on' }, ...(out.wiring ?? [])],
  triggers: [
    { id: 'tFar', min: [-8, 0, -30], max: [8, 2, -18.5], event: 'adv2.far', once: true },
    { id: 'tPillar', min: [4, PILLAR_TOP, -18], max: [8, PILLAR_TOP + 2, -9], event: 'adv2.pillar', once: true },
  ],
  dialogue: [
    { event: 'chamberStart', lines: ['adv2.chamberStart.1'] },
    { event: 'adv2.pillar', lines: ['adv2.pillar.1'] },
    { event: 'exitReached', lines: ['adv2.exitReached.1'] },
  ],
};
