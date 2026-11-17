// Keyboard + mouse + gamepad → abstract actions. Key bindings live only here; controllers read actions.
//
// Held actions (move, jump, crouch) are sampled each physics step. Pressed actions (fire, restart,
// debug, pause, quicksave...) are edge-triggered: consumed once by whoever handles them (the
// simulation consumes fire/use/restart/debug, the shell consumes pause/quicksave/quickload).
//
// Bindings are rebindable (options menu) and stored in localStorage `twinfold:bindings`. Each action
// has up to two codes: KeyboardEvent.code values, or 'Mouse0' / 'Mouse1' / 'Mouse2' for buttons.
import { SHELL } from '../core/shellConfig';

export type HeldAction = 'forward' | 'back' | 'left' | 'right' | 'jump' | 'crouch';
export type PressAction = 'fireA' | 'fireB' | 'use' | 'restart' | 'debug' | 'pause' | 'quicksave' | 'quickload';
export type Action = HeldAction | PressAction;

export const HELD_ACTIONS: readonly HeldAction[] = ['forward', 'back', 'left', 'right', 'jump', 'crouch'];
export const PRESS_ACTIONS: readonly PressAction[] = ['fireA', 'fireB', 'use', 'restart', 'debug', 'pause', 'quicksave', 'quickload'];

/** What the options menu shows for each action. */
export const ACTION_LABELS: Record<Action, string> = {
  forward: 'Move forward',
  back: 'Move back',
  left: 'Strafe left',
  right: 'Strafe right',
  jump: 'Jump',
  crouch: 'Crouch',
  fireA: 'Fire blue opening',
  fireB: 'Fire amber opening',
  use: 'Use / pick up',
  restart: 'Restart chamber',
  debug: 'Debug overlay',
  pause: 'Pause',
  quicksave: 'Quicksave',
  quickload: 'Quickload',
};

export type Bindings = Record<Action, string[]>;

export const DEFAULT_BINDINGS: Bindings = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  jump: ['Space'],
  crouch: ['ControlLeft', 'KeyC'],
  fireA: ['Mouse0'],
  fireB: ['Mouse2'],
  use: ['KeyE'],
  restart: ['KeyR'],
  debug: ['Backquote', 'F3'],
  pause: ['Escape', 'KeyP'],
  quicksave: ['F5'],
  quickload: ['F9'],
};

/** A short readable name for a code ("KeyW" → "W", "Mouse0" → "Left click"). */
export function codeLabel(code: string | undefined): string {
  if (!code) return '—';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  const named: Record<string, string> = {
    Mouse0: 'Left click',
    Mouse1: 'Middle click',
    Mouse2: 'Right click',
    Space: 'Space',
    ControlLeft: 'Ctrl',
    ControlRight: 'Right Ctrl',
    ShiftLeft: 'Shift',
    ShiftRight: 'Right Shift',
    AltLeft: 'Alt',
    Backquote: '`',
    Escape: 'Esc',
    ArrowUp: '↑',
    ArrowDown: '↓',
    ArrowLeft: '←',
    ArrowRight: '→',
  };
  return named[code] ?? code;
}

function loadBindings(): Bindings {
  const b: Bindings = JSON.parse(JSON.stringify(DEFAULT_BINDINGS));
  try {
    const raw = localStorage.getItem(SHELL.storage.bindings);
    if (raw) {
      const saved = JSON.parse(raw) as Partial<Bindings>;
      for (const k of Object.keys(b) as Action[]) {
        const v = saved[k];
        if (Array.isArray(v) && v.every((c) => typeof c === 'string')) b[k] = v.slice(0, 2);
      }
    }
  } catch {
    /* storage blocked: defaults */
  }
  return b;
}

const isHeldAction = (a: Action): a is HeldAction => (HELD_ACTIONS as readonly string[]).includes(a);

