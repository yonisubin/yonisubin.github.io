// Units: creation and removal, XP and promotions, healing, upgrades, Worker jobs, and what
// happens when a unit steps on a tile (ruins, barbarian camps, capturing civilians).
import { D, get, unitForFaction } from '../../data';
import { distance, neighbors, within } from '../hex';
import { pickWeighted, randInt } from '../rng';
import {
  atWar,
  cityAt,
  civilianAt,
  dims,
  eraOf,
  hasTech,
  isCivilian,
  militaryAt,
  notify,
  playerCities,
  tileAt,
  unitDef,
  unitsAt,
} from '../query';
import type { GameState, Unit } from '../state';
import { recomputeVisibility, reveal } from './visibility';
import { availableTechs, learnTech } from './research';
import { isPassableLand } from '../../mapgen/generate';

export const fullMoves = (u: Unit): number => {
  let m = unitDef(u).moves;
  for (const p of u.promotions) m += D.promotions.get(p)!.moves;
  return m * D.rules.moveScale;
};

export function createUnit(s: GameState, type: string, owner: number, tile: number, xp = 0): Unit {
  const id = s.nextId++;
  const u: Unit = {
    id,
    type,
    owner,
    tile,
    hp: D.rules.combat.maxHp,
    moves: 0,
    xp: 0,
    level: 0,
    promotions: [],
    pendingPromotions: 0,
    order: 'none',
    fortifyTurns: 0,
    acted: false,
    hasAttacked: false,
    setUp: false,
    job: null,
    path: [],
    exploring: false,
  };
  u.moves = fullMoves(u);
  s.units[id] = u;
  if (xp) addXp(s, u, xp, false);
  return u;
}

export function removeUnit(s: GameState, u: Unit): void {
  delete s.units[u.id];
}

/** Is there room for this unit on the tile (one military + one civilian per tile)? */
export function hasRoom(s: GameState, u: Unit | string, tile: number, owner: number): boolean {
  const civ = typeof u === 'string' ? get(D.units, u).class === 'civilian' : isCivilian(u);
  const self = typeof u === 'string' ? -1 : u.id;
  for (const o of unitsAt(s, tile)) {
    if (o.id === self) continue;
    if (o.owner !== owner) return false;
    if (isCivilian(o) === civ) return false;
  }
  return true;
}

/** Nearest land tile around `tile` where a unit of this type fits (for spawning). */
export function freeTileNear(s: GameState, type: string, owner: number, tile: number, radius = 3): number {
  for (const i of within(dims(s), tile, radius)) {
    const t = tileAt(s, i);
    if (!isPassableLand(t)) continue;
    const c = cityAt(s, i);
    if (c && c.owner !== owner) continue;
    if (t.owner >= 0 && t.owner !== owner && !atWar(s, owner, t.owner) && !s.players[owner].isBarbarian) continue;
    if (hasRoom(s, type, i, owner)) return i;
  }
  return -1;
}

export function addXp(s: GameState, u: Unit, amount: number, vsBarbarian: boolean): void {
  const x = D.rules.xp;
  if (vsBarbarian) amount = Math.max(0, Math.min(amount, x.vsBarbarianMax - u.xp));
  u.xp += amount;
  while (u.level < x.thresholds.length && u.xp >= x.thresholds[u.level]) {
    u.level++;
    if (!isCivilian(u)) u.pendingPromotions++;
  }
  void s;
}

export function availablePromotions(u: Unit): string[] {
  const cls = unitDef(u).class;
  return [...D.promotions.values()]
    .filter((p) => p.classes.includes(cls) && !u.promotions.includes(p.id) && p.requires.every((r) => u.promotions.includes(r)))
    .map((p) => p.id);
}

/** Take a promotion (or "heal": +50 HP instead). */
export function promote(s: GameState, u: Unit, promotion: string): string | null {
  if (u.pendingPromotions <= 0) return 'no promotion available';
  if (promotion === 'heal') {
    u.hp = Math.min(D.rules.combat.maxHp, u.hp + D.rules.heal.promotion);
  } else {
    if (!availablePromotions(u).includes(promotion)) return 'promotion not available';
    u.promotions.push(promotion);
    const extra = D.promotions.get(promotion)!.moves * D.rules.moveScale;
    u.moves += extra;
  }
  u.pendingPromotions--;
  void s;
  return null;
}

