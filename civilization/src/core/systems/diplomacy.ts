// Diplomacy between major civilizations: embassies, open borders, defensive pacts, research
// agreements, declarations of friendship and denouncements, trade deals (lump and per-turn gold,
// luxury and strategic resources, cities, peace, war on a third party), warmongering, and the
// AI opinion model (a list of visible modifiers that add up to a stance).
import { D, get } from '../../data';
import { distance } from '../hex';
import { eraOf, logEvent, majorPlayers, notify, playerCities } from '../query';
import type { ActiveDeal, Deal, DealItem, GameState } from '../state';
import { score } from './economy';
import { addScience } from './research';
import { bumpEffects } from './effects';
import { militaryStrength } from '../power';

const R = () => D.rules.diplomacy;

export const isMinor = (s: GameState, p: number) => !!s.players[p]?.isMinor;
export const active = (until: number, s: GameState) => until > s.turn;

export function hasOpenBorders(s: GameState, owner: number, guest: number): boolean {
  return active(s.diplomacy.openBorders[owner]?.[guest] ?? 0, s);
}
export const areFriends = (s: GameState, a: number, b: number) => active(s.diplomacy.friend[a]?.[b] ?? 0, s);
export const havePact = (s: GameState, a: number, b: number) => active(s.diplomacy.pact[a]?.[b] ?? 0, s);
export const denounced = (s: GameState, a: number, b: number) => active(s.diplomacy.denounce[a]?.[b] ?? 0, s);

function log(s: GameState, text: string): void {
  s.diplomacy.log.push({ turn: s.turn, text });
  if (s.diplomacy.log.length > 200) s.diplomacy.log.shift();
}

// ---- Resources: copies owned, lent out and received ----

/** Luxury copies a player has from its own land (improved tiles, or under a city). */
export function ownLuxuryCopies(s: GameState, p: number): Record<string, number> {
  const out: Record<string, number> = {};
  const pl = s.players[p];
  s.map.tiles.forEach((t, i) => {
    if (t.owner !== p || !t.resource) return;
    const r = D.resources.get(t.resource)!;
    if (r.kind !== 'luxury' || (r.revealTech && !pl.techs.includes(r.revealTech))) return;
    const underCity = t.cityId >= 0 && s.cities[t.cityId]?.tile === i;
    if ((t.improvement === r.improvement && !t.pillaged) || underCity || r.improvement === 'none') out[t.resource] = (out[t.resource] ?? 0) + 1;
  });
  for (const h of LUXURY_HOOKS) h(s, p, out);
  return out;
}

/** City-state alliances etc. add luxuries/strategics here. */
export const LUXURY_HOOKS: ((s: GameState, p: number, out: Record<string, number>) => void)[] = [];

/** Copies after deals: own − lent + received. */
export function luxuryCounts(s: GameState, p: number): Record<string, number> {
  const out = ownLuxuryCopies(s, p);
  for (const d of s.diplomacy.deals) {
    if (d.kind !== 'luxury' || !d.res) continue;
    if (d.from === p) out[d.res] = (out[d.res] ?? 0) - d.amount;
    if (d.to === p) out[d.res] = (out[d.res] ?? 0) + d.amount;
  }
  return out;
}

/** Strategic copies lent (negative) or received (positive) through deals. */
export function strategicDealDelta(s: GameState, p: number, res: string): number {
  let v = 0;
  for (const d of s.diplomacy.deals) {
    if (d.kind !== 'strategic' || d.res !== res) continue;
    if (d.from === p) v -= d.amount;
    if (d.to === p) v += d.amount;
  }
  return v;
}

// ---- Deals ----

