// Religion and faith. Faith buys a pantheon belief (one per player, each belief once in the
// world); Great Prophets (born when faith reaches a threshold) found a religion — a name plus a
// founder and a follower belief — and later enhance it. Cities have followers per religion;
// the majority religion applies its follower beliefs to the city. Religions spread by pressure
// from nearby cities (holy cities press harder, trade routes carry it), missionaries and
// prophets, and are pushed out by inquisitors.
import { D, get, type BeliefDef } from '../../data';
import { distance } from '../hex';
import { cityAt, dims, eraOf, logEvent, majorPlayers, notify, playerCities, unitDef } from '../query';
import type { City, GameState, QueueItem, Religion, Unit } from '../state';
import { bumpEffects, costPct, playerEffects, sum, type Fx } from './effects';
import { createUnit, freeTileNear, removeUnit } from './units';

const R = () => D.rules.religion;
const pace = (s: GameState) => get(D.pace, s.settings.pace).costPct / 100;

export function majority(c: City): string | null {
  let best: string | null = null, n = 0;
  for (const [r, v] of Object.entries(c.followers ?? {})) if (v > n || (v === n && best !== null && r < best)) [best, n] = [r, v];
  return n > 0 ? best : null;
}

export function takenBeliefs(s: GameState): Set<string> {
  const out = new Set<string>();
  for (const p of s.players) if (p.pantheon) out.add(p.pantheon);
  for (const r of Object.values(s.religions)) for (const b of r.beliefs) out.add(b);
  return out;
}

export function availableBeliefs(s: GameState, kind: BeliefDef['kind']): BeliefDef[] {
  const taken = takenBeliefs(s);
  return [...D.beliefs.values()].filter((b) => b.kind === kind && !taken.has(b.id));
}

export function pantheonCost(s: GameState): number {
  const n = s.players.filter((p) => p.pantheon).length;
  return Math.round((R().pantheonBase + R().pantheonPerPantheon * n) * pace(s));
}

export function prophetCost(s: GameState, p: number): number {
  const n = s.players[p].gpCount.prophet ?? 0;
  return Math.round((R().prophetBase + R().prophetPerProphet * n) * pace(s));
}

export function maxReligions(s: GameState): number {
  const majors = majorPlayers(s).length;
  return Math.min(R().maxReligions, Math.floor((majors * R().maxReligionsPct) / 100) + 1);
}

export function canChoosePantheon(s: GameState, p: number): boolean {
  const pl = s.players[p];
  return !pl.pantheon && !pl.isMinor && pl.faith >= pantheonCost(s) && availableBeliefs(s, 'pantheon').length > 0;
}

export function choosePantheon(s: GameState, p: number, belief: string): string | null {
  if (!canChoosePantheon(s, p)) return 'not enough faith (or you already have a pantheon)';
  if (!availableBeliefs(s, 'pantheon').some((b) => b.id === belief)) return 'that belief is taken';
  const pl = s.players[p];
  pl.faith -= pantheonCost(s);
  pl.pantheon = belief;
  notify(s, p, `Your people now worship ${get(D.beliefs, belief).name}.`, 'good');
  logEvent(s, `The ${pl.name} adopted the pantheon ${get(D.beliefs, belief).name}.`, undefined, p);
  bumpEffects(s);
  return null;
}

/** Spread one citizen of a city to religion r (taking from non-believers first). */
function convert(c: City, r: string, n = 1): void {
  for (let k = 0; k < n; k++) {
    const total = Object.values(c.followers).reduce((a, b) => a + b, 0);
    if ((c.followers[r] ?? 0) >= c.pop) return;
    if (total >= c.pop) {
      // Take from the largest other religion.
      const other = Object.entries(c.followers)
        .filter(([x, v]) => x !== r && v > 0)
        .sort((a, b) => b[1] - a[1])[0];
      if (!other) return;
      c.followers[other[0]]--;
    }
    c.followers[r] = (c.followers[r] ?? 0) + 1;
  }
}