// ---- Healing (end of the owner's turn, for units that didn't act) ----

export function healUnits(s: GameState, p: number): void {
  const h = D.rules.heal;
  for (const id in s.units) {
    const u = s.units[id];
    if (u.owner !== p || u.hp >= D.rules.combat.maxHp) continue;
    const always = u.promotions.some((x) => D.promotions.get(x)!.healAlways);
    if (u.acted && !always) continue;
    const t = tileAt(s, u.tile);
    const city = cityAt(s, u.tile);
    let amount = city && city.owner === p ? h.city : t.owner === p ? h.friendly : t.owner < 0 ? h.neutral : atWar(s, p, t.owner) ? h.enemy : h.neutral;
    // Field medics heal themselves and their neighbours.
    for (const n of [u.tile, ...neighbors(dims(s), u.tile)]) {
      const o = militaryAt(s, n);
      if (o && o.owner === p) for (const pr of o.promotions) amount += D.promotions.get(pr)!.medic;
    }
    u.hp = Math.min(D.rules.combat.maxHp, u.hp + amount);
  }
}

// ---- Upgrades ----

export function upgradeTarget(s: GameState, u: Unit): string | null {
  const def = unitDef(u);
  if (!def.upgradesTo) return null;
  const pl = s.players[u.owner];
  const to = unitForFaction(get(D.units, def.upgradesTo).replaces ?? def.upgradesTo, pl.faction);
  const toDef = get(D.units, to);
  if (!hasTech(pl, toDef.tech)) return null;
  return to;
}

export function upgradeCost(s: GameState, u: Unit): number {
  const to = upgradeTarget(s, u);
  if (!to) return Infinity;
  const diff = Math.max(10, get(D.units, to).cost - unitDef(u).cost);
  return Math.round(diff * D.rules.upgradeGoldPerProduction);
}

// ---- Worker jobs ----

export interface BuildOption {
  job: string;
  name: string;
  turns: number;
}

/** Improvements, roads and clearing a Worker could start on its tile. */
export function buildOptions(s: GameState, u: Unit): BuildOption[] {
  if (!unitDef(u).canBuild) return [];
  const pl = s.players[u.owner];
  const t = tileAt(s, u.tile);
  if (!isPassableLand(t)) return [];
  const out: BuildOption[] = [];
  const w = D.rules.work;
  const isCity = !!cityAt(s, u.tile);
  if (!t.road && hasTech(pl, 'the_wheel') && !isCity) out.push({ job: 'road', name: 'Road', turns: w.roadTurns });
  if (isCity) return out;
  if (t.pillaged && t.improvement) out.push({ job: 'repair', name: `Repair ${get(D.improvements, t.improvement).name}`, turns: w.repairTurns });
  const own = t.owner === u.owner;
  if (own && !t.pillaged) {
    for (const imp of D.improvements.values()) {
      if (t.improvement === imp.id) continue;
      if (!hasTech(pl, imp.tech)) continue;
      const landOk = imp.terrains.includes('any_land') || imp.terrains.includes(t.terrain);
      if (!landOk) continue;
      if (imp.hills === 'only' && !t.hills && !(t.resource && D.resources.get(t.resource)!.improvement === imp.id)) continue;
      if (imp.hills === 'never' && t.hills) continue;
      if (imp.needsFeature && (!t.feature || !imp.features.includes(t.feature))) continue;
      if (t.feature && !imp.features.includes(t.feature)) continue;
      const resOk = t.resource && D.resources.get(t.resource)!.improvement === imp.id && hasTech(pl, D.resources.get(t.resource)!.revealTech);
      if (imp.resourceOnly && !resOk) continue;
      // A resource tile only takes its own improvement (or a generic one that keeps it usable later).
      if (t.resource && hasTech(pl, D.resources.get(t.resource)!.revealTech) && !resOk && D.resources.get(t.resource)!.improvement !== 'none') continue;
      out.push({ job: imp.id, name: imp.name, turns: imp.buildTurns });
    }
  }
  if (own && t.feature) {
    const f = get(D.features, t.feature);
    if (f.removeTech && hasTech(pl, f.removeTech)) out.push({ job: `remove_${f.id}`, name: `Clear ${f.name}`, turns: w.removeTurns[f.id] ?? 4 });
  }
  return out;
}