export class Input {
  private held = new Set<HeldAction>();
  private padHeld = new Set<HeldAction>();
  private pressed = new Set<PressAction>();
  /** Mouse movement since the last read (pixels). */
  private dx = 0;
  private dy = 0;
  locked = false;
  bindings: Bindings = loadBindings();
  private codeMap = new Map<string, Action[]>();
  /** When false (menus, pause), gameplay keys are ignored and held actions are released. */
  private enabledFlag = true;
  /** Crouch toggles on press instead of being held (options). */
  toggleCrouch = false;
  /** Scales mouse deltas (used by the dev session for the sensitivity option) and flips Y. */
  lookScale = 1;
  invertY = false;
  /** Gamepad look sensitivity multiplier (options). Aim assist: none, by design. */
  gamepadSensitivity = 1;
  gamepadConnected = false;
  private padPrev: boolean[] = [];
  /** Set while the options menu waits for a key to bind. */
  private capture: ((code: string) => void) | null = null;

  constructor(private readonly element: HTMLElement) {
    this.rebuildMap();
    window.addEventListener('keydown', (e) => {
      if (this.capture) {
        e.preventDefault();
        const cb = this.capture;
        this.capture = null;
        cb(e.code);
        return;
      }
      if (this.isTyping(e)) return;
      const acts = this.codeMap.get(e.code);
      // Function keys the game uses must not reload the page / open dev tools.
      // (In menus the keys keep their normal meaning: Space presses buttons, arrows scroll.)
      if ((acts && this.enabledFlag) || e.code === 'F5' || e.code === 'F9') e.preventDefault();
      if (acts) for (const a of acts) this.down(a, e.repeat);
    });
    window.addEventListener('keyup', (e) => {
      for (const a of this.codeMap.get(e.code) ?? []) this.up(a);
    });
    window.addEventListener('blur', () => this.held.clear());
    element.addEventListener('mousedown', (e) => {
      if (this.capture) {
        e.preventDefault();
        const cb = this.capture;
        this.capture = null;
        cb(`Mouse${e.button}`);
        return;
      }
      if (!this.locked) return;
      for (const a of this.codeMap.get(`Mouse${e.button}`) ?? []) this.down(a, false);
    });
    element.addEventListener('mouseup', (e) => {
      for (const a of this.codeMap.get(`Mouse${e.button}`) ?? []) this.up(a);
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
    window.addEventListener('gamepadconnected', () => (this.gamepadConnected = true));
    window.addEventListener('gamepaddisconnected', () => (this.gamepadConnected = navigator.getGamepads?.().some((g) => !!g) ?? false));
  }

  private isTyping(e: KeyboardEvent): boolean {
    const t = e.target as HTMLElement | null;
    return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
  }

  private down(a: Action, repeat: boolean): void {
    if (isHeldAction(a)) {
      if (!this.enabledFlag) return;
      if (a === 'crouch' && this.toggleCrouch) {
        if (repeat) return;
        if (this.held.has('crouch')) this.held.delete('crouch');
        else this.held.add('crouch');
        return;
      }
      this.held.add(a);
      return;
    }
    if (repeat) return;
    // Pause and quickload work from menus too; everything else only in play.
    if (!this.enabledFlag && a !== 'pause' && a !== 'quickload') return;
    this.pressed.add(a);
  }

  private up(a: Action): void {
    if (isHeldAction(a) && !(a === 'crouch' && this.toggleCrouch)) this.held.delete(a);
  }

  private rebuildMap(): void {
    this.codeMap.clear();
    for (const [a, codes] of Object.entries(this.bindings) as [Action, string[]][]) {
      for (const c of codes) {
        const list = this.codeMap.get(c) ?? [];
        list.push(a);
        this.codeMap.set(c, list);
      }
    }
  }

  get enabled(): boolean {
    return this.enabledFlag;
  }

  set enabled(on: boolean) {
    this.enabledFlag = on;
    if (!on) {
      this.held.clear();
      this.padHeld.clear();
      this.dx = this.dy = 0;
    }
  }

  // --- Rebinding ------------------------------------------------------------------------------

  /** Bind `code` to `action` in slot 0 or 1. The code is removed from any other action first. */
  rebind(action: Action, slot: 0 | 1, code: string): void {
    for (const a of Object.keys(this.bindings) as Action[]) this.bindings[a] = this.bindings[a].filter((c) => c !== code);
    const list = this.bindings[action].slice();
    list[slot] = code;
    this.bindings[action] = list.filter(Boolean);
    this.rebuildMap();
    this.saveBindings();
  }

  resetBindings(): void {
    this.bindings = JSON.parse(JSON.stringify(DEFAULT_BINDINGS));
    this.rebuildMap();
    this.saveBindings();
  }

  /** The next key or mouse button pressed goes to `cb` instead of the game. */
  captureNext(cb: ((code: string) => void) | null): void {
    this.capture = cb;
  }

  /** Feed a code as if pressed/released (tests, touch). */
  feed(code: string, down: boolean): void {
    for (const a of this.codeMap.get(code) ?? []) (down ? this.down(a, false) : this.up(a));
  }

  private saveBindings(): void {
    try {
      localStorage.setItem(SHELL.storage.bindings, JSON.stringify(this.bindings));
    } catch {
      /* ignore */
    }
  }

  // --- Pointer lock ---------------------------------------------------------------------------

  requestLock(): void {
    // Some browsers return a promise that rejects if the request is too soon after an exit.
    try {
      const r = this.element.requestPointerLock() as unknown as Promise<void> | undefined;
      r?.catch?.(() => undefined);
    } catch {
      /* not allowed here */
    }
  }

  exitLock(): void {
    if (document.pointerLockElement === this.element) document.exitPointerLock();
  }

  // --- Reading actions ------------------------------------------------------------------------

  isHeld(a: HeldAction): boolean {
    return this.held.has(a) || this.padHeld.has(a);
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
    this.pollGamepad();
    const s = this.lookScale;
    const d = { dx: this.dx * s, dy: this.dy * s * (this.invertY ? -1 : 1) };
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

  // --- Gamepad (standard mapping) ---------------------------------------------------------------
  // Left stick moves, right stick looks, A jump, B crouch, X use, LT/LB blue, RT/RB amber,
  // Start pause, Back restart. No aim assist.

  pollGamepad(): void {
    const pads = navigator.getGamepads?.() ?? [];
    const pad = [...pads].find((p): p is Gamepad => !!p && p.connected);
    this.padHeld.clear();
    if (!pad) return;
    this.gamepadConnected = true;
    const dz = SHELL.gamepad.deadZone;
    const axis = (i: number) => {
      const v = pad.axes[i] ?? 0;
      return Math.abs(v) < dz ? 0 : (v - Math.sign(v) * dz) / (1 - dz);
    };
    if (!this.enabledFlag) {
      this.padEdges(pad);
      return;
    }
    const lx = axis(0), ly = axis(1);
    if (ly < -0.3) this.padHeld.add('forward');
    if (ly > 0.3) this.padHeld.add('back');
    if (lx < -0.3) this.padHeld.add('left');
    if (lx > 0.3) this.padHeld.add('right');
    const px = SHELL.gamepad.lookPixels * this.gamepadSensitivity;
    // Square the stick for fine aim near the centre.
    const rx = axis(2), ry = axis(3);
    this.dx += Math.sign(rx) * rx * rx * px;
    this.dy += Math.sign(ry) * ry * ry * px;
    const b = (i: number) => !!pad.buttons[i]?.pressed;
    if (b(0)) this.padHeld.add('jump');
    if (b(1)) this.padHeld.add('crouch');
    this.padEdges(pad);
  }

  private padEdges(pad: Gamepad): void {
    const edges: [number, PressAction][] = [
      [2, 'use'],
      [4, 'fireA'],
      [6, 'fireA'],
      [5, 'fireB'],
      [7, 'fireB'],
      [9, 'pause'],
      [8, 'restart'],
    ];
    for (const [i, a] of edges) {
      const now = !!pad.buttons[i]?.pressed;
      if (now && !this.padPrev[i] && (this.enabledFlag || a === 'pause')) this.pressed.add(a);
      this.padPrev[i] = now;
    }
  }
}
