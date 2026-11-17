// What elements see of the running chamber. One context per loaded chamber; everything it holds
// (meshes in `group`, bodies and colliders in `physics`) is thrown away when the chamber unloads.
import type * as THREE from 'three';
import type { EventBus, GameEvents } from '../core/events';
import type { Element } from '../elements/element';
import type { Entity, LevelData } from '../levels/level';
import type { Physics } from '../physics/world';
import type { PortalSystem } from '../portals/portals';
import type { Player } from '../player/controller';
import type { Effects } from '../render/effects';

export type DeathCause = GameEvents['death']['cause'];

/** Settings the simulation reads every step (pushed in by `applySettings`). */
export interface RuntimeSettings {
  portalColors: { a: number; b: number };
  assist: boolean;
  reduceFlashing: boolean;
  highContrastHazards: boolean;
}

export interface ChamberContext {
  readonly level: LevelData;
  readonly physics: Physics;
  readonly portals: PortalSystem;
  readonly player: Player;
  readonly events: EventBus;
  /** Every mesh an element adds goes in here (removed and disposed on unload). */
  readonly group: THREE.Group;
  readonly effects: Effects;
  readonly settings: RuntimeSettings;
  readonly elements: Map<string, Element>;
  /** Seconds since the chamber started (simulated). */
  time(): number;
  /** Tell the wiring an element's output changed. */
  outputChanged(el: Element): void;
  /** Damage the player (bullets, rockets). */
  hurt(amount: number, cause: DeathCause): void;
  /** Kill the player right away (pellets, liquid, crushers, pits). */
  kill(cause: DeathCause): void;
  playerDead(): boolean;
  /** The prop the player is carrying (or null). */
  heldId(): string | null;
  /** Make the player drop what they carry (without throwing it). */
  forceDrop(): void;
  sfx(name: string, caption?: string): void;
  /** The level id (or its name when it has none). */
  chamberId(): string;
  /** The player stepped into the exit elevator: freeze the counters and emit `exitReached`. */
  reachExit(): void;
  /** Ask for a death-free respawn-safe random number in [0, 1) (deterministic per chamber, saved). */
  random(): number;
  /** Create an element at runtime (boss parts); it lives until the chamber unloads. */
  spawn(entity: Entity): Element;
}
