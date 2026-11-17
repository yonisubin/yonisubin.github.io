// Touch device detection: decides whether the game runs with on-screen touch controls and the
// phone-friendly layout (the `touch` class on <html>) or with mouse + keyboard as before.
//
// Order of precedence: the URL (?touch / ?desktop, for testing on any device) → the option
// "Touch controls: Auto / On / Off" → Auto = the primary pointer is a finger. Touchscreen laptops
// report a fine primary pointer (trackpad / mouse), so they keep the desktop controls.
import { SHELL } from '../core/shellConfig';

export type TouchPref = 'auto' | 'on' | 'off';
export const TOUCH_PREFS: readonly TouchPref[] = ['auto', 'on', 'off'];

/** True when the primary pointer is coarse (phones, tablets). */
export function detectTouch(): boolean {
  try {
    return window.matchMedia('(pointer: coarse)').matches;
  } catch {
    return false;
  }
}

/** ?touch forces touch mode, ?desktop forces it off; null when the URL says nothing. */
export function urlTouchOverride(search = location.search): boolean | null {
  const p = new URLSearchParams(search);
  if (p.has('desktop')) return false;
  if (p.has('touch')) return true;
  return null;
}

export function touchModeFor(pref: TouchPref): boolean {
  const url = urlTouchOverride();
  if (url !== null) return url;
  if (pref === 'on') return true;
  if (pref === 'off') return false;
  return detectTouch();
}

/** The touch layout's CSS hangs off `html.touch`. */
export function applyTouchClass(on: boolean): void {
  document.documentElement.classList.toggle('touch', on);
}

/** The puzzle maker needs a bigger screen than a phone (tablets keep it). */
export function editorTooSmall(touch: boolean): boolean {
  return touch && window.innerWidth < SHELL.touch.editorMinWidth;
}
