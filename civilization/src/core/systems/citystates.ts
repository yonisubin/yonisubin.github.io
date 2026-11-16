// City-states: single-city minor civilizations. Each major player has an influence score with
// each city-state (gifts, quests, pledges raise it; bullying lowers it; it drifts back to a
// resting point every turn). At 30 you're a friend, at 60 (and highest) the ally: allies get the
// city-state's resources and its type's bigger bonus, and it joins their wars.
import { D, get, unitForFaction } from '../../data';
import { distance } from '../hex';
import { randInt, pick } from '../rng';
import { eraOf, logEvent, majorPlayers, minorPlayers, notify, playerCities, playerUnits, unitDef } from '../query';
import type { GameState, Player, Quest, Unit } from '../state';
import { bumpEffects, playerEffects, sum, type Fx } from './effects';
import { createUnit, freeTileNear } from './units';
import { militaryStrength } from '../power';
import { cityStrength } from './cities';

const C = () => D.rules.cityStates;

export function influence(s: GameState, minor: number, p: number): number {
  return s.players[minor].minor?.influence[p] ?? 0;
}

export function relation(s: GameState, minor: number, p: number): 'ally' | 'friend' | 'neutral' | 'angry' | 'war' {
  const m = s.players[minor].minor!;
  if (s.diplomacy.war[minor][p]) return 'war';
  if (m.ally === p) return 'ally';
  const v = m.influence[p] ?? 0;
  if (v >= C().friend) return 'friend';
  return v < 0 ? 'angry' : 'neutral';
}

/** Where influence drifts back to for player p. */
export function restingPoint(s: GameState, minor: number, p: number): number {
  const m = s.players[minor].minor!;
  let v = sum(playerEffects(s, p), 'cs_resting');
  if (m.pledges.includes(p)) v += C().pledgeResting;
  return v;
}

export function addInfluence(s: GameState, minor: number, p: number, amount: number): void {
  const m = s.players[minor].minor!;
  const before = relation(s, minor, p);
  m.influence[p] = (m.influence[p] ?? 0) + amount;
  updateAlly(s, minor);
  const after = relation(s, minor, p);
  if (before !== after && !s.players[p].isMinor) {
    const name = s.players[minor].name;
    if (after === 'ally') notify(s, p, `${name} is now your ally!`, 'good', playerCities(s, minor)[0]?.tile);
    else if (after === 'friend' && before !== 'ally') notify(s, p, `${name} is now your friend.`, 'good', playerCities(s, minor)[0]?.tile);
    else if (before === 'ally' || before === 'friend') notify(s, p, `${name} is no longer your ${before}.`, 'bad', playerCities(s, minor)[0]?.tile);
  }
}

function updateAlly(s: GameState, minor: number): void {
  const m = s.players[minor].minor!;
  let best = m.ally, bestV = best >= 0 ? m.influence[best] ?? 0 : -Infinity;
  if (best >= 0 && (bestV < C().ally || !s.players[best].alive || s.diplomacy.war[minor][best])) {
    best = -1;
    bestV = -Infinity;
  }
  for (const q of majorPlayers(s)) {
    if (!q.alive || s.diplomacy.war[minor][q.id]) continue;
    const v = m.influence[q.id] ?? 0;
    if (v >= C().ally && v > bestV) {
      best = q.id;
      bestV = v;
    }
  }
  if (best !== m.ally) {
    const old = m.ally;
    m.ally = best;
    if (best >= 0) {
      logEvent(s, `${s.players[minor].name} allied with the ${s.players[best].name}.`, undefined, best);
      // It joins its ally's wars against other majors.
      for (const q of majorPlayers(s)) if (q.id !== best && s.diplomacy.war[best][q.id] && !s.diplomacy.war[minor][q.id]) setWarHook?.(s, minor, q.id, true);
    }
    if (old >= 0 && old !== best) notify(s, old, `${s.players[minor].name} is no longer your ally.`, 'bad');
    bumpEffects(s);
  }
}

