// Cities: founding, territory (culture borders and buying tiles), citizens, growth, the
// production queue (with overflow and gold purchases), defence, capture and razing.
import { D, get, type BuildingDef, type ProjectDef, type UnitDef } from '../../data';
import { YIELD_KEYS } from '../../data/schema';
import { distance, neighbors, within } from '../hex';
import {
  allCities,
  capitalOf,
  costMult,
  dims,
  hasTech,
  isCivilian,
  logEvent,
  militaryAt,
  notify,
  playerCities,
  tileAt,
  unitDef,
  unitsAt,
} from '../query';
import type { City, CityFocus, GameState, QueueItem } from '../state';
import { isPassableLand, tileValue } from '../../mapgen/generate';
import { strategicResources } from './economy';
import { happinessOf } from './happiness';
import { cityYields, hasBuilding, specialistSlots, tileYields } from './yields';
import { createUnit, deliverSpaceshipPart, freeTileNear, removeUnit } from './units';
import { addScience } from './research';
import { bumpEffects, cityEffects, costPct, inScope, isCoastal, sum } from './effects';
import { applyOneShots } from './policies';
import { addWarmonger } from './diplomacy';
import { onCityStateConquered, questEvent } from './citystates';
import { recordSite } from './archaeology';
import { contributeToFair } from './congress';
import { recomputeAllVisibility } from './visibility';
import type { StrengthReport } from './combat';

// ---- Founding ----

export function canFoundAt(s: GameState, p: number, tile: number): string | null {
  const t = tileAt(s, tile);
  if (!isPassableLand(t)) return 'cannot found a city here';
  if (t.owner >= 0 && t.owner !== p) return 'this land belongs to someone else';
  for (const c of allCities(s)) if (distance(dims(s), c.tile, tile) < D.rules.minCityDistance) return `too close to ${c.name}`;
  return null;
}

export function nextCityName(s: GameState, p: number): string {
  const pl = s.players[p];
  if (pl.isMinor) return pl.name;
  const names = get(D.factions, pl.faction).cityNames;
  const used = new Set(allCities(s).map((c) => c.name));
  for (let k = 0; k < names.length; k++) {
    const n = names[(pl.nextCityName + k) % names.length];
    if (!used.has(n)) {
      pl.nextCityName = (pl.nextCityName + k + 1) % names.length;
      return n;
    }
  }
  pl.nextCityName++;
  return `${names[0]} ${pl.nextCityName}`;
}

export function foundCity(s: GameState, p: number, tile: number): City {
  const pl = s.players[p];
  const first = !capitalOf(s, p);
  const id = s.nextId++;
  const t = tileAt(s, tile);
  if (t.feature && t.feature !== 'floodplains') t.feature = null;
  t.improvement = null;
  t.road = true;
  t.ruin = false;
  const c: City = {
    id,
    name: nextCityName(s, p),
    owner: p,
    originalOwner: p,
    wasCapital: first,
    isCapital: first,
    tile,
    pop: 1,
    food: 0,
    production: 0,
    queue: [],
    buildings: first ? ['palace'] : [],
    culture: 0,
    tilesClaimed: 0,
    tilesBought: 0,
    worked: [],
    locked: [],
    focus: 'default',
    avoidGrowth: false,
    hp: 0,
    hasAttacked: false,
    resistance: 0,
    puppet: false,
    razing: false,
    occupied: false,
    founded: s.turn,
    damagedThisTurn: false,
    specialists: {},
    manualSpecialists: {},
    followers: {},
    pressure: {},
    works: {},
  };
  c.hp = cityMaxHp(c);
  s.cities[id] = c;
  for (const i of within(dims(s), tile, 1)) {
    const ti = tileAt(s, i);
    if (ti.owner < 0 || i === tile || (ti.owner === p && ti.cityId < 0)) claimTile(s, c, i);
  }
  claimTile(s, c, tile);
  pl.hadCity = true;
  assignCitizens(s, c);
  notify(s, p, `${c.name} was founded${first ? ' — your capital' : ''}.`, 'good', tile);
  logEvent(s, `The ${pl.name} founded ${c.name}.`, tile, p);
  recomputeAllVisibility(s);
  return c;
}

