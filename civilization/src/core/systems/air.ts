// Air power. Aircraft are based in cities (6 slots, more with an Airport) and on carriers.
// Each turn an aircraft can rebase or strike a target in range. Enemy fighters and
// anti-aircraft units near the target may intercept first. Missiles are used up; nuclear
// weapons destroy every unit in their blast, halve cities and leave fallout.
import { D } from '../../data';
import { distance, within } from '../hex';
import { rand } from '../rng';
import { atWar, cityAt, dims, logEvent, majorPlayers, militaryAt, notify, tileAt, unitDef, unitsAt } from '../query';
import type { GameState, Unit } from '../state';
import { damage, unitStrength } from './combat';
import { cityStrength } from './cities';
import { addXp, hasRoom, removeUnit } from './units';
import { isWater } from './domain';
import { recomputeAllVisibility } from './visibility';

const A = () => D.rules.air;

export function canRebase(s: GameState, u: Unit, to: number): string | null {
  const def = unitDef(u);
  if (def.domain !== 'air') return 'not an aircraft';
  if (u.moves <= 0) return 'no moves left';
  if (distance(dims(s), u.tile, to) > def.range * A().rebaseRangeMult) return 'too far';
  const c = cityAt(s, to);
  const carrier = unitsAt(s, to).some((o) => o.owner === u.owner && unitDef(o).carries > 0);
  if (!(c && c.owner === u.owner) && !carrier) return 'aircraft can only base in your cities or on carriers';
  if (!hasRoom(s, u, to, u.owner)) return 'no free slot there';
  return null;
}

export function rebase(u: Unit, to: number): void {
  u.tile = to;
  u.moves = 0;
  u.acted = true;
}

/** What an air strike on `to` would hit. */
function strikeTarget(s: GameState, u: Unit, to: number) {
  const c = cityAt(s, to);
  if (c && c.owner !== u.owner && atWar(s, u.owner, c.owner)) return { city: c };
  const m = militaryAt(s, to) ?? unitsAt(s, to).find((o) => unitDef(o).domain !== 'air');
  if (m && m.owner !== u.owner && atWar(s, u.owner, m.owner)) return { unit: m };
  return null;
}

export function canStrike(s: GameState, u: Unit, to: number): string | null {
  const def = unitDef(u);
  if (def.domain !== 'air' || def.nuke) return 'not a strike aircraft';
  if (u.moves <= 0 || u.hasAttacked) return 'already flew this turn';
  if (distance(dims(s), u.tile, to) > def.range) return 'out of range';
  if (!strikeTarget(s, u, to)) return 'no enemy there';
  return null;
}

/** Interceptors protecting tile `to` from player p's aircraft. */
function interceptors(s: GameState, p: number, to: number): Unit[] {
  const out: Unit[] = [];
  for (const id in s.units) {
    const o = s.units[id];
    const d = unitDef(o);
    if (!d.intercept || o.owner === p || !atWar(s, p, o.owner)) continue;
    const r = d.domain === 'air' ? d.range : d.interceptRange;
    if (distance(dims(s), o.tile, to) <= r) out.push(o);
  }
  return out;
}

