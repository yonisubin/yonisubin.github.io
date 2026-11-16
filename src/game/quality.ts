// Graphics quality: how much the game draws, so it stays playable on slow machines.
//
//   High / Medium / Low   fixed presets (pixels drawn, sun shadows, how far the world loads,
//                         fog, how many people are on the street)
//   Auto (default)        starts at the level it last found, measures the frame rate and
//                         steps down when it's too slow, back up when there's room to spare.
//                         On Low it also lowers the pixel ratio further, down to a floor.
//
// On an older graphics card the cost is mostly pixels (a high-DPI screen at ratio 2 draws
// four times the pixels of ratio 1), the shadow map and how much world is in view, so those
// are the levers. The choice is kept in localStorage; antialiasing is fixed when the WebGL
// context is created, so changing it only takes effect after a reload.

import type { StreamDistances } from '../world/chunks';

export type QualityLevel = 'high' | 'medium' | 'low';
export type QualityChoice = 'auto' | QualityLevel;

export interface QualityPreset {
  /** Upper limit for the renderer's pixel ratio (and the device's own is the other limit). */
  pixelRatio: number;
  antialias: boolean;
  shadows: boolean;
  shadowMapSize: number;
  stream: StreamDistances;
  fogFar: number;
  cameraFar: number;
  /** Ordinary pedestrians out at once (desktop; touch devices have a smaller pool anyway). */
  pedestrians: number;
}

export const PRESETS: Record<QualityLevel, QualityPreset> = {
  high: {
    pixelRatio: 2,
    antialias: true,
    shadows: true,
    shadowMapSize: 2048,
    stream: { farLoad: 850, farUnload: 1000, nearLoad: 400, nearUnload: 520 },
    fogFar: 1100,
    cameraFar: 2500,
    pedestrians: 16,
  },
  medium: {
    pixelRatio: 1.25,
    antialias: true,
    shadows: true,
    shadowMapSize: 1024,
    stream: { farLoad: 650, farUnload: 780, nearLoad: 300, nearUnload: 400 },
    fogFar: 850,
    cameraFar: 1800,
    pedestrians: 12,
  },
  low: {
    pixelRatio: 0.75,
    antialias: false,
    shadows: false,
    shadowMapSize: 1024,
    stream: { farLoad: 480, farUnload: 600, nearLoad: 220, nearUnload: 300 },
    fogFar: 620,
    cameraFar: 1300,
    pedestrians: 8,
  },
};

const LEVELS: QualityLevel[] = ['low', 'medium', 'high'];
const CHOICE_KEY = 'opencity.quality';
const AUTO_KEY = 'opencity.quality.auto';

// Auto: measure the average frame time over windows of WINDOW seconds.
const WINDOW = 4; // s
const SLOW_FPS = 40; // below this on average: step down
const FAST_FPS = 58; // above this for FAST_WINDOWS windows in a row: step up
const FAST_WINDOWS = 3;
const MIN_GAP = 6; // s between two changes
const WARMUP = 10; // s after start (loading, shader compiles) that don't count
const LONG_FRAME = 0.5; // s: a frame this long is a pause / hidden tab, not slowness
const MIN_SCALE = 0.5; // the lowest pixel ratio Auto goes to on Low
const SCALE_STEP = 0.125;

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // private mode / blocked storage: the setting just isn't remembered
  }
}

export class Quality {
  choice: QualityChoice;
  /** The level in effect now (for Auto, the one it has settled on). */
  level: QualityLevel;
  /** Auto on Low: the pixel ratio it has gone down to (≤ the preset's). */
  private lowScale: number;
  private windowTime = 0;
  private windowFrames = 0;
  private sinceStart = 0;
  private sinceChange = MIN_GAP;
  private fastWindows = 0;

