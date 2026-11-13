import type { Input } from './actions';

// On-screen controls for phones and tablets. They feed the same abstract Input as the
// keyboard and mouse, so player controllers never know whether touch is in use.
//
//   Left half  → floating joystick (move; push to the edge to run)
//   Right half → drag to look around
//   Button     → jump
//
// Pointer Events with per-pointerId tracking let several fingers act at once
// (e.g. move with the left thumb while looking with the right).

const STICK_RADIUS = 60; // px, how far the knob can travel from the base centre
const STICK_DEADZONE = 0.12; // fraction of radius ignored, so a resting thumb doesn't drift
const TOUCH_LOOK_SENSITIVITY = 0.006; // rad per px dragged
const BASE_SIZE = STICK_RADIUS * 2;
const KNOB_SIZE = 56; // px
const JUMP_SIZE = 76; // px
const EDGE = 'max(24px, env(safe-area-inset-left))'; // keep clear of notches/rounded corners

/**
 * True when the primary pointer is a finger (phones, tablets). Touchscreen laptops
 * report a fine primary pointer (the trackpad/mouse), so they keep mouse controls.
 */
export function isTouchDevice(): boolean {
  return window.matchMedia('(pointer: coarse)').matches;
}

export class TouchControls {
  private readonly root: HTMLDivElement;
  private readonly base: HTMLDivElement;
  private readonly knob: HTMLDivElement;
  private readonly jump: HTMLDivElement;

  private stickPointer: number | null = null;
  private stickOriginX = 0;
  private stickOriginY = 0;
  private lookPointer: number | null = null;
  private lookLastX = 0;
  private lookLastY = 0;
  private jumpPointer: number | null = null;