export function foundReligion(s: GameState, u: Unit, name: string, founder: string, follower: string): string | null {
  const pl = s.players[u.owner];
  if (unitDef(u).religious !== 'prophet') return 'only a Great Prophet can found a religion';
  if (pl.religion) return 'you already founded a religion';
  if (Object.keys(s.religions).length >= maxReligions(s)) return 'no more religions can be founded in this world';
  const c = cityAt(s, u.tile);
  if (!c || c.owner !== u.owner) return 'the prophet must be in one of your cities';
  if (Object.values(s.religions).some((r) => r.holyCity === c.id)) return 'this city is already a holy city';
  const fb = D.beliefs.get(founder), fl = D.beliefs.get(follower);
  const taken = takenBeliefs(s);
  if (!fb || fb.kind !== 'founder' || taken.has(founder)) return 'choose an available founder belief';
  if (!fl || fl.kind !== 'follower' || taken.has(follower)) return 'choose an available follower belief';
  const clean = name.trim().slice(0, 40) || D.religionNames.find((n) => !Object.values(s.religions).some((r) => r.name === n)) || 'The Faith';
  const id = `rel${s.nextId++}`;
  const rel: Religion = { id, name: clean, founder: u.owner, holyCity: c.id, beliefs: [founder, follower], enhanced: false };
  s.religions[id] = rel;
  pl.religion = id;
  convert(c, id, c.pop);
  removeUnit(s, u);
  logEvent(s, `The ${pl.name} founded ${clean} in ${c.name}.`, c.tile, u.owner);
  for (const q of s.players) notify(s, q.id, q.id === u.owner ? `You founded ${clean}!` : `The ${pl.name} founded a religion: ${clean}.`, q.id === u.owner ? 'good' : 'info', c.tile);
  bumpEffects(s);
  return null;
}

export function enhanceReligion(s: GameState, u: Unit, follower: string, enhancer: string): string | null {
  const pl = s.players[u.owner];
  const rel = pl.religion ? s.religions[pl.religion] : undefined;
  if (unitDef(u).religious !== 'prophet') return 'only a Great Prophet can enhance a religion';
  if (!rel) return 'found a religion first';
  if (rel.enhanced) return 'your religion is already enhanced';
  const taken = takenBeliefs(s);
  if (D.beliefs.get(follower)?.kind !== 'follower' || taken.has(follower)) return 'choose an available follower belief';
  if (D.beliefs.get(enhancer)?.kind !== 'enhancer' || taken.has(enhancer)) return 'choose an available enhancer belief';
  rel.beliefs.push(follower, enhancer);
  rel.enhanced = true;
  removeUnit(s, u);
  notify(s, u.owner, `${rel.name} is enhanced.`, 'good');
  bumpEffects(s);
  return null;
}

/** Completing Devotion (the faith tree) lets the founder add a reformation belief. */
export function canReform(s: GameState, p: number): boolean {
  const pl = s.players[p];
  const rel = pl.religion ? s.religions[pl.religion] : undefined;
  return !!rel && pl.policies.includes('done:devotion') && !rel.beliefs.some((b) => D.beliefs.get(b)?.kind === 'reformation');
}

export function reform(s: GameState, p: number, belief: string): string | null {
  if (!canReform(s, p)) return 'not possible';
  if (D.beliefs.get(belief)?.kind !== 'reformation' || takenBeliefs(s).has(belief)) return 'choose an available reformation belief';
  s.religions[s.players[p].religion!].beliefs.push(belief);
  bumpEffects(s);
  return null;
}

/** Target city for a missionary/prophet: the city it stands in or next to. */
export function spreadTarget(s: GameState, u: Unit): City | undefined {
  const here = cityAt(s, u.tile);
  if (here) return here;
  return Object.values(s.cities).find((c) => distance(dims(s), c.tile, u.tile) === 1);
}

