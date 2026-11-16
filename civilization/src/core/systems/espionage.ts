// Espionage. From the Renaissance each civilization gets a spy, and one more per era after
// (more with the Signal Bureau). A spy can be stationed in:
//   a rival's city — steal technology (faster from high-science cities, with higher rank and with
//     cultural influence); after a couple of turns you also see around the city;
//   a rival's capital at peace, as a diplomat — an extra World Congress delegate;
//   a city-state — rig its elections every few turns, or try a coup when close to its ally;
//   your own city — counter-intelligence: thieves caught there may be killed.
// Caught spies anger the victim; killed spies are replaced after a while.
import { D, get } from '../../data';
import { within } from '../hex';
import { rand } from '../rng';
import { atWar, dims, eraOf, majorPlayers, notify } from '../query';
import type { GameState, Spy } from '../state';
import { playerEffects, sum } from './effects';
import { learnTech } from './research';
import { cityYields } from './yields';
import { influenceLevel } from './culture';
import { addInfluence } from './citystates';

const E = () => D.rules.espionage;
const RANKS = ['Recruit', 'Agent', 'Special Agent'];
export const rankName = (r: number) => RANKS[Math.min(RANKS.length - 1, r)];

export function spyCount(s: GameState, p: number): number {
  const pl = s.players[p];
  const era = eraOf(pl);
  if (era < E().firstEra) return 0;
  return 1 + (era - E().firstEra) * E().perEraAfter + sum(playerEffects(s, p), 'spies');
}

/** Spy stationed somewhere: what it does there. */
export function spyRole(s: GameState, p: number, spy: Spy): 'home' | 'counter' | 'steal' | 'diplomat' | 'rig' | 'dead' {
  if (spy.deadUntil > s.turn) return 'dead';
  const c = spy.city >= 0 ? s.cities[spy.city] : undefined;
  if (!c) return 'home';
  if (c.owner === p) return 'counter';
  if (s.players[c.owner].isMinor) return 'rig';
  return spy.diplomat ? 'diplomat' : 'steal';
}

export function moveSpy(s: GameState, p: number, id: number, city: number, diplomat = false): string | null {
  const spy = s.players[p].spies.find((x) => x.id === id);
  if (!spy) return 'no such spy';
  if (spy.deadUntil > s.turn) return 'this spy is dead';
  if (city < 0) {
    spy.city = -1;
    return null;
  }
  const c = s.cities[city];
  if (!c) return 'no such city';
  if (!s.players[p].explored[c.tile]) return 'you have not found that city';
  if (diplomat && (!c.isCapital || atWar(s, p, c.owner) || s.players[c.owner].isMinor)) return 'diplomats go to a capital you are at peace with';
  spy.city = city;
  spy.diplomat = diplomat && c.owner !== p;
  spy.arrived = s.turn;
  spy.progress = 0;
  return null;
}

/** Technologies the city's owner knows and p doesn't (cheapest first). */
function stealable(s: GameState, p: number, owner: number): string[] {
  const mine = s.players[p].techs;
  return s.players[owner].techs.filter((t) => !mine.includes(t) && !D.techs.get(t)!.repeatable && D.techs.get(t)!.prereqs.every((x) => mine.includes(x))).sort((a, b) => get(D.techs, a).cost - get(D.techs, b).cost);
}

export function stealTarget(s: GameState, owner: number): number {
  return E().stealBase + E().stealPerEra * eraOf(s.players[owner]);
}

export function stealRate(s: GameState, p: number, spy: Spy): number {
  const c = s.cities[spy.city];
  if (!c) return 0;
  const sci = cityYields(s, c).total.science;
  return sci * (1 + (spy.rank * E().rankSpeedPct) / 100) * (1 + (influenceLevel(s, p, c.owner) * E().influenceSpeedPct) / 100);
}