export function claimTile(s: GameState, c: City, i: number): void {
  const t = tileAt(s, i);
  t.owner = c.owner;
  t.cityId = c.id;
}

// ---- Strength and HP ----

export function cityMaxHp(c: City): number {
  let hp = D.rules.city.hp;
  for (const b of c.buildings) hp += get(D.buildings, b).hp;
  return hp;
}

export function cityStrength(s: GameState, c: City): StrengthReport {
  const r = D.rules.city;
  let base = r.baseStrength + c.pop * r.perPop;
  for (const b of c.buildings) base += get(D.buildings, b).defense;
  if (c.isCapital) base += r.capitalBonus;
  base *= 1 + sum(cityEffects(s, c), 'defense_pct', 'percent', (e) => inScope(s, e, c)) / 100;
  const g = militaryAt(s, c.tile);
  if (g && g.owner === c.owner) base += unitDef(g).strength * r.garrisonShare;
  const mods = tileAt(s, c.tile).hills ? [{ label: 'Hills', pct: r.hillsPct }] : [];
  const value = base * (1 + mods.reduce((a, m) => a + m.pct, 0) / 100);
  return { base: Math.round(base * 10) / 10, value, mods };
}

// ---- Citizens ----

const FOCUS_WEIGHTS: Record<CityFocus, Record<string, number>> = {
  default: { food: 2.5, production: 2, gold: 1.2, science: 1, culture: 1, faith: 1, tourism: 0.5 },
  food: { food: 6, production: 1, gold: 0.5, science: 0.5, culture: 0.5 , faith: 0.5, tourism: 0.5 },
  production: { food: 2, production: 6, gold: 0.5, science: 0.5, culture: 0.5 , faith: 0.5, tourism: 0.5 },
  gold: { food: 2, production: 1, gold: 6, science: 0.5, culture: 0.5 , faith: 0.5, tourism: 0.5 },
  science: { food: 2, production: 1, gold: 0.5, science: 6, culture: 0.5 , faith: 0.5, tourism: 0.5 },
  culture: { food: 2, production: 1, gold: 0.5, science: 0.5, culture: 6 , faith: 0.5, tourism: 0.5 },
};

/** Tiles this city could work: its own territory within the work radius, not another city's. */
export function workableTiles(s: GameState, c: City): number[] {
  return within(dims(s), c.tile, D.rules.workRadius).filter((i) => {
    if (i === c.tile) return false;
    const t = tileAt(s, i);
    if (t.owner !== c.owner || t.cityId !== c.id) return false;
    if (get(D.terrains, t.terrain).impassable) return false;
    const enemy = unitsAt(s, i).some((u) => u.owner !== c.owner);
    return !enemy;
  });
}

