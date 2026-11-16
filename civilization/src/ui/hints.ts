// Advisor hints (setup option "Advisor hints", settings.tutorial): one short tip at a time, picked
// from what is happening in the player's game. Each tip shows once per device (localStorage
// `civ:hints` holds the dismissed ones).
import { D } from '../data';
import { playerCities, playerUnits, unitDef } from '../core/query';
import type { GameState } from '../core/state';
import { canPickPolicy } from '../core/systems/policies';
import { canChoosePantheon } from '../core/systems/religion';
import { happinessOf } from '../core/systems/happiness';
import { routesOf, tradeSlots } from '../core/systems/trade';

interface Hint {
  id: string;
  text: string;
  when: (s: GameState, p: number) => boolean;
}

const HINTS: Hint[] = [
  { id: 'found', text: 'Your Settler is ready. Select it and press B (or “Found city”) to found your capital right where it stands — good spots are by rivers, coasts and hills.', when: (s, p) => !playerCities(s, p).length && playerUnits(s, p).some((u) => unitDef(u).canFound) },
  { id: 'research', text: 'Pick a technology to research (T opens the tech tree). Pottery, Animal Husbandry and Mining unlock useful early buildings and improvements.', when: (s, p) => playerCities(s, p).length > 0 && !s.players[p].research },
  { id: 'production', text: 'Choose what your city builds. A Warrior or Scout to explore, then a Worker and a Settler is a strong start.', when: (s, p) => playerCities(s, p).some((c) => !c.queue.length) },
  { id: 'explore', text: 'Scouts can explore on their own: select one and press E. Ancient ruins (marked on the map) hold rewards for the first unit to step in.', when: (s, p) => s.turn >= 1 && playerUnits(s, p).some((u) => u.type === 'scout') },
  { id: 'worker', text: 'Workers improve tiles: farms for food, mines on hills, and the matching improvement on a luxury or strategic resource connects it to your empire.', when: (s, p) => playerUnits(s, p).some((u) => unitDef(u).canBuild && u.moves > 0) },
  { id: 'unhappy', text: 'Your empire is unhappy, so cities grow slowly. Connect new luxuries, build Shrines or Colosseums, or slow down your expansion.', when: (s, p) => happinessOf(s, p).net < 0 },
  { id: 'barbarian', text: 'Barbarians! They come from camps hidden in the fog. Keep a defender in each city and clear camps for gold.', when: (s, p) => Object.values(s.units).some((u) => s.players[u.owner].isBarbarian && s.players[p].visible[u.tile] === 1) },
  { id: 'policy', text: 'You have enough culture for a social policy. Tradition suits a few large cities; Liberty suits many.', when: (s, p) => canPickPolicy(s, p) },
  { id: 'pantheon', text: 'You have enough faith for a pantheon. Pick a belief that matches the land around your cities.', when: (s, p) => canChoosePantheon(s, p) },
  { id: 'citystate', text: 'You met a city-state. Gifts, quests and protection earn influence; friends and allies share food, culture, faith, units or luxuries.', when: (s, p) => s.players[p].met.some((q) => s.players[q].isMinor) },
  { id: 'civ', text: 'You met another civilization. The Relations panel shows their mood; trade luxuries you have two of for ones you lack.', when: (s, p) => s.players[p].met.some((q) => !s.players[q].isMinor && !s.players[q].isBarbarian) },
  { id: 'war', text: 'You are at war. Fortified units on hills or forests defend well, ranged units can hit without taking damage, and only melee units can capture a city.', when: (s, p) => s.players.some((q) => !q.isMinor && !q.isBarbarian && q.id !== p && s.diplomacy.war[p][q.id]) },
  { id: 'trade', text: 'You can open a trade route: build a Caravan (or Cargo Ship on the coast) and send it to a city nearby for gold, or to your own city for food.', when: (s, p) => routesOf(s, p).length < tradeSlots(s, p) && playerCities(s, p).length > 0 },
  { id: 'golden', text: 'A golden age! Production and gold are up while it lasts — a good moment for wonders.', when: (s, p) => s.players[p].goldenAge.turnsLeft > 0 },
  { id: 'greatperson', text: 'A great person was born. Use it now for a burst (science, production, gold, culture) or plant its special improvement for a lasting bonus.', when: (s, p) => playerUnits(s, p).some((u) => !!unitDef(u).greatPerson) },
  { id: 'ideology', text: 'Your people are ready for an ideology. Its tenets take the place of policies; other civilizations with more influence and a different ideology will unsettle your cities.', when: (s, p) => !s.players[p].ideology && s.players[p].techs.length > D.techs.size * 0.45 },
];

function dismissed(): string[] {
  try {
    return JSON.parse(localStorage.getItem('civ:hints') ?? '[]');
  } catch {
    return [];
  }
}

export function dismissHint(id: string): void {
  try {
    localStorage.setItem('civ:hints', JSON.stringify([...new Set([...dismissed(), id])]));
  } catch {
    /* storage may be unavailable */
  }
}

/** The tip to show now, if any. */
export function currentHint(s: GameState): Hint | null {
  if (!s.settings.tutorial || s.human < 0 || s.winner) return null;
  const done = dismissed();
  return HINTS.find((h) => !done.includes(h.id) && h.when(s, s.human)) ?? null;
}

export const resetHints = () => {
  try {
    localStorage.removeItem('civ:hints');
  } catch {
    /* ignore */
  }
};
