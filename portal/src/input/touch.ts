// On-screen touch controls for phones and tablets. They feed the same abstract Input as the
// keyboard, mouse and gamepad, so the player never knows whether touch is in use.
//
//   Left half   → floating joystick (the base appears under the thumb): analog move via setStick()
//   Right half  → drag to look: addLook() pixel deltas (camera sensitivity + invert Y apply)
//   Buttons     → Blue / Amber fire, Jump (held), Crouch (held; the toggle option works as on keys),
//                 Use (lit while a use prompt shows), Pause (top-left)
//
// Pointer Events tracked per pointerId let several fingers act at once (move + look + fire). Buttons
// stop propagation so they never start a stick or a look drag. The controls hide whenever gameplay
// input is off (menus, pause, editor). A dismissible hint asks to turn the phone sideways in portrait.
import type { EventBus } from '../core/events';
import { SHELL } from '../core/shellConfig';
import type { HeldAction, Input, PressAction } from './input';

const T = SHELL.touch;
const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

function div(cls: string, parent: HTMLElement, text = ''): HTMLDivElement {
  const e = document.createElement('div');
  e.className = cls;
  if (text) e.textContent = text;
  parent.appendChild(e);
  return e;
}

function capture(el: Element, id: number): void {
  // Synthetic events (tests) have no active pointer to capture; that's fine.
  try {
    el.setPointerCapture(id);
  } catch {
    /* ignore */
  }
}

export class TouchControls {
  readonly root: HTMLDivElement;
  readonly hint: HTMLDivElement;
  private readonly base: HTMLDivElement;
  private readonly knob: HTMLDivElement;
  readonly buttons: Record<'fireA' | 'fireB' | 'jump' | 'crouch' | 'use' | 'pause', HTMLDivElement>;
  /** Touch mode on (the shell decides: ui/device.ts). */
  private active = false;
  private shown = false;
  private hintDismissed = false;
  private stickId: number | null = null;
  private stickX0 = 0;
  private stickY0 = 0;
  private lookId: number | null = null;
  private lookX = 0;
  private lookY = 0;
  /** Buttons held down, by pointer id → the held action it holds. */
  private heldBy = new Map<number, HeldAction>();