/** Set by game.ts (avoids an import cycle). */
let setWarHook: ((s: GameState, a: number, b: number, war: boolean) => void) | null = null;
export function setCityStateWarHook(f: (s: GameState, a: number, b: number, war: boolean) => void): void {
  setWarHook = f;
}

// ---- Bonuses (as effects for the major player) ----

export function cityStateEffects(s: GameState, p: number): Fx[] {
  const out: Fx[] = [];
  if (s.players[p].isMinor || s.players[p].isBarbarian) return out;
  const era = eraOf(s.players[p]);
  for (const mp of minorPlayers(s)) {
    if (!mp.alive) continue;
    const rel = relation(s, mp.id, p);
    if (rel !== 'friend' && rel !== 'ally') continue;
    const m = mp.minor!;
    const b = C().bonuses[m.type]?.[rel] ?? {};
    const scale = 1 + (era * C().perEraBonusPct) / 100;
    const src = `${mp.name} (${rel})`;
    if (b.food_capital) out.push(fx2('city_yield', { yield: 'food', amount: b.food_capital, scope: 'capital' }, src));
    if (b.food_all) out.push(fx2('city_yield', { yield: 'food', amount: b.food_all }, src));
    if (b.culture) out.push(fx2('city_yield', { yield: 'culture', amount: Math.round(b.culture * scale), scope: 'capital' }, src));
    if (b.faith) out.push(fx2('city_yield', { yield: 'faith', amount: b.faith, scope: 'capital' }, src));
    if (b.happiness) out.push(fx2('happiness', { amount: b.happiness }, src));
    if (rel === 'ally') out.push(fx2('cs_ally_marker', {}, src));
  }
  return out;
}

function fx2(type: string, o: Partial<Fx>, source: string): Fx {
  return { type, amount: 0, percent: 0, count: 1, scope: 'all', ...o, source } as Fx;
}

/** Scale city-state bonuses by Patronage (cs_bonus_pct) and add per-ally yields (cs_ally_yield). */
export function patronageEffects(_s: GameState, _p: number, base: Fx[]): Fx[] {
  const pct = sum(base, 'cs_bonus_pct', 'percent');
  const allies = base.filter((e) => e.type === 'cs_ally_marker').length;
  const out: Fx[] = [];
  for (const e of base) {
    if (e.source.includes('(friend)') || e.source.includes('(ally)')) {
      if (pct && e.amount) out.push({ ...e, amount: Math.round(e.amount * (pct / 100)), source: 'Patronage' });
    }
    if (e.type === 'cs_ally_yield' && allies) out.push({ ...e, type: 'city_yield', amount: e.amount * allies, scope: 'capital', source: e.source });
  }
  return out;
}

/** Allies get the city-state's luxuries and strategic resources. */
export function allyResources(s: GameState, p: number, kind: 'luxury' | 'strategic'): Record<string, number> {
  const out: Record<string, number> = {};
  for (const mp of minorPlayers(s)) {
    if (!mp.alive || mp.minor!.ally !== p) continue;
    s.map.tiles.forEach((t) => {
      if (t.owner !== mp.id || !t.resource) return;
      const r = D.resources.get(t.resource)!;
      if (r.kind !== kind || (r.revealTech && !s.players[p].techs.includes(r.revealTech))) return;
      out[t.resource] = (out[t.resource] ?? 0) + (kind === 'strategic' ? t.resourceQty : 1);
    });
    const def = D.cityStates.get(mp.minor!.def);
    if (kind === 'luxury' && def?.luxury) out[def.luxury] = (out[def.luxury] ?? 0) + 1;
  }
  return out;
}

// ---- Gifts, pledges, bullying ----

export function giftInfluence(s: GameState, p: number, gold: number): number {
  const c = C();
  const era = eraOf(s.players[p]);
  const pct = sum(playerEffects(s, p), 'cs_gift_pct', 'percent');
  return Math.round((gold / c.goldPerInfluence / (1 + era * c.eraGiftPenalty)) * (1 + pct / 100));
}

export function giftGold(s: GameState, p: number, minor: number, gold: number): string | null {
  if (!s.players[minor]?.isMinor) return 'not a city-state';
  if (gold <= 0 || s.players[p].gold < gold) return 'not enough gold';
  if (s.diplomacy.war[p][minor]) return 'at war';
  s.players[p].gold -= gold;
  addInfluence(s, minor, p, giftInfluence(s, p, gold));
  return null;
}

