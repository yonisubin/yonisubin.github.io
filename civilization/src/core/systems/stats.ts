// End-of-game material: per-turn statistics for the graphs, territory snapshots for the replay
// (run-length encoded owner ids), and the final score.
import { D, get } from '../../data';
import { playerCities } from '../query';
import type { GameState, TurnStats } from '../state';
import { score } from './economy';
import { cityYields, playerYields } from './yields';
import { happinessOf } from './happiness';
import { goldReport } from './economy';
import { militaryStrength } from '../power';

export function turnStats(s: GameState, p: number): TurnStats {
  const cities = playerCities(s, p);
  const happy = happinessOf(s, p).net;
  const y = playerYields(s, p);
  let production = 0;
  for (const c of cities) production += cityYields(s, c, happy).total.production;
  return {
    turn: s.turn,
    score: score(s, p),
    pop: cities.reduce((a, c) => a + c.pop, 0),
    military: Math.round(militaryStrength(s, p)),
    production: Math.round(production),
    gold: goldReport(s, p).net,
    science: Math.round(y.science),
    culture: Math.round(y.culture),
    land: s.map.tiles.filter((t) => t.owner === p).length,
  };
}

/** Owner of every tile as runs: "<owner char><count>"; '.' = nobody, 'a'.. = player 0.. (letters, so
 * the digits of a count can't be mistaken for an owner). */
export function encodeOwners(s: GameState): string {
  let out = '';
  let prev = '';
  let n = 0;
  for (const t of s.map.tiles) {
    const ch = t.owner < 0 ? '.' : String.fromCharCode(97 + t.owner);
    if (ch === prev) n++;
    else {
      if (n) out += prev + n;
      prev = ch;
      n = 1;
    }
  }
  if (n) out += prev + n;
  return out;
}

export function decodeOwners(enc: string, size: number): Int8Array {
  const out = new Int8Array(size).fill(-1);
  let i = 0;
  for (const m of enc.matchAll(/([.a-z])(\d+)/g)) {
    const owner = m[1] === '.' ? -1 : m[1].charCodeAt(0) - 97;
    const n = Number(m[2]);
    out.fill(owner, i, i + n);
    i += n;
  }
  return out;
}

export function recordTurn(s: GameState): void {
  for (const pl of s.players) if (!pl.isBarbarian && pl.alive) pl.stats.push(turnStats(s, pl.id));
  s.replay.push({ turn: s.turn, owners: encodeOwners(s) });
}

/** Final score for the Hall of Fame: score × difficulty, with a bonus for winning early. */
export function finalScore(s: GameState, p: number): number {
  const base = score(s, p);
  const diff = get(D.difficulty, s.settings.difficulty);
  const max = s.settings.maxTurns;
  const early = s.winner && s.winner.player === p && s.winner.kind !== 'time' ? 1 + Math.max(0, max - s.turn) / max : 1;
  return Math.round(base * diff.scoreMult * early);
}
