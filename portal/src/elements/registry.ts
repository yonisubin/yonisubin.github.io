// Entity type → element class. Unknown or not-yet-built types get a no-op element (so a chamber
// from a newer editor still loads).
import type { ChamberContext } from '../game/context';
import type { Entity, EntityType } from '../levels/level';
import { Gate } from '../logic/gate';
import { BaseElement } from './base';
import { BossCore, Disposal } from './boss';
import { FloorButton, PedestalButton } from './buttons';
import { EntryElevator, ExitElevator } from './elevators';
import type { Element } from './element';
import { FixedPortal } from './fixedPortal';
import { Grill, Liquid } from './hazards';
import { CommentaryNode, Decal, Indicator, LightElement, Sign } from './info';
import { Crusher, Door, Lift, Panel, Platform } from './movers';
import { PelletCatcher, PelletLauncher } from './pellets';
import { Cube, Debris, PhysProp, Sphere } from './prop';
import { RocketTurret, Turret } from './turret';
import { Chute, Erasure, ExitZone, Zone } from './story';

class Inert extends BaseElement {}

type Ctor = new (ctx: ChamberContext, e: Entity) => BaseElement;

const TYPES: Record<EntityType, Ctor> = {
  cube: Cube,
  companionCube: Cube,
  sphere: Sphere,
  debris: Debris,
  floorButton: FloorButton,
  pedestalButton: PedestalButton,
  door: Door,
  platform: Platform,
  lift: Lift,
  panel: Panel,
  gate: Gate,
  indicator: Indicator,
  sign: Sign,
  entryElevator: EntryElevator,
  exitElevator: ExitElevator,
  fixedPortal: FixedPortal,
  pelletLauncher: PelletLauncher,
  pelletCatcher: PelletCatcher,
  grill: Grill,
  liquid: Liquid,
  crusher: Crusher,
  turret: Turret,
  rocketTurret: RocketTurret,
  disposal: Disposal,
  bossCore: BossCore,
  light: LightElement,
  decal: Decal,
  commentaryNode: CommentaryNode,
  // Story elements (workstream B).
  zone: Zone,
  chute: Chute,
  exitZone: ExitZone,
  erasure: Erasure,
};

export function createElement(ctx: ChamberContext, entity: Entity): Element {
  const C = TYPES[entity.type] ?? Inert;
  const el = new C(ctx, entity);
  if (el instanceof PhysProp) el.init();
  return el;
}
