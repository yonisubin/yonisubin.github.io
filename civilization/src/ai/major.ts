// AI for major players. Utility scoring weighted by the leader's personality:
//   strategic  — research picks, war and peace;
//   operational — what each city builds, where settlers go, what workers improve;
//   tactical   — attacks with good odds, garrisons, marching on enemy cities, clearing camps.
// It changes the game only through applyAction (plus the same helpers the UI reads).
import { D, get } from '../data';
import type { PersonalityData } from '../data/schema';
import { applyAction } from '../core/game';
import { distance, neighbors, within } from '../core/hex';
import {
  allCities,
  allUnits,
  atWar,
  capitalOf,
  cityAt,
  dims,
  isCivilian,
  majorPlayers,
  militaryAt,
  playerCities,
  withIndex,
  playerUnits,
  tileAt,
  unitDef,
} from '../core/query';
import type { City, GameState, QueueItem, Unit } from '../core/state';
import { buildableItems, buyCost, canFoundAt, claimableTiles, itemCost, tileBuyCost } from '../core/systems/cities';
import { canAttack, previewAttack } from '../core/systems/combat';
import { connectedCities } from '../core/systems/economy';
import { autoExplore } from '../core/systems/explore';
import { happinessOf } from '../core/systems/happiness';
import { findPath } from '../core/systems/movement';
import { availableTechs, techCost } from '../core/systems/research';
import { availablePromotions, buildOptions, upgradeCost, upgradeTarget } from '../core/systems/units';
import { hasFreshWater } from '../core/systems/yields';
import { adoptablePolicies, canPickPolicy } from '../core/systems/policies';
import { greatPersonUses } from '../core/systems/greatpeople';
import { aiDiplomacy } from './diplomacy';
import { aiFaith, phase10UnitScore, phase10UnitTurn } from './phase10';
import { isCoastal } from '../core/systems/effects';
import { siteScore } from '../mapgen/generate';

const personality = (s: GameState, p: number): PersonalityData => get(D.factions, s.players[p].faction).leader.personality;

export function aiTurn(s: GameState, p: number): void {
  const pl = s.players[p];
  if (!pl.alive) return;
  chooseResearch(s, p);
  choosePolicies(s, p);
  aiFaith(s, p);
  for (const id of [...pl.pendingCaptures]) decideCaptureAI(s, p, id);
  aiDiplomacy(s, p);
  for (const c of playerCities(s, p)) if (!c.queue.length && !c.puppet && !c.razing) chooseProduction(s, p, c);
  spendGold(s, p);
  const units = playerUnits(s, p).sort((a, b) => unitDef(b).strength - unitDef(a).strength);
  const reserved = new Set<number>();
  for (const u of units) {
    if (!s.units[u.id]) continue;
    while (u.pendingPromotions > 0) {
      const opts = availablePromotions(u);
      applyAction(s, p, { type: 'promote', unit: u.id, promotion: u.hp < 50 || !opts.length ? 'heal' : opts[0] });
    }
    const def = unitDef(u);
    if (phase10UnitTurn(s, p, u)) {
      // Ships, aircraft, traders, work boats, religious units and admirals.
    } else if (def.greatPerson) {
      greatPersonTurn(s, p, u);
    } else if (def.spaceshipPart) {
      const cap = capitalOf(s, p);
      if (cap) applyAction(s, p, { type: 'move', unit: u.id, to: cap.tile });
    } else if (def.canFound) settlerTurn(s, p, u);
    else if (def.canBuild) workerTurn(s, p, u, reserved);
    else if (def.class === 'recon') scoutTurn(s, p, u);
    else militaryTurn(s, p, u);
  }
  // Cities shoot at anything in range.
  for (const c of playerCities(s, p)) {
    for (const t of within(dims(s), c.tile, D.rules.city.range)) {
      if (applyAction(s, p, { type: 'cityAttack', city: c.id, to: t }).ok) break;
    }
  }
}

// ---- Strategy ----

