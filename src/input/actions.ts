// Abstract input layer. Controllers ask about actions ("moveForward", "jump"),
// never about physical keys. All key bindings live in this file.

export type Action =
  | 'moveForward'
  | 'moveBack'
  | 'moveLeft'
  | 'moveRight'
  | 'run'
  | 'jump'
  | 'interact'
  | 'handbrake'
  | 'ascend'
  | 'descend'
  | 'toggleDebug';

// KeyboardEvent.code → actions. `code` is layout-independent (physical key position),
// so WASD stays in the same place on AZERTY/Hebrew keyboards. A key can trigger several
// actions; each player mode only reads the ones it cares about (Space = jump on foot,
// handbrake in a car, climb in the helicopter).
// Movement keys feed moveAxis(), which cars and the helicopter use for steering too.
const KEY_BINDINGS: Record<string, Action[]> = {
  KeyW: ['moveForward'],
  ArrowUp: ['moveForward'],
  KeyS: ['moveBack'],
  ArrowDown: ['moveBack'],
  KeyA: ['moveLeft'],
  ArrowLeft: ['moveLeft'],
  KeyD: ['moveRight'],
  ArrowRight: ['moveRight'],
  ShiftLeft: ['run', 'descend'],
  ShiftRight: ['run', 'descend'],
  Space: ['jump', 'handbrake', 'ascend'],
  KeyE: ['interact'],
  F3: ['toggleDebug'],
  Backquote: ['toggleDebug'],
};

/** Radians of camera rotation per pixel of mouse movement. */
const MOUSE_SENSITIVITY = 0.0025;

/** Joystick deflection (0–1) beyond which the analog stick counts as "run". */
const STICK_RUN_THRESHOLD = 0.85;

export class Input {
  private readonly held = new Set<Action>();
  /** Actions pressed since the last time they were consumed (edge-triggered). */
  private readonly pressed = new Set<Action>();
  private lookX = 0;
  private lookY = 0;
  private locked = false;
  /** Analog stick from on-screen touch controls; x = right, y = forward, length ≤ 1. */
  private stickX = 0;
  private stickY = 0;

  constructor(private readonly element: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      const actions = KEY_BINDINGS[e.code];
      if (!actions) return;
      e.preventDefault(); // stop Space/arrows from scrolling the page
      for (const action of actions) {
        if (!e.repeat) this.pressed.add(action);
        this.held.add(action);
      }
    });
    window.addEventListener('keyup', (e) => {
      for (const action of KEY_BINDINGS[e.code] ?? []) this.held.delete(action);
    });
    // Losing focus means we never see the keyup; drop everything so the player doesn't run off.
    window.addEventListener('blur', () => {
      this.held.clear();
      this.setStick(0, 0);
    });

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
    if (action === 'run' && Math.hypot(this.stickX, this.stickY) > STICK_RUN_THRESHOLD) return true;
    return this.held.has(action);
  }

  /**
   * Movement direction as a 2D axis: x = right, y = forward, length ≤ 1.
   * Keyboard gives full-length (normalized) directions; the touch stick is analog,
   * so a half-pushed stick returns length ≈ 0.5.
   */
  moveAxis(): { x: number; y: number } {
    let x = Number(this.held.has('moveRight')) - Number(this.held.has('moveLeft'));
    let y = Number(this.held.has('moveForward')) - Number(this.held.has('moveBack'));
    x += this.stickX;
    y += this.stickY;
    const len = Math.hypot(x, y);
    if (len > 1) {
      x /= len; // diagonals aren't faster
      y /= len;
    }
    return { x, y };
  }

  // --- Hooks for on-screen touch controls (input/touch.ts) ---

  setStick(x: number, y: number): void {
    this.stickX = x;
    this.stickY = y;
  }

  /** Add camera rotation in radians (+x = right, +y = down), same convention as the mouse. */
  addLook(dx: number, dy: number): void {
    this.lookX += dx;
    this.lookY += dy;
  }

  pressAction(action: Action): void {
    if (!this.held.has(action)) this.pressed.add(action);
    this.held.add(action);
  }

  releaseAction(action: Action): void {
    this.held.delete(action);
  }

  /**
   * True once per physical press. Consumed by the caller, so a press is never
   * lost or doubled no matter how many physics steps run in a frame.
   */
  consumePressed(action: Action): boolean {
    return this.pressed.delete(action);
  }

  /**
   * Forget presses nobody consumed. Called on mode changes, so e.g. the Space press that
   * meant "handbrake" in the car doesn't turn into a jump the moment you step out.
   */
  clearPressed(): void {
    this.pressed.clear();
  }

  /** Accumulated look delta (radians) since the last call. +x = right, +y = down. */
  consumeLook(): { x: number; y: number } {
    const look = { x: this.lookX, y: this.lookY };
    this.lookX = 0;
    this.lookY = 0;
    return look;
  }
}
