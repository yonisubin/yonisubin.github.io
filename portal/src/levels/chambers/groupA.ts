// Wave 2, workstream A: chambers c01–c10 and the advanced chambers adv1–adv6 (one file per chamber
// next to this one, imported here). Medal thresholds for A's challenge chambers go in CHALLENGES_A.
import type { LevelData } from '../level';
import type { ChallengeTable } from './types';
import { C01 } from './c01';
import { C02 } from './c02';

export const CHAMBERS_A: LevelData[] = [C01, C02];
export const CHALLENGES_A: ChallengeTable = {};