export function giftUnit(s: GameState, p: number, minor: number, u: Unit): string | null {
  const city = playerCities(s, minor)[0];
  if (!city) return 'no city';
  if (distance(s.map, u.tile, city.tile) > 3 && s.map.tiles[u.tile].owner !== minor) return 'move the unit next to the city-state first';
  if (unitDef(u).class === 'civilian') return 'only military units can be gifted';
  addInfluence(s, minor, p, Math.round(unitDef(u).cost / C().unitGiftDivisor));
  u.owner = minor;
  u.path = [];
  u.order = 'fortify';
  return null;
}

export function pledge(s: GameState, p: number, minor: number): string | null {
  const m = s.players[minor].minor!;
  if (m.pledges.includes(p)) {
    m.pledges = m.pledges.filter((x) => x !== p);
    return null;
  }
  if (influence(s, minor, p) < 0) return 'they don’t trust you';
  m.pledges.push(p);
  notify(s, p, `You pledged to protect ${s.players[minor].name}.`, 'info');
  return null;
}

/** Can p bully this city-state? Needs a military presence stronger than its defences. */
export function canBully(s: GameState, p: number, minor: number): string | null {
  const city = playerCities(s, minor)[0];
  if (!city) return 'no city';
  if (s.diplomacy.war[p][minor]) return 'at war';
  const near = playerUnits(s, p).filter((u) => unitDef(u).class !== 'civilian' && distance(s.map, u.tile, city.tile) <= 4);
  const ours = near.reduce((a, u) => a + Math.max(unitDef(u).strength, unitDef(u).ranged) * (u.hp / 100), 0);
  const theirs = cityStrength(s, city).value + militaryStrength(s, minor);
  if (ours < theirs * 1.5) return `your nearby forces (${Math.round(ours)}) don't scare them (${Math.round(theirs)})`;
  return null;
}

export function bully(s: GameState, p: number, minor: number, kind: 'gold' | 'worker'): string | null {
  const why = canBully(s, p, minor);
  if (why) return why;
  const c = C();
  const city = playerCities(s, minor)[0];
  if (kind === 'gold') {
    const gold = c.bullyGold + c.bullyGoldPerEra * eraOf(s.players[p]);
    s.players[p].gold += gold;
    addInfluence(s, minor, p, c.bullyInfluence);
    notify(s, p, `${s.players[minor].name} paid ${gold} gold in tribute.`, 'good', city.tile);
  } else {
    const type = unitForFaction('worker', s.players[p].faction);
    const at = freeTileNear(s, type, p, city.tile, 3);
    if (at < 0) return 'no room for a worker';
    createUnit(s, type, p, at);
    addInfluence(s, minor, p, c.bullyWorkerInfluence);
    notify(s, p, `${s.players[minor].name} handed over a Worker.`, 'good', city.tile);
  }
  return null;
}

// ---- Turn processing ----

export function processCityStates(s: GameState): void {
  const c = C();
  for (const mp of minorPlayers(s)) {
    if (!mp.alive) continue;
    const m = mp.minor!;
    for (const q of majorPlayers(s)) {
      if (!q.alive || !q.met.includes(mp.id)) continue;
      // Drift toward the resting point.
      const rest = restingPoint(s, mp.id, q.id);
      const cur = m.influence[q.id] ?? 0;
      const decay = c.decay * (c.personalityDecay[m.personality] ?? 1) * Math.max(0, 1 + sum(playerEffects(s, q.id), 'cs_decay_pct', 'percent') / 100);
      if (cur > rest) m.influence[q.id] = Math.max(rest, cur - decay);
      else if (cur < rest) m.influence[q.id] = Math.min(rest, cur + c.recover);
      // Militaristic city-states give units to friends and allies.
      const rel = relation(s, mp.id, q.id);
      if (m.type === 'militaristic' && (rel === 'friend' || rel === 'ally')) {
        const every = c.militaryGiftTurns[rel];
        if (s.turn - (m.lastGift[q.id] ?? 0) >= every) {
          m.lastGift[q.id] = s.turn;
          giftMilitaryUnit(s, q, mp);
        }
      }
    }
    updateAlly(s, mp.id);
    // Keep up with the world's technology (median of the majors).
    const majors = majorPlayers(s).filter((p) => p.alive);
    for (const t of D.techs.keys()) {
      if (mp.techs.includes(t) || D.techs.get(t)!.repeatable) continue;
      if (majors.filter((p) => p.techs.includes(t)).length * 2 > majors.length) mp.techs.push(t);
    }
    processQuests(s, mp);
  }
}

