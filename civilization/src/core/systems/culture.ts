// Great works, tourism and cultural influence.
// Great Artists, Writers and Musicians (and Archaeologists, for artifacts) create great works
// that sit in slots in buildings and wonders; each gives culture and tourism, and a full
// building of works from one era or from different civilizations earns a theming bonus.
// Tourism builds up toward every other civilization; compared with their lifetime culture it
// sets your influence over them (Exotic → Dominant). Being Influential over everyone wins.
import { D, get } from '../../data';
import { capitalOf, eraOf, logEvent, majorPlayers, notify, playerCities } from '../query';
import type { City, GameState, GreatWork } from '../state';
import { playerEffects, sum } from './effects';
import { hasOpenBorders } from './diplomacy';
import { majority } from './religion';
import { playerYields } from './yields';
import { pick } from '../rng';

const C = () => D.rules.culture;
export const LEVELS = ['Unknown', 'Exotic', 'Familiar', 'Popular', 'Influential', 'Dominant'] as const;
export type Level = (typeof LEVELS)[number];

/** Slot kind a work goes into (artifacts share art slots). */
export const slotKind = (k: GreatWork['kind']) => (k === 'artifact' ? 'art' : k);

/** Free slots for a kind of work in a city: [{building, free}]. */
export function freeSlots(c: City, kind: GreatWork['kind']): { building: string; free: number }[] {
  const out: { building: string; free: number }[] = [];
  for (const b of c.buildings) {
    const n = get(D.buildings, b).greatWorkSlots[slotKind(kind)] ?? 0;
    const used = (c.works?.[b] ?? []).filter(Boolean).length;
    if (n > used) out.push({ building: b, free: n - used });
  }
  return out;
}

/** Where player p's next work of this kind would go (nearest the given tile first). */
export function findSlot(s: GameState, p: number, kind: GreatWork['kind']): { city: City; building: string } | null {
  const cities = playerCities(s, p).sort((a, b) => Number(b.isCapital) - Number(a.isCapital) || a.id - b.id);
  for (const c of cities) {
    const f = freeSlots(c, kind);
    if (f.length) return { city: c, building: f[0].building };
  }
  return null;
}

export function makeGreatWork(s: GameState, p: number, kind: GreatWork['kind']): string | null {
  const slot = findSlot(s, p, kind);
  if (!slot) return `no free ${slotKind(kind)} slot (build an Amphitheater, Opera House, Museum...)`;
  const names = D.greatWorkNames[kind];
  const id = `gw${s.nextId++}`;
  const name = `${pick(s, names.adj)} ${pick(s, names.noun)}`;
  s.greatWorks[id] = { id, kind, name, creator: p, era: eraOf(s.players[p]), turn: s.turn };
  slot.city.works[slot.building] = [...(slot.city.works[slot.building] ?? []), id];
  notify(s, p, `“${name}” now hangs in ${slot.city.name}'s ${get(D.buildings, slot.building).name}.`, 'good', slot.city.tile);
  logEvent(s, `The ${s.players[p].name} created the great work “${name}”.`, slot.city.tile, p);
  return null;
}

/** Culture and tourism from a city's great works (with theming bonuses) and wonders. */
export function cityCultureYields(s: GameState, c: City): { culture: number; tourism: number; themed: string[] } {
  let culture = 0, tourism = 0;
  const themed: string[] = [];
  for (const [b, ids] of Object.entries(c.works ?? {})) {
    const works = ids.map((id) => s.greatWorks[id]).filter(Boolean);
    culture += works.length * C().workCulture;
    tourism += works.length * C().workTourism;
    const slots = Object.values(get(D.buildings, b).greatWorkSlots).reduce((a, n) => a + n, 0);
    if (slots >= 2 && works.length === slots) {
      const sameEra = works.every((w) => w.era === works[0].era);
      const allDifferent = new Set(works.map((w) => w.creator)).size === works.length;
      if (sameEra || allDifferent) {
        culture += C().themeBonus * works.length;
        tourism += C().themeBonus * works.length;
        themed.push(b);
      }
    }
  }
  for (const b of c.buildings) if (get(D.buildings, b).wonder === 'world') tourism += C().wonderTourism;
  return { culture, tourism, themed };
}

/** Tourism bonus per cent (policies, tenets, techs). */
export function tourismPct(s: GameState, p: number): number {
  let v = sum(playerEffects(s, p), 'tourism_pct', 'percent');
  for (const t of s.players[p].techs) v += D.techs.get(t)?.tourismPct ?? 0;
  return v;
}

/** Modifier for p's tourism reaching q. */
export function tourismModifier(s: GameState, p: number, q: number): number {
  const c = C();
  let pct = 0;
  if (hasOpenBorders(s, q, p) || hasOpenBorders(s, p, q)) pct += c.openBordersPct;
  if (s.tradeRoutes.some((r) => (r.owner === p && s.cities[r.to]?.owner === q) || (r.owner === q && s.cities[r.to]?.owner === p))) pct += c.tradeRoutePct;
  const ca = capitalOf(s, p), cb = capitalOf(s, q);
  if (ca && cb && majority(ca) && majority(ca) === majority(cb)) pct += c.sameReligionPct;
  const ia = s.players[p].ideology, ib = s.players[q].ideology;
  if (ia && ib) pct += ia === ib ? c.sameIdeologyPct : c.differentIdeologyPct;
  return pct;
}

export function influencePct(s: GameState, p: number, q: number): number {
  const t = s.players[p].tourismTo?.[q] ?? 0;
  return (100 * t) / Math.max(1, s.players[q].cultureTotal);
}

export function influenceLevel(s: GameState, p: number, q: number): number {
  const v = influencePct(s, p, q);
  let lvl = 0;
  for (const th of C().levels) if (v >= th) lvl++;
  return lvl;
}

export function processTourism(s: GameState): void {
  const majors = majorPlayers(s).filter((p) => p.alive);
  for (const p of majors) {
    const t = playerYields(s, p.id).tourism;
    if (t <= 0) continue;
    p.tourismTo ??= [];
    for (const q of majors) {
      if (q.id === p.id || !p.met.includes(q.id)) continue;
      const before = influenceLevel(s, p.id, q.id);
      p.tourismTo[q.id] = (p.tourismTo[q.id] ?? 0) + t * Math.max(0, 1 + tourismModifier(s, p.id, q.id) / 100);
      const after = influenceLevel(s, p.id, q.id);
      if (after > before && after >= 3) {
        notify(s, p.id, `Your culture is now ${LEVELS[after]} with the ${q.name}.`, 'good');
        notify(s, q.id, `The ${p.name}'s culture is now ${LEVELS[after]} among your people.`, 'bad');
      }
    }
  }
}

/** Cultural victory: Influential (or more) over every other surviving civilization. */
export function culturalWinner(s: GameState): number | null {
  const majors = majorPlayers(s).filter((p) => p.alive);
  if (majors.length < 2) return null;
  for (const p of majors) if (majors.every((q) => q.id === p.id || influenceLevel(s, p.id, q.id) >= 4)) return p.id;
  return null;
}

/** A concert tour: a burst of tourism toward everyone you've met. */
export function concertTour(s: GameState, p: number): void {
  const t = Math.max(10, playerYields(s, p).tourism) * C().concertTurns;
  for (const q of s.players[p].met) if (!s.players[q].isMinor) s.players[p].tourismTo[q] = (s.players[p].tourismTo[q] ?? 0) + t;
  notify(s, p, `A concert tour spreads your culture abroad (+${Math.round(t)} tourism with everyone you know).`, 'good');
}
