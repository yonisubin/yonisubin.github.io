// Chamber registry: every playable chamber by id, the campaign order, chapters, advanced chambers
// and the challenge medal table. Wave 2 adds chambers here (one file per chamber, imported below and
// listed in CAMPAIGN / ADVANCED). The shell (menus, saves, chapter select, challenges) reads only this.
import type { LevelData } from '../level';
import { TEST_ROOM } from '../testRoom';

/** Every known chamber, by id. */
const REGISTRY = new Map<string, LevelData>();

export function registerChamber(level: LevelData): void {
  if (!level.id) throw new Error(`registerChamber: "${level.name}" has no id`);
  REGISTRY.set(level.id, level);
}

registerChamber(TEST_ROOM);

/** The story campaign in order (chamber ids). Empty until wave 2 builds chambers; until then New
 *  Game plays the gray-box test room. */
export const CAMPAIGN: string[] = [];

/** Advanced chambers (harder remixes), unlocked after the story. */
export const ADVANCED: string[] = [];

/** Chapters for chapter select: a title and the chambers in it (the first one is where it starts). */
export interface Chapter {
  title: string;
  chambers: string[];
}
export const CHAPTERS: Chapter[] = [];

/** The chamber New Game starts with. */
export function firstChamber(): string {
  return CAMPAIGN[0] ?? TEST_ROOM.id!;
}

export function getChamber(id: string): LevelData | null {
  return REGISTRY.get(id) ?? null;
}

export function allChambers(): LevelData[] {
  return [...REGISTRY.values()];
}

/** The chamber after `id`: its own `next`, else the following campaign entry, else null (end). */
export function nextChamber(id: string): string | null {
  const own = REGISTRY.get(id)?.next;
  if (own && REGISTRY.has(own)) return own;
  const i = CAMPAIGN.indexOf(id);
  return i >= 0 && i + 1 < CAMPAIGN.length ? CAMPAIGN[i + 1] : null;
}

/** Which chapter a chamber belongs to (-1 if none). */
export function chapterOf(id: string): number {
  return CHAPTERS.findIndex((c) => c.chambers.includes(id));
}

// --- Challenges ------------------------------------------------------------------------------

export type ChallengeMode = 'portals' | 'steps' | 'time';
/** Thresholds for a medal: the result must be at most this (fewer portals / steps, less time). */
export interface MedalThresholds {
  gold: number;
  silver: number;
  bronze: number;
}

/** Per-chamber challenge thresholds (wave 2 fills the numbers for real chambers). The test room's
 *  numbers exist so the framework can be tried and tested. */
export const CHALLENGES: Record<string, Partial<Record<ChallengeMode, MedalThresholds>>> = {
  testroom: {
    portals: { gold: 2, silver: 4, bronze: 8 },
    steps: { gold: 20, silver: 40, bronze: 80 },
    time: { gold: 20, silver: 40, bronze: 90 },
  },
};
