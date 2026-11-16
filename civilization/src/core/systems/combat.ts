// Combat. Strength S = base × HP factor × (1 + Σ per-cent modifiers). With r = S_att / S_def,
// damage to the defender ≈ 30·r^0.8 and to a melee attacker ≈ 30/r^0.8, each ±20% random
// (rules.combat). Ranged attacks take no damage back. Cities have their own strength and HP.
import { D, get } from '../../data';
import { distance, neighbors } from '../hex';
import { rand } from '../rng';
import { atWar, cityAt, difficultyOf, dims, isCivilian, militaryAt, notify, tileAt, unitDef, unitsAt } from '../query';
import { playerEffects, sum } from './effects';
import { addGeneralPoints } from './greatpeople';
import { recordSite } from './archaeology';
import { embarkedStrength, isCoastalTile, isEmbarked, isWater } from './domain';
import type { City, GameState, Unit } from '../state';
import { happinessOf } from './happiness';
import { riverBetween } from './movement';
import { addXp, onEnterTile, removeUnit } from './units';
import { sightFrom } from './visibility';
import { captureCity, cityMaxHp, cityStrength } from './cities';

/** Extra combat modifiers from later phases. */
export const COMBAT_HOOKS: ((s: GameState, u: Unit, attacking: boolean, ranged: boolean, foeTile: number, foe: Unit | undefined, add: (label: string, pct: number) => void) => void)[] = [];

export interface Modifier {
  label: string;
  pct: number;
}

export interface StrengthReport {
  base: number;
  value: number;
  mods: Modifier[];
}

function isRough(s: GameState, i: number): boolean {
  const t = tileAt(s, i);
  return t.hills || (!!t.feature && ['forest', 'jungle', 'marsh'].includes(t.feature));
}

/** Terrain defence of a tile (hills, forest...). */
export function terrainDefense(s: GameState, i: number): number {
  const t = tileAt(s, i);
  let d = get(D.terrains, t.terrain).defense;
  if (t.hills) d += D.rules.hills.defense;
  if (t.feature) d += D.features.get(t.feature)!.defense;
  return d;
}

function hpFactor(u: Unit): number {
  const w = D.rules.combat.hpWeight;
  return 1 - w + (w * u.hp) / D.rules.combat.maxHp;
}

/**
 * Strength of unit u in a fight. `attacking`: u attacks; `ranged`: the attack is ranged;
 * `foeTile`: where the other side stands; `foe`: the other unit (or undefined for a city).
 */