export function assignCitizens(s: GameState, c: City): void {
  const tiles = workableTiles(s, c);
  // Specialists the player asked for, limited by slots and population.
  const slots = specialistSlots(c);
  const manual: Record<string, number> = {};
  let used = 0;
  for (const [k, n] of Object.entries(c.manualSpecialists ?? {})) {
    const v = Math.max(0, Math.min(n, slots[k] ?? 0, c.pop - 1 - used));
    if (v > 0) manual[k] = v;
    used += v;
  }
  c.manualSpecialists = manual;
  c.specialists = { ...manual };
  const workers = c.pop - used;
  c.locked = c.locked.filter((i) => tiles.includes(i)).slice(0, workers);
  const pick = (foodWeight?: number) => {
    const w = { ...FOCUS_WEIGHTS[c.focus] };
    if (foodWeight) w.food = foodWeight;
    const scored = tiles
      .filter((i) => !c.locked.includes(i))
      .map((i) => {
        const y = tileYields(s, i, c.owner);
        let v = 0;
        for (const k of YIELD_KEYS) v += y[k] * w[k];
        return { i, v };
      })
      .sort((a, b) => b.v - a.v || a.i - b.i);
    const worked = [...c.locked];
    for (const x of scored) {
      if (worked.length >= workers) break;
      if (x.v <= D.rules.unemployedProduction * w.production * 0.99 && x.v <= 0) continue;
      worked.push(x.i);
    }
    return worked;
  };
  c.worked = pick();
  // Avoid starving: if food runs short, weigh food much more.
  if (cityYields(s, c).foodSurplus < 0) c.worked = pick(8);
  // Citizens with no tile to work fill free specialist slots (best for the city's focus).
  let idle = workers - c.worked.length;
  if (idle > 0) {
    const w = FOCUS_WEIGHTS[c.focus];
    const kinds = Object.keys(slots).sort((a, b) => specValue(b, w) - specValue(a, w) || a.localeCompare(b));
    for (const k of kinds) {
      while (idle > 0 && (c.specialists[k] ?? 0) < slots[k]) {
        c.specialists[k] = (c.specialists[k] ?? 0) + 1;
        idle--;
      }
    }
  }
}

function specValue(id: string, w: Record<string, number>): number {
  const y = get(D.specialists, id).yields;
  let v = 0;
  for (const k of YIELD_KEYS) v += (y[k] ?? 0) * w[k];
  return v;
}

// ---- Borders ----

export function borderCost(s: GameState, c: City): number {
  const b = D.rules.border;
  const pace = get(D.pace, s.settings.pace).costPct / 100;
  return Math.round((b.base + Math.pow(b.perTile * c.tilesClaimed, b.exponent)) * pace * Math.max(0.1, 1 + costPct(s, c.owner, 'border') / 100));
}

/** Unowned tiles next to the city's territory that it could claim or buy. */
export function claimableTiles(s: GameState, c: City): number[] {
  const m = dims(s);
  const out: number[] = [];
  for (const i of within(m, c.tile, D.rules.ownRadius)) {
    const t = tileAt(s, i);
    if (t.owner >= 0) continue;
    if (neighbors(m, i).some((n) => tileAt(s, n).cityId === c.id)) out.push(i);
  }
  return out;
}

function bestClaim(s: GameState, c: City): number {
  let best = -1, bestV = -Infinity;
  for (const i of claimableTiles(s, c)) {
    const t = tileAt(s, i);
    let v = tileValue(t) - distance(dims(s), c.tile, i) * 2;
    if (t.resource) v += D.resources.get(t.resource)!.kind === 'bonus' ? 2 : 4;
    if (distance(dims(s), c.tile, i) > D.rules.workRadius) v -= 3;
    if (v > bestV) {
      bestV = v;
      best = i;
    }
  }
  return best;
}

export function tileBuyCost(s: GameState, c: City, i: number): number {
  const b = D.rules.tileBuy;
  const pace = get(D.pace, s.settings.pace).costPct / 100;
  return Math.round((b.base + b.perDistance * distance(dims(s), c.tile, i) + b.perBought * c.tilesBought) * pace * Math.max(0.1, 1 + costPct(s, c.owner, 'tile') / 100));
}

// ---- Production ----

export function itemDef(item: QueueItem): UnitDef | BuildingDef | ProjectDef {
  return item.kind === 'unit' ? get(D.units, item.id) : item.kind === 'project' ? get(D.projects, item.id) : get(D.buildings, item.id);
}

/** Processes (Wealth, Research) never finish: they convert production every turn. */
export const isProcess = (item: QueueItem | undefined) => !!item && item.kind === 'project' && !!D.projects.get(item.id)?.process;

/** Which cost_pct targets apply to an item. */
function costTargets(item: QueueItem): string[] {
  if (item.kind === 'unit') {
    const u = get(D.units, item.id);
    const t = ['unit', u.replaces ?? u.id];
    if (u.spaceshipPart) t.push('spaceship');
    return t;
  }
  if (item.kind === 'building') {
    const b = get(D.buildings, item.id);
    return b.wonder ? ['wonder', b.id] : ['building', b.replaces ?? b.id];
  }
  return ['project', item.id];
}

