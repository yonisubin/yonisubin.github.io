// AI for ships, aircraft, trade units, work boats and religion.
import { D, get } from '../data';
import { applyAction } from '../core/game';
import { distance, within } from '../core/hex';
import { atWar, capitalOf, cityAt, dims, isCivilian, militaryAt, playerCities, playerUnits, tileAt, unitDef } from '../core/query';
import type { GameState, Unit } from '../core/state';
import { canStrike } from '../core/systems/air';
import { canAttack, previewAttack } from '../core/systems/combat';
import { isCoastalTile } from '../core/systems/domain';
import { availableBeliefs, canChoosePantheon, faithItems, majority, maxReligions, spreadTarget } from '../core/systems/religion';
import { routeOptions, routesOf, tradeSlots } from '../core/systems/trade';
import { buildOptions } from '../core/systems/units';
import { canSeeSite } from '../core/systems/archaeology';
import { findSlot } from '../core/systems/culture';

const pers = (s: GameState, p: number) => get(D.factions, s.players[p].faction).leader.personality;

/** Extra production scores for phase-10 units (0 = not wanted). */
export function phase10UnitScore(s: GameState, p: number, id: string, coastal: boolean, war: boolean): number | null {
  const u = get(D.units, id);
  const units = playerUnits(s, p);
  const count = (pred: (x: Unit) => boolean) => units.filter(pred).length;
  if (u.archaeology) {
    const sites = Object.keys(s.antiquity).filter((t) => canSeeSite(s, p, Number(t))).length;
    return sites > count((x) => !!unitDef(x).archaeology) && !!findSlot(s, p, 'artifact') ? 25 : 0;
  }
  if (u.role === 'trade') {
    const free = tradeSlots(s, p) - routesOf(s, p).length - count((x) => !!unitDef(x).trade);
    if (free <= 0) return 0;
    if (u.trade === 'sea' && !coastal) return 0;
    return 30;
  }
  if (u.role === 'work_sea') {
    if (!coastal) return 0;
    const spots = s.map.tiles.filter((t) => t.owner === p && t.resource && !t.improvement && D.resources.get(t.resource)?.improvement === 'fishing_boats').length;
    return spots > count((x) => unitDef(x).role === 'work_sea') ? 28 : 0;
  }
  if (u.domain === 'sea') {
    if (!coastal) return 0;
    const ships = count((x) => unitDef(x).domain === 'sea' && !isCivilian(x));
    const want = 1 + Math.round((pers(s, p).naval / 4) * (war ? 2 : 1));
    return ships < want ? 18 + pers(s, p).naval * 2 : 0;
  }
  if (u.domain === 'air') {
    if (u.nuke) return 0;
    const planes = count((x) => unitDef(x).domain === 'air');
    return war && planes < 2 + playerCities(s, p).length / 2 ? 22 : planes < 1 ? 6 : 0;
  }
  return null;
}

export function phase10UnitTurn(s: GameState, p: number, u: Unit): boolean {
  const def = unitDef(u);
  if (def.archaeology) return archaeologistTurn(s, p, u);
  if (def.role === 'trade') return traderTurn(s, p, u);
  if (def.role === 'work_sea') return workBoatTurn(s, p, u);
  if (def.religious) return religiousTurn(s, p, u);
  if (def.greatPerson === 'admiral') {
    const fleet = playerUnits(s, p).filter((x) => unitDef(x).domain === 'sea' && !isCivilian(x) && x.id !== u.id)[0];
    if (fleet && distance(dims(s), fleet.tile, u.tile) > 1) applyAction(s, p, { type: 'move', unit: u.id, to: fleet.tile });
    return true;
  }
  if (def.domain === 'air') return airTurn(s, p, u);
  if (def.domain === 'sea') return shipTurn(s, p, u);
  return false;
}

function archaeologistTurn(s: GameState, p: number, u: Unit): boolean {
  if (u.job) return true;
  if (canSeeSite(s, p, u.tile)) {
    applyAction(s, p, { type: 'dig', unit: u.id, choice: findSlot(s, p, 'artifact') ? 'artifact' : 'landmark' });
    return true;
  }
  const site = Object.keys(s.antiquity)
    .map(Number)
    .filter((t) => canSeeSite(s, p, t) && !Object.values(s.units).some((o) => o.tile === t && o.id !== u.id && unitDef(o).archaeology))
    .sort((a, b) => (tileAt(s, a).owner === p ? 0 : 15) + distance(dims(s), a, u.tile) - ((tileAt(s, b).owner === p ? 0 : 15) + distance(dims(s), b, u.tile)))[0];
  if (site !== undefined) {
    applyAction(s, p, { type: 'move', unit: u.id, to: site });
    if (s.units[u.id] && u.tile === site) applyAction(s, p, { type: 'dig', unit: u.id, choice: findSlot(s, p, 'artifact') ? 'artifact' : 'landmark' });
  }
  return true;
}

