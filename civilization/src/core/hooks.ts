// Wires later systems into the core's extension points (imported once by game.ts).
import { EFFECT_POST, EFFECT_SOURCES } from './systems/effects';
import { cityStateEffects, patronageEffects, allyResources, setCityStateWarHook, setLuxuryCheck } from './systems/citystates';
import { LUXURY_HOOKS, luxuryCounts } from './systems/diplomacy';
import type { GameState } from './state';

export function installHooks(setWar: (s: GameState, a: number, b: number, war: boolean) => void): void {
  EFFECT_SOURCES.push(cityStateEffects);
  EFFECT_POST.push(patronageEffects);
  LUXURY_HOOKS.push((s, p, out) => {
    for (const [k, v] of Object.entries(allyResources(s, p, 'luxury'))) out[k] = (out[k] ?? 0) + v;
  });
  setCityStateWarHook(setWar);
  setLuxuryCheck((s, p, res) => (luxuryCounts(s, p)[res] ?? 0) > 0);
}

import { GP_DO_HOOKS } from './systems/greatpeople';
import { addInfluence } from './systems/citystates';
import { MIGRATIONS } from './migrate';
import { newDiplomacy } from './game';
import { D } from '../data';
import { eraOf, notify } from './query';

// A Great Merchant's trade mission inside a city-state's land also wins influence there.
GP_DO_HOOKS.push((s, u, use) => {
  if (use !== 'trade') return undefined;
  const owner = s.map.tiles[u.tile].owner;
  if (owner < 0 || !s.players[owner].isMinor) return undefined;
  const g = D.rules.greatPeople;
  const gold = g.tradeGold + g.tradePerEra * eraOf(s.players[u.owner]);
  s.players[u.owner].gold += gold;
  addInfluence(s, owner, u.owner, D.rules.cityStates.tradeMissionInfluence);
  notify(s, u.owner, `Trade mission to ${s.players[owner].name}: +${gold} gold and +${D.rules.cityStates.tradeMissionInfluence} influence.`, 'good', u.tile);
  return null;
});

MIGRATIONS.push((s) => {
  const P = s.players.length;
  const fresh = newDiplomacy(P);
  const d = s.diplomacy as unknown as Record<string, unknown>;
  for (const [k, v] of Object.entries(fresh)) if (d[k] === undefined) d[k] = v;
  for (const p of s.players) {
    p.isMinor ??= false;
    p.minor ??= null;
    p.warmonger ??= 0;
  }
});
