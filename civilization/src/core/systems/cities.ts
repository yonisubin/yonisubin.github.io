// Cities: founding, territory (culture borders and buying tiles), citizens, growth, the
// production queue (with overflow and gold purchases), defence, capture and razing.
import { D, get, type BuildingDef, type UnitDef } from '../../data';
import { YIELD_KEYS } from '../../data/schema';
import { distance, neighbors, within } from '../hex';
import {
  allCities,
  capitalOf,
  costMult,
  dims,
  hasTech,
  isCivilian,
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
import { cityYields, hasBuilding, tileYields } from './yields';
import { createUnit, freeTileNear, removeUnit } from './units';
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
  const g = militaryAt(s, c.tile);
  if (g && g.owner === c.owner) base += unitDef(g).strength * r.garrisonShare;
  const mods = tileAt(s, c.tile).hills ? [{ label: 'Hills', pct: r.hillsPct }] : [];
  const value = base * (1 + mods.reduce((a, m) => a + m.pct, 0) / 100);
  return { base: Math.round(base * 10) / 10, value, mods };
}

// ---- Citizens ----

const FOCUS_WEIGHTS: Record<CityFocus, Record<string, number>> = {
  default: { food: 2.5, production: 2, gold: 1.2, science: 1, culture: 1 },
  food: { food: 6, production: 1, gold: 0.5, science: 0.5, culture: 0.5 },
  production: { food: 2, production: 6, gold: 0.5, science: 0.5, culture: 0.5 },
  gold: { food: 2, production: 1, gold: 6, science: 0.5, culture: 0.5 },
  science: { food: 2, production: 1, gold: 0.5, science: 6, culture: 0.5 },
  culture: { food: 2, production: 1, gold: 0.5, science: 0.5, culture: 6 },
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
  c.locked = c.locked.filter((i) => tiles.includes(i)).slice(0, c.pop);
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
      if (worked.length >= c.pop) break;
      if (x.v <= D.rules.unemployedProduction * w.production * 0.99 && x.v <= 0) continue;
      worked.push(x.i);
    }
    return worked;
  };
  c.worked = pick();
  // Avoid starving: if food runs short, weigh food much more.
  if (cityYields(s, c).foodSurplus < 0) c.worked = pick(8);
}

// ---- Borders ----

export function borderCost(s: GameState, c: City): number {
  const b = D.rules.border;
  const pace = get(D.pace, s.settings.pace).costPct / 100;
  return Math.round((b.base + Math.pow(b.perTile * c.tilesClaimed, b.exponent)) * pace);
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
  return Math.round((b.base + b.perDistance * distance(dims(s), c.tile, i) + b.perBought * c.tilesBought) * pace);
}

// ---- Production ----

export function itemDef(item: QueueItem): UnitDef | BuildingDef {
  return item.kind === 'unit' ? get(D.units, item.id) : get(D.buildings, item.id);
}

export function itemCost(s: GameState, p: number, item: QueueItem): number {
  return Math.max(1, Math.round(itemDef(item).cost * costMult(s, p)));
}

export function buyCost(s: GameState, c: City, item: QueueItem): number {
  const b = D.rules.buy;
  const progress = c.queue[0] && c.queue[0].kind === item.kind && c.queue[0].id === item.id ? c.production : 0;
  const remaining = Math.max(1, itemCost(s, c.owner, item) - progress);
  let g = b.multiplier * Math.pow(remaining, b.exponent);
  if (item.kind === 'building') g *= b.buildingPct / 100;
  return Math.round(g);
}