/** Advance Worker jobs of player p by one turn. */
export function workJobs(s: GameState, p: number): void {
  for (const id in s.units) {
    const u = s.units[id];
    if (u.owner !== p || !u.job) continue;
    u.job.turnsLeft--;
    if (u.job.turnsLeft > 0) continue;
    finishJob(s, u, u.job.improvement);
    u.job = null;
  }
}

function finishJob(s: GameState, u: Unit, job: string): void {
  const t = tileAt(s, u.tile);
  if (job === 'road') {
    t.road = true;
    t.roadOwner = u.owner;
    return;
  }
  if (job === 'repair') {
    t.pillaged = false;
    return;
  }
  const clear = (fid: string) => {
    const f = get(D.features, fid);
    t.feature = null;
    if (f.chopProduction > 0) {
      const city = t.cityId >= 0 ? s.cities[t.cityId] : undefined;
      if (city && city.owner === u.owner) {
        city.production += f.chopProduction;
        notify(s, u.owner, `Clearing the ${f.name.toLowerCase()} gave ${city.name} ${f.chopProduction} production.`, 'good', u.tile);
      }
    }
  };
  if (job.startsWith('remove_')) {
    clear(job.slice(7));
    return;
  }
  const imp = get(D.improvements, job);
  if (t.feature && imp.clears.includes(t.feature)) clear(t.feature);
  t.improvement = imp.id;
  t.pillaged = false;
}

// ---- Entering tiles: civilians, camps, ruins ----

/** Called after unit u moved onto its tile. */
export function onEnterTile(s: GameState, u: Unit): void {
  const t = tileAt(s, u.tile);
  // Capture enemy civilians alone on the tile.
  if (!isCivilian(u)) {
    const civ = civilianAt(s, u.tile);
    if (civ && civ.owner !== u.owner && atWar(s, u.owner, civ.owner)) captureCivilian(s, civ, u.owner);
  }
  if (t.camp && !s.players[u.owner].isBarbarian) {
    const barb = unitsAt(s, u.tile).some((o) => s.players[o.owner].isBarbarian);
    if (!barb) clearCamp(s, u);
  }
  if (t.ruin && !s.players[u.owner].isBarbarian) {
    t.ruin = false;
    openRuin(s, u);
  }
}

export function captureCivilian(s: GameState, civ: Unit, by: number): void {
  const from = civ.owner;
  notify(s, from, `Your ${unitDef(civ).name} was captured!`, 'bad', civ.tile);
  if (s.players[by].isBarbarian) {
    removeUnit(s, civ);
    return;
  }
  civ.owner = by;
  // Settlers can't be taken whole: they become Workers.
  if (civ.type === 'settler') civ.type = unitForFaction('worker', s.players[by].faction);
  civ.job = null;
  civ.path = [];
  civ.moves = 0;
  notify(s, by, `You captured a ${unitDef(civ).name}.`, 'good', civ.tile);
}

function clearCamp(s: GameState, u: Unit): void {
  const t = tileAt(s, u.tile);
  t.camp = false;
  delete s.camps[u.tile];
  const b = D.rules.barbarians;
  const gold = b.campReward + eraOf(s.players[u.owner]) * b.campRewardPerEra;
  s.players[u.owner].gold += gold;
  notify(s, u.owner, `You destroyed a barbarian camp and found ${gold} gold.`, 'good', u.tile);
}

