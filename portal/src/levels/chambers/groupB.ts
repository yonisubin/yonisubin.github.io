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

export const CHAMBERS_B: LevelData[] = [C11, C12, C13, C14, C15, C16, C17, C18, C19, ESCAPE1];
export const CHALLENGES_B: ChallengeTable = {};
/** Titles of the six chapters (see CHAPTER_IDS in index.ts). Original names. */
export const CHAPTER_TITLES: string[] = ['Orientation Week', 'Lectures in Falling', 'Office Hours', 'Midterms', 'Commencement', 'Expulsion'];