export function itemCost(s: GameState, p: number, item: QueueItem): number {
  let cost = itemDef(item).cost * costMult(s, p);
  if (item.kind === 'building' && get(D.buildings, item.id).wonder === 'national') {
    // National wonders cost more the more cities you have.
    cost *= 1 + (D.rules.nationalWonderPerCityPct / 100) * Math.max(0, playerCities(s, p).length - 1);
  }
  cost *= Math.max(0.1, 1 + costPct(s, p, costTargets(item)) / 100);
  return Math.max(1, Math.round(cost));
}

export function buyCost(s: GameState, c: City, item: QueueItem): number {
  const b = D.rules.buy;
  const progress = c.queue[0] && c.queue[0].kind === item.kind && c.queue[0].id === item.id ? c.production : 0;
  const remaining = Math.max(1, itemCost(s, c.owner, item) - progress);
  let g = b.multiplier * Math.pow(remaining, b.exponent);
  if (item.kind !== 'unit') g *= b.buildingPct / 100;
  g *= Math.max(0.1, 1 + costPct(s, c.owner, 'buy') / 100);
  return Math.round(g);
}

/** Why the city can't build this (or null if it can). */
export function cannotBuild(s: GameState, c: City, item: QueueItem): string | null {
  const pl = s.players[c.owner];
  if (item.kind === 'unit') {
    const u = D.units.get(item.id);
    if (!u) return 'unknown unit';
    if (u.greatPerson || u.cost <= 0) return 'great people cannot be trained';
    if (u.faction && u.faction !== pl.faction) return 'another faction’s unique unit';
    if (!u.faction && [...D.units.values()].some((x) => x.replaces === u.id && x.faction === pl.faction)) return 'replaced by your unique unit';
    if (!hasTech(pl, u.tech)) return `needs ${get(D.techs, u.tech!).name}`;
    if (u.obsoleteTech && hasTech(pl, u.obsoleteTech) && u.upgradesTo) return 'obsolete';
    if (u.resource) {
      const r = strategicResources(s, c.owner)[u.resource];
      if (!r || r.total - r.used < 1) return `needs ${get(D.resources, u.resource).name}`;
    }
    if (u.id === 'settler' && happinessOf(s, c.owner).net <= D.rules.happiness.veryUnhappy) return 'your people are too unhappy';
    if (u.requiresProject && !pl.projects.includes(u.requiresProject) && s.worldProjects[u.requiresProject] === undefined) return `needs the ${get(D.projects, u.requiresProject).name}`;
    if (u.faithCost > 0) return 'bought with faith';
    if (u.nuke && s.congress?.active.some((r) => r.resolution === 'nuclear_ban')) return 'banned by the Atomic Accord';
    if (u.domain === 'sea' && !isCoastal(s, c)) return 'needs a coastal city';
    if (u.requiresBuilding && !hasBuilding(c, u.requiresBuilding)) return `needs a ${get(D.buildings, u.requiresBuilding).name}`;
    return null;
  }
  if (item.kind === 'project') {
    const pr = D.projects.get(item.id);
    if (!pr) return 'unknown project';
    if (!hasTech(pl, pr.tech)) return `needs ${get(D.techs, pr.tech!).name}`;
    if (pr.oncePerPlayer && pl.projects.includes(pr.id)) return 'already completed';
    if (pr.oncePerWorld && s.worldProjects[pr.id] !== undefined) return `already completed by the ${s.players[s.worldProjects[pr.id]].name}`;
    if (pr.international && !s.congress?.fair) return 'only while the World Congress holds one';
    if (pr.oncePerPlayer && playerCities(s, c.owner).some((o) => o.id !== c.id && o.queue[0]?.id === pr.id)) return 'already under way in another city';
    return null;
  }
  const b = D.buildings.get(item.id);
  if (!b) return 'unknown building';
  if (b.auto) return 'cannot be built';
  if (b.belief) return 'bought with faith';
  if (b.faction && b.faction !== pl.faction) return 'another faction’s unique building';
  if (!b.faction && [...D.buildings.values()].some((x) => x.replaces === b.id && x.faction === pl.faction)) return 'replaced by your unique building';
  if (hasBuilding(c, b.replaces ?? b.id)) return 'already built';
  if (!hasTech(pl, b.tech)) return `needs ${get(D.techs, b.tech!).name}`;
  if (b.wonder === 'world' && s.wonders[b.id] !== undefined) {
    const where = s.cities[s.wonders[b.id]];
    return `already built${where && pl.explored[where.tile] ? ` in ${where.name}` : ''}`;
  }
  if (b.wonder === 'national') {
    if (playerCities(s, c.owner).some((o) => hasBuilding(o, b.id))) return 'already built';
    if (b.requires.allCities) {
      const missing = playerCities(s, c.owner).filter((o) => !o.puppet && !hasBuilding(o, b.requires.allCities!));
      if (missing.length) return `needs a ${get(D.buildings, b.requires.allCities).name} in every city (${missing.length} missing)`;
    }
  }
  if (b.wonder && playerCities(s, c.owner).some((o) => o.id !== c.id && o.queue[0]?.kind === 'building' && o.queue[0].id === b.id)) return 'already under way in another city';
  if (b.requires.coast && !isCoastal(s, c)) return 'needs a coastal city';
  if (b.requires.building && !hasBuilding(c, b.requires.building)) return `needs a ${get(D.buildings, b.requires.building).name}`;
  if (b.requires.river && !tileAt(s, c.tile).river) return 'needs a river';
  if (b.requires.mountain && !neighbors(dims(s), c.tile).some((n) => tileAt(s, n).terrain === 'mountain')) return 'needs a mountain next to the city';
  if (b.requires.resource) {
    const r = strategicResources(s, c.owner)[b.requires.resource];
    if (!r || r.total - r.used < 1) return `needs ${get(D.resources, b.requires.resource).name}`;
  }
  return null;
}