export function spread(s: GameState, u: Unit): string | null {
  const kind = unitDef(u).religious;
  if (kind !== 'missionary' && kind !== 'prophet') return 'this unit cannot spread religion';
  const rel = u.religion ?? s.players[u.owner].religion;
  if (!rel || !s.religions[rel]) return 'no religion to spread';
  const c = spreadTarget(s, u);
  if (!c) return 'stand in or next to a city';
  if (s.diplomacy.war[u.owner]?.[c.owner]) return 'not into an enemy city';
  // Inquisitors guard their city.
  if (Object.values(s.units).some((x) => x.tile === c.tile && x.owner === c.owner && unitDef(x).religious === 'inquisitor' && x.religion !== rel)) return 'an inquisitor guards this city';
  if (u.moves <= 0) return 'no moves left';
  const fx = s.religions[rel] ? religionFx(s, rel) : [];
  const pct = (kind === 'prophet' ? R().prophetConvertPct : R().missionaryConvertPct) * (1 + sum(fx, 'missionary_pct', 'percent') / 100);
  convert(c, rel, Math.max(1, Math.round((c.pop * pct) / 100)));
  u.charges = (u.charges ?? 1) - 1;
  u.moves = 0;
  if (c.owner !== u.owner) notify(s, c.owner, `${s.religions[rel].name} is spreading in ${c.name}.`, 'info', c.tile);
  if ((u.charges ?? 0) <= 0) removeUnit(s, u);
  return null;
}

export function removeHeresy(s: GameState, u: Unit): string | null {
  if (unitDef(u).religious !== 'inquisitor') return 'only inquisitors can do that';
  const c = cityAt(s, u.tile);
  if (!c || c.owner !== u.owner) return 'stand in one of your cities';
  const rel = u.religion ?? s.players[u.owner].religion;
  for (const r of Object.keys(c.followers)) if (r !== rel) c.followers[r] = 0;
  removeUnit(s, u);
  notify(s, u.owner, `Other faiths were driven out of ${c.name}.`, 'good', c.tile);
  return null;
}

export function theological(s: GameState, u: Unit, to: number): string | null {
  if (!unitDef(u).religious) return 'only religious units debate';
  if (distance(dims(s), u.tile, to) !== 1) return 'too far';
  const target = Object.values(s.units).find((x) => x.tile === to && x.owner !== u.owner && unitDef(x).religious && x.religion !== u.religion);
  if (!target) return 'no rival religious unit there';
  target.hp -= R().theologicalDamage;
  u.hp -= R().theologicalDamage / 2;
  u.moves = 0;
  if (target.hp <= 0) {
    notify(s, target.owner, `Your ${unitDef(target).name} lost a theological debate.`, 'bad', to);
    removeUnit(s, target);
  }
  if (u.hp <= 0) removeUnit(s, u);
  return null;
}

// ---- Buying with faith ----

export function faithCost(s: GameState, c: City, item: QueueItem): number {
  const pl = s.players[c.owner];
  const era = eraOf(pl);
  let cost = 0;
  if (item.kind === 'unit') {
    const u = get(D.units, item.id);
    if (u.greatPerson === 'prophet') cost = prophetCost(s, c.owner) * 1.5;
    else if (u.greatPerson) cost = R().gpFaithCost + R().gpFaithPerPurchase * (pl.gpCount[u.greatPerson] ?? 0);
    else cost = u.faithCost * (1 + (era * R().faithCostPerEra) / 100);
  } else if (item.kind === 'building') cost = get(D.buildings, item.id).faithCost * (1 + (era * R().faithCostPerEra) / 100);
  return Math.round(cost * pace(s) * Math.max(0.1, 1 + costPct(s, c.owner, 'faith') / 100));
}

/** Policy trees whose completion unlocks buying a kind of great person with faith. */
const GP_TREES: Record<string, string> = { scientist: 'reason', merchant: 'commerce', artist: 'artistry', writer: 'artistry', musician: 'artistry', engineer: 'heritage', general: 'valor', admiral: 'voyaging' };

export function faithItems(s: GameState, c: City): { item: QueueItem; cost: number; why: string | null }[] {
  const pl = s.players[c.owner];
  const out: { item: QueueItem; cost: number; why: string | null }[] = [];
  const maj = majority(c);
  const mine = pl.religion;
  const add = (item: QueueItem, why: string | null) => out.push({ item, cost: faithCost(s, c, item), why });
  add({ kind: 'unit', id: 'missionary' }, !mine ? 'found a religion first' : maj !== mine ? 'the city must follow your religion' : null);
  add({ kind: 'unit', id: 'inquisitor' }, !mine ? 'found a religion first' : maj !== mine ? 'the city must follow your religion' : null);
  const canProphet = mine ? !s.religions[mine].enhanced : Object.keys(s.religions).length < maxReligions(s);
  add({ kind: 'unit', id: 'great_prophet' }, canProphet ? null : 'no use for a prophet now');
  // Religious buildings from the city's majority religion's follower beliefs.
  if (maj && s.religions[maj])
    for (const b of s.religions[maj].beliefs) {
      const bel = D.beliefs.get(b);
      if (bel?.building && !c.buildings.includes(bel.building)) add({ kind: 'building', id: bel.building }, null);
    }
  // Great people with faith in the industrial era, once the matching tree is complete.
  if (eraOf(pl) >= 4)
    for (const [gp, tree] of Object.entries(GP_TREES)) {
      const unit = D.greatPeople.get(gp)?.unit;
      if (unit) add({ kind: 'unit', id: unit }, pl.policies.includes(`done:${tree}`) ? null : `complete ${get(D.policyTrees, tree).name}`);
    }
  return out;
}

