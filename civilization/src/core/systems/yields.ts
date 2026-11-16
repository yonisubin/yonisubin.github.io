// Tile and city yields. A tile's yield is a stack: terrain (or hills) → feature → resource →
// improvement (+ fresh water, + tech modifiers) → river gold → effects (abilities, policies...)
// → golden age. A city adds specialists, buildings, citizens' science, flat and per-cent effects.
import { D, get } from '../../data';
import { YIELD_KEYS, type YieldKey } from '../../data/schema';
import { neighbors } from '../hex';
import { dims, hasTech, playerCities, tileAt } from '../query';
import { emptyYields, type City, type GameState, type YieldSet } from '../state';
import { happinessOf } from './happiness';
import { cityEffects, inScope, playerEffects, sum } from './effects';

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

export const inGoldenAge = (s: GameState, p: number) => p >= 0 && !!s.players[p] && (s.players[p].goldenAge?.turnsLeft ?? 0) > 0;

function tileMatches(s: GameState, i: number, where: string | undefined): boolean {
  const t = tileAt(s, i);
  switch (where) {
    case 'river':
      return t.river !== 0;
    case 'hills':
      return t.hills;
    case 'tundra_snow':
      return t.terrain === 'tundra' || t.terrain === 'snow';
    case 'desert':
      return t.terrain === 'desert';
    case 'forest':
      return t.feature === 'forest';
    case 'jungle':
      return t.feature === 'jungle';
    case 'coast':
      return t.terrain === 'coast';
    case 'water':
      return D.terrains.get(t.terrain)!.water;
    case 'mountain':
      return t.terrain === 'mountain';
    case 'luxury':
      return !!t.resource && D.resources.get(t.resource)!.kind === 'luxury';
    case 'strategic':
      return !!t.resource && D.resources.get(t.resource)!.kind === 'strategic';
    case 'bonus':
      return !!t.resource && D.resources.get(t.resource)!.kind === 'bonus';
    default:
      // "improvement:farm", "resource:wheat", "feature:marsh", "terrain:desert"
      if (where?.includes(':')) {
        const [k, v] = where.split(':');
        if (k === 'improvement') return t.improvement === v && !t.pillaged;
        if (k === 'resource') return t.resource === v;
        if (k === 'feature') return t.feature === v;
        if (k === 'terrain') return t.terrain === v;
      }
      return false;
  }
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
  // Harbors and lighthouses improve the water tiles their city works.
  if (ter.water && t.cityId >= 0 && s.cities[t.cityId]) for (const b of s.cities[t.cityId].buildings) addY(y, D.buildings.get(b)?.waterYields);
  if (p >= 0) {
    for (const e of playerEffects(s, p)) if (e.type === 'tile_yield' && e.yield && tileMatches(s, i, e.where)) y[e.yield] += e.amount;
    for (const h of TILE_HOOKS) h(s, i, p, y);
    if (inGoldenAge(s, p)) {
      const g = D.rules.goldenAge;
      if (y.production >= 1) y.production += g.productionBonus;
      if (y.gold >= 1) y.gold += g.goldBonus;
    }
  }
  for (const k of YIELD_KEYS) y[k] = Math.max(0, y[k]);
  return y;
}

/** Extra per-tile yield sources added by later phases (beliefs...). */
export const TILE_HOOKS: ((s: GameState, i: number, p: number, y: YieldSet) => void)[] = [];

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

/** Growth uses pace and difficulty (the same multiplier as research and production). */
function growthMult(s: GameState, p: number): number {
  const pace = get(D.pace, s.settings.pace).costPct / 100;
  const pl = s.players[p];
  const diff = get(D.difficulty, s.settings.difficulty);
  return pace * ((pl.isHuman ? diff.humanCostPct : pl.isBarbarian ? 100 : diff.aiCostPct) / 100);
}

/** Does the city have a building of this base id (or a unique that replaces it)? */
export function hasBuilding(c: City, base: string): boolean {
  return c.buildings.some((b) => b === base || D.buildings.get(b)?.replaces === base);
}

export function specialistCount(c: City): number {
  let n = 0;
  for (const v of Object.values(c.specialists ?? {})) n += v;
  return n;
}