function openRuin(s: GameState, u: Unit): void {
  const pl = s.players[u.owner];
  const def = unitDef(u);
  const ok = (kind: string): boolean => {
    switch (kind) {
      case 'population':
        return playerCities(s, u.owner).length > 0;
      case 'upgrade':
        return !isCivilian(u) && !!def.upgradesTo && upgradeTargetIgnoringTech(s, u) !== null;
      case 'tech':
        return availableTechs(pl).length > 0;
      case 'camps':
        return Object.keys(s.camps).length > 0;
      default:
        return true;
    }
  };
  let options = [...D.ruins.values()].filter((r) => !pl.ruinsSeen.includes(r.id) && ok(r.kind));
  if (!options.length) {
    pl.ruinsSeen = [];
    options = [...D.ruins.values()].filter((r) => ok(r.kind));
  }
  if (!options.length) return;
  const r = pickWeighted(s, options, (x) => x.weight);
  pl.ruinsSeen.push(r.id);
  let text = r.name + ': ';
  switch (r.kind) {
    case 'gold':
      pl.gold += r.amount;
      text += `+${r.amount} gold.`;
      break;
    case 'tech': {
      const techs = availableTechs(pl);
      const t = techs[randInt(s, techs.length)];
      learnTech(s, u.owner, t);
      text += `you learned ${get(D.techs, t).name}.`;
      break;
    }
    case 'population': {
      const cities = playerCities(s, u.owner).sort((a, b) => distance(dims(s), a.tile, u.tile) - distance(dims(s), b.tile, u.tile));
      cities[0].pop += r.amount;
      text += `${cities[0].name} grows by ${r.amount}.`;
      break;
    }
    case 'culture': {
      const cap = playerCities(s, u.owner).find((c) => c.isCapital);
      if (cap) cap.culture += r.amount;
      pl.cultureTotal += r.amount;
      text += `+${r.amount} culture.`;
      break;
    }
    case 'map':
      reveal(s, u.owner, within(dims(s), u.tile, r.amount));
      text += 'the land around is revealed.';
      break;
    case 'unit': {
      const type = unitForFaction(r.unit ?? 'warrior', pl.faction);
      const at = freeTileNear(s, type, u.owner, u.tile, 2);
      if (at >= 0) createUnit(s, type, u.owner, at);
      text += `a ${get(D.units, type).name} joins you.`;
      break;
    }
    case 'upgrade': {
      const to = upgradeTargetIgnoringTech(s, u)!;
      u.type = to;
      text += `your unit becomes a ${get(D.units, to).name}.`;
      break;
    }
    case 'camps': {
      const near = Object.keys(s.camps)
        .map(Number)
        .filter((c) => distance(dims(s), c, u.tile) <= r.amount);
      for (const c of near) reveal(s, u.owner, within(dims(s), c, 1));
      text += near.length ? `${near.length} barbarian camp(s) revealed nearby.` : 'no camps nearby.';
      break;
    }
  }
  notify(s, u.owner, text, 'good', u.tile);
  recomputeVisibility(s, u.owner);
}

function upgradeTargetIgnoringTech(s: GameState, u: Unit): string | null {
  const def = unitDef(u);
  if (!def.upgradesTo) return null;
  return unitForFaction(get(D.units, def.upgradesTo).replaces ?? def.upgradesTo, s.players[u.owner].faction);
}

/** Disband a unit when the treasury runs dry (cheapest military first). */
export function disbandForDebt(s: GameState, p: number): void {
  const units = Object.values(s.units).filter((u) => u.owner === p && !isCivilian(u));
  if (!units.length) return;
  units.sort((a, b) => unitDef(a).cost - unitDef(b).cost);
  const u = units[0];
  notify(s, p, `With no gold to pay upkeep, your ${unitDef(u).name} deserted.`, 'bad', u.tile);
  removeUnit(s, u);
}

export function pillage(s: GameState, u: Unit): string | null {
  const t = tileAt(s, u.tile);
  if (isCivilian(u)) return 'civilians cannot pillage';
  if (u.moves <= 0) return 'no moves left';
  if (cityAt(s, u.tile)) return 'cannot pillage a city';
  if (t.owner === u.owner) return 'cannot pillage your own land';
  if (t.owner >= 0 && !atWar(s, u.owner, t.owner)) return 'not at war with the owner';
  if (t.improvement && !t.pillaged) {
    t.pillaged = true;
    s.players[u.owner].gold += 10;
    u.hp = Math.min(D.rules.combat.maxHp, u.hp + 25);
    if (t.owner >= 0) notify(s, t.owner, `Your ${get(D.improvements, t.improvement).name} was pillaged!`, 'bad', u.tile);
  } else if (t.road) {
    t.road = false;
    t.roadOwner = -1;
  } else return 'nothing to pillage';
  u.moves = Math.max(0, u.moves - D.rules.moveScale);
  u.acted = true;
  return null;
}

