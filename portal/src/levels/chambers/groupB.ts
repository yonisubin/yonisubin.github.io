// Wave 2, workstream B: chambers c11–c19, escape1, escape2 and finale (one file per chamber next to
// this one, imported here), chapter titles, and medal thresholds for B's challenge chambers.
import type { LevelData } from '../level';
import type { ChallengeTable } from './types';
import { C11 } from './c11';
import { C12 } from './c12';
import { C13 } from './c13';
import { C14 } from './c14';
import { C15 } from './c15';
import { C16 } from './c16';
import { C17 } from './c17';
import { C18 } from './c18';
import { C19 } from './c19';
import { ESCAPE1 } from './escape1';
import { ESCAPE2 } from './escape2';
import { FINALE } from './finale';

export const CHAMBERS_B: LevelData[] = [C11, C12, C13, C14, C15, C16, C17, C18, C19, ESCAPE1, ESCAPE2, FINALE];
/** Medals: gold is about what the solution replay in tests/chambersB.test.cjs scores. */
export const CHALLENGES_B: ChallengeTable = {
  c11: { portals: { gold: 0, silver: 2, bronze: 4 }, steps: { gold: 32, silver: 45, bronze: 70 }, time: { gold: 25, silver: 40, bronze: 70 } },
  c12: { portals: { gold: 4, silver: 6, bronze: 10 }, steps: { gold: 52, silver: 70, bronze: 100 }, time: { gold: 38, silver: 60, bronze: 100 } },
  c13: { portals: { gold: 4, silver: 6, bronze: 10 }, steps: { gold: 36, silver: 50, bronze: 80 }, time: { gold: 28, silver: 45, bronze: 80 } },
  c14: { portals: { gold: 2, silver: 4, bronze: 8 }, steps: { gold: 30, silver: 45, bronze: 70 }, time: { gold: 24, silver: 40, bronze: 70 } },
  c15: { portals: { gold: 4, silver: 6, bronze: 10 }, steps: { gold: 34, silver: 50, bronze: 80 }, time: { gold: 30, silver: 50, bronze: 90 } },
  c16: { portals: { gold: 2, silver: 4, bronze: 8 }, steps: { gold: 25, silver: 40, bronze: 60 }, time: { gold: 16, silver: 30, bronze: 60 } },
  c17: { portals: { gold: 4, silver: 6, bronze: 10 }, steps: { gold: 30, silver: 45, bronze: 70 }, time: { gold: 30, silver: 50, bronze: 90 } },
};
/** Titles of the six chapters (see CHAPTER_IDS in index.ts). Original names. */
export const CHAPTER_TITLES: string[] = ['Orientation Week', 'Lectures in Falling', 'Office Hours', 'Midterms', 'Commencement', 'Expulsion'];
