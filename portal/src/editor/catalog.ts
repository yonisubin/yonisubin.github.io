// What the puzzle maker knows about each entity type: palette group, marker look, default props,
// and the named outputs / inputs the wiring tool offers (the simulation's elements use these names).
import type { EntityType } from '../levels/level';
import { ENTITY_TYPES } from '../levels/loader';

export interface EntityInfo {
  label: string;
  group: 'Props' | 'Inputs' | 'Receivers' | 'Logic' | 'Hazards' | 'Chamber' | 'Flavour';
  color: number;
  /** Marker box size (m) and how high its centre sits above the placement point. */
  size: [number, number, number];
  outputs: string[];
  inputs: string[];
  props: Record<string, unknown>;
}

const I = (label: string, group: EntityInfo['group'], color: number, size: [number, number, number], outputs: string[], inputs: string[], props: Record<string, unknown> = {}): EntityInfo => ({ label, group, color, size, outputs, inputs, props });

export const CATALOG: Record<EntityType, EntityInfo> = {
  cube: I('Weighted cube', 'Props', 0xc9ced3, [0.65, 0.65, 0.65], [], []),
  companionCube: I('Specimen case', 'Props', 0xe8b4c8, [0.65, 0.65, 0.65], [], []),
  sphere: I('Weighted sphere', 'Props', 0xb8c4cc, [0.6, 0.6, 0.6], [], []),
  debris: I('Debris', 'Props', 0x8d7b68, [0.4, 0.4, 0.4], [], [], { kind: 'chair' }),
  floorButton: I('Floor button', 'Inputs', 0xe0453a, [1.4, 0.15, 1.4], ['pressed'], [], { accepts: 'any' }),
  pedestalButton: I('Pedestal button', 'Inputs', 0xe0453a, [0.4, 1.1, 0.4], ['pressed'], [], { seconds: 0 }),
  pelletCatcher: I('Pellet catcher', 'Inputs', 0x7bd389, [0.9, 0.9, 0.9], ['powered'], []),
  door: I('Door', 'Receivers', 0x3a7bd5, [2, 2.6, 0.3], [], ['open']),
  platform: I('Moving platform', 'Receivers', 0x5d6d7e, [2, 0.3, 2], [], ['active'], { waypoints: [], speed: 2, loop: true }),
  lift: I('Lift', 'Receivers', 0x5d6d7e, [2, 0.3, 2], [], ['active'], { height: 4, speed: 1.5 }),
  panel: I('Moving panel', 'Receivers', 0x9aa5b1, [2, 2, 0.3], [], ['active'], { to: [0, 0, 0] }),
  indicator: I('Indicator strip', 'Receivers', 0x49c5e8, [0.3, 0.05, 0.3], [], ['on'], { path: [], icon: 'check' }),
  sign: I('Info sign', 'Chamber', 0xf4f4f4, [1.2, 1.6, 0.1], [], ['on']),
  gate: I('Logic gate', 'Logic', 0xb084f5, [0.4, 0.4, 0.4], ['out'], ['in'], { op: 'and', seconds: 0 }),
  entryElevator: I('Entry elevator', 'Chamber', 0x8fa3b0, [2.4, 3, 2.4], [], []),
  exitElevator: I('Exit elevator', 'Chamber', 0x37d67a, [2.4, 3, 2.4], [], ['open']),
  fixedPortal: I('Fixed opening', 'Chamber', 0x2f8cff, [1.2, 2.1, 0.1], [], ['active'], { which: 'a', normal: [0, 0, 1] }),
  pelletLauncher: I('Pellet launcher', 'Hazards', 0xf0c419, [0.9, 0.9, 0.9], [], ['active'], { direction: [0, 0, 1], life: 8 }),
  grill: I('Emancipation grill', 'Hazards', 0x8be9fd, [2, 2.5, 0.08], [], ['active'], { size: [2, 2.5], normal: [0, 0, 1] }),
  liquid: I('Toxic liquid', 'Hazards', 0x6ab04c, [4, 0.4, 4], [], [], { size: [4, 0.4, 4] }),
  crusher: I('Crusher', 'Hazards', 0x95a5a6, [2, 2, 1], [], ['active'], { travel: [0, 0, 2], period: 3 }),
  turret: I('Sentry turret', 'Hazards', 0xf5f6fa, [0.5, 1.1, 0.5], [], ['active']),
  rocketTurret: I('Rocket turret', 'Hazards', 0xd35400, [1, 1.4, 1], [], ['active']),
  disposal: I('Disposal unit', 'Chamber', 0x636e72, [1.6, 1.2, 1.6], ['filled'], []),
  bossCore: I('Overseer core', 'Chamber', 0xd63031, [3, 3, 3], [], []),
  light: I('Light', 'Flavour', 0xfff3b0, [0.3, 0.3, 0.3], [], ['on'], { color: 0xffffff, intensity: 1 }),
  decal: I('Decal / writing', 'Flavour', 0x2d3436, [1, 1, 0.05], [], [], { text: '', size: 1 }),
  commentaryNode: I('Commentary node', 'Flavour', 0xfdcb6e, [0.4, 0.4, 0.4], [], [], { text: '' }),
};

export const PALETTE_GROUPS: EntityInfo['group'][] = ['Props', 'Inputs', 'Receivers', 'Logic', 'Hazards', 'Chamber', 'Flavour'];

export function typesIn(group: EntityInfo['group']): EntityType[] {
  return ENTITY_TYPES.filter((t) => CATALOG[t].group === group);
}
