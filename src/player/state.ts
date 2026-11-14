import type * as THREE from 'three';
import type { Action, Input } from '../input/actions';

// Player state machine. Exactly one mode (OnFoot, Driving, Flying) is active.
// Each mode owns its controller and camera rig; the game loop only talks to this class.
// Modes hand control to each other with setMode() (e.g. on foot → a car's driving mode).

/** An on-screen button for touch devices, defined by the mode that needs it. */
export interface TouchButton {
  /** Text on the button; a function for labels that change (ENTER / TALK / SHOP…). */
  label: string | (() => string);
  action: Action;
  /** Shown only while this returns true (e.g. ENTER only near a vehicle). */
  visible?: () => boolean;
}

export interface PlayerMode {
  readonly name: string;
  enter(): void;
  exit(): void;
  /** Fixed-timestep update, called once per physics step *before* world.step(). */
  update(dt: number): void;
  /**
   * Called once per rendered frame after physics.
   * `alpha` ∈ [0, 1) is how far we are between the previous and current physics state,
   * used to interpolate meshes. `frameDt` is the real frame time (for camera smoothing).
   */
  render(alpha: number, frameDt: number): void;
  /** Where the player currently is (drives shadows, NPC spawning). */
  focus(): THREE.Vector3;
  /** Contextual prompt, e.g. "E — drive". Null when there's nothing to say. */
  prompt(): string | null;
  /** Status readout, e.g. speed. Null for none. */
  status(): string | null;
  /** One-line keyboard controls summary for this mode. */
  readonly controlsHint: string;
  /** Buttons shown on touch screens (besides the joystick and look area). */
  readonly touchButtons: TouchButton[];
}

export class PlayerStateMachine {
  private current: PlayerMode | null = null;
  private readonly listeners: ((mode: PlayerMode) => void)[] = [];

  constructor(private readonly input: Input) {}

  get mode(): PlayerMode | null {
    return this.current;
  }

  onChange(listener: (mode: PlayerMode) => void): void {
    this.listeners.push(listener);
  }

  setMode(next: PlayerMode): void {
    if (next === this.current) return;
    this.current?.exit();
    this.current = next;
    this.input.clearPressed();
    next.enter();
    for (const l of this.listeners) l(next);
  }

  update(dt: number): void {
    this.current?.update(dt);
  }

  render(alpha: number, frameDt: number): void {
    this.current?.render(alpha, frameDt);
  }
}