/** What player p could put on the table for `other` (used by the trade screen and the AI). */
export function tradeableItems(s: GameState, p: number, other: number, strategic: Record<string, { total: number; used: number }>): DealItem[] {
  const pl = s.players[p];
  const out: DealItem[] = [];
  const war = s.diplomacy.war[p][other];
  if (war) return [{ kind: 'peace', from: p }, ...(pl.gold > 0 ? [{ kind: 'gold' as const, from: p, amount: Math.min(pl.gold, 100) }] : []), ...playerCities(s, p).filter((c) => !c.isCapital).map((c) => ({ kind: 'city' as const, from: p, city: c.id }))];
  if (pl.gold > 0) out.push({ kind: 'gold', from: p, amount: Math.min(pl.gold, 100) });
  out.push({ kind: 'gpt', from: p, amount: 5 });
  const lux = luxuryCounts(s, p);
  for (const [r, n] of Object.entries(lux)) if (n >= 1) out.push({ kind: 'luxury', from: p, res: r, amount: 1 });
  for (const [r, v] of Object.entries(strategic)) if (v.total - v.used >= 1) out.push({ kind: 'strategic', from: p, res: r, amount: 1 });
  if (!hasOpenBorders(s, p, other)) out.push({ kind: 'openBorders', from: p });
  if (!s.diplomacy.embassy[other][p]) out.push({ kind: 'embassy', from: p });
  if (!s.diplomacy.researchAgreements.some((r) => (r.a === p && r.b === other) || (r.a === other && r.b === p)) && eraOf(pl) >= 1)
    out.push({ kind: 'researchAgreement', from: p });
  if (!havePact(s, p, other)) out.push({ kind: 'defensivePact', from: p });
  for (const q of majorPlayers(s)) if (q.id !== p && q.id !== other && q.alive && pl.met.includes(q.id) && s.players[other].met.includes(q.id) && !s.diplomacy.war[p][q.id]) out.push({ kind: 'war', from: p, target: q.id });
  for (const c of playerCities(s, p)) if (!c.isCapital) out.push({ kind: 'city', from: p, city: c.id });
  return out;
}

export function researchAgreementCost(s: GameState, a: number, b: number): number {
  const era = Math.max(eraOf(s.players[a]), eraOf(s.players[b]));
  return Math.round(R().researchAgreementCostPerEra * (era + 1) * (get(D.pace, s.settings.pace).costPct / 100));
}

/** Why a deal can't happen (or null). */
export function dealProblem(s: GameState, deal: Deal): string | null {
  const { a, b } = deal;
  if (!s.players[a]?.alive || !s.players[b]?.alive) return 'no such player';
  if (isMinor(s, a) || isMinor(s, b)) return 'city-states don’t trade';
  const embargoed = (p: number) => !!s.congress?.active.some((r) => r.resolution === 'embargo' && Number(r.target) === p);
  if (embargoed(a) || embargoed(b)) return 'a World Congress embargo forbids it';
  const war = s.diplomacy.war[a][b];
  if (war && !deal.items.some((i) => i.kind === 'peace')) return 'at war: the deal must include peace';
  const needBoth = (k: string) => deal.items.some((i) => i.kind === k && i.from === a) !== deal.items.some((i) => i.kind === k && i.from === b);
  if (needBoth('researchAgreement')) return 'a research agreement must come from both sides';
  if (needBoth('defensivePact')) return 'a defensive pact must come from both sides';
  if (needBoth('peace')) return 'peace must come from both sides';
  if (deal.items.some((i) => (i.kind === 'researchAgreement' || i.kind === 'defensivePact') && !(s.diplomacy.embassy[a][b] && s.diplomacy.embassy[b][a])))
    return 'both sides need embassies first';
  for (const side of [a, b]) {
    const pl = s.players[side];
    const gold = deal.items.filter((i) => i.from === side && i.kind === 'gold').reduce((x, i) => x + (i.amount ?? 0), 0);
    const ra = deal.items.some((i) => i.from === side && i.kind === 'researchAgreement') ? researchAgreementCost(s, a, b) : 0;
    if (gold + ra > pl.gold) return `${pl.name} doesn't have ${gold + ra} gold`;
    const lux = luxuryCounts(s, side);
    for (const i of deal.items) {
      if (i.from !== side) continue;
      if (i.kind === 'luxury' && (lux[i.res!] ?? 0) < (i.amount ?? 1)) return `${pl.name} has no ${D.resources.get(i.res!)?.name} to spare`;
      if (i.kind === 'city' && (s.cities[i.city!]?.owner !== side || s.cities[i.city!]?.isCapital)) return 'that city can’t be traded';
      if (i.kind === 'war' && (s.diplomacy.war[side][i.target!] || !s.players[i.target!]?.alive)) return 'already at war';
    }
  }
  return null;
}

