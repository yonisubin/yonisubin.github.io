// Land, sea and air. Ships stay on water (only some may enter ocean) and in coastal cities;
// land units may embark onto water once their owner knows the embarkation techs (coast first,
// ocean later), becoming weak transports; aircraft live in cities and on carriers.
import { D } from '../../data';
import { neighbors } from '../hex';
import { cityAt, dims, eraOf, tileAt, unitDef } from '../query';
import type { GameState, Player, Unit } from '../state';

export const domainOf = (u: Unit | string) => unitDef(u).domain;
export const isAir = (u: Unit) => unitDef(u).domain === 'air';
export const isSea = (u: Unit) => unitDef(u).domain === 'sea';

export function isWater(s: GameState, i: number): boolean {
  return D.terrains.get(tileAt(s, i).terrain)!.water;
}

/** 0 = can't embark, 1 = coast and lakes, 2 = ocean too. */
export function embarkLevel(pl: Player): number {
  let lvl = 0;
  for (const t of pl.techs) {
    const e = D.techs.get(t)?.embark;
    if (e === 'ocean') lvl = Math.max(lvl, 2);
    else if (e === 'coast') lvl = Math.max(lvl, 1);
  }
  return lvl;
}

export function isCoastalTile(s: GameState, i: number): boolean {
  return neighbors(dims(s), i).some((n) => isWater(s, n));
}

/** Terrain-wise, can this unit be on tile i? (Ignores other units and borders.) */
export function terrainAllows(s: GameState, u: Unit, i: number): boolean {
  const t = tileAt(s, i);
  const ter = D.terrains.get(t.terrain)!;
  const def = unitDef(u);
  if (t.feature && D.features.get(t.feature)!.impassable) return false;
  if (def.domain === 'air') return false;
  if (def.domain === 'sea') {
    if (ter.water) return t.terrain !== 'ocean' || def.ocean;
    // Ships may sit in their owner's (or a friend's) coastal cities.
    const c = cityAt(s, i);
    return !!c && isCoastalTile(s, i);
  }
  if (ter.impassable) return false;
  if (!ter.water) return true;
  const lvl = embarkLevel(s.players[u.owner]);
  return t.terrain === 'ocean' ? lvl >= 2 : lvl >= 1;
}

/** A land unit standing on water. */
export function isEmbarked(s: GameState, u: Unit): boolean {
  return unitDef(u).domain === 'land' && isWater(s, u.tile);
}

export function embarkedStrength(s: GameState, u: Unit): number {
  const arr = D.rules.naval.embarkStrength;
  return arr[Math.min(arr.length - 1, eraOf(s.players[u.owner]))];
}

/** How many aircraft fit on tile i for player p (city slots + airport, or carriers). */
export function airCapacity(s: GameState, p: number, i: number): number {
  const c = cityAt(s, i);
  let cap = 0;
  if (c && c.owner === p) {
    cap += D.rules.air.citySlots;
    for (const b of c.buildings) cap += D.buildings.get(b)?.airSlots ?? 0;
  }
  for (const id in s.units) {
    const o = s.units[id];
    if (o.tile === i && o.owner === p) cap += unitDef(o).carries;
  }
  return cap;
}

/** Can `viewer` see this (stealthy) unit? Only from right next to it. */
export function stealthSeen(s: GameState, u: Unit, viewer: number): boolean {
  if (u.owner === viewer || !unitDef(u).stealth) return true;
  for (const n of [u.tile, ...neighbors(dims(s), u.tile)])
    for (const id in s.units) if (s.units[id].tile === n && s.units[id].owner === viewer) return true;
  return false;
}