  constructor(private readonly input: Input) {
    this.root = el('div', [
      'position:fixed',
      'inset:0',
      'z-index:10',
      'touch-action:none', // we handle every gesture; no browser scroll/zoom
      'user-select:none',
      '-webkit-user-select:none',
      '-webkit-touch-callout:none',
    ]);

    this.base = el('div', [
      'position:absolute',
      `width:${BASE_SIZE}px`,
      `height:${BASE_SIZE}px`,
      'border-radius:50%',
      'background:rgba(255,255,255,0.12)',
      'border:2px solid rgba(255,255,255,0.35)',
      'pointer-events:none',
      'transition:opacity 0.15s',
    ]);
    this.knob = el('div', [
      'position:absolute',
      `width:${KNOB_SIZE}px`,
      `height:${KNOB_SIZE}px`,
      `left:${(BASE_SIZE - KNOB_SIZE) / 2 - 2}px`,
      `top:${(BASE_SIZE - KNOB_SIZE) / 2 - 2}px`,
      'border-radius:50%',
      'background:rgba(255,255,255,0.55)',
      'box-shadow:0 2px 8px rgba(0,0,0,0.3)',
    ]);
    this.base.appendChild(this.knob);

    this.jump = el('div', [
      'position:absolute',
      `width:${JUMP_SIZE}px`,
      `height:${JUMP_SIZE}px`,
      'right:max(28px, env(safe-area-inset-right))',
      'bottom:max(36px, env(safe-area-inset-bottom))',
      'border-radius:50%',
      'background:rgba(255,255,255,0.22)',
      'border:2px solid rgba(255,255,255,0.5)',
      'color:#fff',
      'font:600 14px system-ui,sans-serif',
      'display:flex',
      'align-items:center',
      'justify-content:center',
      'letter-spacing:0.05em',
    ]);
    this.jump.textContent = 'JUMP';

    this.root.append(this.base, this.jump);
    document.body.appendChild(this.root);
    this.showIdleStick();

    this.jump.addEventListener('pointerdown', (e) => {
      e.stopPropagation(); // don't also start a look drag
      this.jumpPointer = e.pointerId;
      this.jump.setPointerCapture(e.pointerId);
      this.jump.style.background = 'rgba(255,255,255,0.45)';
      this.input.pressAction('jump');
    });
    const endJump = (e: PointerEvent) => {
      if (e.pointerId !== this.jumpPointer) return;
      this.jumpPointer = null;
      this.jump.style.background = 'rgba(255,255,255,0.22)';
      this.input.releaseAction('jump');
    };
    this.jump.addEventListener('pointerup', endJump);
    this.jump.addEventListener('pointercancel', endJump);

    this.root.addEventListener('pointerdown', (e) => this.onDown(e));
    this.root.addEventListener('pointermove', (e) => this.onMove(e));
    this.root.addEventListener('pointerup', (e) => this.onUp(e));
    this.root.addEventListener('pointercancel', (e) => this.onUp(e));
    // A long-press would otherwise open the context menu on some Android browsers.
    this.root.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private onDown(e: PointerEvent): void {
    e.preventDefault();
    this.root.setPointerCapture(e.pointerId);
    if (e.clientX < window.innerWidth / 2) {
      if (this.stickPointer !== null) return;
      // Floating joystick: the base appears wherever the thumb lands.
      this.stickPointer = e.pointerId;
      this.stickOriginX = e.clientX;
      this.stickOriginY = e.clientY;
      this.placeBase(e.clientX, e.clientY, 1);
      this.updateStick(e.clientX, e.clientY);
    } else {
      if (this.lookPointer !== null) return;
      this.lookPointer = e.pointerId;
      this.lookLastX = e.clientX;
      this.lookLastY = e.clientY;
    }
  }

  private onMove(e: PointerEvent): void {
    if (e.pointerId === this.stickPointer) {
      this.updateStick(e.clientX, e.clientY);
    } else if (e.pointerId === this.lookPointer) {
      const dx = e.clientX - this.lookLastX;
      const dy = e.clientY - this.lookLastY;
      this.lookLastX = e.clientX;
      this.lookLastY = e.clientY;
      this.input.addLook(dx * TOUCH_LOOK_SENSITIVITY, dy * TOUCH_LOOK_SENSITIVITY);
    }
  }

  private onUp(e: PointerEvent): void {
    if (e.pointerId === this.stickPointer) {
      this.stickPointer = null;
      this.input.setStick(0, 0);
      this.showIdleStick();
    } else if (e.pointerId === this.lookPointer) {
      this.lookPointer = null;
    }
  }

  /** Convert the thumb's offset from the base centre into a stick value in the unit circle. */
  private updateStick(x: number, y: number): void {
    let dx = x - this.stickOriginX;
    let dy = y - this.stickOriginY;
    const dist = Math.hypot(dx, dy);
    if (dist > STICK_RADIUS) {
      dx *= STICK_RADIUS / dist;
      dy *= STICK_RADIUS / dist;
    }
    this.knob.style.transform = `translate(${dx}px, ${dy}px)`;

    // Remap [deadzone, 1] → [0, 1] so movement starts smoothly just past the deadzone.
    const mag = Math.min(dist / STICK_RADIUS, 1);
    if (mag < STICK_DEADZONE) {
      this.input.setStick(0, 0);
      return;
    }
    const scaled = (mag - STICK_DEADZONE) / (1 - STICK_DEADZONE);
    const nx = dx / (mag * STICK_RADIUS);
    const ny = dy / (mag * STICK_RADIUS);
    // Screen y grows downward; pushing the stick up means "forward".
    this.input.setStick(nx * scaled, -ny * scaled);
  }

  private placeBase(cx: number, cy: number, opacity: number): void {
    this.base.style.left = `${cx - BASE_SIZE / 2}px`;
    this.base.style.top = `${cy - BASE_SIZE / 2}px`;
    this.base.style.right = '';
    this.base.style.bottom = '';
    this.base.style.opacity = String(opacity);
  }

  /** Faded stick in the bottom-left corner so players can see where to put their thumb. */
  private showIdleStick(): void {
    this.knob.style.transform = '';
    this.base.style.left = EDGE;
    this.base.style.top = '';
    this.base.style.bottom = 'max(28px, env(safe-area-inset-bottom))';
    this.base.style.opacity = '0.5';
  }
}

function el(tag: 'div', styles: string[]): HTMLDivElement {
  const node = document.createElement(tag);
  node.style.cssText = styles.join(';');
  return node;
}
