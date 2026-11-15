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
  private readonly routeInfo: HTMLDivElement;
  private readonly jobInfo: HTMLDivElement;
  private readonly hint: HTMLDivElement | null;
  private readonly healthFill: HTMLDivElement;
  private readonly moneyText: HTMLSpanElement;
  private readonly starsText: HTMLDivElement;
  private readonly bustBar: HTMLDivElement;
  private starsKey = '';
  private readonly weaponText: HTMLDivElement;
  private readonly crosshair: HTMLDivElement;
  private readonly scope: HTMLDivElement;
  private readonly vignette: HTMLDivElement;
  private readonly toastBox: HTMLDivElement;
  private readonly fade: HTMLDivElement;
  private readonly breathBar: HTMLDivElement;
  private readonly breathFill: HTMLDivElement;
  private readonly underwaterTint: HTMLDivElement;
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
    // Side job: what to do, time left, shift earnings (under the stats, top left).
    this.jobInfo = panel([
      'left:max(8px, env(safe-area-inset-left))',
      'top:calc(max(8px, env(safe-area-inset-top)) + 96px)',
      'font:600 14px/1.3 system-ui,sans-serif',
      'color:#ffe28a',
      'max-width:60vw',
    ]);
    this.routeInfo = panel([
      'right:max(12px, env(safe-area-inset-right))',
      `top:calc(max(10px, env(safe-area-inset-top)) + ${statusTop + 34}px)`,
      'font:600 15px/1.2 system-ui,sans-serif',
      'color:#f7b9fa',
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
    // Wanted level: five stars, lit ones gold; they blink while the police have lost you.
    this.starsText = document.createElement('div');
    this.starsText.style.cssText = 'font-size:20px;letter-spacing:2px;line-height:1.1;margin-top:3px;display:none;text-shadow:0 1px 2px rgba(0,0,0,0.8)';
    // Busted countdown (stopped next to a police car).
    this.bustBar = document.createElement('div');
    this.bustBar.style.cssText = 'height:6px;border-radius:3px;background:#3d7bff;margin-top:4px;display:none;width:0';
    statsPanel.append(bar, row, this.starsText, this.bustBar);

    // Breath (only while swimming under water or getting it back): a blue bar under health.
    this.breathBar = document.createElement('div');
    this.breathBar.style.cssText = 'height:7px;border-radius:4px;background:rgba(255,255,255,0.18);overflow:hidden;margin:4px 0 0;display:none';
    this.breathFill = document.createElement('div');
    this.breathFill.style.cssText = 'height:100%;width:100%;border-radius:4px;background:#5ac8fa';
    this.breathBar.appendChild(this.breathFill);
    statsPanel.appendChild(this.breathBar);

    // Blue-green tint while the camera is under water.
    this.underwaterTint = document.createElement('div');
    this.underwaterTint.style.cssText =
      'position:fixed;inset:0;pointer-events:none;z-index:13;display:none;background:radial-gradient(circle at 50% 40%, rgba(20,110,130,0.25), rgba(5,40,60,0.6))';
    document.body.appendChild(this.underwaterTint);

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

    // Scope view: black outside a circle, with fine cross-hairs.
    this.scope = document.createElement('div');
    this.scope.style.cssText = [
      'position:fixed',
      'inset:0',
      'pointer-events:none',
      'z-index:14',
      'display:none',
      'background:radial-gradient(circle at center, transparent 0, transparent 37vmin, rgba(0,0,0,0.92) 38vmin)',
    ].join(';');
    const hair = (css: string) => {
      const line = document.createElement('div');
      line.style.cssText = `position:absolute;background:rgba(0,0,0,0.85);${css}`;
      this.scope.appendChild(line);
    };
    hair('left:50%;top:calc(50% - 37vmin);width:2px;height:74vmin;margin-left:-1px');
    hair('top:50%;left:calc(50% - 37vmin);height:2px;width:74vmin;margin-top:-1px');
    document.body.appendChild(this.scope);

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
    else this.clickToPlay = createClickToPlay(input, () => this.clickToPlayHidden);
  }

  private clickToPlay: HTMLDivElement | null = null;
  private clickToPlayHidden = false;

  /** Hide the "Click to play" overlay while another screen (the character picker) is up. */
  hideClickToPlay(hidden: boolean): void {
    this.clickToPlayHidden = hidden;
    if (this.clickToPlay) this.clickToPlay.style.display = hidden ? 'none' : 'flex';
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
    const ap = stats.apAmmo[w.id];
    const weapon = w.melee ? w.name : `${w.name} ${stats.ammo[w.id]}${ap ? ` +${ap} AP` : ''}`;
    if (this.weaponText.textContent !== weapon) this.weaponText.textContent = weapon;
    const scoped = mode.scopedIn?.() ?? false;
    const showCrosshair = mode.name === 'OnFoot' && !w.melee && !scoped;
    this.crosshair.style.display = showCrosshair ? '' : 'none';
    this.scope.style.display = scoped ? '' : 'none';

    this.flash = Math.max(0, this.flash - frameDt * 1.8);
    this.vignette.style.opacity = this.flash.toFixed(2);
  }

  /** Breath left (0…1), or null to hide the bar. Turns red when nearly out. */
  setBreath(fraction: number | null): void {
    this.breathBar.style.display = fraction === null ? 'none' : '';
    if (fraction === null) return;
    this.breathFill.style.width = `${(fraction * 100).toFixed(1)}%`;
    this.breathFill.style.background = fraction > 0.25 ? '#5ac8fa' : '#ff3b30';
  }

  setUnderwater(on: boolean): void {
    const display = on ? '' : 'none';
    if (this.underwaterTint.style.display !== display) this.underwaterTint.style.display = display;
  }

  /** Red flash, stronger for bigger hits. */
  hurt(amount: number): void {
    this.flash = Math.min(1, this.flash + 0.25 + amount / 40);
  }

  /** Wanted stars (0 hides them); `evading` blinks them. `bust` is 0…1 toward being busted. */
  setWanted(stars: number, evading: boolean, bust: number | null): void {
    const blinkOff = evading && Math.floor(performance.now() / 400) % 2 === 1;
    const key = `${stars}:${blinkOff}`;
    if (key !== this.starsKey) {
      this.starsKey = key;
      this.starsText.style.display = stars > 0 ? '' : 'none';
      let html = '';
      for (let k = 0; k < 5; k++) html += `<span style="color:${k < stars && !blinkOff ? '#ffd23f' : 'rgba(255,255,255,0.28)'}">★</span>`;
      this.starsText.innerHTML = html;
    }
    this.bustBar.style.display = bust === null ? 'none' : '';
    if (bust !== null) this.bustBar.style.width = `${Math.min(100, bust * 100).toFixed(0)}%`;
  }

  /** Side-job line (null hides it). */
  setJob(text: string | null): void {
    setText(this.jobInfo, text);
  }

  /** Distance left on the route (m), or null to hide it. */
  setRoute(metres: number | null): void {
    setText(this.routeInfo, metres === null ? null : `⚑ ${metres >= 1000 ? `${(metres / 1000).toFixed(1)} km` : `${Math.round(metres / 10) * 10} m`}`);
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
function createClickToPlay(input: Input, hidden: () => boolean): HTMLDivElement {
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
      E — get in / out of cars and the helicopter &nbsp;·&nbsp; M — map &nbsp;·&nbsp; P — change your look &nbsp;·&nbsp; Esc — release mouse<br />C — dive when swimming &nbsp;·&nbsp; J — side job (in a taxi, ambulance or van) &nbsp;·&nbsp; R — car radio &nbsp;·&nbsp; N — sound on/off
    </div>`;
  overlay.addEventListener('click', () => input.requestPointerLock());
  document.body.appendChild(overlay);

  document.addEventListener('pointerlockchange', () => {
    overlay.style.display = input.pointerLocked || hidden() ? 'none' : 'flex';
  });
  return overlay;
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