function giftMilitaryUnit(s: GameState, to: Player, from: Player): void {
  const cap = playerCities(s, to.id).find((x) => x.isCapital);
  if (!cap) return;
  const options = [...D.units.values()].filter((u) => !u.faction && u.role !== 'settle' && u.class !== 'civilian' && u.class !== 'recon' && (!u.tech || to.techs.includes(u.tech)) && !u.resource && !(u.obsoleteTech && to.techs.includes(u.obsoleteTech)) && u.cost > 0);
  if (!options.length) return;
  const best = options.sort((a, b) => b.cost - a.cost)[0];
  const type = unitForFaction(best.id, to.faction);
  const at = freeTileNear(s, type, to.id, cap.tile, 3);
  if (at < 0) return;
  createUnit(s, type, to.id, at);
  notify(s, to.id, `${from.name} sent you a ${get(D.units, type).name}.`, 'good', at);
}

// ---- Quests ----

const QUEST_TEXT: Record<string, (s: GameState, q: Quest) => string> = {
  camp: () => 'Destroy the barbarian camp that threatens us',
  wonder: (_s, q) => `Build the ${D.buildings.get(String(q.target))?.name}`,
  connect: (_s, q) => `Connect ${D.resources.get(String(q.target))?.name} to your empire`,
  culture: () => 'Make the most culture (contest)',
  techs: () => 'Discover the most technologies (contest)',
  great_person: (_s, q) => `Bring forth a Great ${String(q.target)[0].toUpperCase()}${String(q.target).slice(1)}`,
  conquer: (s, q) => `Conquer ${s.players[Number(q.target)]?.name}`,
};
export const QUEST_TEXT_HOOKS = QUEST_TEXT;

export function questText(s: GameState, q: Quest): string {
  return (QUEST_TEXT[q.kind] ?? (() => q.kind))(s, q);
}

/** Later phases add quest kinds: return a quest or null. */
export const QUEST_MAKERS: ((s: GameState, minor: Player) => Quest | null)[] = [];

function makeQuest(s: GameState, mp: Player): Quest | null {
  const until = s.turn + C().questTurns;
  const base = { start: s.turn, until, done: [] as number[] };
  const city = playerCities(s, mp.id)[0];
  const makers: (() => Quest | null)[] = [
    () => {
      const camp = Object.keys(s.camps).map(Number).find((t) => city && distance(s.map, t, city.tile) <= 10);
      return camp !== undefined ? { kind: 'camp', target: camp, ...base } : null;
    },
    () => {
      const majors = majorPlayers(s).filter((p) => p.alive);
      const era = Math.max(...majors.map(eraOf));
      const w = [...D.buildings.values()].filter((b) => b.wonder === 'world' && s.wonders[b.id] === undefined && b.tech && D.techs.get(b.tech)!.era <= era);
      return w.length ? { kind: 'wonder', target: pick(s, w).id, ...base } : null;
    },
    () => {
      const lux = [...D.resources.values()].filter((r) => r.kind === 'luxury' && !r.minorOnly && s.map.tiles.some((t) => t.resource === r.id));
      return lux.length ? { kind: 'connect', target: pick(s, lux).id, ...base } : null;
    },
    () => ({ kind: 'culture', ...base, base: Object.fromEntries(majorPlayers(s).map((p) => [p.id, p.cultureTotal])) }),
    () => ({ kind: 'techs', ...base, base: Object.fromEntries(majorPlayers(s).map((p) => [p.id, p.techs.length + p.futureTechs])) }),
    () => ({ kind: 'great_person', target: pick(s, ['scientist', 'engineer', 'merchant', 'artist', 'writer', 'musician']), ...base }),
    () => {
      const rivals = minorPlayers(s).filter((x) => x.alive && x.id !== mp.id && playerCities(s, x.id)[0] && city && distance(s.map, playerCities(s, x.id)[0].tile, city.tile) <= 14);
      return rivals.length && mp.minor!.personality !== 'friendly' ? { kind: 'conquer', target: pick(s, rivals).id, ...base } : null;
    },
    ...QUEST_MAKERS.map((f) => () => f(s, mp)),
  ];
  for (let tries = 0; tries < 6; tries++) {
    const q = makers[randInt(s, makers.length)]();
    if (q && !mp.minor!.quests.some((x) => x.kind === q.kind)) return q;
  }
  return null;
}

