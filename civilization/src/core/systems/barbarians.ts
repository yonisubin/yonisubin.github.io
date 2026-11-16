// Barbarian camps: new camps appear in fog no major player can see, and each camp spawns the
// best barbarian unit the world's technology allows every few turns. (How barbarian units move
// and fight is in ai/barbarians.ts.)
import { D } from '../../data';
import { distance } from '../hex';
import { rand, randInt } from '../rng';
import { allCities, allUnits, barbarianId, dims, eraOf, majorPlayers, unitsAt } from '../query';
import type { GameState } from '../state';
import { isPassableLand } from '../../mapgen/generate';
import { createUnit, freeTileNear } from './units';

/** Best unit barbarians can field: barbarian-flagged units whose tech some major player knows. */
export function barbarianUnitType(s: GameState): string {
  const majors = majorPlayers(s).filter((p) => p.alive);
  let best = 'warrior';
  let bestCost = 0;
  for (const u of D.units.values()) {
    if (!u.barbarian) continue;
    if (u.tech && !majors.some((p) => p.techs.includes(u.tech!))) continue;
    // Keep them a step behind: only units of the era most majors have reached.
    const era = u.tech ? D.techs.get(u.tech)!.era : 0;
    const eras = majors.map(eraOf).sort((a, b) => a - b);
    if (era > (eras[Math.floor(eras.length / 2)] ?? 0)) continue;
    if (u.cost > bestCost) {
      best = u.id;
      bestCost = u.cost;
    }
  }
  return best;
}

export function barbarianSpawns(s: GameState): void {
  if (!s.settings.barbarians) return;
  const b = D.rules.barbarians;
  const bid = barbarianId(s);
  if (bid < 0) return;
  if (s.turn >= b.firstSpawnTurn) {
    for (const key of Object.keys(s.camps)) {
      const tile = Number(key);
      if (!s.map.tiles[tile].camp) {
        delete s.camps[key];
        continue;
      }
      if (s.turn - s.camps[key] < b.spawnEveryTurns + randInt(s, 3)) continue;
      const nearby = allUnits(s).filter((u) => u.owner === bid && distance(dims(s), u.tile, tile) <= 4).length;
      if (nearby >= b.maxUnitsPerCamp) continue;
      const type = barbarianUnitType(s);
      const at = unitsAt(s, tile).length ? freeTileNear(s, type, bid, tile, 2) : tile;
      if (at >= 0) createUnit(s, type, bid, at);
      s.camps[key] = s.turn;
    }
  }
  // Occasionally a new camp in the fog (until most players are in the industrial age).
  const size = D.mapSizes.get(s.settings.mapSize)!;
  const eras = majorPlayers(s).filter((p) => p.alive).map(eraOf).sort((a, z) => a - z);
  const lateGame = (eras[Math.floor(eras.length / 2)] ?? 0) >= b.stopEra;
  if (!lateGame && Object.keys(s.camps).length < size.barbarianCamps * 1.5 && rand(s) * 100 < b.newCampChancePct / 4) {
    const n = s.map.tiles.length;
    for (let tries = 0; tries < 40; tries++) {
      const i = randInt(s, n);
      const t = s.map.tiles[i];
      if (!isPassableLand(t) || t.owner >= 0 || t.camp || t.ruin || unitsAt(s, i).length) continue;
      if (s.players.some((p) => !p.isBarbarian && p.visible[i])) continue;
      if (allCities(s).some((c) => distance(dims(s), c.tile, i) < b.campDistanceFromCity)) continue;
      if (Object.keys(s.camps).some((c) => distance(dims(s), Number(c), i) < 4)) continue;
      t.camp = true;
      t.resource = null;
      s.camps[i] = s.turn - b.spawnEveryTurns; // spawns a defender right away
      break;
    }
  }
}

/** Very unhappy empires see rebels rise near their cities. */
export function spawnRebels(s: GameState, p: number): void {
  const bid = barbarianId(s);
  const cities = allCities(s).filter((c) => c.owner === p);
  if (bid < 0 || !cities.length) return;
  const c = cities[randInt(s, cities.length)];
  const type = barbarianUnitType(s);
  for (let k = 0; k < 2; k++) {
    const at = freeTileNear(s, type, bid, c.tile, 3);
    if (at >= 0 && at !== c.tile) createUnit(s, type, bid, at);
  }
}
