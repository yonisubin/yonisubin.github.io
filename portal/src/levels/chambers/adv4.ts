// Advanced 4 — "No Net" (remix of practical 08). The chasm has no floor and no lift: miss and you
// fall out of the practical. The far side is reached by a narrow pier only five metres wide.
import type { LevelData } from '../level';
import { doorway, exitBay, intake, lamp, metal, shell, strip, white } from './kitA';

const TOWER = 9;
const PIT = { x0: -2, x1: 4, z0: -12, z1: -6, y: -4 };
const CHASM = { z0: -26, z1: -16, y: -10 };
const inn = intake(0, 0);
const out = exitBay(0, -40, 0, ['bell.pressed']);

export const ADV4: LevelData = {
  version: 2,
  id: 'adv4',
  name: 'Advanced 4',
  device: 'both',
  next: 'adv5',
  info: { number: 8, title: 'Adv. · No Net', icons: ['fling', 'portal', 'platform'] },
  spawn: inn.spawn,
  brushes: [
    ...shell({ min: [-8, 0, -40], max: [8, 14, 0], floor: null, holes: { s: [doorway(0)], n: [doorway(0)] } }),
    // Start floor around the drop pit.
    metal([-8.5, -4.5, PIT.z1], [8.5, 0, 0.5]),
    metal([-8.5, -4.5, CHASM.z1], [8.5, 0, PIT.z0]),
    metal([-8.5, -4.5, PIT.z0], [PIT.x0, 0, PIT.z1]),
    metal([PIT.x1, -4.5, PIT.z0], [8.5, 0, PIT.z1]),
    white([PIT.x0, -4.5, PIT.z0], [PIT.x1, PIT.y, PIT.z1], { '-y': 'metal' }),
    // No chasm floor (a bottomless drop); the exit side is reached by a narrow pier.
    metal([-2.5, -4.5, -32], [2.5, 0, CHASM.z0]),
    metal([-8.5, -4.5, -40.5], [8.5, 0, -32]),
    // Launch block on the chasm's edge: white north face from the chasm floor up.
    metal([-3, CHASM.y, -16.01], [3, 5, -14], { '-z': 'portalable' }),
    // The catwalk along the east wall (the only place the launch face can be seen from).
    metal([6, -0.3, -22], [8, 0, CHASM.z1]),
    // The tower.
    metal([-8, 0, PIT.z0], [-3, TOWER, -4.8]),
    ...inn.brushes,
    ...out.brushes,
  ],
  entities: [
    ...inn.entities,
    lamp('lamp1', [0, 13.4, -6], 10, 22),
    lamp('lamp2', [0, 13.4, -21], 10, 24),
    lamp('lamp3', [0, 13.4, -33], 9, 18),
    { id: 'towerLift', type: 'lift', position: [-5.5, -0.15, -3.5], props: { height: TOWER } },
    { id: 'bell', type: 'pedestalButton', position: [3, 0, -33] },
    strip('wire', [[3, 0, -33.4], [3, 0, -37], [1.9, 0, -37], [1.9, 0, -39.9]], [2.1, 1.5, -39.98], 0),
    { id: 'landing', type: 'decal', position: [0, 0.01, -29.5], props: { image: 'arrow', floor: true, size: [1.6, 0.8] }, yaw: -Math.PI / 2 },
    { id: 'catwalkSign', type: 'decal', position: [7.98, 2, -19], yaw: -Math.PI / 2, props: { text: 'VIEWING', size: [1.4, 0.4], ink: '#c9d2da' } },
    ...out.entities,
  ],
  wiring: [{ from: 'bell.pressed', to: 'wire.on' }, ...(out.wiring ?? [])],
  triggers: [
    { id: 'tCatwalk', min: [6, 0, -22], max: [8, 2, -18], event: 'adv4.catwalk', once: true },
    { id: 'tTower', min: [-8, TOWER, PIT.z0], max: [-3, TOWER + 2, -4.8], event: 'adv4.tower', once: true },
    { id: 'tFar', min: [-8, 0, -40], max: [8, 2, -27], event: 'adv4.far', once: true },
  ],
  dialogue: [
    { event: 'chamberStart', lines: ['adv4.chamberStart.1'] },
    { event: 'adv4.far', lines: ['adv4.far.1'] },
    { event: 'exitReached', lines: ['adv4.exitReached.1'] },
  ],
};
