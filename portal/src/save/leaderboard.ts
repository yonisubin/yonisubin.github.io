// Local challenge leaderboards in IndexedDB: one list per chamber and mode, best (lowest) first.
import type { ChallengeMode, MedalThresholds } from '../levels/chambers';
import { CHALLENGES } from '../levels/chambers';
import { SHELL } from '../core/shellConfig';
import { dbGet, dbPut } from './db';

export type Medal = 'gold' | 'silver' | 'bronze' | null;

export interface LeaderboardEntry {
  value: number;
  medal: Medal;
  name: string;
  date: number;
}

interface LeaderboardRecord {
  key: string;
  entries: LeaderboardEntry[];
}

const keyOf = (chamberId: string, mode: ChallengeMode) => `${chamberId}:${mode}`;

export function thresholds(chamberId: string, mode: ChallengeMode): MedalThresholds | null {
  return CHALLENGES[chamberId]?.[mode] ?? null;
}

/** Lower is better: at most `gold` → gold, and so on. */
export function medalFor(value: number, t: MedalThresholds | null): Medal {
  if (!t) return null;
  if (value <= t.gold) return 'gold';
  if (value <= t.silver) return 'silver';
  if (value <= t.bronze) return 'bronze';
  return null;
}

export async function leaderboard(chamberId: string, mode: ChallengeMode): Promise<LeaderboardEntry[]> {
  return (await dbGet<LeaderboardRecord>('leaderboard', keyOf(chamberId, mode)))?.entries ?? [];
}

/** Record a run; returns its rank (0 = best) or -1 if it didn't make the list. */
export async function submitRun(chamberId: string, mode: ChallengeMode, value: number, name = 'You'): Promise<{ rank: number; medal: Medal; entries: LeaderboardEntry[] }> {
  const medal = medalFor(value, thresholds(chamberId, mode));
  const entries = await leaderboard(chamberId, mode);
  const entry: LeaderboardEntry = { value, medal, name, date: Date.now() };
  entries.push(entry);
  entries.sort((a, b) => a.value - b.value || a.date - b.date);
  const kept = entries.slice(0, SHELL.challenges.leaderboardSize);
  await dbPut<LeaderboardRecord>('leaderboard', { key: keyOf(chamberId, mode), entries: kept });
  return { rank: kept.indexOf(entry), medal, entries: kept };
}
