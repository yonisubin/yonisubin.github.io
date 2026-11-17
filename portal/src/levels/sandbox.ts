// Gray-box sandbox for phases 5–7: one big hall with every element, plus a small room for the
// pre-placed / one-colour device rules. Reach them with twinfold.session.loadChamber(...) (tests),
// or ?chamber=sandbox in the URL.
//
// Seen from above (x → east, z → south). Floor top y = 0, ceiling y = 10, walls are white panels.
//
//   z=-15 ┌──── catcher (north wall, x -10) ───────────────┬── exit enclosure ──┐
//         │        basin (liquid)   pit                    │   exit elevator    │
//   z=-12 │       x -6..-2        x 2..6     boss core     │                    │
//   z=-9.5│   pellet launcher (west wall, z -6) →   rocket  ├──[exit door]───────┤
//         │                  door1 (x -8, z -4)    turret  disposal           │
//         │                                     platform (x 8, z 6..-4)        │
//   z=2   │    pedestals   buttons: any / cube / sphere      ┌─ turret gallery ─┤
//         │                                    grill x -2    │ (low metal walls)│
//   z=8   │   cube  companion  sphere   chair monitor cup    └──────────────────┤
//         │  entry elevator (x -17)   sign     crusher (x 2)     lift (x 8)      │
//   z=15  └─────────────────────────────────────────────────────────────────────┘
//       x=-20                                                                 x=20
import type { Brush, LevelData } from './level';

const floor = (min: [number, number, number], max: [number, number, number]): Brush => ({ min, max, tag: 'portalable' });