/** Carry a deal out. */
export function executeDeal(s: GameState, deal: Deal, setWar: (s: GameState, a: number, b: number, war: boolean) => void): void {
  const { a, b } = deal;
  const other = (p: number) => (p === a ? b : a);
  const T = R().dealTurns;
  for (const i of deal.items) {
    const to = other(i.from);
    switch (i.kind) {
      case 'gold':
        s.players[i.from].gold -= i.amount ?? 0;
        s.players[to].gold += i.amount ?? 0;
        break;
      case 'gpt':
      case 'luxury':
      case 'strategic':
        s.diplomacy.deals.push({ from: i.from, to, kind: i.kind, amount: i.amount ?? 1, res: i.res, until: s.turn + T });
        break;
      case 'openBorders':
        s.diplomacy.openBorders[i.from][to] = s.turn + R().openBordersTurns;
        break;
      case 'embassy':
        s.diplomacy.embassy[to][i.from] = true;
        break;
      case 'researchAgreement':
        if (i.from === a) {
          const cost = researchAgreementCost(s, a, b);
          s.players[a].gold -= cost;
          s.players[b].gold -= cost;
          s.diplomacy.researchAgreements.push({ a, b, start: s.turn, cost });
        }
        break;
      case 'defensivePact':
        if (i.from === a) s.diplomacy.pact[a][b] = s.diplomacy.pact[b][a] = s.turn + R().pactTurns;
        break;
      case 'peace':
        if (i.from === a && s.diplomacy.war[a][b]) setWar(s, a, b, false);
        break;
      case 'city': {
        const c = s.cities[i.city!];
        if (!c) break;
        c.owner = to;
        c.isCapital = false;
        c.buildings = c.buildings.filter((x) => x !== 'palace' && get(D.buildings, x).wonder !== 'national');
        c.queue = [];
        for (const t of s.map.tiles) if (t.cityId === c.id) t.owner = to;
        bumpEffects(s);
        break;
      }
      case 'war':
        if (!s.diplomacy.war[i.from][i.target!]) setWar(s, i.from, i.target!, true);
        break;
    }
  }
  s.diplomacy.trades[a][b]++;
  s.diplomacy.trades[b][a]++;
  const desc = (p: number) => deal.items.filter((i) => i.from === p).map((i) => itemText(s, i)).join(', ') || 'nothing';
  const text = `${s.players[a].name} gave ${desc(a)}; ${s.players[b].name} gave ${desc(b)}.`;
  log(s, text);
  notify(s, a, `Deal with the ${s.players[b].name}: ${text}`, 'good');
  notify(s, b, `Deal with the ${s.players[a].name}: ${text}`, 'good');
  bumpEffects(s);
}

export function itemText(s: GameState, i: DealItem): string {
  switch (i.kind) {
    case 'gold':
      return `${i.amount} gold`;
    case 'gpt':
      return `${i.amount} gold per turn`;
    case 'luxury':
    case 'strategic':
      return `${i.amount ?? 1} ${D.resources.get(i.res!)?.name}`;
    case 'openBorders':
      return 'open borders';
    case 'embassy':
      return 'an embassy';
    case 'researchAgreement':
      return 'a research agreement';
    case 'defensivePact':
      return 'a defensive pact';
    case 'peace':
      return 'peace';
    case 'city':
      return s.cities[i.city!]?.name ?? 'a city';
    case 'war':
      return `war on the ${s.players[i.target!]?.name}`;
  }
}

/**
 * How much an AI (player `ai`) values a deal, in gold. Positive = good for the AI.
 * Things it gets count for it, things it gives count against it; opinion shifts both.
 */
export function dealValue(s: GameState, ai: number, deal: Deal): number {
  const other = deal.a === ai ? deal.b : deal.a;
  const op = opinion(s, ai, other).total;
  const lux = luxuryCounts(s, ai);
  const T = R().dealTurns;
  let v = 0;
  for (const i of deal.items) {
    const mine = i.from === ai;
    let val = 0;
    switch (i.kind) {
      case 'gold':
        val = i.amount ?? 0;
        break;
      case 'gpt':
        val = (i.amount ?? 0) * T * 0.8;
        break;
      case 'luxury': {
        const have = lux[i.res!] ?? 0;
        // A new luxury is worth a lot (happiness); a spare copy little; the last copy a lot.
        val = mine ? (have <= 1 ? 250 : 40) : have >= 1 ? 30 : 160;
        break;
      }
      case 'strategic':
        val = 25 * (i.amount ?? 1);
        break;
      case 'openBorders':
        val = mine ? (op < 0 ? 400 : 50) : 40;
        break;
      case 'embassy':
        val = R().embassyValue;
        break;
      case 'researchAgreement':
        val = op >= 0 ? 60 : -100;
        break;
      case 'defensivePact':
        val = op >= 25 ? 50 : -500;
        break;
      case 'peace':
        // Mirrors aiAcceptsPeace: losing wars want peace; winners want something for it.
        val = militaryStrength(s, ai) < militaryStrength(s, other) * 0.9 ? 150 : -150;
        break;
      case 'city': {
        const c = s.cities[i.city!];
        val = c ? 150 + c.pop * 60 + c.buildings.length * 40 : 0;
        if (mine) val *= 2.5;
        break;
      }
      case 'war': {
        const target = i.target!;
        const myOp = opinion(s, ai, target).total;
        val = myOp < -20 && militaryStrength(s, ai) > militaryStrength(s, target) ? 100 : -400;
        if (!mine) val = 0;
        break;
      }
    }
    if (i.kind === 'researchAgreement' || i.kind === 'defensivePact' || i.kind === 'peace') {
      // Two-sided items: count once (on the AI's own entry).
      if (!mine) continue;
      v += val;
      continue;
    }
    v += mine ? -val : val;
  }
  // Friends get a better price; rivals a worse one; the frightened give in more easily.
  const afraid = militaryStrength(s, other) > militaryStrength(s, ai) * 2 ? 120 : 0;
  return v + op * 2 + afraid;
}

