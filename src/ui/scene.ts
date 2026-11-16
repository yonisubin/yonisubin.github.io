import * as THREE from 'three';
import type { Input } from '../input/actions';
import type { CharacterModel } from '../player/character';

// Story dialogue scenes: a panel along the bottom with the speaker's name (in their colour)
// and their line typing itself out, then — sometimes — two or three choices.
//
//   Space / Enter / E / click / tap   finish typing the line, or go to the next one
//   1 / 2 / 3 or click a choice        pick it
//   Esc                                skip to the choice (or the end)
//
// While a scene plays, game input is blocked (one block on Input's counter) and, if the
// speaker is standing nearby, the camera frames the two of you: from the side, a little
// above eye height, looking at the point between your heads (a classic "two-shot").

export interface SceneLine {
  /** Who's talking (a name, already resolved), their colour, and their model if it's in the world. */
  name: string;
  color: string;
  model: CharacterModel | null;
  text: string;
}

const TYPE_SPEED = 55; // characters per second

export class SceneUI {
  private readonly panel: HTMLDivElement;
  private readonly nameEl: HTMLDivElement;
  private readonly textEl: HTMLDivElement;
  private readonly choicesEl: HTMLDivElement;
  private readonly hintEl: HTMLDivElement;
  private lines: SceneLine[] = [];
  private index = 0;
  private shown = 0; // characters typed so far
  private choices: string[] = [];
  private resolve: ((choice: number | null) => void) | null = null;
  private talking: CharacterModel | null = null;
  /** Where the camera frames the scene (speaker feet), or null to leave the camera alone. */
  private focus: THREE.Vector3 | null = null;
  /** Which way the speaker faces (toward the street): the camera stays on that side. */
  private facing = 0;
  private readonly from = new THREE.Vector3();
  private readonly look = new THREE.Vector3();