/** Specialist slots in a city by type (from its buildings). */
export function specialistSlots(c: City): Record<string, number> {
  const out: Record<string, number> = {};
  for (const b of c.buildings) for (const [k, v] of Object.entries(get(D.buildings, b).specialists)) out[k] = (out[k] ?? 0) + v;
  return out;
}

/** Extra per-city yield sources added by later phases (trade routes, city-states...). */
export const CITY_HOOKS: ((s: GameState, c: City, y: YieldSet, pct: YieldSet) => void)[] = [];

export function cityYields(s: GameState, c: City, happiness = happinessOf(s, c.owner).net): CityYieldReport {
  const y = emptyYields();
  for (const i of c.worked) {
    const ty = tileYields(s, i, c.owner);
    for (const k of YIELD_KEYS) y[k] += ty[k];
  }
  const ct = cityTileYields(s, c);
  for (const k of YIELD_KEYS) y[k] += ct[k];
  for (const [id, n] of Object.entries(c.specialists ?? {})) addY(y, get(D.specialists, id).yields, n);
  const unemployed = Math.max(0, c.pop - c.worked.length - specialistCount(c));
  y.production += unemployed * D.rules.unemployedProduction;
  y.science += c.pop * D.rules.sciencePerCitizen;
  const pct = emptyYields();
  for (const bid of c.buildings) {
    const b = get(D.buildings, bid);
    addY(y, b.yields);
    addY(y, b.perPop, c.pop);
    addY(pct, b.percent);
  }
  let growthPct = 0;
  for (const e of cityEffects(s, c)) {
    if (!e.yield && e.type !== 'growth_pct') continue;
    if (!inScope(s, e, c)) continue;
    if (e.type === 'city_yield') y[e.yield!] += e.amount;
    else if (e.type === 'per_pop') y[e.yield!] += e.amount * c.pop;
    else if (e.type === 'city_percent') pct[e.yield!] += e.percent;
    else if (e.type === 'growth_pct') growthPct += e.percent;
  }
  for (const h of CITY_HOOKS) h(s, c, y, pct);
  if (inGoldenAge(s, c.owner)) pct.culture += D.rules.goldenAge.culturePct;
  for (const k of YIELD_KEYS) if (k !== 'food') y[k] = y[k] * (1 + pct[k] / 100);
  if (c.resistance > 0 || c.razing) {
    y.production = y.gold = y.science = y.culture = y.faith = 0;
  }
  if (c.puppet) {
    // Puppets give less science and culture (they run themselves).
    y.science *= 0.75;
    y.culture *= 0.75;
  }
  const eat = c.pop * D.rules.foodPerCitizen;
  let surplus = y.food - eat;
  if (surplus > 0) {
    surplus *= 1 + (pct.food + growthPct) / 100;
    if (happiness <= D.rules.happiness.veryUnhappy) surplus = 0;
    else if (happiness < 0) surplus *= D.rules.happiness.unhappyGrowthPct / 100;
    if (c.avoidGrowth) surplus = 0;
  }
  const needed = growthNeeded(s, c);
  const growthTurns = surplus > 0 ? Math.max(1, Math.ceil((needed - c.food) / surplus)) : surplus < 0 ? -Math.max(1, Math.ceil(c.food / -surplus)) : Infinity;
  return { total: y, foodSurplus: surplus, growthNeeded: needed, growthTurns };
}

/** Great person points a city makes per turn, by type. */
export function cityGreatPeople(s: GameState, c: City): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [id, n] of Object.entries(c.specialists ?? {})) {
    const sp = get(D.specialists, id);
    out[sp.gp] = (out[sp.gp] ?? 0) + sp.points * n;
  }
  for (const b of c.buildings) for (const [k, v] of Object.entries(get(D.buildings, b).greatPeople)) out[k] = (out[k] ?? 0) + v;
  const fx = playerEffects(s, c.owner);
  for (const k of Object.keys(out)) out[k] *= 1 + sum(fx, 'great_people_pct', 'percent', (e) => !e.gp || e.gp === k) / 100;
  return out;
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