// ---- Turn processing ----

export function processDiplomacy(s: GameState): void {
  const d = s.diplomacy;
  // Per-turn gold.
  for (const deal of d.deals) {
    if (deal.kind !== 'gpt' || deal.until <= s.turn) continue;
    const pay = Math.min(deal.amount, Math.max(0, s.players[deal.from].gold));
    s.players[deal.from].gold -= pay;
    s.players[deal.to].gold += pay;
  }
  const ended = d.deals.filter((x) => x.until <= s.turn || !s.players[x.from].alive || !s.players[x.to].alive);
  for (const x of ended) notify(s, x.to, `A deal with the ${s.players[x.from].name} ended (${dealText(x)}).`, 'info');
  d.deals = d.deals.filter((x) => !ended.includes(x));
  if (ended.length) bumpEffects(s);
  // Research agreements pay out after enough turns of peace.
  for (const ra of [...d.researchAgreements]) {
    if (d.war[ra.a][ra.b]) {
      d.researchAgreements = d.researchAgreements.filter((x) => x !== ra);
      continue;
    }
    if (s.turn - ra.start >= R().researchAgreementTurns) {
      const science = ra.cost * R().researchAgreementScienceMult;
      for (const p of [ra.a, ra.b]) {
        addScience(s, p, science);
        notify(s, p, `Your research agreement paid off: +${Math.round(science)} science.`, 'good');
      }
      d.researchAgreements = d.researchAgreements.filter((x) => x !== ra);
    }
  }
  for (const p of s.players) p.warmonger = Math.max(0, (p.warmonger ?? 0) - R().warmongerDecay);
  // Old proposals expire.
  d.proposals = d.proposals.filter((x) => s.turn - x.turn <= 3);
}

function dealText(x: ActiveDeal): string {
  return x.kind === 'gpt' ? `${x.amount} gold per turn` : `${x.amount} ${D.resources.get(x.res!)?.name}`;
}

/** War consequences: open borders and deals between them end; pacts drag allies in. */
export function onWarDeclared(s: GameState, a: number, b: number, setWar: (s: GameState, a: number, b: number, war: boolean) => void): void {
  const d = s.diplomacy;
  d.declaredBy[a][b] = d.declaredBy[b][a] = a;
  d.openBorders[a][b] = d.openBorders[b][a] = 0;
  d.deals = d.deals.filter((x) => !((x.from === a && x.to === b) || (x.from === b && x.to === a)));
  d.researchAgreements = d.researchAgreements.filter((x) => !((x.a === a && x.b === b) || (x.a === b && x.b === a)));
  // Backstabbing a friend is remembered by everyone.
  if (areFriends(s, a, b)) {
    s.players[a].warmonger += 25;
    d.friend[a][b] = d.friend[b][a] = 0;
    log(s, `The ${s.players[a].name} betrayed their friendship with the ${s.players[b].name}.`);
  }
  d.pact[a][b] = d.pact[b][a] = 0;
  bumpEffects(s);
  // Defensive pacts: everyone with a pact with the victim joins in.
  for (const q of majorPlayers(s)) {
    if (q.id === a || q.id === b || !q.alive) continue;
    if (havePact(s, q.id, b) && !d.war[q.id][a]) {
      logEvent(s, `The ${q.name} honour their pact with the ${s.players[b].name}.`, undefined, q.id);
      setWar(s, q.id, a, true);
    }
  }
}

