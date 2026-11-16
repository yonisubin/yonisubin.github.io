// Tile and city yields. A tile's yield is a stack: terrain (or hills) → feature → resource →
// improvement (+ fresh water, + tech modifiers) → river gold → faction ability. A city adds its
// buildings, citizens' science and per-cent bonuses on top of its worked tiles.
import { D, get } from '../../data';
import { YIELD_KEYS, type YieldKey } from '../../data/schema';
import { neighbors } from '../hex';
import { dims, effectsOf, hasTech, playerCities, tileAt } from '../query';
import { emptyYields, type City, type GameState, type YieldSet } from '../state';
import { happinessOf } from './happiness';

function addY(y: YieldSet, src: Partial<Record<YieldKey, number>> | undefined, mult = 1): void {
  if (!src) return;
  for (const k of YIELD_KEYS) if (src[k]) y[k] += src[k]! * mult;
}

export function hasFreshWater(s: GameState, i: number): boolean {
  const t = tileAt(s, i);
  if (t.river) return true;
  return neighbors(dims(s), i).some((j) => {
    const n = tileAt(s, j);
    return n.terrain === 'lake' || n.feature === 'oasis';
  });
}

/** Can player p see/use the resource on this tile (its reveal tech is known)? */
export function resourceVisible(s: GameState, p: number, i: number): boolean {
  const t = tileAt(s, i);
  if (!t.resource) return false;
  if (p < 0) return true;
  return hasTech(s.players[p], D.resources.get(t.resource)!.revealTech);
}

/** Yields of tile i when worked by player p (p = -1: ignore player-specific bonuses). */
export function tileYields(s: GameState, i: number, p: number): YieldSet {
  const t = tileAt(s, i);
  const y = emptyYields();
  const ter = get(D.terrains, t.terrain);
  if (t.hills) addY(y, D.rules.hills.yields);
  else addY(y, ter.yields);
  if (t.feature) {
    const f = get(D.features, t.feature);
    if (f.replace) {
      Object.assign(y, emptyYields());
      addY(y, f.replace);
    }
    addY(y, f.add);
  }
  const pl = p >= 0 ? s.players[p] : undefined;
  if (t.resource && resourceVisible(s, p, i)) addY(y, get(D.resources, t.resource).yields);
  if (t.improvement && !t.pillaged) {
    const imp = get(D.improvements, t.improvement);
    addY(y, imp.yields);
    if (imp.freshWaterFood && hasFreshWater(s, i)) y.food += imp.freshWaterFood;
    if (t.resource && resourceVisible(s, p, i)) {
      const r = get(D.resources, t.resource);
      if (r.improvement === t.improvement) addY(y, r.improvedYields);
    }
    if (pl)
      for (const tech of pl.techs)
        for (const mod of D.techs.get(tech)!.tileMods)
          if (mod.improvement === t.improvement && (!mod.freshWaterOnly || hasFreshWater(s, i))) y[mod.yield] += mod.amount;
  }
  if (t.river) y.gold += D.rules.riverGold;
  if (p >= 0)
    for (const e of effectsOf(s, p)) {
      if (e.type !== 'tile_yield') continue;
      const hit =
        (e.where === 'river' && t.river !== 0) ||
        (e.where === 'hills' && t.hills) ||
        (e.where === 'tundra_snow' && (t.terrain === 'tundra' || t.terrain === 'snow')) ||
        (e.where === 'desert' && t.terrain === 'desert') ||
        (e.where === 'forest' && t.feature === 'forest') ||
        (e.where === 'coast' && t.terrain === 'coast');
      if (hit) y[e.yield] += e.amount;
    }
  for (const k of YIELD_KEYS) y[k] = Math.max(0, y[k]);
  return y;
}

