// Saves: multiple manual slots + an autosave slot (written on `autosave` events) + a quicksave slot
// (F5 / F9). Each record holds a SessionSnapshot, the chamber id (and the level data itself when the
// chamber isn't in the registry, e.g. a puzzle-maker chamber), a timestamp and the campaign progress
// at that moment. Campaign progress also lives on its own (unlocked chambers / chapters, story
// finished → challenges and advanced chambers unlock).
import type { SessionSnapshot } from '../core/session';
import type { LevelData } from '../levels/level';
import { CHAPTERS, chapterOf, getChamber } from '../levels/chambers';
import { SHELL } from '../core/shellConfig';
import { dbAll, dbDelete, dbGet, dbPut } from './db';

export interface Progress {
  key: 'campaign';
  /** Chambers the player has reached (chapter select lists these). */
  reached: string[];
  /** Chambers finished at least once. */
  completed: string[];
  /** Chapters unlocked (index into CHAPTERS). Chapter 0 is always open. */
  chapters: number[];
  /** Finishing the story unlocks challenges and advanced chambers. */
  storyFinished: boolean;
}

export type SlotKind = 'auto' | 'quick' | 'manual';

export interface SaveRecord {
  key: string;
  kind: SlotKind;
  name: string;
  chamberId: string;
  chamberName: string;
  timestamp: number;
  snapshot: SessionSnapshot;
  /** Only for chambers that aren't in the registry (puzzle maker, share links). */
  level?: LevelData;
  progress: Progress;
}

export const AUTO_SLOT = 'auto';
export const QUICK_SLOT = 'quick';
export const manualSlot = (i: number) => `slot${i + 1}`;
export const MANUAL_SLOTS = Array.from({ length: SHELL.saves.manualSlots }, (_, i) => manualSlot(i));

export function emptyProgress(): Progress {
  return { key: 'campaign', reached: [], completed: [], chapters: [0], storyFinished: false };
}

export class SaveManager {
  private progressCache: Progress = emptyProgress();

  /** Load campaign progress (call once at start). */
  async init(): Promise<Progress> {
    try {
      this.progressCache = (await dbGet<Progress>('progress', 'campaign')) ?? emptyProgress();
    } catch {
      this.progressCache = emptyProgress();
    }
    return this.progressCache;
  }

  get progress(): Progress {
    return this.progressCache;
  }

  async setProgress(p: Progress): Promise<void> {
    this.progressCache = p;
    await dbPut('progress', p);
  }

  /** The player reached a chamber: remember it and unlock its chapter. */
  async reach(chamberId: string): Promise<void> {
    const p = { ...this.progressCache, reached: [...this.progressCache.reached], chapters: [...this.progressCache.chapters] };
    if (!getChamber(chamberId)) return; // custom chambers don't count
    if (!p.reached.includes(chamberId)) p.reached.push(chamberId);
    const ch = chapterOf(chamberId);
    if (ch >= 0 && !p.chapters.includes(ch)) p.chapters.push(ch);
    await this.setProgress(p);
  }

  async complete(chamberId: string): Promise<void> {
    if (!getChamber(chamberId) || this.progressCache.completed.includes(chamberId)) return;
    await this.setProgress({ ...this.progressCache, completed: [...this.progressCache.completed, chamberId] });
  }

  async finishStory(): Promise<void> {
    await this.setProgress({ ...this.progressCache, storyFinished: true, chapters: CHAPTERS.map((_, i) => i) });
  }

  /** New game: progress kept (unlocks are permanent), only the autosave is cleared. */
  async resetAutosave(): Promise<void> {
    await dbDelete('saves', AUTO_SLOT);
  }

  async write(key: string, kind: SlotKind, snapshot: SessionSnapshot, level: LevelData, name?: string): Promise<SaveRecord> {
    const registered = getChamber(snapshot.chamberId);
    const rec: SaveRecord = {
      key,
      kind,
      name: name ?? (kind === 'auto' ? 'Autosave' : kind === 'quick' ? 'Quicksave' : `Slot ${key.replace('slot', '')}`),
      chamberId: snapshot.chamberId,
      chamberName: level.name,
      timestamp: Date.now(),
      snapshot: JSON.parse(JSON.stringify(snapshot)) as SessionSnapshot,
      progress: JSON.parse(JSON.stringify(this.progressCache)) as Progress,
    };
    if (!registered) rec.level = JSON.parse(JSON.stringify(level)) as LevelData;
    await dbPut('saves', rec);
    return rec;
  }

  async read(key: string): Promise<SaveRecord | null> {
    return dbGet<SaveRecord>('saves', key);
  }

  /** The level a record needs: from the registry, or the copy saved with it. */
  levelOf(rec: SaveRecord): LevelData | null {
    return getChamber(rec.chamberId) ?? rec.level ?? null;
  }

  async list(): Promise<SaveRecord[]> {
    const all = await dbAll<SaveRecord>('saves');
    return all.sort((a, b) => b.timestamp - a.timestamp);
  }

  /** The most recent save of any kind (Continue). */
  async latest(): Promise<SaveRecord | null> {
    return (await this.list())[0] ?? null;
  }

  async remove(key: string): Promise<void> {
    await dbDelete('saves', key);
  }
}
