// Player state machine. Exactly one mode (OnFoot, later Driving / Flying) is active.
// Each mode owns its controller and camera rig; the game loop only talks to this class.

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
}

export class PlayerStateMachine {
  private current: PlayerMode | null = null;

  get mode(): PlayerMode | null {
    return this.current;
  }

  setMode(next: PlayerMode): void {
    if (next === this.current) return;
    this.current?.exit();
    this.current = next;
    next.enter();
  }

  update(dt: number): void {
    this.current?.update(dt);
  }

  render(alpha: number, frameDt: number): void {
    this.current?.render(alpha, frameDt);
  }
}
