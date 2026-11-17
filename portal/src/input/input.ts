// Keyboard + mouse → abstract actions. Key bindings live only here; controllers read actions.
//
// Held actions (move, jump, crouch) are sampled each physics step. Pressed actions (fire, restart,
// debug) are edge-triggered: consumed once by whoever handles them.

export type HeldAction = 'forward' | 'back' | 'left' | 'right' | 'jump' | 'crouch';
export type PressAction = 'fireA' | 'fireB' | 'use' | 'restart' | 'debug';

const KEY_HELD: Record<string, HeldAction> = {
  KeyW: 'forward',
  ArrowUp: 'forward',
  KeyS: 'back',
  ArrowDown: 'back',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
  Space: 'jump',
  ControlLeft: 'crouch',
  ControlRight: 'crouch',
  KeyC: 'crouch',
};

const KEY_PRESS: Record<string, PressAction> = {
  KeyE: 'use',
  KeyR: 'restart',
  Backquote: 'debug',
  F3: 'debug',
};

export class Input {
  private held = new Set<HeldAction>();
  private pressed = new Set<PressAction>();
  /** Mouse movement since the last read (pixels). */
  private dx = 0;
  private dy = 0;
  locked = false;

  constructor(private readonly element: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      const h = KEY_HELD[e.code];
      const p = KEY_PRESS[e.code];
      if (h || p) e.preventDefault();
      if (h) this.held.add(h);
      if (p && !e.repeat) this.pressed.add(p);
    });
    window.addEventListener('keyup', (e) => {
      const h = KEY_HELD[e.code];
      if (h) this.held.delete(h);
    });
    window.addEventListener('blur', () => this.held.clear());
    element.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      if (e.button === 0) this.pressed.add('fireA');
      if (e.button === 2) this.pressed.add('fireB');
    });
    element.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.dx += e.movementX;
      this.dy += e.movementY;
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.element;
      if (!this.locked) this.held.clear();
    });
  }

  requestLock(): void {
    // Some browsers return a promise that rejects if the request is too soon after an exit.
    const r = this.element.requestPointerLock() as unknown as Promise<void> | undefined;
    r?.catch?.(() => undefined);
  }

  isHeld(a: HeldAction): boolean {
    return this.held.has(a);
  }

  /** Edge-triggered: true once per press. */
  consume(a: PressAction): boolean {
    if (!this.pressed.has(a)) return false;
    this.pressed.delete(a);
    return true;
  }

  /** Clears press events nobody consumed this frame (so a stale press doesn't fire later). */
  clearPressed(except: PressAction[] = []): void {
    for (const p of [...this.pressed]) if (!except.includes(p)) this.pressed.delete(p);
  }

  takeMouseDelta(): { dx: number; dy: number } {
    const d = { dx: this.dx, dy: this.dy };
    this.dx = 0;
    this.dy = 0;
    return d;
  }

  /** For tests / scripted runs: force an action on or off. */
  setHeld(a: HeldAction, on: boolean): void {
    if (on) this.held.add(a);
    else this.held.delete(a);
  }

  press(a: PressAction): void {
    this.pressed.add(a);
  }
}
