// Chamber registry: every playable chamber by id, the campaign order, chapters, advanced chambers
// and the challenge medal table. Wave 2 adds chambers here (one file per chamber, imported below and
// listed in CAMPAIGN / ADVANCED). The shell (menus, saves, chapter select, challenges) reads only this.
import type { LevelData } from '../level';
import { TEST_ROOM } from '../testRoom';
import { FIXED_ROOM, SANDBOX } from '../sandbox';
import { CHAMBERS_A, CHALLENGES_A } from './groupA';
import { CHAMBERS_B, CHALLENGES_B, CHAPTER_TITLES } from './groupB';
import type { ChallengeTable } from './types';
export type { ChallengeMode, MedalThresholds } from './types';

/** Every known chamber, by id. */
const REGISTRY = new Map<string, LevelData>();

export function registerChamber(level: LevelData): void {
  if (!level.id) throw new Error(`registerChamber: "${level.name}" has no id`);
  REGISTRY.set(level.id, level);
}

registerChamber(TEST_ROOM);
// The gray-box element rooms (until the chambers exist, chapter select lists every registered chamber).
registerChamber(SANDBOX);
registerChamber(FIXED_ROOM);
for (const c of [...CHAMBERS_A, ...CHAMBERS_B]) registerChamber(c);

/** The fixed campaign ids, in order: A builds c01–c10, B builds c11–c19, escape1, escape2, finale. */
export const CAMPAIGN_IDS = [
  ...Array.from({ length: 19 }, (_, i) => `c${String(i + 1).padStart(2, '0')}`),
  'escape1',
  'escape2',
  'finale',
];
/** Advanced chambers (A builds them). */
export const ADVANCED_IDS = ['adv1', 'adv2', 'adv3', 'adv4', 'adv5', 'adv6'];
/** Chapters by chamber id (titles come from groupB.ts). */
const CHAPTER_IDS: string[][] = [
  ['c01', 'c02', 'c03', 'c04'],
  ['c05', 'c06', 'c07', 'c08'],
  ['c09', 'c10', 'c11', 'c12'],
  ['c13', 'c14', 'c15', 'c16'],
  ['c17', 'c18', 'c19'],
  ['escape1', 'escape2', 'finale'],
];

/** The story campaign in order: the campaign ids that exist (until any do, New Game plays the
 *  gray-box test room). */
export const CAMPAIGN: string[] = CAMPAIGN_IDS.filter((id) => REGISTRY.has(id));

/** Advanced chambers (harder remixes), unlocked after the story. */
export const ADVANCED: string[] = ADVANCED_IDS.filter((id) => REGISTRY.has(id));

/** Chapters for chapter select: a title and the chambers in it (the first one is where it starts). */
export interface Chapter {
  title: string;
  chambers: string[];
}
export const CHAPTERS: Chapter[] = CHAPTER_IDS.map((ids, i) => ({
  title: CHAPTER_TITLES[i] ?? `Chapter ${i + 1}`,
  chambers: ids.filter((id) => REGISTRY.has(id)),
})).filter((c) => c.chambers.length > 0);

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

export const CHALLENGES: ChallengeTable = {
  ...CHALLENGES_A,
  ...CHALLENGES_B,
  testroom: {
    portals: { gold: 2, silver: 4, bronze: 8 },
    steps: { gold: 20, silver: 40, bronze: 80 },
    time: { gold: 20, silver: 40, bronze: 90 },
  },
};
