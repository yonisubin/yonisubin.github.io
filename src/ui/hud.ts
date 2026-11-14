import type { Input } from '../input/actions';
import type { PlayerMode } from '../player/state';
import { MAX_HEALTH, type PlayerStats } from '../game/stats';

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
  private readonly healthFill: HTMLDivElement;
  private readonly moneyText: HTMLSpanElement;
  private readonly weaponText: HTMLDivElement;
  private readonly crosshair: HTMLDivElement;
  private readonly vignette: HTMLDivElement;
  private readonly toastBox: HTMLDivElement;
  private readonly fade: HTMLDivElement;
  private flash = 0;
  private toastTimer = 0;

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

    // Health bar, cash and weapon (top left).
    const statsPanel = panel([
      'left:max(8px, env(safe-area-inset-left))',
      'top:max(8px, env(safe-area-inset-top))',
      'width:170px',
      'font:600 14px/1.3 system-ui,sans-serif',
    ]);
    statsPanel.style.display = '';
    const bar = document.createElement('div');
    bar.style.cssText = 'height:9px;border-radius:5px;background:rgba(255,255,255,0.18);overflow:hidden;margin:2px 0 5px';
    this.healthFill = document.createElement('div');
    this.healthFill.style.cssText = 'height:100%;width:100%;border-radius:5px;background:#4cd964;transition:width 0.15s';
    bar.appendChild(this.healthFill);
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;justify-content:space-between';
    this.moneyText = document.createElement('span');
    this.moneyText.style.cssText = 'color:#8ff0a4;font-family:ui-monospace,monospace';
    this.weaponText = document.createElement('div');
    this.weaponText.style.cssText = 'opacity:0.9;font-weight:500';
    row.append(this.moneyText, this.weaponText);
    statsPanel.append(bar, row);

    // Crosshair for guns: a small ring in the centre of the screen.
    this.crosshair = document.createElement('div');
    this.crosshair.style.cssText = [
      'position:fixed',
      'left:50%',
      'top:50%',
      'width:14px',
      'height:14px',
      'margin:-7px 0 0 -7px',
      'border:2px solid rgba(255,255,255,0.85)',
      'border-radius:50%',
      'box-shadow:0 0 3px rgba(0,0,0,0.6)',
      'pointer-events:none',
      'z-index:20',
      'display:none',
    ].join(';');
    document.body.appendChild(this.crosshair);

    // Red edge flash when hurt.
    this.vignette = document.createElement('div');
    this.vignette.style.cssText = [
      'position:fixed',
      'inset:0',
      'pointer-events:none',
      'z-index:15',
      'opacity:0',
      'box-shadow:inset 0 0 120px 30px rgba(220,0,0,0.85)',
    ].join(';');
    document.body.appendChild(this.vignette);

    // Short messages ("+$40", "You need a weapon...") above the prompt.
    this.toastBox = panel(['left:50%', 'transform:translateX(-50%)', 'bottom:30%', 'font-size:18px', 'font-weight:700']);

    // Fade to black on death.
    this.fade = document.createElement('div');
    this.fade.style.cssText = [
      'position:fixed',
      'inset:0',
      'z-index:50',
      'background:#000',
      'opacity:0',
      'transition:opacity 0.8s',
      'pointer-events:none',
      'display:flex',
      'align-items:center',
      'justify-content:center',
      'color:#d33',
      'font:700 34px system-ui,sans-serif',
    ].join(';');
    document.body.appendChild(this.fade);

    if (touch) showTouchHint();
    else createClickToPlay(input);
  }

  /** Call once per frame. */
  update(mode: PlayerMode, stats: PlayerStats, frameDt: number): void {
    // On touch screens the context buttons (ENTER/EXIT) do the job of the key prompt.
    setText(this.prompt, this.hint ? mode.prompt() : null);
    setText(this.status, mode.status());
    if (this.hint) setText(this.hint, mode.controlsHint);

    const h = stats.health / MAX_HEALTH;
    this.healthFill.style.width = `${(h * 100).toFixed(1)}%`;
    this.healthFill.style.background = h > 0.5 ? '#4cd964' : h > 0.25 ? '#ffcc00' : '#ff3b30';
    const money = `$${stats.money}`;
    if (this.moneyText.textContent !== money) this.moneyText.textContent = money;
    const w = stats.weapon;
    const weapon = w.melee ? w.name : `${w.name} ${stats.ammo[w.id]}`;
    if (this.weaponText.textContent !== weapon) this.weaponText.textContent = weapon;
    const showCrosshair = mode.name === 'OnFoot' && !w.melee;
    this.crosshair.style.display = showCrosshair ? '' : 'none';

    this.flash = Math.max(0, this.flash - frameDt * 1.8);
    this.vignette.style.opacity = this.flash.toFixed(2);
  }

  /** Red flash, stronger for bigger hits. */
  hurt(amount: number): void {
    this.flash = Math.min(1, this.flash + 0.25 + amount / 40);
  }

  toast(text: string, seconds = 1.6): void {
    setText(this.toastBox, text);
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => setText(this.toastBox, null), seconds * 1000);
  }

  /** Fade to black with a message, or back again. */
  setFade(on: boolean, text = ''): void {
    this.fade.textContent = text;
    this.fade.style.opacity = on ? '1' : '0';
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