export function processEspionage(s: GameState): void {
  const e = E();
  for (const pl of majorPlayers(s)) {
    if (!pl.alive) continue;
    // New spies as eras pass.
    while (pl.spies.length < spyCount(s, pl.id)) {
      const name = D.spyNames[(pl.id * 7 + pl.spies.length * 3) % D.spyNames.length];
      pl.spies.push({ id: s.nextId++, name, rank: Math.min(e.maxRank, sum(playerEffects(s, pl.id), 'spy_rank')), city: -1, diplomat: false, arrived: s.turn, progress: 0, deadUntil: 0 });
      notify(s, pl.id, `A new spy, ${name}, is ready for assignment.`, 'good');
    }
    for (const spy of pl.spies) {
      if (spy.deadUntil > s.turn) continue;
      if (spy.deadUntil === s.turn && spy.deadUntil > 0) notify(s, pl.id, `${spy.name} has been replaced and awaits orders.`, 'info');
      const c = s.cities[spy.city];
      if (spy.city >= 0 && !c) spy.city = -1;
      const role = spyRole(s, pl.id, spy);
      if (role === 'steal') {
        const techs = stealable(s, pl.id, c.owner);
        if (!techs.length) continue;
        spy.progress += stealRate(s, pl.id, spy);
        if (spy.progress >= stealTarget(s, c.owner)) {
          spy.progress = 0;
          // Counter-intelligence in that city may catch the thief.
          const guard = s.players[c.owner].spies.find((x) => x.city === c.id && x.deadUntil <= s.turn);
          const killChance = guard ? e.counterKillPct + guard.rank * 10 - spy.rank * 5 : 0;
          if (rand(s) * 100 < killChance) {
            spy.deadUntil = s.turn + e.respawnTurns;
            spy.city = -1;
            notify(s, pl.id, `${spy.name} was caught and executed in ${c.name}.`, 'bad', c.tile);
            notify(s, c.owner, `Your agent caught and killed a ${pl.name} spy in ${c.name}.`, 'good', c.tile);
            s.diplomacy.trades[c.owner][pl.id] -= 5;
            continue;
          }
          learnTech(s, pl.id, techs[0]);
          spy.rank = Math.min(e.maxRank, spy.rank + 1);
          notify(s, pl.id, `${spy.name} stole ${get(D.techs, techs[0]).name} from ${c.name}!`, 'good', c.tile);
          if (rand(s) * 100 < e.catchChancePct + killChance) {
            notify(s, c.owner, `A ${pl.name} spy stole ${get(D.techs, techs[0]).name} from ${c.name}.`, 'bad', c.tile);
            s.diplomacy.trades[c.owner][pl.id] -= 5;
          } else notify(s, c.owner, `Technology was stolen from ${c.name} by an unknown spy.`, 'bad', c.tile);
        }
      } else if (role === 'rig' && (s.turn + c.owner) % e.electionEveryTurns === 0) {
        // Rigged elections: influence for us, a little less for everyone else there.
        addInfluence(s, c.owner, pl.id, e.rigInfluence * (1 + spy.rank * 0.5));
        for (const q of majorPlayers(s)) if (q.id !== pl.id && q.met.includes(c.owner)) addInfluence(s, c.owner, q.id, e.rigOthers);
        notify(s, pl.id, `${spy.name} rigged the election in ${c.name}.`, 'good', c.tile);
      }
    }
  }
}

/** Tiles player p sees through spies that have settled in (for visibility). */
export function spyVision(s: GameState, p: number): number[] {
  const out: number[] = [];
  for (const spy of s.players[p].spies ?? []) {
    const c = spy.city >= 0 ? s.cities[spy.city] : undefined;
    if (!c || spy.deadUntil > s.turn || c.owner === p || s.turn - spy.arrived < E().surveillanceTurns) continue;
    out.push(...within(dims(s), c.tile, 2));
  }
  return out;
}

export function coupChance(s: GameState, p: number, spy: Spy): number {
  const c = s.cities[spy.city];
  if (!c || !s.players[c.owner].isMinor) return 0;
  const m = s.players[c.owner].minor!;
  if (m.ally < 0 || m.ally === p) return 0;
  const gap = (m.influence[m.ally] ?? 0) - (m.influence[p] ?? 0);
  if (gap > E().coupMargin) return 0;
  return Math.max(5, Math.min(90, E().coupBaseChancePct + spy.rank * 15 - gap));
}

export function coup(s: GameState, p: number, id: number): string | null {
  const spy = s.players[p].spies.find((x) => x.id === id);
  if (!spy || spyRole(s, p, spy) !== 'rig') return 'the spy must be in a city-state';
  const chance = coupChance(s, p, spy);
  if (!chance) return `you need influence within ${E().coupMargin} of their ally`;
  const c = s.cities[spy.city];
  const m = s.players[c.owner].minor!;
  const ally = m.ally;
  if (rand(s) * 100 < chance) {
    const a = m.influence[ally] ?? 0;
    m.influence[ally] = m.influence[p] ?? 0;
    m.influence[p] = a;
    addInfluence(s, c.owner, p, 0);
    notify(s, p, `Coup in ${c.name}! It is now your ally.`, 'good', c.tile);
    notify(s, ally, `The ${s.players[p].name} staged a coup in ${c.name}.`, 'bad', c.tile);
    s.diplomacy.trades[ally][p] -= 5;
  } else {
    spy.deadUntil = s.turn + E().respawnTurns;
    spy.city = -1;
    notify(s, p, `The coup in ${c.name} failed; ${spy.name} was killed.`, 'bad', c.tile);
  }
  return null;
}