export function unitStrength(s: GameState, u: Unit, attacking: boolean, ranged: boolean, foeTile: number, foe?: Unit): StrengthReport {
  const def = unitDef(u);
  const base = !attacking && isEmbarked(s, u) ? embarkedStrength(s, u) : attacking && ranged ? def.ranged : def.strength;
  const mods: Modifier[] = [];
  const add = (label: string, pct: number) => pct && mods.push({ label, pct });
  // Where the fight happens for terrain-based bonuses: the defender's tile.
  const fightTile = attacking ? foeTile : u.tile;
  if (!attacking) {
    add('Terrain', terrainDefense(s, u.tile));
    if (u.fortifyTurns >= 2 && !ranged) add('Fortified', D.rules.combat.fortifyTwoTurnsPct);
    else if (u.fortifyTurns >= 1) add('Fortified', D.rules.combat.fortifyPct);
    if (ranged) for (const p of u.promotions) for (const c of D.promotions.get(p)!.combat) if (c.when === 'vs_ranged') add(D.promotions.get(p)!.name, c.percent);
  } else if (!ranged) {
    if (riverBetween(s, u.tile, foeTile)) add('Across river', D.rules.riverAttackPct);
    let flank = 0;
    for (const n of neighbors(dims(s), foeTile)) {
      if (n === u.tile) continue;
      const m = militaryAt(s, n);
      if (m && m.owner === u.owner) flank++;
    }
    add('Flanking', flank * D.rules.combat.flankingPct);
  }
  const foeCity = !foe ? cityAt(s, foeTile) : undefined;
  for (const b of def.bonuses) {
    if (b.vs === 'city' && foeCity && attacking) add('vs city', b.percent);
    else if (foe && b.vs === unitDef(foe).class) add(`vs ${b.vs}`, b.percent);
    else if (foe && b.vs === 'wounded' && foe.hp < D.rules.combat.maxHp) add('vs wounded', b.percent);
  }
  for (const pid of u.promotions) {
    const p = D.promotions.get(pid)!;
    for (const c of p.combat) {
      const hit =
        (c.when === 'open' && !isRough(s, fightTile)) ||
        (c.when === 'rough' && isRough(s, fightTile)) ||
        (c.when === 'vs_city' && attacking && !!foeCity) ||
        (c.when === 'vs_wounded' && !!foe && foe.hp < D.rules.combat.maxHp) ||
        c.when === 'always';
      if (hit) add(p.name, c.percent);
    }
  }
  const foeIsBarb = (foe && s.players[foe.owner].isBarbarian) || (foeCity && s.players[foeCity.owner].isBarbarian);
  for (const e of playerEffects(s, u.owner)) {
    if (e.type !== 'combat') continue;
    if ((e.when === 'vs_city' && attacking && foeCity) || (e.when === 'rough' && isRough(s, fightTile)) || e.when === 'always' || (e.when === 'vs_barbarian' && foeIsBarb)) add(e.source, e.percent);
  }
  // A Great General (land) or Great Admiral (sea) next to the unit inspires it.
  if (!s.players[u.owner].isBarbarian) {
    const near = [u.tile, ...neighbors(dims(s), u.tile)];
    const want = def.domain === 'sea' ? 'admiral' : 'general';
    if (Object.values(s.units).some((g) => g.owner === u.owner && unitDef(g).greatPerson === want && near.includes(g.tile)))
      add(want === 'admiral' ? 'Great Admiral' : 'Great General', want === 'admiral' ? D.rules.naval.admiralAura : D.rules.greatPeople.generalAura);
  }
  // Defending in a Citadel.
  if (!attacking && tileAt(s, u.tile).improvement === 'citadel' && !tileAt(s, u.tile).pillaged) add('Citadel', D.rules.greatPeople.citadelDefense);
  for (const h of COMBAT_HOOKS) h(s, u, attacking, ranged, foeTile, foe, add);
  const pl = s.players[u.owner];
  if (!pl.isBarbarian && happinessOf(s, u.owner).net <= D.rules.happiness.veryUnhappy) add('Unhappiness', D.rules.happiness.veryUnhappyCombatPct);
  const foeOwner = foe ? foe.owner : foeCity ? foeCity.owner : -1;
  if (foeOwner >= 0 && s.players[foeOwner].isBarbarian && !pl.isBarbarian) {
    const diff = difficultyOf(s);
    add('vs barbarians', pl.isHuman ? diff.humanVsBarbarianPct : diff.aiVsBarbarianPct);
  }
  const total = mods.reduce((a, m) => a + m.pct, 0);
  const value = Math.max(0.1, base * hpFactor(u) * (1 + total / 100));
  return { base, value, mods };
}

export function damage(ratio: number, randomness: number): number {
  const c = D.rules.combat;
  return Math.max(1, Math.round(c.baseDamage * Math.pow(ratio, c.exponent) * randomness));
}

export interface CombatPreview {
  attacker: StrengthReport;
  defender: StrengthReport;
  /** Expected damage to the defender (unit HP, or city HP). */
  toDefender: [number, number];
  /** Expected damage to the attacker (0 for ranged). */
  toAttacker: [number, number];
  ranged: boolean;
  defenderHp: number;
  attackerHp: number;
}

/** Can unit u attack tile `to`? Returns the reason if not. */
export function canAttack(s: GameState, u: Unit, to: number): string | null {
  const def = unitDef(u);
  if (isCivilian(u)) return 'civilians cannot attack';
  if (def.domain === 'air') return 'aircraft make air strikes';
  if (u.moves <= 0) return 'no moves left';
  if (u.hasAttacked) return 'already attacked this turn';
  if (isEmbarked(s, u)) return 'embarked units cannot attack';
  const target = defenderAt(s, u, to);
  if (!target) return 'nothing to attack there';
  const d = distance(dims(s), u.tile, to);
  const targetOnWater = isWater(s, to) && !target.city;
  // Melee: land units fight on land, ships fight ships, embarked units and coastal cities.
  if (def.ranged === 0) {
    if (def.domain === 'land' && targetOnWater) return 'land units cannot attack ships';
    if (def.domain === 'sea' && !targetOnWater && !(target.city && isCoastalTile(s, to))) return 'ships can only attack at sea or coastal cities';
  }
  if (def.ranged > 0) {
    let range = def.range;
    for (const p of u.promotions) range += D.promotions.get(p)!.range;
    if (d > range) return 'out of range';
    if (!sightFrom(s, u.tile, range).includes(to)) return 'no line of sight';
    if (def.mustSetUp && u.moves < unitDef(u).moves * D.rules.moveScale && !u.setUp) return 'siege units must set up (attack before moving)';
  } else if (d !== 1) return 'too far';
  return null;
}

