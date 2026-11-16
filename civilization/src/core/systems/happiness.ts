// Empire-wide happiness: base (difficulty) + distinct luxuries + buildings + ability, minus
// unhappiness from cities and citizens (more in occupied cities, less in puppets).
import { D, get } from '../../data';
import { difficultyOf, effectsOf, hasTech, playerCities } from '../query';
import type { GameState } from '../state';

export interface HappinessReport {
  happy: number;
  unhappy: number;
  net: number;
  luxuries: string[];
}

/** Distinct luxury types player p has connected (improved, in its territory, or under a city). */
export function connectedLuxuries(s: GameState, p: number): string[] {
  const out = new Set<string>();
  const pl = s.players[p];
  for (let i = 0; i < s.map.tiles.length; i++) {
    const t = s.map.tiles[i];
    if (t.owner !== p || !t.resource) continue;
    const r = D.resources.get(t.resource)!;
    if (r.kind !== 'luxury' || !hasTech(pl, r.revealTech)) continue;
    const improved = t.improvement === r.improvement && !t.pillaged;
    const underCity = t.cityId >= 0 && s.cities[t.cityId]?.tile === i;
    if (improved || underCity || r.improvement === 'none') out.add(t.resource);
  }
  return [...out].sort();
}

export function happinessOf(s: GameState, p: number): HappinessReport {
  const pl = s.players[p];
  if (pl.isBarbarian) return { happy: 0, unhappy: 0, net: 0, luxuries: [] };
  const h = D.rules.happiness;
  const diff = difficultyOf(s);
  const luxuries = connectedLuxuries(s, p);
  let happy = (pl.isHuman ? diff.humanHappiness : diff.aiHappiness) + luxuries.length * h.luxury;
  let unhappy = 0;
  for (const c of playerCities(s, p)) {
    for (const b of c.buildings) happy += get(D.buildings, b).happiness;
    const cityPart = h.perCity * (c.puppet ? h.puppetCityPct / 100 : 1);
    const citizenPart = c.pop * h.perCitizen * (c.puppet ? h.puppetCityPct / 100 : 1);
    const occupied = c.occupied ? c.pop * h.occupiedPerCitizen : 0;
    unhappy += cityPart + citizenPart + occupied;
  }
  for (const e of effectsOf(s, p)) if (e.type === 'happiness') happy += e.amount;
  if (pl.isHuman) unhappy *= diff.humanUnhappinessPct / 100;
  unhappy = Math.round(unhappy);
  return { happy, unhappy, net: happy - unhappy, luxuries };
}
