// Golden ages: positive happiness fills a meter each turn; when full, a golden age starts
// (+1 production on tiles making production, +1 gold on tiles making gold, +20% culture — see
// yields.ts). Each later golden age needs more points.
import { D, get } from '../../data';
import { logEvent, notify, playerCities } from '../query';
import type { GameState } from '../state';
import { playerEffects, sum } from './effects';

export function goldenAgeThreshold(s: GameState, p: number): number {
  const g = D.rules.goldenAge;
  const pl = s.players[p];
  const cities = Math.max(1, playerCities(s, p).length);
  const pace = get(D.pace, s.settings.pace).costPct / 100;
  return Math.round((g.base + g.perAge * pl.goldenAge.count) * (1 + 0.01 * (cities - 1)) * pace);
}

export function goldenAgeLength(s: GameState, p: number): number {
  const pct = sum(playerEffects(s, p), 'golden_age_length_pct', 'percent');
  return Math.max(1, Math.round(D.rules.goldenAge.turns * (1 + pct / 100)));
}

export function startGoldenAge(s: GameState, p: number, turns = goldenAgeLength(s, p)): void {
  const pl = s.players[p];
  const was = pl.goldenAge.turnsLeft > 0;
  pl.goldenAge.turnsLeft += turns;
  if (!was) {
    pl.goldenAge.count++;
    notify(s, p, `A golden age begins! (${turns} turns)`, 'good');
    logEvent(s, `The ${pl.name} entered a golden age.`, undefined, p);
  } else notify(s, p, `Your golden age is extended by ${turns} turns.`, 'good');
}

/** End of turn: count down an active golden age, or fill the meter with happiness. */
export function processGoldenAge(s: GameState, p: number, happiness: number): void {
  const pl = s.players[p];
  if (pl.goldenAge.turnsLeft > 0) {
    pl.goldenAge.turnsLeft--;
    if (pl.goldenAge.turnsLeft === 0) notify(s, p, 'Your golden age has ended.', 'info');
    return;
  }
  if (happiness <= 0) return;
  pl.goldenAge.points += happiness * (1 + sum(playerEffects(s, p), 'golden_age_points_pct', 'percent') / 100);
  const need = goldenAgeThreshold(s, p);
  if (pl.goldenAge.points >= need) {
    pl.goldenAge.points -= need;
    startGoldenAge(s, p);
  }
}