function traderTurn(s: GameState, p: number, u: Unit): boolean {
  const c = cityAt(s, u.tile);
  if (c && c.owner === p) {
    const opts = routeOptions(s, u);
    if (opts.length && routesOf(s, p).length < tradeSlots(s, p)) {
      applyAction(s, p, { type: 'tradeRoute', unit: u.id, to: opts[0].to.id, carries: opts[0].carries });
      return true;
    }
  }
  const home = capitalOf(s, p);
  if (home && home.tile !== u.tile) applyAction(s, p, { type: 'move', unit: u.id, to: home.tile });
  return true;
}

function workBoatTurn(s: GameState, p: number, u: Unit): boolean {
  if (buildOptions(s, u).length) {
    applyAction(s, p, { type: 'build', unit: u.id, job: buildOptions(s, u)[0].job });
    return true;
  }
  const spot = s.map.tiles
    .map((t, i) => ({ t, i }))
    .filter(({ t }) => t.owner === p && t.resource && !t.improvement && D.resources.get(t.resource)?.improvement === 'fishing_boats')
    .sort((a, b) => distance(dims(s), a.i, u.tile) - distance(dims(s), b.i, u.tile))[0];
  if (spot) {
    applyAction(s, p, { type: 'move', unit: u.id, to: spot.i });
    if (s.units[u.id] && buildOptions(s, u).length) applyAction(s, p, { type: 'build', unit: u.id, job: buildOptions(s, u)[0].job });
  }
  return true;
}

function shipTurn(s: GameState, p: number, u: Unit): boolean {
  if (u.moves <= 0) return true;
  // Attack anything in reach with good odds.
  const range = unitDef(u).ranged > 0 ? unitDef(u).range : 1;
  for (const t of within(dims(s), u.tile, range)) {
    if (t === u.tile || canAttack(s, u, t)) continue;
    const pv = previewAttack(s, u, t);
    if (!pv) continue;
    const dealt = (pv.toDefender[0] + pv.toDefender[1]) / 2, taken = (pv.toAttacker[0] + pv.toAttacker[1]) / 2;
    if (pv.ranged || (dealt >= taken && taken < u.hp - 15)) {
      applyAction(s, p, { type: 'attack', unit: u.id, to: t });
      return true;
    }
  }
  // At war: sail toward the nearest enemy coastal city.
  const enemies = Object.values(s.cities).filter((c) => c.owner !== p && atWar(s, p, c.owner) && !s.players[c.owner].isBarbarian && isCoastalTile(s, c.tile) && s.players[p].explored[c.tile]);
  if (enemies.length && u.hp > 50) {
    const target = enemies.sort((a, b) => distance(dims(s), a.tile, u.tile) - distance(dims(s), b.tile, u.tile))[0];
    const spot = within(dims(s), target.tile, range).find((i) => i !== target.tile && tileAt(s, i) && D.terrains.get(tileAt(s, i).terrain)!.water && !militaryAt(s, i));
    if (spot !== undefined && applyAction(s, p, { type: 'move', unit: u.id, to: spot }).ok) return true;
  }
  // Otherwise rest in the nearest coastal city.
  const port = playerCities(s, p).filter((c) => isCoastalTile(s, c.tile)).sort((a, b) => distance(dims(s), a.tile, u.tile) - distance(dims(s), b.tile, u.tile))[0];
  if (port && port.tile !== u.tile && !militaryAt(s, port.tile)) applyAction(s, p, { type: 'move', unit: u.id, to: port.tile });
  else applyAction(s, p, { type: 'order', unit: u.id, order: 'fortify' });
  return true;
}

function airTurn(s: GameState, p: number, u: Unit): boolean {
  if (u.moves <= 0 || unitDef(u).nuke) return true;
  let best = -1, bestV = 0;
  for (const t of within(dims(s), u.tile, unitDef(u).range)) {
    if (canStrike(s, u, t)) continue;
    const c = cityAt(s, t);
    const v = c ? 5 : 10 - (militaryAt(s, t)?.hp ?? 100) / 20;
    if (v > bestV) {
      bestV = v;
      best = t;
    }
  }
  if (best >= 0 && u.hp > 40) applyAction(s, p, { type: 'airStrike', unit: u.id, to: best });
  return true;
}

