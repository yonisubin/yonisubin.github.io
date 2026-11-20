// Saved progress, kept in the browser (localStorage), so closing the tab doesn't lose your
// money, weapons, missions or where you were.
//
// One small JSON object under one key, with a version number: data from an older or
// unknown version, or anything that doesn't parse, is ignored and you start a new game.
// The wanted level is never saved (reloading is a fresh start with the police).
//
// Saving is cheap (a few hundred bytes), so the game saves every 30 s, shortly after your
// money changes (purchases, mission rewards, job pay, death, fines all move money) and when
// the page is hidden or closed.

// A copy of the game served from a sub-folder (the /preview/ build) keeps its own save, so
// trying a preview never overwrites your progress in the live game on the same site.
const KEY = `opencity.save.v1${import.meta.env.BASE_URL === '/' ? '' : import.meta.env.BASE_URL}`;
const VERSION = 1;

export interface SaveData {
  version: number;
  stats: {
    health: number;
    money: number;
    owned: string[];
    ammo: Record<string, number>;
    apAmmo: Record<string, number>;
    addons: string[];
    current: string;
    /** Owns the car autopilot (absent in older saves). */
    autopilot?: boolean;
  };
  /** Missions completed per giver name, and their best (most) time left in seconds. */
  missions: Record<string, { done: number; best: number }>;
  /** Side-job records (Phase 3). */
  jobs: Record<string, { done: number; earned: number }>;
  player: { x: number; z: number; heading: number };
  hours: number;
  waypoint: { x: number; z: number } | null;
}

export function loadSave(): SaveData | null {
  try {
    const data = JSON.parse(localStorage.getItem(KEY) ?? 'null') as SaveData | null;
    // Saved data can be old, half-written or edited by hand: check every field before use.
    if (!isObject(data) || data.version !== VERSION || !isObject(data.stats) || !isObject(data.player)) return null;
    const { x, z, heading } = data.player;
    if (![x, z, heading, data.hours].every(Number.isFinite)) return null;
    data.missions = records(data.missions, ['done', 'best']);
    data.jobs = records(data.jobs, ['done', 'earned']);
    const w = data.waypoint;
    data.waypoint = isObject(w) && Number.isFinite(w.x) && Number.isFinite(w.z) ? { x: w.x, z: w.z } : null;
    return data;
  } catch {
    return null; // corrupt or blocked storage: a new game
  }
}

function isObject(v: unknown): v is Record<string, any> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Keep only well-formed { name: { field: number … } } entries; anything else is dropped. */
function records<K extends string>(v: unknown, fields: K[]): Record<string, Record<K, number>> {
  const out: Record<string, Record<K, number>> = {};
  if (!isObject(v)) return out;
  for (const [name, rec] of Object.entries(v)) {
    if (isObject(rec) && fields.every((f) => Number.isFinite(rec[f]))) out[name] = Object.fromEntries(fields.map((f) => [f, rec[f]])) as Record<K, number>;
  }
  return out;
}

export function writeSave(data: Omit<SaveData, 'version'>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ version: VERSION, ...data }));
  } catch {
    // Private mode / storage full: playing on without saving is fine.
  }
}

export function clearSave(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}

/**
 * Decides when to save: every `interval` seconds, and `soon` seconds after something
 * important changed (call `changed()`).
 */
export class Autosave {
  private sinceSave = 0;
  private pending = -1;
  private stopped = false;

  constructor(
    private readonly save: () => void,
    private readonly interval = 30,
    private readonly soon = 1,
  ) {
    const flush = () => this.now();
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flush();
    });
  }

  /** Something worth saving happened; save in a moment. */
  changed(): void {
    if (this.pending < 0) this.pending = this.soon;
  }

  /** Never save again (New game: the reload's pagehide mustn't write the old game back). */
  stop(): void {
    this.stopped = true;
  }

  now(): void {
    if (this.stopped) return;
    this.save();
    this.sinceSave = 0;
    this.pending = -1;
  }

  update(dt: number): void {
    this.sinceSave += dt;
    if (this.pending >= 0) {
      this.pending -= dt;
      if (this.pending < 0) this.now();
    }
    if (this.sinceSave > this.interval) this.now();
  }
}
