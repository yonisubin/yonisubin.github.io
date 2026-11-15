import * as THREE from 'three';
import type { Input } from '../input/actions';
import type { CharacterModel } from '../player/character';
import { HAIR_COLORS, OUTFIT_SHIFTS, SKIN_TONES, type CharacterLibrary, type Look } from '../player/characterLibrary';

// "Choose your character": pick one of the people in the roster and their skin tone, hair
// colour and outfit colour. While it's open the camera circles the player for a preview.
// The choice is saved in the browser and used next time.

const STORAGE_KEY = 'city.look.v1';
const DEFAULT_LOOK: Look = { id: 'm_hoodie', skin: 2, hair: 1, outfit: 0, height: 1.78 };
const HEIGHT = { male: 1.78, female: 1.66 } as const;

/** The saved look, or a default one. */
export function loadLook(library: CharacterLibrary): Look {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Look | null;
    if (saved && library.characters.some((c) => c.id === saved.id)) return saved;
  } catch {
    // Storage unavailable (private mode) or corrupt: use the default.
  }
  return DEFAULT_LOOK;
}

/** True the very first time (no saved character yet). */
export function hasSavedLook(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== null;
  } catch {
    return true; // can't remember anything; don't nag every visit
  }
}

function saveLook(look: Look): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(look));
  } catch {
    // Not saved; fine.
  }
}

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

export class CharacterPicker {
  private readonly panel: HTMLDivElement;
  private look: Look;
  private open_ = false;
  private angle = 0;
  private building = 0; // guards against an older model finishing after a newer one

  constructor(
    private readonly library: CharacterLibrary,
    private readonly input: Input,
    private readonly camera: THREE.PerspectiveCamera,
    /** Where the player stands (feet). */
    private readonly playerFeet: () => THREE.Vector3,
    /** Facing of the player's body, so the preview starts from the front. */
    private readonly playerFacing: () => number,
    /** Give the player a new body. */
    private readonly setModel: (model: CharacterModel) => void,
    /** Only offered while on foot. */
    private readonly canOpen: () => boolean,
    /** Called when the picker opens/closes (e.g. hide the "click to play" overlay). */
    private readonly onToggle: (open: boolean) => void,
    touch: boolean,
  ) {
    this.look = loadLook(library);
    this.panel = document.createElement('div');
    this.panel.style.cssText = [
      'position:fixed',
      'left:50%',
      'bottom:max(12px, env(safe-area-inset-bottom))',
      'transform:translateX(-50%)',
      'z-index:45',
      'width:min(440px, calc(100vw - 24px))',
      'max-height:60vh',
      'overflow:auto',
      'padding:14px 16px',
      'border-radius:14px',
      'background:rgba(20,22,26,0.9)',
      'color:#fff',
      'font:15px/1.4 system-ui,sans-serif',
      'display:none',
    ].join(';');
    for (const type of ['pointerdown', 'mousedown', 'click']) this.panel.addEventListener(type, (e) => e.stopPropagation());
    document.body.appendChild(this.panel);

    if (touch) {
      // A small button under the health panel to reopen it on touch screens.
      const button = document.createElement('button');
      button.textContent = 'LOOK';
      button.style.cssText = [
        'position:fixed',
        'left:max(8px, env(safe-area-inset-left))',
        'top:calc(max(8px, env(safe-area-inset-top)) + 58px)',
        'z-index:21',
        'padding:5px 10px',
        'border:1px solid rgba(255,255,255,0.5)',
        'border-radius:8px',
        'background:rgba(0,0,0,0.45)',
        'color:#fff',
        'font:600 12px system-ui,sans-serif',
      ].join(';');
      for (const type of ['pointerdown', 'mousedown']) button.addEventListener(type, (e) => e.stopPropagation());
      button.addEventListener('click', () => this.toggle());
      document.body.appendChild(button);
    }
  }

  get isOpen(): boolean {
    return this.open_;
  }

  private keysHooked = false;

  toggle(): void {
    if (this.open_) this.close();
    else this.open();
  }

  open(): void {
    if (this.open_ || !this.canOpen()) return;
    // While the picker is open game input is blocked, so its own P / Esc listener closes it
    // (like the full map's).
    if (!this.keysHooked) {
      this.keysHooked = true;
      window.addEventListener('keydown', (e) => {
        if (!this.open_ || (e.code !== 'KeyP' && e.code !== 'Escape') || e.repeat) return;
        e.preventDefault();
        this.close();
      });
    }
    this.open_ = true;
    this.angle = this.playerFacing(); // start in front of the character (see update())
    this.input.setBlocked(true);
    this.input.exitPointerLock();
    this.onToggle(true);
    this.draw();
    this.panel.style.display = '';
  }