/** Everything the city can build now. */
export function buildableItems(s: GameState, c: City): QueueItem[] {
  const out: QueueItem[] = [];
  for (const u of D.units.values()) if (!cannotBuild(s, c, { kind: 'unit', id: u.id })) out.push({ kind: 'unit', id: u.id });
  for (const b of D.buildings.values()) if (!cannotBuild(s, c, { kind: 'building', id: b.id })) out.push({ kind: 'building', id: b.id });
  for (const p of D.projects.values()) if (!cannotBuild(s, c, { kind: 'project', id: p.id })) out.push({ kind: 'project', id: p.id });
  return out;
}

/** Starting XP for units built in this city. */
export function cityXp(c: City): number {
  return c.buildings.reduce((a, b) => a + get(D.buildings, b).xp, 0);
}

/** Put a finished item into the world. Returns false if there was no room (try again next turn). */
function completeItem(s: GameState, c: City, item: QueueItem): boolean {
  if (item.kind === 'project') {
    const pr = get(D.projects, item.id);
    s.players[c.owner].projects.push(pr.id);
    if (pr.oncePerWorld) s.worldProjects[pr.id] = c.owner;
    logEvent(s, `The ${s.players[c.owner].name} completed the ${pr.name}.`, c.tile, c.owner);
    for (const pl of s.players) notify(s, pl.id, pl.id === c.owner ? `${c.name} completed the ${pr.name}!` : `The ${s.players[c.owner].name} completed the ${pr.name}.`, pl.id === c.owner ? 'good' : 'info', c.tile);
    return true;
  }
  if (item.kind === 'building') {
    const b = get(D.buildings, item.id);
    c.buildings.push(item.id);
    if (b.hp) c.hp += b.hp;
    if (b.wonder) completeWonder(s, c, item.id);
    else notify(s, c.owner, `${c.name} built a ${b.name}.`, 'good', c.tile);
    return true;
  }
  const at = freeTileNear(s, item.id, c.owner, c.tile, 2);
  if (at < 0) return false;
  const u = createUnit(s, item.id, c.owner, at, cityXp(c));
  notify(s, c.owner, `${c.name} trained a ${get(D.units, item.id).name}.`, 'good', c.tile);
  if (c.isCapital) deliverSpaceshipPart(s, u);
  return true;
}