  constructor(
    private readonly input: Input,
    events: EventBus,
    hudRoot: HTMLElement,
  ) {
    const root = (this.root = div('', hudRoot));
    root.id = 'touchControls';
    root.style.setProperty('--tb', `${T.buttonSize}px`);
    root.style.setProperty('--tgap', `${T.buttonGap}px`);
    root.style.setProperty('--tpause', `${T.pauseSize}px`);
    this.base = div('stickBase', root);
    this.base.style.width = this.base.style.height = `${T.stickRadius * 2}px`;
    this.knob = div('stickKnob', this.base);
    this.knob.style.width = this.knob.style.height = `${T.knobSize}px`;

    const cluster = div('touchCluster', root);
    const btn = (cls: string, label: string, parent: HTMLElement) => {
      const b = div(`touchBtn ${cls}`, parent, label);
      b.dataset.touch = cls;
      return b;
    };
    this.buttons = {
      use: btn('use', 'USE', cluster),
      fireA: btn('fireA', 'BLUE', cluster),
      fireB: btn('fireB', 'AMBER', cluster),
      crouch: btn('crouch', 'CROUCH', cluster),
      jump: btn('jump', 'JUMP', cluster),
      pause: btn('pause', 'II', root),
    };
    this.bindPress(this.buttons.fireA, 'fireA', true);
    this.bindPress(this.buttons.fireB, 'fireB', true);
    this.bindPress(this.buttons.use, 'use');
    this.bindPress(this.buttons.pause, 'pause');
    this.bindHeld(this.buttons.jump, 'jump');
    this.bindHeld(this.buttons.crouch, 'crouch');

    root.addEventListener('pointerdown', (e) => this.down(e));
    root.addEventListener('pointermove', (e) => this.move(e));
    for (const t of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) root.addEventListener(t, (e) => this.up(e));
    root.addEventListener('contextmenu', (e) => e.preventDefault());

    this.hint = div('', hudRoot);
    this.hint.id = 'rotateHint';
    this.hint.append(div('', this.hint, 'Turn your phone sideways for the best view'), div('small', this.hint, 'Tap to dismiss'));
    this.hint.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.hintDismissed = true;
      this.hint.style.display = 'none';
    });

    events.on('prompt', ({ text }) => this.buttons.use.classList.toggle('ready', !!text));
    events.on('chamberStart', () => this.buttons.use.classList.remove('ready'));
    this.show(false);
  }

  setActive(on: boolean): void {
    this.active = on;
    this.update();
  }

  /** Fire buttons take the opening palette. */
  setColors(a: number, b: number): void {
    this.buttons.fireA.style.setProperty('--c', hex(a));
    this.buttons.fireB.style.setProperty('--c', hex(b));
  }

  /** Called every frame by the shell: visible only in touch mode while gameplay input is on. */
  update(): void {
    const show = this.active && this.input.enabled;
    if (show !== this.shown) this.show(show);
    const portrait = window.innerHeight > window.innerWidth;
    this.hint.style.display = show && portrait && !this.hintDismissed ? 'block' : 'none';
  }

  get visible(): boolean {
    return this.shown;
  }

  private show(on: boolean): void {
    this.shown = on;
    this.root.style.display = on ? 'block' : 'none';
    if (!on) this.releaseAll();
  }

  private releaseAll(): void {
    this.stickId = this.lookId = null;
    this.base.style.display = 'none';
    this.input.setStick(0, 0);
    for (const a of this.heldBy.values()) this.input.setHeld(a, false);
    this.heldBy.clear();
    for (const b of Object.values(this.buttons)) b.classList.remove('down');
  }

  // --- Stick + look --------------------------------------------------------------------------

  private down(e: PointerEvent): void {
    e.preventDefault();
    if (e.clientX < window.innerWidth / 2) {
      if (this.stickId !== null) return;
      this.stickId = e.pointerId;
      this.stickX0 = e.clientX;
      this.stickY0 = e.clientY;
      this.base.style.display = 'block';
      this.base.style.left = `${e.clientX - T.stickRadius}px`;
      this.base.style.top = `${e.clientY - T.stickRadius}px`;
      this.knob.style.transform = 'translate(-50%, -50%)';
    } else {
      if (this.lookId !== null) return;
      this.lookId = e.pointerId;
      this.lookX = e.clientX;
      this.lookY = e.clientY;
    }
    capture(this.root, e.pointerId);
  }

  private move(e: PointerEvent): void {
    if (e.pointerId === this.stickId) {
      let x = (e.clientX - this.stickX0) / T.stickRadius;
      let y = (e.clientY - this.stickY0) / T.stickRadius;
      const m = Math.hypot(x, y);
      if (m > 1) {
        x /= m;
        y /= m;
      }
      this.knob.style.transform = `translate(calc(-50% + ${x * T.stickRadius}px), calc(-50% + ${y * T.stickRadius}px))`;
      // Rescale past the dead zone so the speed rises smoothly from 0 at its edge to 1 at the rim.
      const mm = Math.min(1, m);
      const k = mm < T.stickDeadZone ? 0 : (mm - T.stickDeadZone) / (1 - T.stickDeadZone) / (mm || 1);
      // Screen y grows downward; pushing up means forward.
      this.input.setStick(x * k, -y * k);
    } else if (e.pointerId === this.lookId) {
      this.input.addLook((e.clientX - this.lookX) * T.lookScale, (e.clientY - this.lookY) * T.lookScale);
      this.lookX = e.clientX;
      this.lookY = e.clientY;
    }
  }

  private up(e: PointerEvent): void {
    if (e.pointerId === this.stickId) {
      this.stickId = null;
      this.base.style.display = 'none';
      this.input.setStick(0, 0);
    } else if (e.pointerId === this.lookId) this.lookId = null;
  }

  // --- Buttons ---------------------------------------------------------------------------------

  private bindPress(b: HTMLElement, a: PressAction, fire = false): void {
    b.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      b.classList.add('down');
      this.input.press(a);
      if (fire && T.fireVibrateMs > 0) navigator.vibrate?.(T.fireVibrateMs);
    });
    const release = (e: Event) => {
      e.stopPropagation();
      b.classList.remove('down');
    };
    for (const t of ['pointerup', 'pointercancel', 'pointerleave'] as const) b.addEventListener(t, release);
  }

  private bindHeld(b: HTMLElement, a: HeldAction): void {
    b.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      capture(b, e.pointerId);
      b.classList.add('down');
      this.heldBy.set(e.pointerId, a);
      this.input.setHeld(a, true);
    });
    const release = (e: PointerEvent) => {
      e.stopPropagation();
      if (!this.heldBy.has(e.pointerId)) return;
      this.heldBy.delete(e.pointerId);
      // Another finger may still hold the same action.
      if (![...this.heldBy.values()].includes(a)) {
        this.input.setHeld(a, false);
        b.classList.remove('down');
      }
    };
    for (const t of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) b.addEventListener(t, release);
  }
}