export function declareFriendship(s: GameState, a: number, b: number): void {
  s.diplomacy.friend[a][b] = s.diplomacy.friend[b][a] = s.turn + R().friendshipTurns;
  s.diplomacy.denounce[a][b] = s.diplomacy.denounce[b][a] = 0;
  log(s, `The ${s.players[a].name} and the ${s.players[b].name} declared friendship.`);
  for (const q of majorPlayers(s)) if (q.met.includes(a)) notify(s, q.id, `The ${s.players[a].name} and the ${s.players[b].name} declared friendship.`, 'info');
}

export function denounce(s: GameState, a: number, b: number): void {
  s.diplomacy.denounce[a][b] = s.turn + R().denounceTurns;
  s.diplomacy.friend[a][b] = s.diplomacy.friend[b][a] = 0;
  log(s, `The ${s.players[a].name} denounced the ${s.players[b].name}.`);
  for (const q of majorPlayers(s)) if (q.met.includes(a)) notify(s, q.id, `The ${s.players[a].name} denounced the ${s.players[b].name}!`, q.id === b ? 'bad' : 'info');
}

// ---- Opinion ----

export interface Opinion {
  total: number;
  parts: { label: string; value: number }[];
  stance: 'War' | 'Afraid' | 'Hostile' | 'Guarded' | 'Neutral' | 'Friendly';
}

/** Extra opinion modifiers from later phases (religion, ideology...). */
export const OPINION_HOOKS: ((s: GameState, a: number, b: number) => { label: string; value: number }[])[] = [];

/** What player a thinks of player b. */
export function opinion(s: GameState, a: number, b: number): Opinion {
  const o = R().opinion;
  const d = s.diplomacy;
  const parts: { label: string; value: number }[] = [];
  const add = (label: string, value: number) => value && parts.push({ label, value: Math.round(value) });
  const A = s.players[a];
  const pers = D.factions.get(A.faction)?.leader.personality;
  if (pers) add('Temperament', pers.diplomacy * 2 - pers.aggression);
  if (d.war[a][b]) add('At war', o.atWar);
  else if (s.turn - d.changed[a][b] < o.pastWarTurns && d.declaredBy[a][b] === b) add('Recent war', o.pastWar);
  if (areFriends(s, a, b)) add('Declared friendship', o.friendship);
  if (denounced(s, b, a)) add('Denounced us', o.denounced);
  for (const q of majorPlayers(s)) {
    if (q.id === a || q.id === b) continue;
    if (areFriends(s, a, q.id) && denounced(s, b, q.id)) add(`Denounced our friend`, o.denouncedFriend);
    if (d.war[a][q.id] && d.war[b][q.id]) add('Shared enemy', o.sharedEnemy);
  }
  // Land: their cities crowding ours.
  let close = 0;
  for (const ca of playerCities(s, a)) for (const cb of playerCities(s, b)) if (distance(s.map, ca.tile, cb.tile) <= 7) close++;
  add('Borders too close', Math.max(o.landDisputeMax, close * o.landDispute));
  add('Warmonger', s.players[b].warmonger * o.warmonger * ((pers?.forgiveness ?? 5) < 5 ? 1.3 : 0.8));
  add('Trade', Math.min(o.tradeMax, d.trades[a][b] * o.trade));
  if (d.embassy[a][b] && d.embassy[b][a]) add('Embassies', o.embassy);
  if (hasOpenBorders(s, a, b) && hasOpenBorders(s, b, a)) add('Open borders', o.openBorders);
  // Someone winning too much is a worry.
  const scores = majorPlayers(s).filter((p) => p.alive).map((p) => score(s, p.id));
  if (score(s, b) >= Math.max(...scores) && score(s, b) > score(s, a) * 1.25) add('Leading the world', o.leader * ((pers?.boldness ?? 5) / 5));
  for (const h of OPINION_HOOKS) for (const x of h(s, a, b)) add(x.label, x.value);
  const total = parts.reduce((x, y) => x + y.value, 0);
  let stance: Opinion['stance'];
  if (d.war[a][b]) stance = 'War';
  else if (total < 0 && militaryStrength(s, b) > militaryStrength(s, a) * 2) stance = 'Afraid';
  else if (total <= -30) stance = 'Hostile';
  else if (total < -5) stance = 'Guarded';
  else if (total < 25) stance = 'Neutral';
  else stance = 'Friendly';
  return { total, parts, stance };
}

/** Warmonger reputation for capturing a city. */
export function addWarmonger(s: GameState, by: number, capital: boolean, victimStarted: boolean): void {
  const r = R();
  let v = capital ? r.warmongerCapital : r.warmongerCapture;
  if (victimStarted) v *= 0.5;
  s.players[by].warmonger = (s.players[by].warmonger ?? 0) + v;
}

