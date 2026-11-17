// Wave 2, workstream B: chambers c11–c19, escape1, escape2 and finale (one file per chamber next to
// this one, imported here), chapter titles, and medal thresholds for B's challenge chambers.
import type { LevelData } from '../level';
import type { ChallengeTable } from './types';
import { C11 } from './c11';

export const CHAMBERS_B: LevelData[] = [C11];
export const CHALLENGES_B: ChallengeTable = {};
/** Titles of the six chapters (see CHAPTER_IDS in index.ts). Original names. */
export const CHAPTER_TITLES: string[] = ['Orientation Week', 'Lectures in Falling', 'Office Hours', 'Midterms', 'Commencement', 'Expulsion'];