/** Policy preferences per personality trait. */
const TREE_TASTE: Record<string, (p: PersonalityData) => number> = {
  heritage: (p) => 10 - p.expansion + p.wonders * 0.5,
  frontier: (p) => p.expansion * 1.2,
  valor: (p) => p.aggression * 1.2,
  devotion: (p) => p.religion,
  patronage: (p) => p.cityStateInterest,
  artistry: (p) => p.culture,
  commerce: (p) => p.gold,
  voyaging: (p) => p.naval,
  reason: (p) => p.science * 1.2,
};

function choosePolicies(s: GameState, p: number): void {
  const pers = personality(s, p);
  for (let guard = 0; guard < 4 && canPickPolicy(s, p); guard++) {
    const options = adoptablePolicies(s, p);
    if (!options.length) return;
    const pl = s.players[p];
    const score = (id: string) => {
      const tree = D.policyTrees.get(id) ? id : D.policies.get(id)!.tree;
      let v = TREE_TASTE[tree]?.(pers) ?? 5;
      // Finish trees already started.
      if (pl.policies.includes(tree) && id !== tree) v += 6;
      return v;
    };
    options.sort((a, b) => score(b) - score(a) || a.localeCompare(b));
    if (!applyAction(s, p, { type: 'adoptPolicy', policy: options[0] }).ok) return;
  }
}

function greatPersonTurn(s: GameState, p: number, u: Unit): void {
  const uses = greatPersonUses(s, u);
  const type = unitDef(u).greatPerson;
  if (type === 'general') {
    // Generals stick with the army: stand next to the strongest unit.
    const army = playerUnits(s, p).filter((x) => !isCivilian(x)).sort((a, b) => unitDef(b).strength - unitDef(a).strength)[0];
    if (army && distance(dims(s), army.tile, u.tile) > 1) applyAction(s, p, { type: 'move', unit: u.id, to: army.tile });
    return;
  }
  if (type === 'engineer') {
    // Hurry a wonder in the capital if one is being built, else build a manufactory.
    const cap = capitalOf(s, p);
    if (cap && cap.queue[0] && D.buildings.get(cap.queue[0].id)?.wonder) {
      if (u.tile !== cap.tile) applyAction(s, p, { type: 'move', unit: u.id, to: cap.tile });
      if (s.units[u.id] && u.tile === cap.tile) applyAction(s, p, { type: 'greatPerson', unit: u.id, use: 'hurry' });
      return;
    }
  }
  const prefer: Record<string, string> = { scientist: 'discover', engineer: 'improve', merchant: 'trade', artist: 'golden_age', writer: 'inspire', musician: 'concert' };
  const want = prefer[type ?? ''];
  if (want && uses.includes(want as never)) {
    applyAction(s, p, { type: 'greatPerson', unit: u.id, use: want as 'discover' });
    return;
  }
  // Walk to an owned tile without a city to build the special improvement.
  const cap = capitalOf(s, p);
  if (cap) {
    const spot = within(dims(s), cap.tile, 2).find((i) => i !== cap.tile && tileAt(s, i).owner === p && !cityAt(s, i) && !tileAt(s, i).resource && tileAt(s, i).terrain !== 'mountain' && !D.terrains.get(tileAt(s, i).terrain)!.water);
    if (spot !== undefined) {
      applyAction(s, p, { type: 'move', unit: u.id, to: spot });
      if (s.units[u.id] && greatPersonUses(s, u).includes('improve')) applyAction(s, p, { type: 'greatPerson', unit: u.id, use: 'improve' });
    }
  }
}