/** Yields of a city's own tile (at least rules.cityTileMin). */
export function cityTileYields(s: GameState, c: City): YieldSet {
  const y = tileYields(s, c.tile, c.owner);
  const min = D.rules.cityTileMin;
  for (const k of YIELD_KEYS) y[k] = Math.max(y[k], min[k] ?? 0);
  return y;
}

export interface CityYieldReport {
  /** Gross yields after per-cent bonuses (food before citizens eat). */
  total: YieldSet;
  /** Food left after citizens eat, after unhappiness (can be negative). */
  foodSurplus: number;
  /** Food needed for the next citizen. */
  growthNeeded: number;
  /** Turns until growth (Infinity if not growing) or starvation (negative). */
  growthTurns: number;
}

export function growthNeeded(s: GameState, c: City): number {
  const g = D.rules.growth;
  const n = c.pop;
  const base = Math.floor(g.base + g.linear * (n - 1) + Math.pow(n - 1, g.exponent));
  return Math.max(1, Math.round(base * growthMult(s, c.owner)));
}

/** Growth uses pace only (difficulty affects research/production through costMult). */
function growthMult(s: GameState, p: number): number {
  const pace = get(D.pace, s.settings.pace).costPct / 100;
  const pl = s.players[p];
  const diff = get(D.difficulty, s.settings.difficulty);
  return pace * ((pl.isHuman ? diff.humanCostPct : pl.isBarbarian ? 100 : diff.aiCostPct) / 100);
}

/** Does this player have a buildable (or built) building of this base id in the city? */
export function hasBuilding(c: City, base: string): boolean {
  return c.buildings.some((b) => b === base || D.buildings.get(b)?.replaces === base);
}

export function cityYields(s: GameState, c: City, happiness = happinessOf(s, c.owner).net): CityYieldReport {
  const y = emptyYields();
  for (const i of c.worked) {
    const ty = tileYields(s, i, c.owner);
    for (const k of YIELD_KEYS) y[k] += ty[k];
  }
  const ct = cityTileYields(s, c);
  for (const k of YIELD_KEYS) y[k] += ct[k];
  const unemployed = Math.max(0, c.pop - c.worked.length);
  y.production += unemployed * D.rules.unemployedProduction;
  y.science += c.pop * D.rules.sciencePerCitizen;
  const pct = emptyYields();
  for (const bid of c.buildings) {
    const b = get(D.buildings, bid);
    addY(y, b.yields);
    addY(y, b.perPop, c.pop);
    addY(pct, b.percent);
  }
  for (const e of effectsOf(s, c.owner)) if (e.type === 'city_percent') pct[e.yield] += e.percent;
  for (const k of YIELD_KEYS) if (k !== 'food') y[k] = y[k] * (1 + pct[k] / 100);
  if (c.resistance > 0 || c.razing) {
    y.production = y.gold = y.science = y.culture = 0;
  }
  const eat = c.pop * D.rules.foodPerCitizen;
  let surplus = y.food - eat;
  if (surplus > 0) {
    surplus *= 1 + pct.food / 100;
    if (happiness <= D.rules.happiness.veryUnhappy) surplus = 0;
    else if (happiness < 0) surplus *= D.rules.happiness.unhappyGrowthPct / 100;
    if (c.avoidGrowth) surplus = 0;
  }
  const needed = growthNeeded(s, c);
  const growthTurns = surplus > 0 ? Math.max(1, Math.ceil((needed - c.food) / surplus)) : surplus < 0 ? -Math.max(1, Math.ceil(c.food / -surplus)) : Infinity;
  return { total: y, foodSurplus: surplus, growthNeeded: needed, growthTurns };
}

/** Sum of a player's city yields (science and culture per turn, gross gold). */
export function playerYields(s: GameState, p: number): YieldSet {
  const happy = happinessOf(s, p).net;
  const y = emptyYields();
  for (const c of playerCities(s, p)) {
    const r = cityYields(s, c, happy);
    for (const k of YIELD_KEYS) y[k] += r.total[k];
  }
  return y;
}
