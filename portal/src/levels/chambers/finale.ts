// Finale — "The Senate". The Provost's core hangs in its own chamber; it cannot be shot.
//
//   A rocket turret at the north end covers the alcoves along the south wall: it fires at you
//   whenever you stand in one (the first time starts the fight and the Erasure). There are three
//   alcoves, each with a white-faced baffle standing in its mouth; high on the west wall, one white
//   panel at a time slides out, level with the core. Put one end on the baffle's face and the other
//   on the panel, show yourself in the alcove beside the baffle, then step behind it: the rocket
//   homes on you, goes into the baffle and comes out of the panel straight at the core.
//   Each hit knocks a component loose (the turret powers down while one is loose). Carry it to the
//   disposal unit by the east tank and drop it in. Every disposal shifts the arena: the used panel
//   retracts (closing your opening), the next one slides out, and the next alcove's door opens.
//   Meanwhile the Erasure counts down (150 / 120 / 90 s) and correction fluid rises in the tank
//   behind the east glass; if it runs out you are erased. Three components → the core is defeated.
import type { LevelData, Vec3 } from '../level';
import { box, G, lobby, M, note, P, scrawl, wall } from './kitB';

const L = lobby(-2, 0, undefined, 12);
/** Alcove centres (x) by stage. */
const BX = [-2, -10, 5];
/** Target panels (z on the west wall, y 8) by stage, set so the redirected rocket meets the core. */
const PZ = [-27, -29.4, -24.9];
const CORE: Vec3 = [-7, 8, -27];

const alcove = (bx: number) => [
  box([bx - 2.5, -1, -11], [bx + 2.5, 0, -7.5]),
  box([bx - 2.5, 0, -10], [bx - 1.5, 3.5, -8.5]),
  box([bx + 1.5, 0, -10], [bx + 2.5, 3.5, -8.5]),
  box([bx - 2.5, 0, -8.5], [bx + 2.5, 3.5, -7.5]),
  box([bx - 2.5, 3.5, -10], [bx + 2.5, 4.5, -7.5]),
  // The baffle in its mouth: metal, with a white north face.
  box([bx - 0.7, 0, -11.3], [bx + 0.7, 2.6, -11], M, { '-z': P }),
];

