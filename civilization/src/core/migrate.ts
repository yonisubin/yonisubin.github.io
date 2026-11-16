// Bring older saves up to date: fill in fields added by later phases with their defaults.
import { D, get } from '../data';
import type { GameState } from './state';

export function migrate(s: GameState): GameState {
  const st = s.settings as Partial<GameState['settings']>;
  st.victories ??= { domination: true, science: true, culture: true, diplomatic: true, time: true };
  st.maxTurns ??= get(D.pace, s.settings.pace).maxTurns;
  s.replay ??= [];
  s.events ??= [];
  for (const p of s.players) {
    p.projects ??= [];
    p.spaceship ??= {};
    p.futureTechs ??= 0;
    const zero = { pop: 0, military: 0, production: 0, gold: 0, science: 0, culture: 0, land: 0 };
    p.stats ??= [];
    for (const x of p.stats) for (const [k, v] of Object.entries(zero)) if (!(k in x)) (x as unknown as Record<string, number>)[k] = v;
  }
  for (const h of MIGRATIONS) h(s);
  return s;
}

/** Later systems register their own default-filling here. */
export const MIGRATIONS: ((s: GameState) => void)[] = [];
