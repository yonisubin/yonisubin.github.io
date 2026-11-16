// Wires later systems into the core's extension points (imported once by game.ts).
import { EFFECT_POST, EFFECT_SOURCES } from './systems/effects';
import { cityStateEffects, patronageEffects, allyResources, setCityStateWarHook, setLuxuryCheck } from './systems/citystates';
import { LUXURY_HOOKS, luxuryCounts } from './systems/diplomacy';
import type { GameState } from './state';
import { CITY_EFFECT_SOURCES } from './systems/effects';
import { majority, religionCityEffects, religionHappiness, religionPlayerEffects } from './systems/religion';
import { HAPPINESS_HOOKS } from './systems/happiness';
import { CITY_HOOKS } from './systems/yields';
import { cityRouteYields } from './systems/trade';
import { SCORE_HOOKS } from './systems/economy';
import { OPINION_HOOKS } from './systems/diplomacy';
import { capitalOf } from './query';
import { cityCultureYields, concertTour, culturalWinner, findSlot, makeGreatWork, tourismPct } from './systems/culture';
import { publicOpinion } from './systems/ideology';
import { congressCityEffects, congressEffects, setDiplomaticWin } from './systems/congress';
import { spyVision } from './systems/espionage';
import { VISIBILITY_HOOKS } from './systems/visibility';
import { declareWinner, VICTORY_CHECKS } from './game';
import { GP_USE_HOOKS } from './systems/greatpeople';
import { unitDef as udef } from './query';

// Great artists, writers and musicians can create great works; musicians also tour.
GP_USE_HOOKS.push((s, u, out) => {
  const t = udef(u).greatPerson;
  const kind = t === 'artist' ? 'art' : t === 'writer' ? 'writing' : t === 'musician' ? 'music' : null;
  if (kind && findSlot(s, u.owner, kind)) out.push('great_work' as never);
});
GP_DO_HOOKS.push((s, u, use) => {
  if (use === 'great_work') {
    const t = udef(u).greatPerson;
    return makeGreatWork(s, u.owner, t === 'artist' ? 'art' : t === 'writer' ? 'writing' : 'music');
  }
  if (use === 'concert') {
    concertTour(s, u.owner);
    return null;
  }
  return undefined;
});

function capitalReligion(s: GameState, p: number): string | null {
  const c = capitalOf(s, p);
  return c ? majority(c) : null;
}

export function installHooks(setWar: (s: GameState, a: number, b: number, war: boolean) => void): void {
  EFFECT_SOURCES.push(cityStateEffects);
  EFFECT_SOURCES.push(religionPlayerEffects);
  CITY_EFFECT_SOURCES.push(religionCityEffects);
  HAPPINESS_HOOKS.push((s, p) => [religionHappiness(s, p), 0]);
  CITY_HOOKS.push((s, c, y) => {
    for (const [k, v] of Object.entries(cityRouteYields(s, c))) (y as unknown as Record<string, number>)[k] += v;
  });
  SCORE_HOOKS.push((s, p) => (s.players[p].religion ? D.rules.score.perReligion : 0));
  // Phase 11: great works, tourism, ideology.
  SCORE_HOOKS.push((s, p) => Object.values(s.greatWorks).filter((w) => Object.values(s.cities).some((c) => c.owner === p && Object.values(c.works ?? {}).some((ids) => ids.includes(w.id)))).length * D.rules.score.perGreatWork);
  CITY_HOOKS.push((s, c, y, pct) => {
    const cy = cityCultureYields(s, c);
    y.culture += cy.culture;
    y.tourism += cy.tourism;
    pct.tourism += tourismPct(s, c.owner);
    // Anarchy after switching ideology: the city produces little.
    if ((s.players[c.owner].anarchy ?? 0) > 0) for (const k of ['production', 'gold', 'science', 'culture'] as const) pct[k] -= 100;
  });
  HAPPINESS_HOOKS.push((s, p) => [0, publicOpinion(s, p).unhappiness]);
  // Phase 12: the World Congress and espionage.
  EFFECT_SOURCES.push(congressEffects);
  CITY_EFFECT_SOURCES.push(congressCityEffects);
  setDiplomaticWin((s, p, how) => declareWinner(s, p, 'diplomatic', how));
  VISIBILITY_HOOKS.push(spyVision);
  VICTORY_CHECKS.push((s) => {
    if (!s.settings.victories.culture) return;
    const w = culturalWinner(s);
    if (w !== null) declareWinner(s, w, 'culture', 'became the culture everyone follows');
  });
  OPINION_HOOKS.push((s, a, b) => {
    const ia = s.players[a].ideology, ib = s.players[b].ideology;
    if (!ia || !ib) return [];
    return [{ label: ia === ib ? 'Same ideology' : 'Rival ideology', value: ia === ib ? D.rules.ideology.opinionSame : D.rules.ideology.opinionDifferent }];
  });
  OPINION_HOOKS.push((s, a, b) => {
    const ra = capitalReligion(s, a), rb = capitalReligion(s, b);
    if (!ra || !rb) return [];
    const zeal = (D.factions.get(s.players[a].faction)?.leader.personality.religion ?? 5) / 5;
    return [{ label: ra === rb ? 'Shared faith' : 'Different faith', value: (ra === rb ? D.rules.religion.opinionSame : D.rules.religion.opinionDifferent) * zeal }];
  });
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