function chooseResearch(s: GameState, p: number): void {
  const pl = s.players[p];
  if (pl.research) return;
  const pers = personality(s, p);
  const avail = availableTechs(pl);
  if (!avail.length) return;
  const score = (t: string) => {
    let v = 10;
    for (const u of D.units.values()) {
      if (u.tech !== t || (u.faction && u.faction !== pl.faction)) continue;
      v += ['attack', 'fast', 'siege', 'ranged'].includes(u.role) ? pers.aggression * 1.5 : pers.boldness * 0.6;
    }
    for (const b of D.buildings.values()) {
      if (b.tech !== t || (b.faction && b.faction !== pl.faction)) continue;
      const w: Record<string, number> = { growth: 8, production: 7, gold: pers.gold, science: pers.science, culture: pers.culture, happiness: 9, defense: 3, military: pers.aggression * 0.5 };
      v += w[b.focus] ?? 3;
    }
    for (const i of D.improvements.values()) if (i.tech === t) v += 8;
    for (const r of D.resources.values()) if (r.revealTech === t) v += 6;
    v += get(D.techs, t).tileMods.length * 5;
    return v / Math.sqrt(techCost(s, p, t));
  };
  avail.sort((a, b) => score(b) - score(a));
  applyAction(s, p, { type: 'research', tech: avail[0] });
}

function decideCaptureAI(s: GameState, p: number, id: number): void {
  const c = s.cities[id];
  if (!c) return;
  const cap = capitalOf(s, p);
  const far = cap ? distance(dims(s), cap.tile, c.tile) > D.rules.city.razeVsAnnexDistance : true;
  const unhappy = happinessOf(s, p).net < 0;
  let choice: 'annex' | 'puppet' | 'raze' = far || unhappy ? 'puppet' : 'annex';
  if (unhappy && c.pop <= 2 && !c.wasCapital) choice = 'raze';
  applyAction(s, p, { type: 'capture', city: id, choice });
}

// ---- Cities ----

function atWarWithMajor(s: GameState, p: number): boolean {
  return majorPlayers(s).some((q) => q.id !== p && q.alive && s.diplomacy.war[p][q.id]);
}

function chooseProduction(s: GameState, p: number, c: City): void {
  const pers = personality(s, p);
  const options = buildableItems(s, c);
  if (!options.length) return;
  const cities = playerCities(s, p);
  const units = playerUnits(s, p);
  const military = units.filter((u) => !isCivilian(u) && unitDef(u).class !== 'recon').length;
  const workers = units.filter((u) => unitDef(u).canBuild).length;
  const settlers = units.filter((u) => unitDef(u).canFound).length + allCities(s).filter((x) => x.owner === p && x.queue[0]?.id === 'settler').length;
  const happy = happinessOf(s, p).net;
  const war = atWarWithMajor(s, p);
  const targetCities = 3 + Math.round(pers.expansion / 2);
  // Supply: armies beyond about 3 units per city cost too much upkeep to be worth it.
  const supply = 4 + cities.length * 3;
  const wantMilitary = Math.min(supply, 1 + cities.length * 1.2 + pers.aggression / 3 + (war ? cities.length * 1.5 : 0));
  const garrisoned = !!militaryAt(s, c.tile);
  const score = (item: QueueItem): number => {
    const cost = itemCost(s, p, item);
    let v = 0;
    if (item.kind === 'project') {
      const pr = get(D.projects, item.id);
      v = pr.process ? 0.5 : 60 + pers.science * 3;
    } else if (item.kind === 'unit' && get(D.units, item.id).spaceshipPart) {
      // Race for the stars once the Apollo Program is done.
      v = 70 + pers.science * 3;
    } else if (item.kind === 'unit' && phase10UnitScore(s, p, item.id, isCoastal(s, c), war) !== null) {
      v = phase10UnitScore(s, p, item.id, isCoastal(s, c), war)!;
    } else if (item.kind === 'unit') {
      const u = get(D.units, item.id);
      if (u.canFound) v = cities.length + settlers < targetCities && happy > 0 && c.pop >= 2 && s.turn > 3 ? 55 + pers.expansion : 0;
      else if (u.canBuild) v = workers < Math.max(1, cities.length) ? 45 : workers < cities.length * 1.5 ? 12 : 0;
      else if (u.class === 'recon') v = s.turn < 40 && units.filter((x) => unitDef(x).class === 'recon').length < 1 ? 15 : 0;
      else {
        const deficit = wantMilitary - military;
        v = deficit > 0 ? 25 + deficit * 8 : military >= supply ? 0 : 3;
        if (!garrisoned) v += 20;
        // Prefer strong units for their cost; defenders when not at war, attackers when at war.
        const power = Math.max(u.strength, u.ranged);
        v *= 0.6 + power / 25;
        if (war && ['attack', 'siege', 'fast'].includes(u.role)) v *= 1.3;
        if (!war && u.role === 'siege') v *= 0.4;
      }
    } else {
      const b = get(D.buildings, item.id);
      if (b.wonder) {
        // Wonders: by personality, more in productive cities, never while in danger.
        const prodRank = c.pop / Math.max(1, Math.max(...cities.map((x) => x.pop)));
        return war ? 2 : ((10 + pers.wonders * 3) * (0.5 + prodRank)) / (1 + cost / 400);
      }
      const w: Record<string, number> = {
        growth: 16 + (c.pop < 4 ? 6 : 0),
        production: 14,
        gold: 8 + pers.gold,
        science: 8 + pers.science,
        culture: 8 + pers.culture * 0.8 + (c.tilesClaimed < 4 ? 5 : 0),
        happiness: happy < 3 ? 40 : happy < 6 ? 14 : 4,
        defense: war ? 30 : 5,
        military: 4 + pers.aggression * 0.8,
      };
      v = w[b.focus] ?? 5;
      if (b.maintenance > 1 && s.players[p].gold < 30) v *= 0.6;
    }
    return v / (1 + cost / 120);
  };
  const best = options.map((o) => ({ o, v: score(o) })).sort((a, b) => b.v - a.v)[0];
  if (best && best.v > 0) applyAction(s, p, { type: 'produce', city: c.id, item: best.o });
}

