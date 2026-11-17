// Trigger volumes and checkpoints from the level data. A trigger fires (`trigger` event with its
// event name) when the player enters its box — every entry, or only the first with `once`.
// Entering a checkpoint box makes it the current checkpoint (once per checkpoint): the chamber then
// emits `checkpoint` and autosaves.
import type * as THREE from 'three';
import type { Checkpoint, Trigger, Vec3 } from '../levels/level';

export interface TriggerState {
  inside: string[];
  fired: string[];
  reached: string[];
}

function inBox(p: THREE.Vector3, min: Vec3, max: Vec3): boolean {
  return p.x >= min[0] && p.x <= max[0] && p.y >= min[1] && p.y <= max[1] && p.z >= min[2] && p.z <= max[2];
}

export class Triggers {
  private inside = new Set<string>();
  private fired = new Set<string>();
  private reached = new Set<string>();

  constructor(
    private readonly triggers: readonly Trigger[],
    private readonly checkpoints: readonly Checkpoint[],
    private readonly onTrigger: (t: Trigger) => void,
    private readonly onCheckpoint: (c: Checkpoint) => void,
  ) {}

  /** `p`: a point of the player (the capsule centre). */
  update(p: THREE.Vector3): void {
    for (const t of this.triggers) {
      const now = inBox(p, t.min, t.max);
      const was = this.inside.has(t.id);
      if (now && !was) {
        this.inside.add(t.id);
        if (!(t.once && this.fired.has(t.id))) {
          this.fired.add(t.id);
          this.onTrigger(t);
        }
      } else if (!now && was) this.inside.delete(t.id);
    }
    for (const c of this.checkpoints) {
      if (this.reached.has(c.id) || !inBox(p, c.min, c.max)) continue;
      this.reached.add(c.id);
      this.onCheckpoint(c);
    }
  }

  /** Mark a checkpoint as already reached (starting from it). */
  markReached(id: string): void {
    this.reached.add(id);
  }

  snapshot(): TriggerState {
    return { inside: [...this.inside], fired: [...this.fired], reached: [...this.reached] };
  }

  restore(s: TriggerState): void {
    this.inside = new Set(s.inside);
    this.fired = new Set(s.fired);
    this.reached = new Set(s.reached);
  }
}
