export type ChallengeMode = 'portals' | 'steps' | 'time';
/** Thresholds for a medal: the result must be at most this (fewer portals / steps, less time). */
export interface MedalThresholds {
  gold: number;
  silver: number;
  bronze: number;
}
export type ChallengeTable = Record<string, Partial<Record<ChallengeMode, MedalThresholds>>>;