function completeWonder(s: GameState, c: City, id: string): void {
  const b = get(D.buildings, id);
  const pl = s.players[c.owner];
  if (b.wonder === 'world') {
    s.wonders[id] = c.id;
    // Everyone else building it loses it; their progress is paid back as gold.
    for (const o of Object.values(s.cities)) {
      if (o.id === c.id || o.queue[0]?.kind !== 'building' || o.queue[0].id !== id) continue;
      const refund = Math.round(o.production);
      o.queue.shift();
      o.production = 0;
      s.players[o.owner].gold += refund;
      notify(s, o.owner, `The ${pl.name} finished the ${b.name} first. ${o.name}'s work became ${refund} gold.`, 'bad', o.tile);
    }
    logEvent(s, `The ${pl.name} built the ${b.name} in ${c.name}.`, c.tile, c.owner);
    questEvent(s, 'wonder', id, c.owner);
    for (const q of s.players) if (q.id !== c.owner && !q.isBarbarian) notify(s, q.id, `${q.met.includes(c.owner) ? `The ${pl.name}` : 'A distant civilization'} completed the ${b.name}.`, 'info');
  }
  notify(s, c.owner, `${c.name} completed the ${b.name}!`, 'good', c.tile);
  applyOneShots(s, c.owner, b.effects, c.tile);
  bumpEffects(s);
}

export function buyItem(s: GameState, c: City, item: QueueItem): string | null {
  const why = cannotBuild(s, c, item);
  if (why) return why;
  if (c.resistance > 0 || c.puppet) return 'this city cannot buy right now';
  if (item.kind === 'project') return 'projects cannot be bought';
  if (item.kind === 'building' && get(D.buildings, item.id).wonder) return 'wonders cannot be bought';
  const cost = buyCost(s, c, item);
  const pl = s.players[c.owner];
  if (pl.gold < cost) return `needs ${cost} gold`;
  if (item.kind === 'unit' && freeTileNear(s, item.id, c.owner, c.tile, 2) < 0) return 'no room for the unit';
  pl.gold -= cost;
  // Bought items replace the matching queue head (its progress is spent).
  if (c.queue[0] && c.queue[0].kind === item.kind && c.queue[0].id === item.id) {
    c.queue.shift();
    c.production = 0;
  }
  c.queue = c.queue.filter((q) => !(q.kind === 'building' && item.kind === 'building' && q.id === item.id));
  completeItem(s, c, item);
  return null;
}

// ---- End of turn ----