export function buyWithFaith(s: GameState, c: City, item: QueueItem): string | null {
  const opt = faithItems(s, c).find((o) => o.item.kind === item.kind && o.item.id === item.id);
  if (!opt) return 'not available here';
  if (opt.why) return opt.why;
  const pl = s.players[c.owner];
  if (pl.faith < opt.cost) return `needs ${opt.cost} faith`;
  if (item.kind === 'building') {
    pl.faith -= opt.cost;
    c.buildings.push(item.id);
    return null;
  }
  const at = freeTileNear(s, item.id, c.owner, c.tile, 2);
  if (at < 0) return 'no room for the unit';
  pl.faith -= opt.cost;
  const u = createUnit(s, item.id, c.owner, at);
  const def = unitDef(u);
  if (def.religious) {
    u.religion = pl.religion ?? majority(c) ?? undefined;
    u.charges = def.charges + (def.religious === 'missionary' && u.religion ? sum(religionFx(s, u.religion), 'missionary_charges') : 0);
  }
  if (def.greatPerson) pl.gpCount[def.greatPerson] = (pl.gpCount[def.greatPerson] ?? 0) + 1;
  return null;
}

// ---- Turn processing ----

/** A religion's founder-side effects (enhancers) for spreading. */
export function religionFx(s: GameState, rel: string): Fx[] {
  const r = s.religions[rel];
  if (!r) return [];
  const out: Fx[] = [];
  for (const b of r.beliefs) for (const e of get(D.beliefs, b).effects) out.push({ ...e, source: get(D.beliefs, b).name });
  return out;
}

export function processReligion(s: GameState): void {
  // Prophets for players with enough faith.
  for (const pl of s.players) {
    if (pl.isMinor || pl.isBarbarian || !pl.alive) continue;
    const canUse = pl.religion ? !s.religions[pl.religion].enhanced : Object.keys(s.religions).length < maxReligions(s);
    if (canUse && pl.pantheon && pl.faith >= prophetCost(s, pl.id)) {
      const cap = playerCities(s, pl.id).find((c) => c.isCapital) ?? playerCities(s, pl.id)[0];
      if (!cap) continue;
      const at = freeTileNear(s, 'great_prophet', pl.id, cap.tile, 2);
      if (at < 0) continue;
      pl.faith -= prophetCost(s, pl.id);
      const u = createUnit(s, 'great_prophet', pl.id, at);
      u.charges = unitDef(u).charges;
      u.religion = pl.religion ?? undefined;
      pl.gpCount.prophet = (pl.gpCount.prophet ?? 0) + 1;
      notify(s, pl.id, 'A Great Prophet has appeared!', 'good', at);
    }
  }
  const cities = Object.values(s.cities);
  const sources = cities.map((c) => ({ c, r: majority(c) })).filter((x) => x.r && s.religions[x.r]);
  for (const c of cities) {
    // New citizens follow the majority; lost citizens leave the smallest faith.
    let total = Object.values(c.followers).reduce((a, b) => a + b, 0);
    const maj = majority(c);
    if (total < c.pop && maj) {
      c.followers[maj] += c.pop - total;
      total = c.pop;
    }
    while (total > c.pop) {
      const smallest = Object.entries(c.followers).filter(([, v]) => v > 0).sort((a, b) => a[1] - b[1])[0];
      if (!smallest) break;
      c.followers[smallest[0]]--;
      total--;
    }
    // Pressure from nearby cities and trade routes.
    for (const src of sources) {
      if (src.c.id === c.id) continue;
      const rel = src.r!;
      const fx = religionFx(s, rel);
      const range = R().pressureRange * (1 + sum(fx, 'pressure_range_pct', 'percent') / 100);
      if (distance(dims(s), src.c.tile, c.tile) > range) continue;
      const holy = s.religions[rel].holyCity === src.c.id;
      const base = holy ? R().pressureHoly : R().pressureCity;
      c.pressure[rel] = (c.pressure[rel] ?? 0) + base * (1 + sum(fx, 'pressure_pct', 'percent') / 100);
    }
    // A holy city keeps pressing its own religion on itself.
    for (const rel of Object.values(s.religions)) if (rel.holyCity === c.id) c.pressure[rel.id] = (c.pressure[rel.id] ?? 0) + R().pressureHoly * 2;
    for (const route of s.tradeRoutes) {
      const other = route.from === c.id ? s.cities[route.to] : route.to === c.id ? s.cities[route.from] : undefined;
      const rel = other ? majority(other) : null;
      if (!rel || !s.religions[rel]) continue;
      c.pressure[rel] = (c.pressure[rel] ?? 0) + R().pressureRoute * (1 + sum(religionFx(s, rel), 'route_pressure_pct', 'percent') / 100);
    }
    for (const [rel, v] of Object.entries(c.pressure)) {
      if (!s.religions[rel]) {
        delete c.pressure[rel];
        continue;
      }
      if (v >= R().convertAt) {
        convert(c, rel);
        c.pressure[rel] = v - R().convertAt;
      }
    }
  }
}