/** What would u fight at `to`: an enemy military unit, a city, or a lone civilian. */
export function defenderAt(s: GameState, u: Unit, to: number): { unit?: Unit; city?: City } | null {
  const city = cityAt(s, to);
  if (city && city.owner !== u.owner && atWar(s, u.owner, city.owner)) return { city };
  const m = militaryAt(s, to);
  if (m && m.owner !== u.owner && atWar(s, u.owner, m.owner)) return { unit: m };
  const civ = unitsAt(s, to).find((o) => o.owner !== u.owner && atWar(s, u.owner, o.owner) && unitDef(o).domain !== 'air');
  if (civ && unitDef(u).ranged > 0) return { unit: civ };
  return null;
}

export function previewAttack(s: GameState, u: Unit, to: number): CombatPreview | null {
  const target = defenderAt(s, u, to);
  if (!target) return null;
  const ranged = unitDef(u).ranged > 0;
  const att = unitStrength(s, u, true, ranged, to, target.unit);
  const dfn: StrengthReport = target.city ? cityStrength(s, target.city) : unitStrength(s, target.unit!, false, ranged, u.tile, u);
  const r = att.value / dfn.value;
  const rp = D.rules.combat.randomPct / 100;
  const toDef: [number, number] = [damage(r, 1 - rp), damage(r, 1 + rp)];
  const toAtt: [number, number] = ranged ? [0, 0] : [damage(1 / r, 1 - rp), damage(1 / r, 1 + rp)];
  return {
    attacker: att,
    defender: dfn,
    toDefender: toDef,
    toAttacker: toAtt,
    ranged,
    defenderHp: target.city ? target.city.hp : target.unit!.hp,
    attackerHp: u.hp,
  };
}

export interface AttackOutcome {
  damageDealt: number;
  damageTaken: number;
  defenderDied: boolean;
  attackerDied: boolean;
  cityCaptured: boolean;
}

/** Resolve an attack by unit u on tile `to` (after canAttack passed). */
export function resolveAttack(s: GameState, u: Unit, to: number): AttackOutcome {
  const target = defenderAt(s, u, to)!;
  const def = unitDef(u);
  const ranged = def.ranged > 0;
  const prev = previewAttack(s, u, to)!;
  const rp = D.rules.combat.randomPct / 100;
  const r = prev.attacker.value / prev.defender.value;
  const dealt = damage(r, 1 - rp + rand(s) * 2 * rp);
  const taken = ranged ? 0 : damage(1 / r, 1 - rp + rand(s) * 2 * rp);
  const out: AttackOutcome = { damageDealt: dealt, damageTaken: taken, defenderDied: false, attackerDied: false, cityCaptured: false };
  const vsBarb = s.players[target.unit?.owner ?? target.city!.owner].isBarbarian;
  const attackerName = `${s.players[u.owner].isBarbarian ? 'Barbarian' : s.players[u.owner].name} ${def.name}`;
  u.hasAttacked = true;
  u.acted = true;
  u.fortifyTurns = 0;
  u.order = 'none';
  u.path = [];
  u.moves = def.moveAfterAttack ? Math.max(0, u.moves - D.rules.moveScale) : 0;

  if (target.city) {
    const c = target.city;
    c.damagedThisTurn = true;
    // Ranged attacks can't take a city below 1 HP; a melee attack to 0 captures it.
    c.hp = Math.max(ranged ? 1 : 0, c.hp - dealt);
    if (!ranged) {
      u.hp -= taken;
      if (u.hp <= 0) {
        out.attackerDied = true;
        removeUnit(s, u);
      }
    }
    addXp(s, u, ranged ? D.rules.xp.rangedAttack : D.rules.xp.attack, vsBarb);
    notify(s, c.owner, `${c.name} was attacked by a ${attackerName} (−${dealt} HP).`, 'combat', c.tile);
    if (!ranged && !out.attackerDied && c.hp <= 0) {
      if (s.players[u.owner].isBarbarian) {
        // Barbarians sack the city instead of taking it.
        const loot = Math.min(s.players[c.owner].gold, 30);
        s.players[c.owner].gold -= loot;
        c.hp = Math.round(cityMaxHp(c) * 0.25);
        notify(s, c.owner, `Barbarians sacked ${c.name} and carried off ${loot} gold!`, 'bad', c.tile);
      } else {
        // Civilians inside are captured along with the city.
        u.tile = c.tile;
        captureCity(s, c, u.owner);
        onEnterTile(s, u);
        out.cityCaptured = true;
      }
    }
    return out;
  }

  const d = target.unit!;
  const dName = `${s.players[d.owner].isBarbarian ? 'barbarian' : s.players[d.owner].name} ${unitDef(d).name}`;
  if (isCivilian(d)) {
    // A ranged attack on a lone civilian kills it.
    removeUnit(s, d);
    out.defenderDied = true;
    notify(s, d.owner, `Your ${unitDef(d).name} was killed.`, 'bad', to);
    return out;
  }
  d.hp -= dealt;
  d.acted = true;
  if (!ranged) u.hp -= taken;
  const gain = ranged ? D.rules.xp.rangedAttack : D.rules.xp.attack;
  addXp(s, u, gain, vsBarb);
  addGeneralPoints(s, u.owner, gain, u.tile, def.domain === 'sea' ? 'admiral' : 'general');
  if (d.hp > 0) {
    addXp(s, d, D.rules.xp.defend, s.players[u.owner].isBarbarian);
    addGeneralPoints(s, d.owner, D.rules.xp.defend, d.tile, unitDef(d).domain === 'sea' ? 'admiral' : 'general');
  } else onKill(s, u.owner, to);
  if (d.hp <= 0) {
    out.defenderDied = true;
    recordSite(s, to, 'battle', D.rules.archaeology.siteChancePerBattlePct);
    removeUnit(s, d);
    notify(s, d.owner, `Your ${unitDef(d).name} was destroyed by a ${attackerName}.`, 'bad', to);
    notify(s, u.owner, `Your ${def.name} destroyed a ${dName}.`, 'good', to);
  } else {
    notify(s, d.owner, `Your ${unitDef(d).name} was attacked by a ${attackerName} (−${dealt} HP).`, 'combat', to);
  }
  if (!ranged && u.hp <= 0) {
    out.attackerDied = true;
    removeUnit(s, u);
    notify(s, u.owner, `Your ${def.name} died attacking a ${dName}.`, 'bad', to);
  }
  // A melee winner moves into the empty tile (capturing any civilian there).
  if (out.defenderDied && !ranged && !out.attackerDied) {
    const civ = unitsAt(s, to).find((o) => o.owner !== u.owner);
    if (!militaryAt(s, to) && (!civ || isCivilian(civ))) {
      u.tile = to;
      onEnterTile(s, u);
    }
  }
  return out;
}