export function airStrike(s: GameState, u: Unit, to: number): { dealt: number; taken: number; intercepted: boolean } {
  const def = unitDef(u);
  const target = strikeTarget(s, u, to)!;
  u.moves = 0;
  u.hasAttacked = true;
  u.acted = true;
  let taken = 0;
  let intercepted = false;
  // Interception happens before the bombs fall.
  const ints = interceptors(s, u.owner, to);
  if (ints.length && rand(s) * 100 < A().interceptChancePct) {
    intercepted = true;
    taken += A().interceptDamage;
    notify(s, ints[0].owner, `Your ${unitDef(ints[0]).name} intercepted an enemy ${def.name}.`, 'good', to);
  }
  if (!def.missile) u.hp -= taken;
  if (u.hp <= 0) {
    notify(s, u.owner, `Your ${def.name} was shot down.`, 'bad', to);
    removeUnit(s, u);
    return { dealt: 0, taken, intercepted };
  }
  const att = def.ranged * (1 - 0.5 + (0.5 * u.hp) / 100);
  let mult = 1;
  for (const b of def.bonuses) if (b.vs === 'city' && target.city) mult += b.percent / 100;
  for (const p of u.promotions) for (const c of D.promotions.get(p)!.combat) if (c.when === 'always' || (c.when === 'vs_city' && target.city)) mult += c.percent / 100;
  const dfn = target.city ? cityStrength(s, target.city).value : unitStrength(s, target.unit!, false, true, u.tile).value;
  const rp = D.rules.combat.randomPct / 100;
  const dealt = damage((att * mult) / dfn, 1 - rp + rand(s) * 2 * rp);
  if (target.city) {
    target.city.hp = Math.max(1, target.city.hp - dealt);
    target.city.damagedThisTurn = true;
    notify(s, target.city.owner, `${target.city.name} was bombed (−${dealt} HP).`, 'combat', to);
  } else {
    const t = target.unit!;
    t.hp -= dealt;
    if (t.hp <= 0) {
      notify(s, t.owner, `Your ${unitDef(t).name} was destroyed from the air.`, 'bad', to);
      removeUnit(s, t);
    } else notify(s, t.owner, `Your ${unitDef(t).name} was bombed (−${dealt} HP).`, 'combat', to);
  }
  if (def.missile) {
    removeUnit(s, u);
    return { dealt, taken, intercepted };
  }
  // Bombers take some return fire.
  const back = Math.round((damage(dfn / att, 1) * A().strikeTakePct) / 100);
  u.hp -= back;
  taken += back;
  addXp(s, u, D.rules.xp.rangedAttack, false);
  if (u.hp <= 0) removeUnit(s, u);
  return { dealt, taken, intercepted };
}

export function canNuke(s: GameState, u: Unit, to: number): string | null {
  const def = unitDef(u);
  if (!def.nuke) return 'not a nuclear weapon';
  if (u.moves <= 0) return 'not ready';
  if (distance(dims(s), u.tile, to) > def.range) return 'out of range';
  // Only on enemies (or empty land): every owner hit must be at war with us.
  for (const i of within(dims(s), to, def.nuke)) {
    const o = tileAt(s, i).owner;
    if (o >= 0 && o !== u.owner && !atWar(s, u.owner, o)) return `that would hit the ${s.players[o].name}, who you are not at war with`;
  }
  return null;
}

export function nuke(s: GameState, u: Unit, to: number): void {
  const def = unitDef(u);
  const p = u.owner;
  const blast = within(dims(s), to, def.nuke);
  removeUnit(s, u);
  for (const i of blast) {
    for (const o of unitsAt(s, i)) {
      notify(s, o.owner, `Your ${unitDef(o).name} was destroyed in a nuclear blast.`, 'bad', i);
      removeUnit(s, o);
    }
    const c = cityAt(s, i);
    if (c) {
      c.pop = Math.max(1, Math.round(c.pop * (1 - A().nukeCityPopPct / 100)));
      c.hp = 1;
      c.damagedThisTurn = true;
      notify(s, c.owner, `${c.name} was struck by a nuclear weapon!`, 'bad', i);
    }
    const t = tileAt(s, i);
    if (!isWater(s, i) && t.terrain !== 'mountain' && !c && rand(s) < 0.6) {
      t.feature = 'fallout';
      if (t.improvement) t.pillaged = true;
    }
  }
  s.players[p].warmonger += A().nukeWarmonger;
  logEvent(s, `The ${s.players[p].name} used a nuclear weapon.`, to, p);
  for (const q of majorPlayers(s)) notify(s, q.id, `The ${s.players[p].name} used a nuclear weapon!`, q.id === p ? 'info' : 'bad', to);
  recomputeAllVisibility(s);
}

/** Aircraft that aren't in a city ride along with the carrier they're on. */
export function carryAircraft(s: GameState, carrier: Unit, from: number): void {
  if (!unitDef(carrier).carries || cityAt(s, from)) return;
  for (const id in s.units) {
    const o = s.units[id];
    if (o.tile === from && o.owner === carrier.owner && unitDef(o).domain === 'air') o.tile = carrier.tile;
  }
}
