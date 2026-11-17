// Options: the model, persistence (localStorage `twinfold:options`) and turning them into
// SessionSettings for the simulation plus the shell's own effects (volumes, CSS brightness, HUD).
import type { SessionSettings } from '../core/session';
import { SHELL } from '../core/shellConfig';
import { CONFIG } from '../core/config';

export type PaletteId = 'standard' | 'deuteranopia' | 'protanopia' | 'tritanopia' | 'monochrome';

/** Portal colour presets. Each pair differs strongly in lightness as well as hue, so it reads under
 *  every kind of colour blindness it's named for (and in greyscale for 'monochrome'). */
export const PALETTES: Record<PaletteId, { label: string; a: number; b: number }> = {
  standard: { label: 'Standard (blue / amber)', a: CONFIG.portal.colors.a, b: CONFIG.portal.colors.b },
  deuteranopia: { label: 'Deuteranopia (blue / yellow)', a: 0x1f5fff, b: 0xfff04a },
  protanopia: { label: 'Protanopia (sky / gold)', a: 0x3fb4ff, b: 0xd6a400 },
  tritanopia: { label: 'Tritanopia (teal / magenta-red)', a: 0x00c7b4, b: 0xff2d6f },
  monochrome: { label: 'High contrast (white / black-violet)', a: 0xf2f2f2, b: 0x4b1a8c },
};

export interface Options {
  // Video
  renderScale: number;
  fov: number;
  recursionDepth: number;
  brightness: number;
  gamma: number;
  frameCap: 0 | 30 | 60 | 120;
  // Audio
  master: number;
  music: number;
  effects: number;
  voice: number;
  subtitles: boolean;
  captions: boolean;
  // Controls
  mouseSensitivity: number;
  invertY: boolean;
  toggleCrouch: boolean;
  gamepadSensitivity: number;
  // Gameplay
  crosshairIndicator: boolean;
  hints: boolean;
  assist: boolean;
  // Accessibility
  palette: PaletteId;
  highContrastHazards: boolean;
  reduceRoll: boolean;
  reduceFlashing: boolean;
  // Extras
  commentary: boolean;
}

export const DEFAULT_OPTIONS: Options = {
  renderScale: 1,
  fov: CONFIG.camera.fov,
  recursionDepth: CONFIG.portal.recursionDepth,
  brightness: 1,
  gamma: 1,
  frameCap: 0,
  master: 0.8,
  music: 0.6,
  effects: 0.8,
  voice: 0.9,
  subtitles: true,
  captions: false,
  mouseSensitivity: 1,
  invertY: false,
  toggleCrouch: false,
  gamepadSensitivity: 1,
  crosshairIndicator: true,
  hints: true,
  assist: false,
  palette: 'standard',
  highContrastHazards: false,
  reduceRoll: false,
  reduceFlashing: false,
  commentary: false,
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Fill in missing / invalid values from the defaults (old or hand-edited storage). */
export function sanitizeOptions(raw: unknown): Options {
  const o: Options = { ...DEFAULT_OPTIONS };
  if (typeof raw !== 'object' || raw === null) return o;
  const r = raw as Record<string, unknown>;
  for (const k of Object.keys(DEFAULT_OPTIONS) as (keyof Options)[]) {
    const d = DEFAULT_OPTIONS[k];
    const v = r[k];
    if (typeof v === typeof d && (typeof v !== 'number' || Number.isFinite(v))) (o as unknown as Record<string, unknown>)[k] = v;
  }
  const S = SHELL.options;
  o.fov = clamp(o.fov, S.fovMin, S.fovMax);
  o.renderScale = clamp(o.renderScale, S.renderScaleMin, S.renderScaleMax);
  o.recursionDepth = Math.round(clamp(o.recursionDepth, S.recursionMin, S.recursionMax));
  for (const k of ['master', 'music', 'effects', 'voice'] as const) o[k] = clamp(o[k], 0, 1);
  o.brightness = clamp(o.brightness, 0.5, 1.5);
  o.gamma = clamp(o.gamma, 0.5, 1.5);
  if (![0, 30, 60, 120].includes(o.frameCap)) o.frameCap = 0;
  if (!(o.palette in PALETTES)) o.palette = 'standard';
  return o;
}

export function loadOptions(): Options {
  try {
    return sanitizeOptions(JSON.parse(localStorage.getItem(SHELL.storage.options) ?? 'null'));
  } catch {
    return { ...DEFAULT_OPTIONS };
  }
}

export function saveOptions(o: Options): void {
  try {
    localStorage.setItem(SHELL.storage.options, JSON.stringify(o));
  } catch {
    /* storage blocked */
  }
}

/** The part of the options the simulation needs. */
export function toSessionSettings(o: Options): SessionSettings {
  const p = PALETTES[o.palette];
  return {
    fov: o.fov,
    mouseSensitivity: CONFIG.camera.mouseSensitivity * o.mouseSensitivity,
    invertY: o.invertY,
    renderScale: o.renderScale,
    recursionDepth: o.recursionDepth,
    portalColors: { a: p.a, b: p.b },
    reduceRoll: o.reduceRoll,
    reduceFlashing: o.reduceFlashing,
    highContrastHazards: o.highContrastHazards,
    assist: o.assist,
    toggleCrouch: o.toggleCrouch,
    frameCap: o.frameCap,
  };
}

/** Brightness and gamma as a CSS filter on the game canvas (gamma approximated by contrast). */
export function cssFilter(o: Options): string {
  if (o.brightness === 1 && o.gamma === 1) return '';
  return `brightness(${o.brightness}) contrast(${(1 / o.gamma).toFixed(3)})`;
}