export const SANDBOX: LevelData = {
  version: 2,
  id: 'sandbox',
  name: 'Gray-box sandbox',
  device: 'both',
  next: 'testroom',
  info: { number: 0, title: 'Element sandbox', icons: ['cube', 'sphere', 'button', 'pellet', 'grill', 'liquid', 'turret', 'crusher'] },
  spawn: { position: [-17, 0, 12.5], yaw: 0 },
  brushes: [
    // Floor (3 m thick) around a liquid basin (x -6..-2) and a bottomless pit (x 2..6), z -12..-8.
    floor([-20, -3, -15], [20, 0, -12]),
    floor([-20, -3, -8], [20, 0, 15]),
    floor([-20, -3, -12], [-6, 0, -8]),
    floor([-2, -3, -12], [2, 0, -8]),
    floor([6, -3, -12], [20, 0, -8]),
    { min: [-6, -3, -12], max: [-2, -1.5, -8], tag: 'metal' },
    // Outer walls and ceiling.
    floor([-21, -3, -16], [-20, 11, 16]),
    floor([20, -3, -16], [21, 11, 16]),
    floor([-21, -3, -16], [21, 11, -15]),
    floor([-21, -3, 15], [21, 11, 16]),
    floor([-21, 10, -16], [21, 11, 16]),
    // Exit enclosure (x 12..20, z -15..-9.5): metal walls with a doorway at x 15.8..18.2.
    { min: [11.8, 0, -15], max: [12, 10, -9.4], tag: 'metal' },
    { min: [12, 0, -9.6], max: [15.8, 10, -9.4], tag: 'metal' },
    { min: [18.2, 0, -9.6], max: [20, 10, -9.4], tag: 'metal' },
    { min: [15.8, 3, -9.6], max: [18.2, 10, -9.4], tag: 'metal' },
    // Turret gallery (x 13..20, z 2..8): low metal walls.
    { min: [12.8, 0, 1.8], max: [13, 3, 8.2], tag: 'metal' },
    { min: [13, 0, 1.8], max: [20, 3, 2], tag: 'metal' },
    { min: [13, 0, 8], max: [20, 3, 8.2], tag: 'metal' },
  ],
  entities: [
    { id: 'entry', type: 'entryElevator', position: [-17, 0, 12.5], yaw: Math.PI },
    { id: 'sign', type: 'sign', position: [-13.5, 1.8, 14.95], yaw: Math.PI },
    { id: 'light1', type: 'light', position: [0, 8, 0], props: { intensity: 10, distance: 30 } },
    { id: 'arrow', type: 'decal', position: [-14, 0.01, 9], yaw: 0, props: { image: 'arrow', floor: true, size: [1.2, 0.6] } },
    { id: 'note', type: 'commentaryNode', position: [-15, 1.5, 9], props: { text: 'This hall holds one of everything. Break it gently.' } },

    // Props.
    { id: 'cube1', type: 'cube', position: [-12, 0.33, 10] },
    { id: 'cube2', type: 'companionCube', position: [-10, 0.33, 10] },
    { id: 'ball1', type: 'sphere', position: [-8, 0.33, 10] },
    { id: 'chair', type: 'debris', position: [-6, 0.46, 12], props: { kind: 'chair' } },
    { id: 'monitor', type: 'debris', position: [-5, 0.26, 13], props: { kind: 'monitor' } },
    { id: 'cup', type: 'debris', position: [-4.4, 0.07, 12], props: { kind: 'cup' } },

    // Inputs.
    { id: 'btnAny', type: 'floorButton', position: [-12, 0, 4] },
    { id: 'btnCube', type: 'floorButton', position: [-8, 0, 4], props: { accepts: 'cube' } },
    { id: 'btnSphere', type: 'floorButton', position: [-4, 0, 4], props: { accepts: 'sphere' } },
    { id: 'pedTimer', type: 'pedestalButton', position: [-14, 0, 6], props: { seconds: 4 } },
    { id: 'pedToggle', type: 'pedestalButton', position: [-15.5, 0, 6] },
    { id: 'pedRocket', type: 'pedestalButton', position: [-17, 0, 6] },

    // Logic.
    { id: 'gAnd', type: 'gate', position: [0, 0, 0], props: { op: 'and' } },
    { id: 'gOr', type: 'gate', position: [0, 0, 0], props: { op: 'or' } },
    { id: 'gNot', type: 'gate', position: [0, 0, 0], props: { op: 'not' } },
    { id: 'gTimer', type: 'gate', position: [0, 0, 0], props: { op: 'timer', seconds: 2 } },

    // Receivers.
    { id: 'door1', type: 'door', position: [-8, 0, -4] },
    { id: 'doorExit', type: 'door', position: [17, 0, -9.5] },
    { id: 'ind1', type: 'indicator', position: [-9.4, 1.2, -3.85], props: { path: [[-12, 0.01, 3.2], [-12, 0.01, -2], [-9.4, 0.01, -2], [-9.4, 0.01, -3.7]], icon: 'check' } },
    { id: 'ind2', type: 'indicator', position: [-14, 1.4, 6.3], props: { path: [[-14, 0.01, 5.6], [-14, 0.01, 3]], icon: 'timer' } },
    { id: 'ind3', type: 'indicator', position: [-10, 3, -14.9], props: { icon: 'check' } },
    { id: 'plat1', type: 'platform', position: [8, 1, 6], props: { waypoints: [[8, 1, 6], [8, 1, -4]], speed: 2, portalable: true } },
    { id: 'lift1', type: 'lift', position: [8, 0, 12], props: { height: 4 } },
    { id: 'panel1', type: 'panel', position: [19.85, 2.5, 11], props: { size: [0.3, 3, 3], to: [-2, 0, 0], tag: 'portalable' } },

    // Hazards.
    { id: 'launcher1', type: 'pelletLauncher', position: [-19.9, 1.5, -6], props: { direction: [1, 0, 0], life: 12 } },
    { id: 'catcher1', type: 'pelletCatcher', position: [-10, 1.5, -14.9], props: { direction: [0, 0, 1] } },
    { id: 'grill1', type: 'grill', position: [-2, 2, 8], props: { size: [4, 4], normal: [1, 0, 0] } },
    { id: 'acid', type: 'liquid', position: [-4, -0.5, -10], props: { size: [4, 1, 4] } },
    { id: 'crush1', type: 'crusher', position: [2, 6, 11], props: { size: [2, 3, 2], travel: [0, -4.4, 0], period: 3 } },
    { id: 'tur1', type: 'turret', position: [16, 0.61, 5], yaw: -Math.PI / 2 },
    { id: 'tur2', type: 'turret', position: [18, 0.61, 3.5], yaw: -Math.PI / 2 },
    { id: 'rockets', type: 'rocketTurret', position: [15, 0, -4], yaw: -Math.PI / 2 },
    { id: 'core', type: 'bossCore', position: [4, 6, -4], props: { radius: 1.2, stages: 3 } },
    { id: 'bin', type: 'disposal', position: [10, 0.75, 12.5], props: { size: [1.5, 1.5, 1.5] } },

    { id: 'exit', type: 'exitElevator', position: [17, 0, -12.8], yaw: 0 },
  ],
  wiring: [
    { from: 'btnAny.pressed', to: 'gAnd.in1' },
    { from: 'btnCube.pressed', to: 'gAnd.in2' },
    { from: 'btnCube.pressed', to: 'gOr.in1' },
    { from: 'btnSphere.pressed', to: 'gOr.in2' },
    { from: 'btnSphere.pressed', to: 'gNot.in' },
    { from: 'btnAny.pressed', to: 'gTimer.in' },
    { from: 'gAnd.out', to: 'door1.open' },
    { from: 'btnAny.pressed', to: 'ind1.on' },
    { from: 'pedTimer.pressed', to: 'ind2.on' },
    { from: 'catcher1.caught', to: 'ind3.on' },
    { from: 'pedToggle.pressed', to: 'doorExit.open' },
    { from: 'btnSphere.pressed', to: 'panel1.active' },
    { from: 'pedRocket.pressed', to: 'rockets.active' },
  ],
  triggers: [{ id: 'nearGrill', min: [-4, 0, 6], max: [-2.5, 3, 10], event: 'sandboxGrill', once: true }],
  checkpoints: [{ id: 'mid', min: [-1, 0, 12], max: [1, 3, 14], spawn: { position: [0, 0, 13], yaw: Math.PI / 2 } }],
};

/**
 * Pre-placed portals and a one-colour device: the device fires only the first colour; the second
 * end is fixed and flips between the east and west walls every 3 s.
 */
export const FIXED_ROOM: LevelData = {
  version: 2,
  id: 'fixedroom',
  name: 'Fixed portal room',
  device: 'a',
  spawn: { position: [0, 0, 4], yaw: 0 },
  brushes: [
    floor([-8, -1, -8], [8, 0, 8]),
    floor([-9, -1, -9], [-8, 6, 9]),
    floor([8, -1, -9], [9, 6, 9]),
    floor([-9, -1, -9], [9, 6, -8]),
    floor([-9, -1, 8], [9, 6, 9]),
    floor([-9, 5, -9], [9, 6, 9]),
  ],
  entities: [
    {
      id: 'flip',
      type: 'fixedPortal',
      position: [8, 1.5, 0],
      props: { which: 'b', normal: [-1, 0, 0], cycle: [[[8, 1.5, 0], [-1, 0, 0]], [[-8, 1.5, 0], [1, 0, 0]]], period: 3 },
    },
  ],
};