function spendGold(s: GameState, p: number): void {
  const pl = s.players[p];
  const cities = playerCities(s, p);
  // Buy a cheap luxury/strategic tile now and then.
  if (pl.gold > 250) {
    for (const c of cities) {
      const t = claimableTiles(s, c).find((i) => {
        const r = tileAt(s, i).resource;
        return r && D.resources.get(r)!.kind !== 'bonus';
      });
      if (t !== undefined && tileBuyCost(s, c, t) < pl.gold - 150) {
        applyAction(s, p, { type: 'buyTile', city: c.id, tile: t });
        break;
      }
    }
  }
  if (pl.gold < 200) return;
  // Rich: buy useful buildings in the weakest cities (up to three a turn).
  const reserve = 150 + s.turn;
  for (let k = 0; k < 3 && pl.gold > reserve * 2; k++) {
    let bought = false;
    for (const c of [...cities].sort((x, y) => x.pop - y.pop)) {
      if (c.puppet || c.resistance) continue;
      const opts = buildableItems(s, c).filter((q) => q.kind === 'building' && !get(D.buildings, q.id).wonder);
      opts.sort((x, y) => buyCost(s, c, x) - buyCost(s, c, y));
      const q = opts.find((x) => buyCost(s, c, x) < pl.gold - reserve);
      if (q && applyAction(s, p, { type: 'buy', city: c.id, item: q }).ok) {
        bought = true;
        break;
      }
    }
    if (!bought) break;
  }
  // Hurry the queue head of the least productive city.
  const war = atWarWithMajor(s, p);
  for (const c of cities.sort((a, b) => a.pop - b.pop)) {
    const item = c.queue[0];
    if (!item) continue;
    // Military units are only worth hurrying in war (or when gold is piling up).
    if (!war && pl.gold < 400 && item.kind === 'unit' && !get(D.units, item.id).canFound && !get(D.units, item.id).canBuild) continue;
    const cost = buyCost(s, c, item);
    if (cost < pl.gold - 120) {
      applyAction(s, p, { type: 'buy', city: c.id, item });
      return;
    }
  }
}

// ---- Settlers ----