function processQuests(s: GameState, mp: Player): void {
  const m = mp.minor!;
  // Contests end at their deadline: the leader(s) win.
  for (const q of m.quests) {
    if (q.until > s.turn) {
      if (q.kind === 'connect')
        for (const p of majorPlayers(s)) if (p.met.includes(mp.id) && !q.done.includes(p.id) && luxuryOwned(s, p.id, String(q.target))) completeQuest(s, mp, q, p.id);
      continue;
    }
    if (q.kind === 'culture' || q.kind === 'techs') {
      const gains = majorPlayers(s)
        .filter((p) => p.alive && p.met.includes(mp.id))
        .map((p) => ({ p: p.id, v: (q.kind === 'culture' ? p.cultureTotal : p.techs.length + p.futureTechs) - (q.base?.[p.id] ?? 0) }));
      const top = Math.max(0, ...gains.map((g) => g.v));
      if (top > 0) for (const g of gains) if (g.v === top) completeQuest(s, mp, q, g.p);
    }
  }
  m.quests = m.quests.filter((q) => q.until > s.turn && !(q.done.length && !['culture', 'techs', 'connect', 'great_person'].includes(q.kind)));
  if ((s.turn + mp.id) % C().questEveryTurns === 0 && m.quests.length < 2) {
    const q = makeQuest(s, mp);
    if (q) {
      m.quests.push(q);
      for (const p of majorPlayers(s)) if (p.met.includes(mp.id)) notify(s, p.id, `${mp.name} asks: ${questText(s, q)}.`, 'info', playerCities(s, mp.id)[0]?.tile);
    }
  }
}

let luxuryOwned: (s: GameState, p: number, res: string) => boolean = () => false;
export function setLuxuryCheck(f: (s: GameState, p: number, res: string) => boolean): void {
  luxuryOwned = f;
}

function completeQuest(s: GameState, mp: Player, q: Quest, p: number): void {
  if (q.done.includes(p)) return;
  q.done.push(p);
  addInfluence(s, mp.id, p, C().questInfluence);
  notify(s, p, `${mp.name}: quest complete — “${questText(s, q)}” (+${C().questInfluence} influence).`, 'good', playerCities(s, mp.id)[0]?.tile);
}

/** Something happened that might complete a quest: kind + what + who did it. */
export function questEvent(s: GameState, kind: string, target: string | number, p: number): void {
  if (p < 0 || s.players[p].isMinor || s.players[p].isBarbarian) return;
  for (const mp of minorPlayers(s)) {
    if (!mp.alive || !s.players[p].met.includes(mp.id)) continue;
    for (const q of mp.minor!.quests) if (q.kind === kind && String(q.target) === String(target) && q.until > s.turn) completeQuest(s, mp, q, p);
  }
}

/** A city-state was conquered: everyone who knew it is upset with the conqueror. */
export function onCityStateConquered(s: GameState, minor: number, by: number): void {
  questEvent(s, 'conquer', minor, by);
  s.players[by].warmonger = (s.players[by].warmonger ?? 0) + 15;
  for (const mp of minorPlayers(s)) if (mp.alive && mp.id !== minor) addInfluence(s, mp.id, by, -20);
}

