// The interface every test element implements (buttons, doors, platforms, pellets, turrets...).
// Part of the CONTRACT: the wiring graph (logic/) only talks to elements through this.
import type { Entity, EntityType } from '../levels/level';

export interface Element {
  readonly id: string;
  readonly type: EntityType;
  readonly entity: Entity;
  /** Current output values, e.g. { pressed: true } for a button. */
  readonly outputs: Readonly<Record<string, boolean>>;
  /** Named inputs this element listens to (e.g. 'open' for a door, 'active' for a platform). */
  readonly inputs: readonly string[];
  setInput(name: string, value: boolean): void;
  /** Fixed-step update (dt = 1/60 s). */
  update(dt: number): void;
  /** Plain JSON state for saves; restore() must reproduce it exactly. */
  snapshot(): unknown;
  restore(state: unknown): void;
  /** Remove meshes / colliders and free GPU resources. */
  dispose(): void;
}