/** Effects a player gets from religion: pantheon, founder and reformation beliefs. */
export function religionPlayerEffects(s: GameState, p: number): Fx[] {
  const pl = s.players[p];
  const out: Fx[] = [];
  if (pl.pantheon) for (const e of get(D.beliefs, pl.pantheon).effects) out.push({ ...e, source: get(D.beliefs, pl.pantheon).name });
  const rel = pl.religion ? s.religions[pl.religion] : undefined;
  if (rel) {
    const following = Object.values(s.cities).filter((c) => majority(c) === rel.id);
    const foreign = following.filter((c) => c.owner !== p).length;
    const followers = Object.values(s.cities).reduce((a, c) => a + (c.followers[rel.id] ?? 0), 0);
    for (const b of rel.beliefs) {
      const def = get(D.beliefs, b);
      if (def.kind !== 'founder' && def.kind !== 'reformation') continue;
      for (const e of def.effects) {
        const src = def.name;
        if (e.type === 'per_follower_city') out.push({ ...e, type: 'city_yield', amount: e.amount * following.length, scope: 'capital', source: src });
        else if (e.type === 'per_foreign_follower_city') out.push({ ...e, type: 'city_yield', amount: e.amount * foreign, scope: 'capital', source: src });
        else if (e.type === 'per_follower') out.push({ ...e, type: 'city_yield', amount: Math.floor((e.amount * followers) / 2), scope: 'capital', source: src });
        else if (e.type === 'per_follower_city_happiness') out.push({ ...e, type: 'happiness', amount: Math.floor(e.amount * following.length), source: src });
        else out.push({ ...e, source: src });
      }
    }
  }
  return out;
}

/** Follower beliefs of a city's majority religion, as effects local to that city. */
export function religionCityEffects(s: GameState, c: City): Fx[] {
  const maj = majority(c);
  const rel = maj ? s.religions[maj] : undefined;
  if (!rel) return [];
  const out: Fx[] = [];
  for (const b of rel.beliefs) {
    const def = get(D.beliefs, b);
    if (def.kind !== 'follower') continue;
    for (const e of def.effects) if (e.type !== 'happiness_city') out.push({ ...e, scope: 'this', source: def.name });
  }
  return out;
}

/** Happiness from follower beliefs (+1 per following city...). */
export function religionHappiness(s: GameState, p: number): number {
  let v = 0;
  for (const c of playerCities(s, p)) {
    const maj = majority(c);
    if (!maj || !s.religions[maj]) continue;
    for (const b of s.religions[maj].beliefs)
      for (const e of get(D.beliefs, b).effects)
        if (e.type === 'happiness_city' && (!e.where || (e.where === 'river' && s.map.tiles[c.tile].river))) v += e.amount;
  }
  return v;
}

export { playerEffects };