  close(): void {
    if (!this.open_) return;
    this.open_ = false;
    this.panel.style.display = 'none';
    this.input.setBlocked(false);
    saveLook(this.look);
    this.onToggle(false);
    this.input.requestPointerLock(); // straight back into the game (we're in a click handler)
  }

  /** Call every frame: the P key toggles it; while open, circle the camera around the player. */
  update(frameDt: number): void {
    if (this.input.consumePressed('characterMenu')) this.toggle();
    if (!this.open_) return;
    this.angle += frameDt * 0.35;
    const feet = this.playerFeet();
    // Seen from the front: the body faces −Z rotated by its facing, so put the camera along it.
    // Aim below the body's middle so the character sits in the upper half, clear of the panel.
    const dist = 3.6;
    this.camera.position.set(feet.x - Math.sin(this.angle) * dist, feet.y + 1.3, feet.z - Math.cos(this.angle) * dist);
    this.camera.lookAt(feet.x, feet.y + 0.35, feet.z);
  }

  private change(update: Partial<Look>): void {
    this.look = { ...this.look, ...update };
    if (update.id) this.look.height = HEIGHT[this.library.info(this.look.id).gender];
    const ticket = ++this.building;
    void this.library.create(this.look).then((model) => {
      if (ticket === this.building) this.setModel(model);
    });
    this.draw();
  }

  private draw(): void {
    const p = this.panel;
    p.innerHTML = '';
    const list = this.library.characters;
    const index = Math.max(0, list.findIndex((c) => c.id === this.look.id));
    const info = list[index];

    const top = document.createElement('div');
    top.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px';
    const arrow = (text: string, delta: number) => {
      const b = this.button(text, () => this.change({ id: list[(index + delta + list.length) % list.length].id }));
      b.style.width = '44px';
      return b;
    };
    const title = document.createElement('div');
    title.style.cssText = 'text-align:center;flex:1';
    title.innerHTML = `<div style="font-size:12px;opacity:0.65">Choose your character · ${index + 1}/${list.length}</div><div style="font-weight:700;font-size:17px">${info.name} <span style="opacity:0.6;font-weight:500">(${info.gender === 'male' ? 'man' : 'woman'})</span></div>`;
    top.append(arrow('◀', -1), title, arrow('▶', 1));
    p.appendChild(top);

    // Outfit swatches: the outfit's main clothing colour after each hue shift.
    const cloth = info.parts.find((part) => part.kind === 'cloth');
    const base = new THREE.Color(...(cloth?.color ?? [0.3, 0.3, 0.3]));
    const outfitColors = OUTFIT_SHIFTS.map((deg) => {
      const hsl = { h: 0, s: 0, l: 0 };
      const c = base.clone();
      c.getHSL(hsl);
      c.setHSL((hsl.h + deg / 360) % 1, Math.min(Math.max(hsl.s, 0.35), 0.55), Math.min(Math.max(hsl.l, 0.25), 0.6));
      return c.getHex();
    });
    p.appendChild(this.swatches('Skin', SKIN_TONES, this.look.skin, (i) => this.change({ skin: i })));
    p.appendChild(this.swatches('Hair', HAIR_COLORS, this.look.hair, (i) => this.change({ hair: i })));
    p.appendChild(this.swatches('Outfit', outfitColors, this.look.outfit, (i) => this.change({ outfit: i })));

    const play = this.button('Play', () => this.close(), '#2f7d45');
    play.style.cssText += ';width:100%;margin-top:10px;padding:10px';
    p.appendChild(play);
  }

  private swatches(label: string, colors: number[], selected: number, pick: (i: number) => void): HTMLDivElement {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:8px;margin:6px 0';
    const name = document.createElement('div');
    name.textContent = label;
    name.style.cssText = 'width:52px;font-size:13px;opacity:0.8';
    row.appendChild(name);
    colors.forEach((c, i) => {
      const s = document.createElement('button');
      s.setAttribute('aria-label', `${label} ${i + 1}`);
      s.style.cssText = [
        'width:34px',
        'height:34px',
        'border-radius:50%',
        `background:${hex(c)}`,
        `border:${i === selected ? '3px solid #fff' : '2px solid rgba(255,255,255,0.25)'}`,
        'cursor:pointer',
        'padding:0',
      ].join(';');
      s.addEventListener('click', () => pick(i));
      row.appendChild(s);
    });
    return row;
  }

  private button(text: string, onClick: () => void, color = '#444'): HTMLButtonElement {
    const b = document.createElement('button');
    b.textContent = text;
    b.style.cssText = `padding:8px;border:0;border-radius:9px;background:${color};color:#fff;font:600 15px system-ui,sans-serif;cursor:pointer`;
    b.addEventListener('click', onClick);
    return b;
  }
}