export function processCity(s: GameState, c: City, happiness: number): void {
  const r = cityYields(s, c, happiness);
  // Razing: one citizen per turn until nothing is left.
  if (c.razing) {
    c.pop--;
    if (c.pop <= 0) {
      destroyCity(s, c);
      return;
    }
    assignCitizens(s, c);
    return;
  }
  if (c.resistance > 0) c.resistance--;

  // Growth and starvation.
  c.food += r.foodSurplus;
  if (c.food >= r.growthNeeded && r.foodSurplus > 0) {
    c.food -= r.growthNeeded;
    const keep = c.buildings.reduce((a, b) => a + get(D.buildings, b).growthKeep, 0);
    c.food += (r.growthNeeded * Math.min(keep, 90)) / 100;
    c.pop++;
    notify(s, c.owner, `${c.name} grew to size ${c.pop}.`, 'info', c.tile);
  } else if (c.food < 0) {
    if (c.pop > 1) {
      c.pop--;
      notify(s, c.owner, `${c.name} is starving and lost a citizen!`, 'bad', c.tile);
    }
    c.food = 0;
  }

  // Production with overflow. Puppets pick their own buildings.
  if (c.puppet && !c.queue.length) {
    const options = buildableItems(s, c).filter((q) => q.kind === 'building');
    options.sort((a, b) => itemCost(s, c.owner, a) - itemCost(s, c.owner, b));
    if (options.length) c.queue.push(options[0]);
  }
  if (c.queue[0]?.kind === 'project' && D.projects.get(c.queue[0].id)?.international) {
    // International project: production goes into the world's shared effort.
    if (s.congress?.fair) contributeToFair(s, c.owner, r.total.production);
    else c.queue.shift();
  } else if (isProcess(c.queue[0])) {
    // Wealth / Research: part of the production becomes gold or science; nothing accumulates.
    const pr = get(D.projects, c.queue[0].id);
    const amount = (r.total.production * D.rules.processPct) / 100;
    if (pr.process === 'gold') s.players[c.owner].gold += Math.round(amount);
    else addScience(s, c.owner, amount);
  } else c.production += r.total.production;
  if (c.queue.length && !isProcess(c.queue[0]) && !D.projects.get(c.queue[0].id)?.international) {
    const item = c.queue[0];
    const why = cannotBuild(s, c, item);
    if (why) {
      // It can't be built any more (obsolete, a resource was lost, built elsewhere...): drop it
      // and keep the production for the next item.
      c.queue.shift();
      if (why !== 'already built') notify(s, c.owner, `${c.name} can no longer build ${itemDef(item).name} (${why}).`, 'bad', c.tile);
    } else {
      const cost = itemCost(s, c.owner, item);
      if (c.production >= cost && completeItem(s, c, item)) {
        c.production = Math.min(c.production - cost, cost * D.rules.overflowCap);
        c.queue.shift();
      }
    }
  }

  // Borders.
  c.culture += r.total.culture;
  s.players[c.owner].cultureTotal += r.total.culture;
  const cost = borderCost(s, c);
  if (c.culture >= cost) {
    const t = bestClaim(s, c);
    if (t >= 0) {
      c.culture -= cost;
      c.tilesClaimed++;
      claimTile(s, c, t);
    }
  }

  // Healing.
  const max = cityMaxHp(c);
  if (c.hp < max) c.hp = Math.min(max, c.hp + D.rules.city.healPerTurn);
  c.damagedThisTurn = false;
  assignCitizens(s, c);
}

// ---- Capture, razing, destruction ----

export function captureCity(s: GameState, c: City, by: number): void {
  const from = c.owner;
  const loserCap = c.isCapital;
  c.owner = by;
  c.isCapital = false;
  // The palace, unique buildings and national wonders don't change hands; world wonders do.
  c.buildings = c.buildings.filter((b) => b !== 'palace' && !get(D.buildings, b).faction && get(D.buildings, b).wonder !== 'national');
  c.manualSpecialists = {};
  bumpEffects(s);
  c.pop = Math.max(1, Math.round(c.pop * (1 - D.rules.city.capturePopLossPct / 100)));
  c.queue = [];
  c.production = 0;
  c.locked = [];
  c.hp = Math.round(cityMaxHp(c) * 0.25);
  c.resistance = c.pop * D.rules.city.resistanceTurnsPerPop;
  c.puppet = true; // until the conqueror decides
  c.occupied = false;
  for (let i = 0; i < s.map.tiles.length; i++) {
    const t = s.map.tiles[i];
    if (t.cityId === c.id) t.owner = by;
  }
  // Enemy civilians in the city are captured; nothing else can be there.
  for (const u of unitsAt(s, c.tile)) {
    if (u.owner === by) continue;
    if (isCivilian(u)) {
      u.owner = by;
      if (u.type === 'settler') u.type = 'worker';
      u.path = [];
      u.job = null;
    } else removeUnit(s, u);
  }
  logEvent(s, `The ${s.players[by].name} captured ${c.name} from the ${s.players[from].name}.`, c.tile, by);
  addWarmonger(s, by, c.wasCapital, s.diplomacy.declaredBy[by]?.[from] === from);
  if (s.players[from].isMinor) onCityStateConquered(s, from, by);
  notify(s, from, `${c.name} has fallen to the ${s.players[by].name}!`, 'bad', c.tile);
  notify(s, by, `You captured ${c.name}!`, 'good', c.tile);
  for (const pl of s.players) if (pl.id !== from && pl.id !== by && pl.met.includes(by)) notify(s, pl.id, `The ${s.players[by].name} captured ${c.name}.`, 'info');
  if (loserCap) moveCapital(s, from);
  checkElimination(s, from);
  if (s.players[by].isHuman) s.players[by].pendingCaptures.push(c.id);
  assignCitizens(s, c);
  recomputeAllVisibility(s);
}