  constructor(
    private readonly camera: THREE.Camera,
    private readonly input: Input,
    /** The player's feet, for framing. */
    private readonly playerFeet: () => THREE.Vector3,
    private readonly touch: boolean,
    /** Told when a scene opens / closes (e.g. hide the "Click to play" overlay meanwhile). */
    private readonly onToggle: (open: boolean) => void = () => {},
  ) {
    this.panel = document.createElement('div');
    this.panel.style.cssText = [
      'position:fixed',
      'left:50%',
      'bottom:max(18px, env(safe-area-inset-bottom))',
      'transform:translateX(-50%)',
      'z-index:58',
      'width:min(640px, calc(100vw - 24px))',
      'padding:14px 18px 12px',
      'border-radius:16px',
      'background:rgba(14,15,19,0.92)',
      'box-shadow:0 8px 30px rgba(0,0,0,0.45)',
      'color:#fff',
      'font:17px/1.45 system-ui,sans-serif',
      'display:none',
      'cursor:pointer',
      'user-select:none',
    ].join(';');
    this.nameEl = document.createElement('div');
    this.nameEl.style.cssText = 'font-weight:800;font-size:14px;letter-spacing:0.04em;text-transform:uppercase;margin-bottom:4px';
    this.textEl = document.createElement('div');
    this.textEl.style.cssText = 'min-height:2.9em';
    this.choicesEl = document.createElement('div');
    this.choicesEl.style.cssText = 'display:flex;flex-direction:column;gap:6px;margin-top:10px';
    this.hintEl = document.createElement('div');
    this.hintEl.style.cssText = 'margin-top:6px;font-size:12px;opacity:0.55;text-align:right';
    this.hintEl.textContent = touch ? 'Tap to continue' : 'Space to continue · Esc to skip';
    this.panel.append(this.nameEl, this.textEl, this.choicesEl, this.hintEl);
    // Taps and clicks on the panel advance the scene and must not reach the game below.
    for (const type of ['pointerdown', 'mousedown', 'touchstart']) this.panel.addEventListener(type, (e) => e.stopPropagation());
    this.panel.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!this.choicesShowing) this.advance(); // the choice itself needs 1–3 or a click on it
    });
    document.body.appendChild(this.panel);
    // Game keys are blocked during a scene, so the scene listens for its own.
    window.addEventListener('keydown', (e) => {
      if (!this.active || e.repeat) return;
      if (e.code === 'Space' || e.code === 'Enter' || e.code === 'KeyE') {
        e.preventDefault();
        if (!this.choicesShowing) this.advance(); // the choice itself needs 1–3 or a click on it
      } else if (e.code === 'Escape') {
        e.preventDefault();
        this.skip();
      } else if (/^Digit[1-3]$/.test(e.code) && this.choicesShowing) {
        const k = Number(e.code.slice(5)) - 1;
        if (k < this.choices.length) this.pick(k);
      }
    });
  }

  get active(): boolean {
    return this.resolve !== null;
  }

  private get typing(): boolean {
    const line = this.lines[this.index];
    return !!line && this.shown < line.text.length;
  }

  private get onLastLine(): boolean {
    return this.index >= this.lines.length - 1;
  }

  /** The choices are on screen (waiting for 1–3). */
  get choicesShowing(): boolean {
    return this.onLastLine && !this.typing && this.choices.length > 0;
  }

  /**
   * Play lines; resolves with the chosen option's index (or null if there were no choices)
   * when the scene ends. `focus` is the speaker's feet if they're standing nearby.
   */
  play(lines: SceneLine[], choices: string[] = [], focus: THREE.Vector3 | null = null, facing = 0): Promise<number | null> {
    if (this.resolve) this.finish(null); // one scene at a time
    if (!lines.length && !choices.length) return Promise.resolve(null);
    this.lines = lines.length ? lines : [{ name: '', color: '#fff', model: null, text: '' }];
    this.choices = choices;
    this.index = 0;
    this.shown = 0;
    this.focus = focus && focus.distanceTo(this.playerFeet()) < 30 ? focus.clone() : null;
    this.facing = facing;
    this.input.setBlocked(true);
    this.onToggle(true); // before releasing the mouse, so "Click to play" doesn't pop up over us
    this.input.exitPointerLock();
    this.panel.style.display = '';
    this.showLine();
    return new Promise((resolve) => (this.resolve = resolve));
  }

  /** Esc: jump to the end of the scene (to the choices if there are any). */
  skip(): void {
    if (!this.active) return;
    this.index = this.lines.length - 1;
    this.shown = this.lines[this.index].text.length;
    this.showLine();
    if (!this.choices.length) this.finish(null);
  }

  private advance(): void {
    const line = this.lines[this.index];
    if (this.typing) {
      this.shown = line.text.length; // finish the line first
      this.render();
      return;
    }
    if (!this.onLastLine) {
      this.index++;
      this.shown = 0;
      this.showLine();
      return;
    }
    if (!this.choices.length) this.finish(null);
  }

  private pick(k: number): void {
    this.finish(k);
  }

  private finish(choice: number | null): void {
    const resolve = this.resolve;
    this.resolve = null;
    this.setTalking(null);
    this.panel.style.display = 'none';
    this.choicesEl.innerHTML = '';
    this.focus = null;
    this.input.setBlocked(false);
    this.onToggle(false);
    if (!this.touch) this.input.requestPointerLock();
    resolve?.(choice);
  }

  private showLine(): void {
    const line = this.lines[this.index];
    this.nameEl.textContent = line.name;
    this.nameEl.style.color = line.color;
    this.setTalking(line.model);
    this.render();
  }

  private setTalking(model: CharacterModel | null): void {
    if (this.talking && this.talking !== model) this.talking.setTalking(false);
    this.talking = model;
    model?.setTalking(true);
  }

  private render(): void {
    const line = this.lines[this.index];
    this.textEl.textContent = line.text.slice(0, Math.floor(this.shown));
    const showChoices = this.choicesShowing;
    this.hintEl.style.display = showChoices ? 'none' : '';
    if (showChoices && !this.choicesEl.childElementCount) {
      this.choices.forEach((label, k) => {
        const b = document.createElement('button');
        b.textContent = this.touch ? label : `${k + 1}. ${label}`;
        b.style.cssText = 'text-align:left;padding:9px 12px;border:1px solid rgba(255,255,255,0.18);border-radius:10px;background:rgba(255,255,255,0.08);color:#fff;font:600 15px system-ui,sans-serif;cursor:pointer';
        for (const type of ['pointerdown', 'mousedown', 'touchstart']) b.addEventListener(type, (e) => e.stopPropagation());
        b.addEventListener('click', (e) => {
          e.stopPropagation();
          this.pick(k);
        });
        this.choicesEl.appendChild(b);
      });
    } else if (!showChoices) {
      this.choicesEl.innerHTML = '';
    }
  }

  /** Call every frame, after the player's camera (it takes the camera over while framing). */
  update(frameDt: number): void {
    if (!this.active) return;
    const line = this.lines[this.index];
    if (this.shown < line.text.length) {
      this.shown = Math.min(line.text.length, this.shown + frameDt * TYPE_SPEED);
      this.render();
    }
    if (!this.focus) return;
    // Two-shot: from the side of the line between you, looking at the point between your
    // heads. Of its two sides, use the one toward the street (where the speaker faces):
    // behind them there are walls, signs and shop fronts in the way.
    const p = this.playerFeet();
    const f = this.focus;
    const mx = (p.x + f.x) / 2;
    const mz = (p.z + f.z) / 2;
    let dx = f.x - p.x;
    let dz = f.z - p.z;
    const l = Math.hypot(dx, dz) || 1;
    dx /= l;
    dz /= l;
    // Perpendicular to the line between you, pointing toward the street (−sin, −cos of facing).
    let sx = -dz;
    let sz = dx;
    if (sx * -Math.sin(this.facing) + sz * -Math.cos(this.facing) < 0) {
      sx = -sx;
      sz = -sz;
    }
    const side = 3 + l * 0.6;
    this.from.set(mx + sx * side, Math.max(p.y, f.y) + 1.9, mz + sz * side);
    this.look.set(mx, (p.y + f.y) / 2 + 1.15, mz);
    this.camera.position.lerp(this.from, Math.min(1, frameDt * 6));
    this.camera.lookAt(this.look);
  }
}