export const FINALE: LevelData = {
  version: 2,
  id: 'finale',
  name: 'The Senate',
  device: 'both',
  info: { number: 19, title: 'The Senate', icons: ['portal', 'turret', 'timer'] },
  spawn: L.spawn,
  brushes: [
    ...L.brushes,
    box([-16, -1, -41], [15.2, 0, -11]),
    box([-16, 14, -41], [20, 15, -10]),
    box([-16, 0, -41], [20, 14, -40]),
    box([-16, 0, -40], [-15, 14, -11]),
    ...wall('x', -16, 15.2, -11, -10, 0, 14, M, [
      ...BX.map((at) => ({ at, width: 3, height: 3.5 })),
      { at: 12, width: 2.4, height: 3 },
    ]),
    ...BX.flatMap(alcove),
    // The Erasure tank behind the east glass.
    box([15, 0, -40], [15.2, 3.5, -11], G),
    box([15.2, -3, -40], [20, -2, -11]),
    box([19, -3, -40], [20, 14, -11]),
    box([15.2, -3, -11], [20, 14, -10]),
    box([15.2, -3, -40.5], [20, 0, -40]),
    // The core's mount.
    box([CORE[0] - 0.3, 9.6, CORE[2] - 0.3], [CORE[0] + 0.3, 14, CORE[2] + 0.3]),
  ],
  entities: [
    ...L.entities,
    { id: 'senateLight1', type: 'light', position: [0, 13, -18], props: { intensity: 9, distance: 30 } },
    { id: 'senateLight2', type: 'light', position: [0, 13, -33], props: { intensity: 9, distance: 30 } },
    { id: 'coreLight', type: 'light', position: [-4, 10, -24], props: { intensity: 6, distance: 12, color: 0xff6a5a } },
    { id: 'core', type: 'bossCore', position: CORE, props: { radius: 1.6, stages: 3 } },
    { id: 'rockets', type: 'rocketTurret', position: [-2, 0, -37.5], yaw: 0 },
    { id: 'bin', type: 'disposal', position: [8, 0.75, -24], props: { size: [1.6, 1.5, 1.6], core: 'core' } },
    { id: 'erasure', type: 'erasure', position: [6, 9, -39.95], yaw: 0, props: { seconds: [150, 120, 90], core: 'core', moat: [17.1, -25.5, 3.8, 29], moatFloor: -1.95, moatDepth: 4.5, boardSize: [5, 1.9] } },
    // The turret covers the alcoves: it only fires while you stand in one. The fight (and the
    // Erasure) begins the first time you do.
    ...BX.map((bx, k) => ({ id: `inAlcove${k}`, type: 'zone' as const, position: [bx, 1.5, -9.7] as Vec3, props: { size: [3, 3, 2.4] } })),
    { id: 'gInAlcove', type: 'gate', position: [0, 0, 0], props: { op: 'or' } },
    { id: 'fightLatch', type: 'zone', position: [BX[0], 1.5, -9.7], props: { size: [3, 3, 2.4] } },
    ...[0, 1, 2].map((k) => ({ id: `target${k}`, type: 'panel' as const, position: [-15.4, CORE[1], PZ[k]] as Vec3, props: { size: [0.3, 2.4, 1.4], to: [0.5, 0, 0], tag: 'portalable' } })),
    { id: 'door1', type: 'door', position: [BX[1], 0, -10.85], props: { width: 3, height: 3 } },
    { id: 'door2', type: 'door', position: [BX[2], 0, -10.85], props: { width: 3, height: 3 } },
    { id: 'gNotDefeated', type: 'gate', position: [0, 0, 0], props: { op: 'not' } },
    { id: 'gNotExposed', type: 'gate', position: [0, 0, 0], props: { op: 'not' } },
    { id: 'gNot1', type: 'gate', position: [0, 0, 0], props: { op: 'not' } },
    { id: 'gNot2', type: 'gate', position: [0, 0, 0], props: { op: 'not' } },
    { id: 'gNot3', type: 'gate', position: [0, 0, 0], props: { op: 'not' } },
    scrawl('senateSign', [-6, 12.4, -39.95], 0, 'THE SENATE · ALL MOTIONS ARE FINAL', [7, 0.7], '#22282d'),
    scrawl('binSign', [8, 2.2, -24.85], 0, 'DISPOSAL', [1.6, 0.35], '#c0392b'),
    scrawl('marrowFinale', [-0.6, 2.9, -8.55], Math.PI, 'stand behind it. let it come to you. - M', [2.8, 0.3], '#c0392b'),
    note('cnF1', [13.5, 1.6, -6], 'The boss is a puzzle about where you stand. The rocket aims at you; the baffle and the panel decide where it ends up.'),
    note('cnF2', [10.5, 1.6, -38.5], 'Each stage moves the white panel and opens a new alcove, so you re-solve the angle instead of repeating it. The panels are placed so the maths works.'),
  ],
  wiring: [
    { from: 'core.defeated', to: 'gNotDefeated.in' },
    { from: 'core.exposed', to: 'gNotExposed.in' },
    { from: 'inAlcove0.inside', to: 'gInAlcove.in1' },
    { from: 'inAlcove1.inside', to: 'gInAlcove.in2' },
    { from: 'inAlcove2.inside', to: 'gInAlcove.in3' },
    { from: 'gInAlcove.out', to: 'rockets.active' },
    { from: 'gNotDefeated.out', to: 'rockets.active' },
    { from: 'gNotExposed.out', to: 'rockets.active' },
    { from: 'fightLatch.entered', to: 'erasure.active' },
    { from: 'gNotDefeated.out', to: 'erasure.active' },
    { from: 'core.stage1', to: 'gNot1.in' },
    { from: 'core.stage2', to: 'gNot2.in' },
    { from: 'core.stage3', to: 'gNot3.in' },
    { from: 'gNot1.out', to: 'target0.active' },
    { from: 'core.stage1', to: 'target1.active' },
    { from: 'gNot2.out', to: 'target1.active' },
    { from: 'core.stage2', to: 'target2.active' },
    { from: 'gNot3.out', to: 'target2.active' },
    { from: 'core.stage1', to: 'door1.open' },
    { from: 'core.stage2', to: 'door2.open' },
  ],
  triggers: [
    { id: 'tSenate', min: [9, 0, -14], max: [15, 3, -11], event: 'finale.enter', once: true },
    { id: 'tFight', min: [BX[0] - 1.5, 0, -10.9], max: [BX[0] + 1.5, 3, -8.5], event: 'finale.fight', once: true },
  ],
  checkpoints: [
    { id: 'alcove1', min: [BX[1] - 1.5, 0, -10.8], max: [BX[1] + 1.5, 3, -8.5], spawn: { position: [BX[1], 0, -9.3], yaw: 0 } },
    { id: 'alcove2', min: [BX[2] - 1.5, 0, -10.8], max: [BX[2] + 1.5, 3, -8.5], spawn: { position: [BX[2], 0, -9.3], yaw: 0 } },
  ],
  dialogue: [
    { event: 'chamberStart', lines: ['finale.chamberStart.1', 'finale.chamberStart.2'] },
    { event: 'finale.enter', lines: ['finale.enter.1'] },
    { event: 'finale.fight', lines: ['finale.fight.1', 'finale.fight.2'] },
    { event: 'boss.hit.0', lines: ['finale.hit0.1'] },
    { event: 'boss.componentDisposed.0', lines: ['finale.stage1.1', 'finale.stage1.2'] },
    { event: 'boss.hit.1', lines: ['finale.hit1.1'] },
    { event: 'boss.componentDisposed.1', lines: ['finale.stage2.1', 'finale.stage2.2'] },
    { event: 'boss.hit.2', lines: ['finale.hit2.1'] },
    { event: 'checkpoint', lines: ['finale.checkpoint.1'] },
    { event: 'death', lines: ['finale.death.1'] },
  ],
};