function religiousTurn(s: GameState, p: number, u: Unit): boolean {
  const def = unitDef(u);
  const pl = s.players[p];
  if (def.religious === 'prophet') {
    const cap = capitalOf(s, p);
    if (!pl.religion && Object.keys(s.religions).length < maxReligions(s)) {
      if (cap && u.tile !== cap.tile) applyAction(s, p, { type: 'move', unit: u.id, to: cap.tile });
      if (s.units[u.id] && cap && u.tile === cap.tile) {
        const name = D.religionNames.find((n) => !Object.values(s.religions).some((r) => r.name === n)) ?? 'The Faith';
        const founder = availableBeliefs(s, 'founder')[0], follower = availableBeliefs(s, 'follower')[0];
        if (founder && follower) applyAction(s, p, { type: 'foundReligion', unit: u.id, name, founder: founder.id, follower: follower.id });
      }
      return true;
    }
    if (pl.religion && !s.religions[pl.religion].enhanced) {
      const f = availableBeliefs(s, 'follower')[0], e = availableBeliefs(s, 'enhancer')[0];
      if (f && e) {
        applyAction(s, p, { type: 'enhanceReligion', unit: u.id, follower: f.id, enhancer: e.id });
        return true;
      }
    }
  }
  if (def.religious === 'inquisitor') {
    const c = playerCities(s, p).find((x) => majority(x) && majority(x) !== pl.religion);
    if (c) {
      if (u.tile !== c.tile) applyAction(s, p, { type: 'move', unit: u.id, to: c.tile });
      if (s.units[u.id] && u.tile === c.tile) applyAction(s, p, { type: 'removeHeresy', unit: u.id });
    }
    return true;
  }
  // Missionaries and prophets spread: own cities first, then the nearest others.
  const rel = u.religion ?? pl.religion;
  if (!rel) return true;
  const here = spreadTarget(s, u);
  if (here && majority(here) !== rel && !s.diplomacy.war[p]?.[here.owner]) {
    applyAction(s, p, { type: 'spreadReligion', unit: u.id });
    return true;
  }
  const targets = Object.values(s.cities)
    .filter((c) => majority(c) !== rel && !s.diplomacy.war[p]?.[c.owner] && pl.explored[c.tile])
    .sort((a, b) => (a.owner === p ? 0 : 20) + distance(dims(s), a.tile, u.tile) - ((b.owner === p ? 0 : 20) + distance(dims(s), b.tile, u.tile)));
  for (const c of targets.slice(0, 3)) {
    const spot = within(dims(s), c.tile, 1).find((i) => i !== c.tile && !militaryAt(s, i) && !D.terrains.get(tileAt(s, i).terrain)!.water);
    const goal = c.owner === p ? c.tile : spot;
    if (goal !== undefined && applyAction(s, p, { type: 'move', unit: u.id, to: goal }).ok) {
      if (s.units[u.id] && spreadTarget(s, u)?.id === c.id && u.moves > 0) applyAction(s, p, { type: 'spreadReligion', unit: u.id });
      return true;
    }
  }
  return true;
}

/** Faith: pantheon, then prophets/missionaries/religious buildings. */
export function aiFaith(s: GameState, p: number): void {
  const pl = s.players[p];
  if (canChoosePantheon(s, p)) {
    // The pantheon whose tiles we have most of.
    const opts = availableBeliefs(s, 'pantheon');
    const owned = s.map.tiles.filter((t) => t.owner === p);
    const score = (b: (typeof opts)[number]) =>
      b.effects.reduce((a, e) => a + (e.type === 'tile_yield' ? owned.filter((t) => (e.where === 'river' ? t.river : e.where === 'forest' ? t.feature === 'forest' : e.where === 'desert' ? t.terrain === 'desert' : e.where === 'coast' ? t.terrain === 'coast' : e.where === 'hills' ? t.hills : false)).length : 3), 0);
    opts.sort((a, b) => score(b) - score(a));
    if (opts[0]) applyAction(s, p, { type: 'pantheon', belief: opts[0].id });
  }
  if (!pl.religion) return;
  const cities = playerCities(s, p);
  for (const c of cities) {
    for (const o of faithItems(s, c)) {
      if (o.why || o.cost > pl.faith - 50) continue;
      const id = o.item.id;
      const missionaries = playerUnits(s, p).filter((u) => unitDef(u).religious === 'missionary').length;
      const want =
        (o.item.kind === 'building') ||
        (id === 'missionary' && missionaries < 2 && Object.values(s.cities).some((x) => majority(x) !== pl.religion && distance(dims(s), x.tile, c.tile) < 12)) ||
        (id === 'inquisitor' && cities.some((x) => majority(x) && majority(x) !== pl.religion));
      if (want && applyAction(s, p, { type: 'buyFaith', city: c.id, item: o.item }).ok) return;
    }
  }
}