/** Decide what to do with a captured city (annex, puppet, or raze). */
export function decideCapture(s: GameState, c: City, choice: 'annex' | 'puppet' | 'raze'): string | null {
  if (choice === 'raze' && c.wasCapital && c.originalOwner !== c.owner) return 'an original capital cannot be razed';
  const pl = s.players[c.owner];
  pl.pendingCaptures = pl.pendingCaptures.filter((x) => x !== c.id);
  c.puppet = choice === 'puppet';
  c.razing = choice === 'raze';
  c.occupied = choice === 'annex' && !c.buildings.some((b) => get(D.buildings, b).endsOccupation);
  if (choice === 'raze') notify(s, c.owner, `${c.name} will burn, one citizen per turn.`, 'info', c.tile);
  return null;
}

function moveCapital(s: GameState, p: number): void {
  const cities = playerCities(s, p).sort((a, b) => b.pop - a.pop);
  if (!cities.length) return;
  const c = cities[0];
  c.isCapital = true;
  if (!c.buildings.includes('palace')) c.buildings.push('palace');
  notify(s, p, `${c.name} is your new capital.`, 'info', c.tile);
}

export function destroyCity(s: GameState, c: City): void {
  for (const t of s.map.tiles)
    if (t.cityId === c.id) {
      t.owner = -1;
      t.cityId = -1;
    }
  tileAt(s, c.tile).road = true;
  for (const [w, cid] of Object.entries(s.wonders)) if (cid === c.id) delete s.wonders[w];
  for (const ids of Object.values(c.works ?? {})) for (const id of ids) delete s.greatWorks[id];
  recordSite(s, c.tile, 'city');
  delete s.cities[c.id];
  bumpEffects(s);
  notify(s, c.owner, `${c.name} has been razed to the ground.`, 'info', c.tile);
  logEvent(s, `${c.name} was razed.`, c.tile, c.owner);
  checkElimination(s, c.originalOwner);
}

/** A player with no cities left (after having had one) is out. */
export function checkElimination(s: GameState, p: number): void {
  const pl = s.players[p];
  if (!pl.alive || pl.isBarbarian) return;
  const hasCities = playerCities(s, p).length > 0;
  const hasSettler = Object.values(s.units).some((u) => u.owner === p && unitDef(u).canFound);
  if (hasCities || (!pl.hadCity && hasSettler)) return;
  pl.alive = false;
  for (const u of Object.values(s.units)) if (u.owner === p) removeUnit(s, u);
  for (const q of s.players) notify(s, q.id, `The ${pl.name} ${pl.hadCity ? 'have been destroyed' : 'have vanished'}.`, q.id === p ? 'bad' : 'info');
}

/** Annex a puppet city. */
export function annexPuppet(c: City): string | null {
  if (!c.puppet) return 'not a puppet';
  c.puppet = false;
  c.occupied = !c.buildings.some((b) => get(D.buildings, b).endsOccupation);
  return null;
}