/** Why the city can't build this (or null if it can). */
export function cannotBuild(s: GameState, c: City, item: QueueItem): string | null {
  const pl = s.players[c.owner];
  if (item.kind === 'unit') {
    const u = D.units.get(item.id);
    if (!u) return 'unknown unit';
    if (u.faction && u.faction !== pl.faction) return 'another faction’s unique unit';
    if (!u.faction && [...D.units.values()].some((x) => x.replaces === u.id && x.faction === pl.faction)) return 'replaced by your unique unit';
    if (!hasTech(pl, u.tech)) return `needs ${get(D.techs, u.tech!).name}`;
    if (u.obsoleteTech && hasTech(pl, u.obsoleteTech) && u.upgradesTo) return 'obsolete';
    if (u.resource) {
      const r = strategicResources(s, c.owner)[u.resource];
      if (!r || r.total - r.used < 1) return `needs ${get(D.resources, u.resource).name}`;
    }
    if (u.id === 'settler' && happinessOf(s, c.owner).net <= D.rules.happiness.veryUnhappy) return 'your people are too unhappy';
    return null;
  }
  const b = D.buildings.get(item.id);
  if (!b) return 'unknown building';
  if (b.auto) return 'cannot be built';
  if (b.faction && b.faction !== pl.faction) return 'another faction’s unique building';
  if (!b.faction && [...D.buildings.values()].some((x) => x.replaces === b.id && x.faction === pl.faction)) return 'replaced by your unique building';
  if (hasBuilding(c, b.replaces ?? b.id)) return 'already built';
  if (!hasTech(pl, b.tech)) return `needs ${get(D.techs, b.tech!).name}`;
  if (b.requires.building && !hasBuilding(c, b.requires.building)) return `needs a ${get(D.buildings, b.requires.building).name}`;
  if (b.requires.river && !tileAt(s, c.tile).river) return 'needs a river';
  if (b.requires.mountain && !neighbors(dims(s), c.tile).some((n) => tileAt(s, n).terrain === 'mountain')) return 'needs a mountain next to the city';
  return null;
}

/** Everything the city can build now. */
export function buildableItems(s: GameState, c: City): QueueItem[] {
  const out: QueueItem[] = [];
  for (const u of D.units.values()) if (!cannotBuild(s, c, { kind: 'unit', id: u.id })) out.push({ kind: 'unit', id: u.id });
  for (const b of D.buildings.values()) if (!cannotBuild(s, c, { kind: 'building', id: b.id })) out.push({ kind: 'building', id: b.id });
  return out;
}

/** Starting XP for units built in this city. */
export function cityXp(c: City): number {
  return c.buildings.reduce((a, b) => a + get(D.buildings, b).xp, 0);
}

/** Put a finished item into the world. Returns false if there was no room (try again next turn). */
function completeItem(s: GameState, c: City, item: QueueItem): boolean {
  if (item.kind === 'building') {
    c.buildings.push(item.id);
    if (get(D.buildings, item.id).hp) c.hp += get(D.buildings, item.id).hp;
    notify(s, c.owner, `${c.name} built a ${get(D.buildings, item.id).name}.`, 'good', c.tile);
    return true;
  }
  const at = freeTileNear(s, item.id, c.owner, c.tile, 2);
  if (at < 0) return false;
  createUnit(s, item.id, c.owner, at, cityXp(c));
  notify(s, c.owner, `${c.name} trained a ${get(D.units, item.id).name}.`, 'good', c.tile);
  return true;
}

export function buyItem(s: GameState, c: City, item: QueueItem): string | null {
  const why = cannotBuild(s, c, item);
  if (why) return why;
  if (c.resistance > 0 || c.puppet) return 'this city cannot buy right now';
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
  c.production += r.total.production;
  if (c.queue.length) {
    const item = c.queue[0];
    const why = cannotBuild(s, c, item);
    if (why === 'already built') c.queue.shift();
    else if (!why) {
      const cost = itemCost(s, c.owner, item);
      if (c.production >= cost && completeItem(s, c, item)) {
        c.production = Math.min(c.production - cost, cost * D.rules.overflowCap);
        c.queue.shift();
      }
    }
    // Otherwise blocked (e.g. a resource was lost): production waits.
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
  c.buildings = c.buildings.filter((b) => b !== 'palace' && !get(D.buildings, b).faction);
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
  delete s.cities[c.id];
  notify(s, c.owner, `${c.name} has been razed to the ground.`, 'info', c.tile);
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

