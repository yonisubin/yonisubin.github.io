// The shell's part of the HUD, driven by bus events: use prompt (`prompt`), red damage vignette
// (`damage`), subtitles and closed captions (dialogue manager), challenge timer / counters, the
// chamber-complete / elevator card and small toasts ("Saved"). It sits in the same #hud root as the
// crosshair (ui/hud.ts), whose colours and visibility it also controls (palette, indicator option).
import type { EventBus } from '../core/events';
import { SHELL } from '../core/shellConfig';
import type { SubtitleView } from '../dialogue/manager';

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

function el(tag: string, id: string, parent: HTMLElement, cls = ''): HTMLDivElement {
  const e = document.createElement(tag) as HTMLDivElement;
  e.id = id;
  if (cls) e.className = cls;
  parent.appendChild(e);
  return e;
}

export class ShellHud {
  readonly prompt: HTMLDivElement;
  readonly vignette: HTMLDivElement;
  readonly subtitles: HTMLDivElement;
  readonly captions: HTMLDivElement;
  readonly challenge: HTMLDivElement;
  readonly card: HTMLDivElement;
  readonly toastEl: HTMLDivElement;
  private vignetteLevel = 0;
  private captionTimers: { el: HTMLElement; until: number }[] = [];
  private toastUntil = 0;
  hintsEnabled = true;
  reduceFlashing = false;

  constructor(private readonly root: HTMLElement) {
    this.vignette = el('div', 'vignette', root);
    this.prompt = el('div', 'prompt', root);
    this.subtitles = el('div', 'subtitles', root);
    this.captions = el('div', 'captions', root);
    this.challenge = el('div', 'challengeHud', root);
    this.card = el('div', 'chamberCard', root);
    this.toastEl = el('div', 'toast', root);
    this.hide();
  }

  connect(events: EventBus): () => void {
    const offs = [
      events.on('prompt', ({ text }) => this.setPrompt(text)),
      events.on('damage', ({ amount }) => this.hurt(amount)),
      events.on('death', () => this.hurt(100)),
      events.on('chamberStart', () => {
        this.setPrompt(null);
        this.vignetteLevel = 0;
      }),
    ];
    return () => offs.forEach((f) => f());
  }

  private hide(): void {
    this.prompt.style.display = 'none';
    this.challenge.style.display = 'none';
    this.card.style.display = 'none';
    this.toastEl.style.display = 'none';
    this.subtitles.style.display = 'none';
  }

  setPrompt(text: string | null): void {
    const show = !!text && this.hintsEnabled;
    this.prompt.style.display = show ? 'block' : 'none';
    this.prompt.textContent = show ? text : '';
  }

  /** Red vignette whose strength follows the damage taken, fading out. */
  hurt(amount: number): void {
    const max = this.reduceFlashing ? SHELL.hud.vignetteMax * 0.5 : SHELL.hud.vignetteMax;
    this.vignetteLevel = Math.min(max, this.vignetteLevel + 0.25 + amount / 40);
  }

  get vignetteOpacity(): number {
    return this.vignetteLevel;
  }

  showSubtitle(s: SubtitleView | null): void {
    if (!s) {
      this.subtitles.style.display = 'none';
      this.subtitles.textContent = '';
      return;
    }
    this.subtitles.style.display = 'block';
    this.subtitles.innerHTML = '';
    const who = document.createElement('span');
    who.className = 'speaker';
    who.textContent = `${s.speaker}: `;
    this.subtitles.append(who, document.createTextNode(s.text));
  }

  caption(text: string): void {
    const line = document.createElement('div');
    line.textContent = text;
    this.captions.appendChild(line);
    this.captionTimers.push({ el: line, until: performance.now() / 1000 + SHELL.dialogue.captionSeconds });
    while (this.captions.childElementCount > 4) this.captions.firstElementChild?.remove();
  }

  /** Crosshair colours (palette) and whether the half-rings show which portals are placed. */
  setCrosshair(a: number, b: number, indicator: boolean): void {
    const paths = this.root.querySelectorAll<SVGPathElement>('#crosshair path');
    // ui/hud.ts creates the left (first colour) arc, then the right one.
    paths[0]?.setAttribute('stroke', hex(a));
    paths[1]?.setAttribute('stroke', hex(b));
    paths.forEach((p) => (p.style.visibility = indicator ? 'visible' : 'hidden'));
  }

  setChallenge(text: string | null): void {
    this.challenge.style.display = text ? 'block' : 'none';
    this.challenge.textContent = text ?? '';
  }

  /** The chamber-complete / elevator card. */
  showCard(title: string, lines: string[], sub = ''): void {
    this.card.innerHTML = '';
    const h = document.createElement('h2');
    h.textContent = title;
    this.card.appendChild(h);
    for (const l of lines) {
      const p = document.createElement('div');
      p.textContent = l;
      this.card.appendChild(p);
    }
    if (sub) {
      const s = document.createElement('div');
      s.className = 'sub';
      s.textContent = sub;
      this.card.appendChild(s);
    }
    this.card.style.display = 'block';
  }

  hideCard(): void {
    this.card.style.display = 'none';
  }

  toast(text: string): void {
    this.toastEl.textContent = text;
    this.toastEl.style.display = 'block';
    this.toastUntil = performance.now() / 1000 + 1.8;
  }

  update(dt: number): void {
    this.vignetteLevel = Math.max(0, this.vignetteLevel - dt / SHELL.hud.vignetteFade);
    this.vignette.style.opacity = this.vignetteLevel.toFixed(3);
    const now = performance.now() / 1000;
    this.captionTimers = this.captionTimers.filter((c) => {
      if (now < c.until) return true;
      c.el.remove();
      return false;
    });
    if (this.toastUntil && now > this.toastUntil) {
      this.toastEl.style.display = 'none';
      this.toastUntil = 0;
    }
  }
}
