import type { Input } from '../input/actions';
import type { PlayerMode } from '../player/state';

// On-screen text: "Click to play" (desktop), the current mode's prompt ("E — drive"),
// a status readout (speed / altitude) and a one-line controls hint.

const PANEL = [
  'position:fixed',
  'z-index:20',
  'padding:6px 12px',
  'border-radius:8px',
  'background:rgba(0,0,0,0.45)',
  'color:#fff',
  'font:15px/1.4 system-ui,sans-serif',
  'pointer-events:none',
  'white-space:nowrap',
];

function panel(extra: string[]): HTMLDivElement {
  const el = document.createElement('div');
  el.style.cssText = [...PANEL, ...extra].join(';');
  el.style.display = 'none';
  document.body.appendChild(el);
  return el;
}

function setText(el: HTMLDivElement, text: string | null): void {
  const display = text ? '' : 'none';
  if (el.style.display !== display) el.style.display = display;
  if (text && el.textContent !== text) el.textContent = text;
}

export class Hud {
  private readonly prompt: HTMLDivElement;
  private readonly status: HTMLDivElement;
  private readonly hint: HTMLDivElement | null;

  /** `statusTop`: px from the top for the status readout (it sits under the minimap). */
  constructor(input: Input, touch: boolean, statusTop: number) {
    this.prompt = panel([
      'left:50%',
      'transform:translateX(-50%)',
      touch ? 'top:max(56px, env(safe-area-inset-top))' : 'bottom:22%',
      'font-size:17px',
      'font-weight:600',
    ]);
    this.status = panel([
      'right:max(12px, env(safe-area-inset-right))',
      `top:calc(max(10px, env(safe-area-inset-top)) + ${statusTop}px)`,
      'font:600 20px/1.2 ui-monospace,monospace',
    ]);
    this.hint = touch ? null : panel(['left:12px', 'bottom:12px', 'font-size:13px', 'opacity:0.85']);
    if (touch) showTouchHint();
    else createClickToPlay(input);
  }

  /** Call once per frame. */
  update(mode: PlayerMode): void {
    // On touch screens the context buttons (ENTER/EXIT) do the job of the key prompt.
    setText(this.prompt, this.hint ? mode.prompt() : null);
    setText(this.status, mode.status());
    if (this.hint) setText(this.hint, mode.controlsHint);
  }
}

/** Mouse look needs pointer lock, which browsers only grant in response to a click. */
function createClickToPlay(input: Input): void {
  const overlay = document.createElement('div');
  overlay.style.cssText = [
    'position:fixed',
    'inset:0',
    'z-index:40',
    'display:flex',
    'flex-direction:column',
    'align-items:center',
    'justify-content:center',
    'gap:12px',
    'background:rgba(0,0,0,0.45)',
    'color:#fff',
    'font:16px/1.6 system-ui,sans-serif',
    'text-align:center',
    'cursor:pointer',
    'user-select:none',
  ].join(';');
  overlay.innerHTML = `
    <div style="font-size:28px;font-weight:600">Click to play</div>
    <div style="opacity:0.85">
      WASD — move &nbsp;·&nbsp; Shift — run &nbsp;·&nbsp; Space — jump &nbsp;·&nbsp; Mouse — look<br />
      E — get in / out of cars and the helicopter &nbsp;·&nbsp; Esc — release mouse
    </div>`;
  overlay.addEventListener('click', () => input.requestPointerLock());
  document.body.appendChild(overlay);

  document.addEventListener('pointerlockchange', () => {
    overlay.style.display = input.pointerLocked ? 'none' : 'flex';
  });
}

/** Brief controls hint for touch devices; fades out on its own. */
function showTouchHint(): void {
  const hint = document.createElement('div');
  hint.style.cssText = [
    'position:fixed',
    'top:max(16px, env(safe-area-inset-top))',
    'left:50%',
    'transform:translateX(-50%)',
    'z-index:20',
    'padding:8px 14px',
    'border-radius:999px',
    'background:rgba(0,0,0,0.5)',
    'color:#fff',
    'font:14px/1.4 system-ui,sans-serif',
    'white-space:nowrap',
    'pointer-events:none',
    'transition:opacity 1s',
  ].join(';');
  hint.textContent = 'Left: move · Right: look · ENTER near a car';
  document.body.appendChild(hint);
  setTimeout(() => (hint.style.opacity = '0'), 5000);
  setTimeout(() => hint.remove(), 6500);
}
