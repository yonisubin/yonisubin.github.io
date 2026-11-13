// Abstract input layer. Controllers ask about actions ("moveForward", "jump"),
// never about physical keys. All key bindings live in this file.

export type Action =
  | 'moveForward'
  | 'moveBack'
  | 'moveLeft'
  | 'moveRight'
  | 'run'
  | 'jump'
  | 'interact';

// KeyboardEvent.code → action. `code` is layout-independent (physical key position),
// so WASD stays in the same place on AZERTY/Hebrew keyboards.
const KEY_BINDINGS: Record<string, Action> = {
  KeyW: 'moveForward',
  ArrowUp: 'moveForward',
  KeyS: 'moveBack',
  ArrowDown: 'moveBack',
  KeyA: 'moveLeft',
  ArrowLeft: 'moveLeft',
  KeyD: 'moveRight',
  ArrowRight: 'moveRight',
  ShiftLeft: 'run',
  ShiftRight: 'run',
  Space: 'jump',
  KeyE: 'interact',
};

/** Radians of camera rotation per pixel of mouse movement. */
const MOUSE_SENSITIVITY = 0.0025;

export class Input {
  private readonly held = new Set<Action>();
  /** Actions pressed since the last time they were consumed (edge-triggered). */
  private readonly pressed = new Set<Action>();
  private lookX = 0;
  private lookY = 0;
  private locked = false;

  constructor(private readonly element: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      const action = KEY_BINDINGS[e.code];
      if (!action) return;
      e.preventDefault(); // stop Space/arrows from scrolling the page
      if (!e.repeat) this.pressed.add(action);
      this.held.add(action);
    });
    window.addEventListener('keyup', (e) => {
      const action = KEY_BINDINGS[e.code];
      if (action) this.held.delete(action);
    });
    // Losing focus means we never see the keyup; drop everything so the player doesn't run off.
    window.addEventListener('blur', () => this.held.clear());

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.element;
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.lookX += e.movementX * MOUSE_SENSITIVITY;
      this.lookY += e.movementY * MOUSE_SENSITIVITY;
    });
  }

  get pointerLocked(): boolean {
    return this.locked;
  }

  requestPointerLock(): void {
    // Some browsers return a promise that rejects (e.g. too soon after Esc); ignore that.
    const result = this.element.requestPointerLock() as unknown;
    if (result instanceof Promise) result.catch(() => {});
  }

  isDown(action: Action): boolean {
    return this.held.has(action);
  }

  /**
   * True once per physical press. Consumed by the caller, so a press is never
   * lost or doubled no matter how many physics steps run in a frame.
   */
  consumePressed(action: Action): boolean {
    return this.pressed.delete(action);
  }

  /** Accumulated look delta (radians) since the last call. +x = right, +y = down. */
  consumeLook(): { x: number; y: number } {
    const look = { x: this.lookX, y: this.lookY };
    this.lookX = 0;
    this.lookY = 0;
    return look;
  }
}