function bestSite(s: GameState, p: number, u: Unit): number {
  const pl = s.players[p];
  const cap = capitalOf(s, p);
  const m = dims(s);
  let best = -1, bestV = -Infinity;
  for (const i of within(m, u.tile, 10)) {
    if (!pl.explored[i] || canFoundAt(s, p, i)) continue;
    let v = siteScore(m, s.map.tiles, i);
    if (v <= 0) continue;
    // Shared tiles with existing territory are worth less.
    for (const j of within(m, i, 2)) if (tileAt(s, j).owner >= 0) v -= 2;
    if (cap) {
      const d = distance(m, cap.tile, i);
      if (d > 9) v -= (d - 9) * 3;
    }
    for (const c of allCities(s)) if (c.owner !== p && distance(m, c.tile, i) < 6) v -= 15;
    v -= distance(m, u.tile, i) * 1.5;
    if (v > bestV) {
      bestV = v;
      best = i;
    }
  }
  return best;
}

function settlerTurn(s: GameState, p: number, u: Unit): void {
  // First city: settle on the spot (start positions are chosen to be good).
  if (!playerCities(s, p).length && !canFoundAt(s, p, u.tile)) {
    applyAction(s, p, { type: 'found', unit: u.id });
    return;
  }
  // Keep a destination: the end of the current path.
  let goal = u.path.length ? u.path[u.path.length - 1] : -1;
  if (goal < 0 || canFoundAt(s, p, goal)) goal = bestSite(s, p, u);
  if (goal < 0) {
    if (!canFoundAt(s, p, u.tile)) applyAction(s, p, { type: 'found', unit: u.id });
    return;
  }
  if (goal === u.tile) {
    applyAction(s, p, { type: 'found', unit: u.id });
    return;
  }
  if (!applyAction(s, p, { type: 'move', unit: u.id, to: goal }).ok) {
    if (!canFoundAt(s, p, u.tile)) applyAction(s, p, { type: 'found', unit: u.id });
    return;
  }
  if (s.units[u.id] && u.tile === goal && u.moves > 0) applyAction(s, p, { type: 'found', unit: u.id });
}

// ---- Workers ----

function jobValue(s: GameState, p: number, tile: number, job: string): number {
  const t = tileAt(s, tile);
  if (job === 'road') return 0;
  if (job.startsWith('remove_')) return job === 'remove_marsh' ? 3 : 0.5;
  if (job === 'repair') return 8;
  const imp = get(D.improvements, job);
  let v = (imp.yields.food ?? 0) * 3 + (imp.yields.production ?? 0) * 2.5 + (imp.yields.gold ?? 0) * 1.5;
  if (imp.freshWaterFood && hasFreshWater(s, tile)) v += imp.freshWaterFood * 3;
  if (t.resource && D.resources.get(t.resource)!.improvement === job) {
    const r = D.resources.get(t.resource)!;
    v += r.kind === 'luxury' ? 12 : r.kind === 'strategic' ? 8 : 4;
  }
  if (t.feature && imp.clears.includes(t.feature)) v -= 1.5;
  void p;
  return v;
}

