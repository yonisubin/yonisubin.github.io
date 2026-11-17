// Wave 2, workstream A: chambers c01–c10 and the advanced chambers adv1–adv6 (one file per chamber
// next to this one, imported here). Medal thresholds for A's challenge chambers go in CHALLENGES_A.
import type { LevelData } from '../level';
import type { ChallengeTable } from './types';
import { C01 } from './c01';
import { C02 } from './c02';
import { C03 } from './c03';
import { C04 } from './c04';
import { C05 } from './c05';
import { C06 } from './c06';
import { C07 } from './c07';
import { C08 } from './c08';
import { C09 } from './c09';
import { C10 } from './c10';
import { ADV1 } from './adv1';
import { ADV2 } from './adv2';
import { ADV3 } from './adv3';
import { ADV4 } from './adv4';

export const CHAMBERS_A: LevelData[] = [C01, C02, C03, C04, C05, C06, C07, C08, C09, C10, ADV1, ADV2, ADV3, ADV4];
/**
 * Medal thresholds (a result must be at most the value). Set from the scripted solution replays in
 * tests/chambersA.test.cjs (portals / steps / seconds): gold is a clean run with a small margin,
 * silver allows some wandering, bronze a few false starts.
 */
export const CHALLENGES_A: ChallengeTable = {
  c05: { portals: { gold: 2, silver: 3, bronze: 5 }, steps: { gold: 22, silver: 32, bronze: 50 }, time: { gold: 20, silver: 35, bronze: 70 } },
  c06: { portals: { gold: 2, silver: 3, bronze: 5 }, steps: { gold: 40, silver: 55, bronze: 80 }, time: { gold: 32, silver: 50, bronze: 90 } },
  c07: { portals: { gold: 2, silver: 3, bronze: 5 }, steps: { gold: 22, silver: 32, bronze: 50 }, time: { gold: 24, silver: 40, bronze: 80 } },
  c08: { portals: { gold: 2, silver: 3, bronze: 5 }, steps: { gold: 58, silver: 75, bronze: 110 }, time: { gold: 38, silver: 55, bronze: 100 } },
  c09: { portals: { gold: 2, silver: 3, bronze: 5 }, steps: { gold: 33, silver: 45, bronze: 70 }, time: { gold: 22, silver: 35, bronze: 70 } },
  c10: { portals: { gold: 6, silver: 8, bronze: 12 }, steps: { gold: 30, silver: 42, bronze: 65 }, time: { gold: 26, silver: 45, bronze: 90 } },
};
