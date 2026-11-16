// Barbarian units: attack what they can beat nearby (civilians first), pillage improvements,
// march on weak cities, otherwise wander around their camp.
import { D } from '../data';
import { applyAction } from '../core/game';
import { distance, neighbors, within } from '../core/hex';
import { randInt } from '../core/rng';
import { allUnits, barbarianId, cityAt, dims, isCivilian, militaryAt, tileAt, unitDef } from '../core/query';
import type { GameState, Unit } from '../core/state';
import { canAttack, previewAttack } from '../core/systems/combat';

export function barbarianTurn(s: GameState): void {
  const b = barbarianId(s);
  if (b < 0) return;
  for (const u of allUnits(s).filter((x) => x.owner === b)) {
    if (!s.units[u.id]) continue;
    unitTurn(s, b, u);
  }
}

function unitTurn(s: GameState, b: number, u: Unit): void {
  const m = dims(s);
  const R = D.rules.barbarians.aggroRadius;
  if (attackSomething(s, b, u)) return;
  // Targets: lone civilians, weak units, cities, improvements.
  let best = -1, bestV = -Infinity;
  for (const i of within(m, u.tile, R)) {
    const d = distance(m, u.tile, i);
    let v = -Infinity;
    const other = allUnits(s).find((o) => o.tile === i && o.owner !== b);
    if (other) v = (isCivilian(other) && !militaryAt(s, i) ? 30 : 15 - unitDef(other).strength) - d * 2;
    const c = cityAt(s, i);
    if (c && c.owner !== b) v = Math.max(v, 10 - d * 2 - c.hp / 40);
    const t = tileAt(s, i);
    if (t.improvement && !t.pillaged && t.owner >= 0 && !c) v = Math.max(v, 6 - d * 2);
    if (v > bestV) {
      bestV = v;
      best = i;
    }
  }
  if (best >= 0) {
    if (best === u.tile) {
      applyAction(s, b, { type: 'pillage', unit: u.id });
      return;
    }
    const t = tileAt(s, best);
    // Walk next to the target (or onto an improvement to pillage it).
    const dest = t.improvement && !cityAt(s, best) && !allUnits(s).some((o) => o.tile === best) ? best : neighbors(m, best).sort((a, z) => distance(m, a, u.tile) - distance(m, z, u.tile))[0];
    if (dest !== undefined && applyAction(s, b, { type: 'move', unit: u.id, to: dest }).ok) {
      if (s.units[u.id] && u.moves > 0) {
        if (!attackSomething(s, b, u) && tileAt(s, u.tile).improvement) applyAction(s, b, { type: 'pillage', unit: u.id });
      }
      return;
    }
  }
  // Wander near a camp.
  const camps = Object.keys(s.camps).map(Number);
  const home = camps.sort((a, z) => distance(m, a, u.tile) - distance(m, z, u.tile))[0];
  const around = home !== undefined ? within(m, home, 3) : neighbors(m, u.tile);
  const dest = around[randInt(s, around.length)];
  if (dest !== u.tile) applyAction(s, b, { type: 'move', unit: u.id, to: dest });
}

function attackSomething(s: GameState, b: number, u: Unit): boolean {
  const range = unitDef(u).ranged > 0 ? unitDef(u).range : 1;
  let best = -1, bestV = 0;
  for (const t of within(dims(s), u.tile, range)) {
    if (t === u.tile || canAttack(s, u, t)) continue;
    const pv = previewAttack(s, u, t);
    if (!pv) continue;
    const dealt = (pv.toDefender[0] + pv.toDefender[1]) / 2;
    const taken = (pv.toAttacker[0] + pv.toAttacker[1]) / 2;
    if (!pv.ranged && taken >= u.hp) continue;
    const v = dealt - taken * 0.5 + (dealt >= pv.defenderHp ? 20 : 0);
    if (v > bestV) {
      bestV = v;
      best = t;
    }
  }
  if (best < 0) {
    // Step onto a lone civilian to capture it.
    for (const n of neighbors(dims(s), u.tile)) {
      const civ = allUnits(s).find((o) => o.tile === n && o.owner !== b && isCivilian(o));
      if (civ && !militaryAt(s, n) && !cityAt(s, n)) return applyAction(s, b, { type: 'move', unit: u.id, to: n }).ok;
    }
    return false;
  }
  return applyAction(s, b, { type: 'attack', unit: u.id, to: best }).ok;
}