function workerTurn(s: GameState, p: number, u: Unit, reserved: Set<number>): void {
  if (u.job) return;
  // Flee from nearby enemies to the nearest city.
  const m = dims(s);
  const threat = within(m, u.tile, 2).some((i) => {
    const e = militaryAt(s, i);
    return e && atWar(s, p, e.owner);
  });
  const cities = playerCities(s, p);
  if (threat && cities.length) {
    const home = cities.sort((a, b) => distance(m, a.tile, u.tile) - distance(m, b.tile, u.tile))[0];
    if (home.tile !== u.tile) applyAction(s, p, { type: 'move', unit: u.id, to: home.tile });
    return;
  }
  // Best improvement on worked or soon-worked tiles near our cities.
  let best = -1, bestJob = '', bestV = 0;
  for (const c of cities) {
    for (const i of within(m, c.tile, 2)) {
      if (reserved.has(i) || tileAt(s, i).cityId !== c.id || i === c.tile) continue;
      const other = allUnits(s).some((o) => o.id !== u.id && o.owner === p && o.tile === i && unitDef(o).canBuild);
      if (other) continue;
      const fake = { ...u, tile: i };
      for (const opt of buildOptions(s, fake)) {
        let v = jobValue(s, p, i, opt.job);
        if (v <= 0) continue;
        v -= distance(m, u.tile, i) * 0.8;
        if (c.worked.includes(i)) v += 2;
        if (v > bestV) {
          bestV = v;
          best = i;
          bestJob = opt.job;
        }
      }
    }
  }
  // Otherwise roads to connect cities to the capital.
  if (best < 0) {
    const cap = capitalOf(s, p);
    const connected = connectedCities(s, p);
    const unconnected = cities.filter((c) => !connected.has(c.id) && cap && distance(m, c.tile, cap.tile) <= 10);
    if (cap && unconnected.length && s.players[p].techs.includes('the_wheel')) {
      const c = unconnected[0];
      const path = findPath(s, { ...u, tile: c.tile, moves: 99 }, cap.tile, 3000);
      const need = path?.path.find((i) => !tileAt(s, i).road && !cityAt(s, i) && !reserved.has(i));
      if (need !== undefined) {
        best = need;
        bestJob = 'road';
      }
    }
  }
  if (best < 0) return;
  reserved.add(best);
  if (u.tile !== best) {
    applyAction(s, p, { type: 'move', unit: u.id, to: best });
    if (!s.units[u.id] || u.tile !== best || u.moves <= 0) return;
  }
  applyAction(s, p, { type: 'build', unit: u.id, job: bestJob });
}

// ---- Scouts ----

function scoutTurn(s: GameState, p: number, u: Unit): void {
  if (u.path.length) return;
  if (autoExplore(s, u)) return;
  militaryTurn(s, p, u);
}

// ---- Military ----

function tryAttack(s: GameState, p: number, u: Unit): boolean {
  const best = withIndex(s, () => bestAttack(s, u));
  if (best < 0) return false;
  return applyAction(s, p, { type: 'attack', unit: u.id, to: best }).ok;
}

function bestAttack(s: GameState, u: Unit): number {
  const def = unitDef(u);
  const range = def.ranged > 0 ? def.range : 1;
  let best = -1, bestV = 0;
  for (const t of within(dims(s), u.tile, range)) {
    if (t === u.tile || canAttack(s, u, t)) continue;
    const pv = previewAttack(s, u, t);
    if (!pv) continue;
    const dealt = (pv.toDefender[0] + pv.toDefender[1]) / 2;
    const taken = (pv.toAttacker[0] + pv.toAttacker[1]) / 2;
    const kills = dealt >= pv.defenderHp;
    const city = !!cityAt(s, t);
    let v: number;
    if (pv.ranged) v = dealt + (kills ? 30 : 0);
    else {
      if (taken >= u.hp - 10 && !kills) continue; // suicide
      if (city && !kills && dealt < taken) continue;
      v = dealt - taken * 0.8 + (kills ? 25 : 0) + (city && kills ? 100 : 0);
    }
    if (v > bestV) {
      bestV = v;
      best = t;
    }
  }
  return best;
}