  constructor(
    /** Apply a preset (pixel ratio already worked out). Called at once and on every change. */
    private readonly apply: (preset: QualityPreset, pixelRatio: number, level: QualityLevel) => void,
    private readonly devicePixelRatio: number,
    touch: boolean,
  ) {
    const saved = read(CHOICE_KEY);
    this.choice = saved === 'high' || saved === 'medium' || saved === 'low' ? saved : 'auto';
    const found = read(AUTO_KEY);
    const autoStart: QualityLevel = touch ? 'medium' : 'high';
    this.level = this.choice !== 'auto' ? this.choice : found === 'high' || found === 'medium' || found === 'low' ? found : autoStart;
    this.lowScale = PRESETS.low.pixelRatio;
    this.applyNow();
  }

  /** Antialiasing for the renderer (read before creating it: it can't change afterwards). */
  static antialias(): boolean {
    const choice = read(CHOICE_KEY);
    const level = choice === 'high' || choice === 'medium' || choice === 'low' ? choice : read(AUTO_KEY) ?? 'high';
    return level !== 'low';
  }

  get preset(): QualityPreset {
    return PRESETS[this.level];
  }

  /** The renderer's pixel ratio for the current level. */
  get pixelRatio(): number {
    const cap = this.level === 'low' && this.choice === 'auto' ? this.lowScale : this.preset.pixelRatio;
    return Math.min(this.devicePixelRatio, cap);
  }

  /** The menu: Auto → High → Medium → Low → Auto. Returns the new choice. */
  cycle(): QualityChoice {
    const order: QualityChoice[] = ['auto', 'high', 'medium', 'low'];
    this.set(order[(order.indexOf(this.choice) + 1) % order.length]);
    return this.choice;
  }

  set(choice: QualityChoice): void {
    this.choice = choice;
    write(CHOICE_KEY, choice);
    if (choice !== 'auto') this.level = choice;
    this.lowScale = PRESETS.low.pixelRatio;
    this.fastWindows = 0;
    this.sinceChange = 0;
    this.applyNow();
  }

  get label(): string {
    const name = (l: string) => l[0].toUpperCase() + l.slice(1);
    return this.choice === 'auto' ? `Auto (${name(this.level)})` : name(this.choice);
  }

  /**
   * Call every rendered frame with its real duration (s). `counts` is false while the game
   * isn't really running (paused, a menu or the map open): those frames are ignored.
   */
  feed(frameDt: number, counts = true): void {
    this.sinceStart += frameDt;
    this.sinceChange += frameDt;
    if (this.choice !== 'auto' || !counts || this.sinceStart < WARMUP || frameDt > LONG_FRAME) {
      // A pause or hitch in the middle spoils the window: start a fresh one.
      if (frameDt > LONG_FRAME || !counts) this.windowTime = this.windowFrames = 0;
      return;
    }
    this.windowTime += frameDt;
    this.windowFrames++;
    if (this.windowTime < WINDOW) return;
    const fps = this.windowFrames / this.windowTime;
    this.windowTime = this.windowFrames = 0;
    if (this.sinceChange < MIN_GAP) return;
    if (fps < SLOW_FPS) {
      this.fastWindows = 0;
      this.stepDown();
    } else if (fps > FAST_FPS) {
      if (++this.fastWindows >= FAST_WINDOWS) {
        this.fastWindows = 0;
        this.stepUp();
      }
    } else this.fastWindows = 0;
  }

  private stepDown(): void {
    const k = LEVELS.indexOf(this.level);
    if (k > 0) this.level = LEVELS[k - 1];
    else if (this.lowScale > MIN_SCALE) this.lowScale = Math.max(MIN_SCALE, this.lowScale - SCALE_STEP);
    else return; // nothing left to give
    this.changed();
  }

  private stepUp(): void {
    if (this.level === 'low' && this.lowScale < PRESETS.low.pixelRatio) {
      this.lowScale = Math.min(PRESETS.low.pixelRatio, this.lowScale + SCALE_STEP);
    } else {
      const k = LEVELS.indexOf(this.level);
      if (k >= LEVELS.length - 1) return;
      this.level = LEVELS[k + 1];
    }
    this.changed();
  }

  private changed(): void {
    this.sinceChange = 0;
    write(AUTO_KEY, this.level);
    this.applyNow();
  }

  private applyNow(): void {
    this.apply(this.preset, this.pixelRatio, this.level);
  }
}
