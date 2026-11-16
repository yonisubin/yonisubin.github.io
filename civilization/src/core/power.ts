// Military strength of a player (sum of unit strengths weighted by health). Used by the AI, the
// relations screen and the statistics.
import { playerUnits, unitDef } from './query';
import type { GameState } from './state';

export function militaryStrength(s: GameState, p: number): number {
  let v = 0;
  for (const u of playerUnits(s, p)) {
    const d = unitDef(u);
    v += Math.max(d.strength, d.ranged) * (u.hp / 100);
  }
  return v;
}
