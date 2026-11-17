// The gray-box test room for phases 1–4: one big hall to try movement, placement, walking through,
// the infinite fall and the fling.
//
// Seen from above (x → east, z → south). Floor top is y = 0; everything is 11 m deep below it.
//
//   z=-15  ┌──────────────── north wall (white) ───────────────────┐
//          │ LEDGE (y=4, white top,  │      │                      │
//          │  metal front)           │chasm │      EAST FLOOR      │
//          │                         │ 6 m  │    (fling target     │
//          │                         │ wide │       ▌pillar        │
//   z=-3   │  ┌──PIT──┐              │      │                      │
//          │  │ 10 m  │              │ 6 m  │                      │
//   z=3    │  └───────┘              │ deep │                      │
//          │          LAUNCH BLOCK ▐ │      │    fling target pad  │
//          │  ▬▬glass▬▬  (6 m tall)  │      │    (x 7..11, z 4..8) │
//          │        SPAWN (x -3)            │                      │
//   z=15   └──────────────── south wall (metal) ───────────────────┘
//        x=-12          x=-4  x=-2      x=4                       x=12
//
// Fling: put one portal high on the launch block's east face (x = -4, faces the chasm), the other on the
// pit floor, jump into the pit: you come out of the block at ~15 m/s and sail over the chasm.
// Infinite fall: one portal on the pit floor, the other on the ceiling above it.
import type { LevelData } from './level';

export const TEST_ROOM: LevelData = {
  version: 2,
  id: 'testroom',
  name: 'Gray-box test room',
  spawn: { position: [-3, 0, 12], yaw: 0 },
  brushes: [
    // Floor west of the chasm, with the pit cut out (x -11..-5, z -3..3).
    { min: [-12, -11, -15], max: [-11, 0, 15], tag: 'portalable' },
    { min: [-5, -11, -15], max: [-2, 0, 15], tag: 'portalable' },
    { min: [-11, -11, -15], max: [-5, 0, -3], tag: 'portalable' },
    // Near the spawn the floor is dark metal (pit walls stay white).
    { min: [-11, -11, 3], max: [-5, 0, 15], tag: 'portalable', faces: { '+y': 'metal' } },
    // Pit bottom, 10 m down.
    { min: [-11, -11, -3], max: [-5, -10, 3], tag: 'portalable' },
    // Chasm floor, 6 m down.
    { min: [-2, -11, -15], max: [4, -6, 15], tag: 'portalable' },
    // Floor east of the chasm.
    { min: [4, -11, -15], max: [12, 0, 15], tag: 'portalable' },

    // Outer walls and ceiling (ceiling at y = 10).
    { min: [-13, -11, -16], max: [-12, 11, 16], tag: 'portalable' },
    { min: [12, -11, -16], max: [13, 11, 16], tag: 'portalable' },
    { min: [-13, -11, -16], max: [13, 11, -15], tag: 'portalable' },
    { min: [-13, -11, 15], max: [13, 11, 16], tag: 'metal' },
    { min: [-13, 10, -16], max: [13, 11, 16], tag: 'portalable' },

    // Ledge in the north-west corner: metal front, white top. Reach it with portals.
    { min: [-12, 0, -15], max: [-4, 4, -11], tag: 'metal', faces: { '+y': 'portalable' } },
    // Launch block, 6 m tall: metal, its east face (toward the chasm) is white. Aim at that face
    // from the strip of floor between it and the chasm.
    { min: [-6, 0, 4], max: [-4, 6, 8], tag: 'metal', faces: { '+x': 'portalable' } },
    // Free-standing glass pane: portal shots fizzle on it.
    { min: [-10, 0, 7.9], max: [-6.5, 3, 8.1], tag: 'glass' },
    // A metal pillar on the east floor.
    { min: [8, 0, -9], max: [9, 10, -8], tag: 'metal' },
    // A small white crate to step on (0.4 m: the step-up handles it).
    { min: [-4.6, 0, 10], max: [-3.6, 0.4, 11], tag: 'portalable' },
  ],
  markers: [{ position: [9, 0, 6], size: [4, 4], color: 0x37d67a }],
};