function militaryTurn(s: GameState, p: number, u: Unit): void {
  const m = dims(s);
  if (u.moves <= 0 || u.job) return;
  if (tryAttack(s, p, u)) {
    if (s.units[u.id] && u.moves > 0) tryAttack(s, p, u);
    return;
  }
  const cities = playerCities(s, p);
  const here = cityAt(s, u.tile);
  // Badly hurt: rest (fortify heals) — in a city if one is close.
  if (u.hp < 45) {
    const home = cities.filter((c) => !militaryAt(s, c.tile) || c.tile === u.tile).sort((a, b) => distance(m, a.tile, u.tile) - distance(m, b.tile, u.tile))[0];
    if (home && home.tile !== u.tile && distance(m, home.tile, u.tile) <= 4) applyAction(s, p, { type: 'move', unit: u.id, to: home.tile });
    else applyAction(s, p, { type: 'order', unit: u.id, order: 'fortify' });
    return;
  }
  // Garrison: every city wants a defender; the closest free unit goes.
  const ungarrisoned = cities.filter((c) => !militaryAt(s, c.tile));
  if (here && here.owner === p && militaryAt(s, here.tile)?.id === u.id && (unitDef(u).role === 'defense' || ungarrisoned.length === 0 || playerUnits(s, p).filter((x) => !isCivilian(x)).length <= cities.length)) {
    // Stay unless we're at war and have spare units elsewhere.
    if (!atWarWithMajor(s, p) || unitDef(u).role === 'defense') {
      applyAction(s, p, { type: 'order', unit: u.id, order: 'fortify' });
      return;
    }
  }
  const nearestEmpty = ungarrisoned.sort((a, b) => distance(m, a.tile, u.tile) - distance(m, b.tile, u.tile))[0];
  if (nearestEmpty && distance(m, nearestEmpty.tile, u.tile) <= 8 && unitDef(u).ranged === 0) {
    if (applyAction(s, p, { type: 'move', unit: u.id, to: nearestEmpty.tile }).ok) return;
  }
  // Threats near our cities.
  for (const c of cities) {
    for (const i of within(m, c.tile, 4)) {
      const e = militaryAt(s, i);
      if (e && atWar(s, p, e.owner) && s.players[p].visible[i]) {
        if (approach(s, p, u, i)) return;
      }
    }
  }
  // At war: march on the nearest enemy city.
  const enemyCities = allCities(s).filter((c) => c.owner !== p && s.diplomacy.war[p][c.owner] && s.players[p].explored[c.tile]);
  if (enemyCities.length && unitDef(u).class !== 'recon') {
    const target = enemyCities.sort((a, b) => distance(m, a.tile, u.tile) - distance(m, b.tile, u.tile))[0];
    if (approach(s, p, u, target.tile)) return;
  }
  // Clear barbarian camps near home.
  const camps = Object.keys(s.camps)
    .map(Number)
    .filter((t) => s.players[p].explored[t] && cities.some((c) => distance(m, c.tile, t) <= 8));
  if (camps.length && unitDef(u).strength >= 8 && u.hp > 70) {
    const camp = camps.sort((a, b) => distance(m, a, u.tile) - distance(m, b, u.tile))[0];
    if (approach(s, p, u, camp)) return;
  }
  // Upgrade if rich.
  const to = upgradeTarget(s, u);
  if (to && s.players[p].gold > upgradeCost(s, u) + 100 && tileAt(s, u.tile).owner === p) {
    applyAction(s, p, { type: 'upgrade', unit: u.id });
    return;
  }
  // Otherwise go home and fortify (second defender in the most exposed city).
  if (here && here.owner === p) {
    applyAction(s, p, { type: 'order', unit: u.id, order: 'fortify' });
    return;
  }
  const home = cities.sort((a, b) => distance(m, a.tile, u.tile) - distance(m, b.tile, u.tile))[0];
  if (home) {
    const spot = [home.tile, ...neighbors(m, home.tile)].find((i) => !militaryAt(s, i) || militaryAt(s, i)!.id === u.id);
    if (spot !== undefined && spot !== u.tile && applyAction(s, p, { type: 'move', unit: u.id, to: spot }).ok) return;
  }
  applyAction(s, p, { type: 'order', unit: u.id, order: 'fortify' });
}

/** Move toward a target tile (stopping next to it), then attack if possible. */
function approach(s: GameState, p: number, u: Unit, target: number): boolean {
  const m = dims(s);
  const range = unitDef(u).ranged > 0 ? unitDef(u).range : 1;
  if (distance(m, u.tile, target) <= range) return tryAttack(s, p, u);
  // Find a free tile next to (or in range of) the target to move to.
  const spots = within(m, target, range)
    .filter((i) => i !== target && distance(m, i, target) === range && !militaryAt(s, i))
    .sort((a, b) => distance(m, a, u.tile) - distance(m, b, u.tile));
  for (const spot of spots.slice(0, 2)) {
    const res = applyAction(s, p, { type: 'move', unit: u.id, to: spot });
    if (res.ok) {
      if (s.units[u.id] && u.moves > 0) tryAttack(s, p, u);
      return true;
    }
  }
  return false;
}