/** Rewards for killing an enemy unit (policies: culture, gold). */
function onKill(s: GameState, p: number, at: number): void {
  const pl = s.players[p];
  if (pl.isBarbarian) return;
  const fx = playerEffects(s, p);
  const culture = sum(fx, 'kill_culture'), gold = sum(fx, 'kill_gold');
  if (culture) {
    pl.culture += culture;
    pl.cultureTotal += culture;
  }
  if (gold) pl.gold += gold;
  if (culture || gold) notify(s, p, `Victory spoils: ${[culture ? `+${culture} culture` : '', gold ? `+${gold} gold` : ''].filter(Boolean).join(', ')}.`, 'good', at);
}

/** City ranged attack on a unit at `to`. */
export function canCityAttack(s: GameState, c: City, to: number): string | null {
  if (c.hasAttacked) return 'already attacked this turn';
  if (distance(dims(s), c.tile, to) > D.rules.city.range) return 'out of range';
  const m = militaryAt(s, to) ?? unitsAt(s, to)[0];
  if (!m || m.owner === c.owner || !atWar(s, c.owner, m.owner)) return 'no enemy there';
  return null;
}

export function previewCityAttack(s: GameState, c: City, to: number): { toDefender: [number, number]; defender: StrengthReport; attacker: StrengthReport } | null {
  const m = militaryAt(s, to) ?? unitsAt(s, to)[0];
  if (!m) return null;
  const att = cityStrength(s, c);
  const dfn = unitStrength(s, m, false, true, c.tile);
  const r = att.value / dfn.value;
  const rp = D.rules.combat.randomPct / 100;
  return { toDefender: [damage(r, 1 - rp), damage(r, 1 + rp)], defender: dfn, attacker: att };
}

export function resolveCityAttack(s: GameState, c: City, to: number): number {
  const m = militaryAt(s, to) ?? unitsAt(s, to)[0];
  const p = previewCityAttack(s, c, to)!;
  const rp = D.rules.combat.randomPct / 100;
  const dealt = damage(p.attacker.value / p.defender.value, 1 - rp + rand(s) * 2 * rp);
  c.hasAttacked = true;
  if (isCivilian(m)) {
    removeUnit(s, m);
    return dealt;
  }
  m.hp -= dealt;
  if (m.hp <= 0) {
    removeUnit(s, m);
    notify(s, m.owner, `Your ${unitDef(m).name} was destroyed by ${c.name}'s defenders.`, 'bad', to);
  } else notify(s, m.owner, `${c.name} fired on your ${unitDef(m).name} (−${dealt} HP).`, 'combat', to);
  return dealt;
}
