// Gold income/expenses, city connections and strategic resource counts.
import { D, get } from '../../data';
import { neighbors } from '../hex';
import { allUnits, atWar, capitalOf, dims, hasTech, playerCities, playerUnits, unitDef } from '../query';
import { playerEffects, sum } from './effects';
import { strategicDealDelta } from './diplomacy';
import { allyResources } from './citystates';
import type { GameState } from '../state';
import { cityYields } from './yields';
import { happinessOf } from './happiness';

/** Cities (ids) connected to player p's capital by roads (or adjacency) not through enemy land. */
export function connectedCities(s: GameState, p: number): Set<number> {
  const out = new Set<number>();
  const cap = capitalOf(s, p);
  if (!cap) return out;
  const m = dims(s);
  const seen = new Set<number>([cap.tile]);
  const stack = [cap.tile];
  const cityTiles = new Map<number, number>();
  for (const c of playerCities(s, p)) cityTiles.set(c.tile, c.id);
  while (stack.length) {
    const i = stack.pop()!;
    const cid = cityTiles.get(i);
    if (cid !== undefined) out.add(cid);
    for (const n of neighbors(m, i)) {
      if (seen.has(n)) continue;
      const t = s.map.tiles[n];
      const passable = t.road || cityTiles.has(n);
      if (!passable || (t.owner >= 0 && atWar(s, p, t.owner))) continue;
      seen.add(n);
      stack.push(n);
    }
  }
  return out;
}

/** Extra gold per turn from later phases (trade routes, deals...). Can be negative. */
export const GOLD_HOOKS: ((s: GameState, p: number) => number)[] = [];

export interface GoldReport {
  cities: number;
  connections: number;
  buildings: number;
  units: number;
  roads: number;
  net: number;
}

export function unitUpkeep(s: GameState, p: number): number {
  const u = D.rules.unitUpkeep;
  const count = playerUnits(s, p).length;
  const free = u.freeUnits + playerCities(s, p).length * u.freePerCity;
  const perUnit = u.base + Math.floor(s.turn / u.perTurns);
  return Math.max(0, count - free) * perUnit;
}

export function goldReport(s: GameState, p: number): GoldReport {
  const happy = happinessOf(s, p).net;
  let cities = 0;
  let buildings = 0;
  for (const c of playerCities(s, p)) {
    cities += cityYields(s, c, happy).total.gold;
    for (const b of c.buildings) buildings += get(D.buildings, b).maintenance;
  }
  let connections = 0;
  const cg = D.rules.connectionGold;
  const fx = playerEffects(s, p);
  const extra = sum(fx, 'connection_gold');
  for (const id of connectedCities(s, p)) {
    const c = s.cities[id];
    if (c.isCapital) continue;
    connections += cg.base + c.pop * cg.perPop + extra;
  }
  let roads = 0;
  s.map.tiles.forEach((t, i) => {
    const isCityTile = t.cityId >= 0 && s.cities[t.cityId]?.tile === i;
    if (t.road && t.roadOwner === p && !isCityTile) roads += D.rules.roadMaintenance;
  });
  const upkeep = (t: string) => Math.max(0, 1 + sum(fx, 'upkeep_pct', 'percent', (e) => e.target === t) / 100);
  const units = Math.round(unitUpkeep(s, p) * upkeep('unit'));
  buildings = Math.round(buildings * upkeep('building'));
  roads = Math.round(roads * upkeep('road'));
  let other = 0;
  for (const h of GOLD_HOOKS) other += h(s, p);
  cities = Math.round(cities) + Math.round(other);
  connections = Math.round(connections);
  return { cities, connections, buildings, units, roads, net: cities + connections - buildings - units - roads };
}

/** Strategic resources: total from improved tiles and how many units use them. */
export function strategicResources(s: GameState, p: number): Record<string, { total: number; used: number }> {
  const out: Record<string, { total: number; used: number }> = {};
  const pl = s.players[p];
  for (const r of D.resources.values()) if (r.kind === 'strategic') out[r.id] = { total: 0, used: 0 };
  for (let i = 0; i < s.map.tiles.length; i++) {
    const t = s.map.tiles[i];
    if (t.owner !== p || !t.resource || !out[t.resource]) continue;
    const r = D.resources.get(t.resource)!;
    if (!hasTech(pl, r.revealTech)) continue;
    const underCity = t.cityId >= 0 && s.cities[t.cityId]?.tile === i;
    if ((t.improvement === r.improvement && !t.pillaged) || underCity) out[t.resource].total += t.resourceQty;
  }
  for (const u of allUnits(s)) {
    if (u.owner !== p) continue;
    const need = unitDef(u).resource;
    if (need && out[need]) out[need].used++;
  }
  for (const c of playerCities(s, p))
    for (const b of c.buildings) {
      const need = get(D.buildings, b).requires.resource;
      if (need && out[need]) out[need].used++;
    }
  // Deals and city-state allies.
  const ally = allyResources(s, p, 'strategic');
  for (const k of Object.keys(out)) {
    if (!hasTech(pl, D.resources.get(k)!.revealTech)) continue;
    out[k].total += (ally[k] ?? 0) + strategicDealDelta(s, p, k);
  }
  return out;
}

export function score(s: GameState, p: number): number {
  const sc = D.rules.score;
  let v = 0;
  for (const c of playerCities(s, p)) v += sc.perCity + c.pop * sc.perCitizen + c.buildings.length * sc.perBuilding;
  for (const t of s.map.tiles) if (t.owner === p) v += sc.perLandTile;
  const pl = s.players[p];
  v += pl.techs.length * sc.perTech + pl.futureTechs * sc.perFutureTech;
  for (const n of Object.values(pl.spaceship)) v += n * sc.spaceshipPart;
  for (const h of SCORE_HOOKS) v += h(s, p);
  return Math.round(v);
}

/** Extra score sources added by later systems (wonders, policies, great works, religion). */
export const SCORE_HOOKS: ((s: GameState, p: number) => number)[] = [];
