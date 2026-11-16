// The game API: newGame(settings), applyAction(state, action) and endTurn(state, hooks).
// Actions validate first and change nothing when they fail.
import { D, get, unitForFaction } from '../data';
import { generateMap } from '../mapgen/generate';
import { neighbors } from './hex';
import { hashSeed, shuffle } from './rng';
import {
  allCities,
  isCivilian,
  majorPlayers,
  minorPlayers,
  notify,
  playerCities,
  playerUnits,
  unitDef,
} from './query';
import type { Action, ActionResult, GameState, Player, Settings, VictoryKind } from './state';
import { annexPuppet, assignCitizens, buyItem, canFoundAt, cannotBuild, checkElimination, claimTile, decideCapture, foundCity, processCity, tileBuyCost, claimableTiles } from './systems/cities';
import { canAttack, canCityAttack, resolveAttack, resolveCityAttack } from './systems/combat';
import { goldReport, score, SCORE_HOOKS } from './systems/economy';
import { happinessOf } from './systems/happiness';
import { followPath, moveUnit } from './systems/movement';
import { autoExplore } from './systems/explore';
import { addScience, setResearch } from './systems/research';
import { buildOptions, createUnit, disbandForDebt, freeTileNear, fullMoves, healUnits, pillage, promote, removeUnit, upgradeCost, upgradeTarget, workJobs } from './systems/units';
import { recomputeAllVisibility, recomputeVisibility } from './systems/visibility';
import { barbarianSpawns, spawnRebels } from './systems/barbarians';
import { playerYields } from './systems/yields';
import { recordTurn } from './systems/stats';
import { installHooks } from './hooks';
import { areFriends, dealProblem, dealValue, declareFriendship, denounce, denounced, executeDeal, onWarDeclared, opinion, processDiplomacy } from './systems/diplomacy';
import { bully, giftGold, giftUnit, pledge, processCityStates } from './systems/citystates';
import { adoptPolicy, canPickPolicy } from './systems/policies';
import { processGoldenAge } from './systems/goldenage';
import { processGreatPeople, useGreatPerson } from './systems/greatpeople';
import { specialistSlots } from './systems/yields';
import { militaryStrength } from './power';
import { logEvent } from './query';

export interface NewGameOptions extends Partial<Settings> {
  /** Faction for the human player ('random' or an id). */
  faction?: string;
  /** Number of major players (default from map size). */
  civs?: number;
  /** Number of city-states (default from map size). */
  cityStates?: number;
}

export function newDiplomacy(P: number): GameState['diplomacy'] {
  const grid = <T,>(v: T) => Array.from({ length: P }, () => new Array<T>(P).fill(v));
  return {
    war: grid(false),
    changed: grid(-99),
    embassy: grid(false),
    openBorders: grid(0),
    pact: grid(0),
    friend: grid(0),
    denounce: grid(0),
    declaredBy: grid(-1),
    trades: grid(0),
    researchAgreements: [],
    deals: [],
    proposals: [],
    log: [],
  };
}

export function newGame(o: NewGameOptions = {}): GameState {
  const settings: Settings = {
    seed: o.seed ?? String(Date.now() % 1e9),
    mapType: o.mapType ?? 'continents',
    mapSize: o.mapSize ?? 'tiny',
    difficulty: o.difficulty ?? 'prince',
    pace: o.pace ?? 'standard',
    barbarians: o.barbarians ?? true,
    ruins: o.ruins ?? true,
    spectator: o.spectator ?? false,
    victories: { domination: true, science: true, culture: true, diplomatic: true, time: true, ...(o.victories ?? {}) },
    maxTurns: o.maxTurns ?? get(D.pace, o.pace ?? 'standard').maxTurns,
  };
  const size = get(D.mapSizes, settings.mapSize);
  const civs = Math.max(2, Math.min(o.civs ?? size.civs, D.factions.size));
  const holder = { rng: hashSeed(settings.seed) };
  const map = generateMap(holder, {
    type: settings.mapType,
    w: size.width,
    h: size.height,
    players: civs,
    ruins: settings.ruins,
    barbarianCamps: settings.barbarians ? size.barbarianCamps : 0,
    minors: Math.min(o.cityStates ?? size.cityStates, D.cityStates.size),
  });

  // Factions: the human's choice first, the rest shuffled; then match factions to starts by bias.
  let factionIds = shuffle(holder, [...D.factions.keys()]);
  const humanFaction = o.faction && o.faction !== 'random' && D.factions.has(o.faction) ? o.faction : factionIds[0];
  factionIds = [humanFaction, ...factionIds.filter((f) => f !== humanFaction)].slice(0, civs);
  const starts = assignStarts(map, factionIds);

  const n = map.w * map.h;
  const base = (i: number): Player => ({
    id: i,
    name: '',
    faction: '',
    leader: '',
    color: '#888888',
    color2: '#ffffff',
    isHuman: false,
    isBarbarian: false,
    isMinor: false,
    minor: null,
    warmonger: 0,
    alive: true,
    gold: 0,
    techs: [],
    techProgress: {},
    research: null,
    researchQueue: [],
    explored: new Array(n).fill(0),
    visible: new Array(n).fill(0),
    met: [],
    nextCityName: 0,
    ruinsSeen: [],
    pendingCaptures: [],
    cultureTotal: 0,
    notifications: [],
    hadCity: false,
    stats: [],
    projects: [],
    spaceship: {},
    futureTechs: 0,
    policies: [],
    culture: 0,
    freePolicies: 0,
    goldenAge: { points: 0, turnsLeft: 0, count: 0 },
    gpPoints: {},
    gpCount: {},
  });
  const players: Player[] = factionIds.map((fid, i) => {
    const f = get(D.factions, fid);
    return { ...base(i), name: f.name, faction: fid, leader: `${f.leader.title} ${f.leader.name}`, color: f.colors.primary, color2: f.colors.secondary, isHuman: i === 0 && !settings.spectator };
  });
  // City-states.
  const csDefs = shuffle(holder, [...D.cityStates.values()]).slice(0, map.minorStarts.length);
  const minorIds: number[] = [];
  for (const def of csDefs) {
    const i = players.length;
    minorIds.push(i);
    players.push({
      ...base(i),
      name: def.name,
      leader: `City-state of ${def.name}`,
      color: def.color,
      color2: '#1a1a1a',
      isMinor: true,
      minor: { def: def.id, type: def.type, personality: def.personality, influence: [], ally: -1, pledges: [], quests: [], lastGift: [] },
    });
  }
  players.push({ ...base(players.length), name: 'Barbarians', leader: 'Barbarian chieftains', color: '#3a3a3a', color2: '#c0392b', isBarbarian: true, explored: [], visible: [] });
  const P = players.length;
  const s: GameState = {
    version: 1,
    settings,
    rng: holder.rng,
    turn: 0,
    map: { w: map.w, h: map.h, tiles: map.tiles },
    players,
    units: {},
    cities: {},
    nextId: 1,
    diplomacy: newDiplomacy(P),
    camps: {},
    winner: null,
    human: settings.spectator ? -1 : 0,
    replay: [],
    events: [],
    wonders: {},
    modGen: 0,
  };
  for (const c of map.camps) s.camps[c] = -99;

  for (const pl of players) if (pl.minor) pl.minor.influence = new Array(P).fill(0);
  // City-states start with their city and a small garrison.
  minorIds.forEach((id, k) => {
    const tile = map.minorStarts[k];
    const c = foundCity(s, id, tile);
    c.name = players[id].name;
    for (const u of D.rules.cityStates.startUnits) {
      const at = freeTileNear(s, u, id, tile, 2);
      if (at >= 0) createUnit(s, u, id, at);
    }
  });
  // Starting units.
  const diff = get(D.difficulty, settings.difficulty);
  players.forEach((pl, i) => {
    if (pl.isBarbarian || pl.isMinor) return;
    const units = [...D.rules.startUnits, ...(pl.isHuman ? [] : diff.aiExtraUnits)];
    for (const base of units) {
      const type = unitForFaction(base, pl.faction);
      const at = freeTileNear(s, type, i, starts[i], 3);
      if (at >= 0) createUnit(s, type, i, at);
    }
  });
  recomputeAllVisibility(s);
  recordTurn(s);
  return s;
}

/** Give each faction the start that best matches its start bias (greedy). */
function assignStarts(map: ReturnType<typeof generateMap>, factions: string[]): number[] {
  const m = { w: map.w, h: map.h };
  const biasScore = (fid: string, start: number) => {
    const bias = get(D.factions, fid).startBias;
    let v = 0;
    for (const i of [start, ...neighbors(m, start), ...neighbors(m, start).flatMap((x) => neighbors(m, x))]) {
      const t = map.tiles[i];
      if (bias.includes(t.terrain)) v++;
      if (bias.includes('hills') && t.hills) v++;
      if (bias.includes('forest') && t.feature === 'forest') v++;
      if (bias.includes('river') && t.river) v++;
      if (bias.includes('coast') && t.terrain === 'coast') v++;
    }
    return v;
  };
  const left = [...map.starts];
  const out: number[] = [];
  for (const f of factions) {
    left.sort((a, b) => biasScore(f, b) - biasScore(f, a) || a - b);
    out.push(left.shift()!);
  }
  return out;
}

const fail = (error: string): ActionResult => ({ ok: false, error });
const OK: ActionResult = { ok: true };

/** Apply one action for player `p`. */
export function applyAction(s: GameState, p: number, a: Action): ActionResult {
  if (s.winner) return fail('the game is over');
  const pl = s.players[p];
  if (!pl || !pl.alive) return fail('no such player');
  const unit = 'unit' in a ? s.units[a.unit] : undefined;
  if ('unit' in a && (!unit || unit.owner !== p)) return fail('not your unit');
  const city = 'city' in a ? s.cities[a.city] : undefined;
  if ('city' in a && (!city || city.owner !== p)) return fail('not your city');
  switch (a.type) {
    case 'move': {
      const u = unit!;
      // With no moves left this just stores the path; it's followed next turn.
      const err = moveUnit(s, u, a.to);
      return err ? fail(err) : OK;
    }
    case 'attack': {
      const u = unit!;
      const why = canAttack(s, u, a.to);
      if (why) return fail(why);
      resolveAttack(s, u, a.to);
      recomputeAllVisibility(s);
      checkVictory(s);
      return OK;
    }
    case 'found': {
      const u = unit!;
      if (!unitDef(u).canFound) return fail('this unit cannot found cities');
      if (u.moves <= 0) return fail('no moves left');
      const why = canFoundAt(s, p, u.tile);
      if (why) return fail(why);
      removeUnit(s, u);
      foundCity(s, p, u.tile);
      return OK;
    }
    case 'build': {
      const u = unit!;
      const opt = buildOptions(s, u).find((o) => o.job === a.job);
      if (!opt) return fail('cannot build that here');
      if (u.moves <= 0) return fail('no moves left');
      u.job = { improvement: a.job, turnsLeft: opt.turns };
      u.path = [];
      u.moves = 0;
      return OK;
    }
    case 'order': {
      const u = unit!;
      u.exploring = a.order === 'explore';
      if (a.order === 'wake' || a.order === 'explore') u.order = 'none';
      else {
        u.order = a.order;
        if (a.order === 'fortify' && isCivilian(u)) return fail('civilians cannot fortify');
        if (a.order !== 'skip') u.path = [];
      }
      if (a.order === 'skip') u.moves = 0;
      return OK;
    }
    case 'delete':
      removeUnit(s, unit!);
      recomputeVisibility(s, p);
      return OK;
    case 'pillage': {
      const err = pillage(s, unit!);
      return err ? fail(err) : OK;
    }
    case 'promote': {
      const err = promote(s, unit!, a.promotion);
      return err ? fail(err) : OK;
    }
    case 'upgrade': {
      const u = unit!;
      const to = upgradeTarget(s, u);
      if (!to) return fail('no upgrade available');
      if (s.map.tiles[u.tile].owner !== p) return fail('upgrade inside your own territory');
      const cost = upgradeCost(s, u);
      if (pl.gold < cost) return fail(`needs ${cost} gold`);
      if (u.moves <= 0) return fail('no moves left');
      pl.gold -= cost;
      u.type = to;
      u.moves = 0;
      return OK;
    }
    case 'produce': {
      const c = city!;
      if (c.puppet) return fail('puppets choose their own production');
      const why = cannotBuild(s, c, a.item);
      if (why) return fail(why);
      if (a.append) {
        if (a.item.kind === 'building' && c.queue.some((q) => q.id === a.item.id)) return fail('already queued');
        c.queue.push(a.item);
      } else {
        // Switching keeps progress (simple rule: production stays with the city).
        c.queue = [a.item, ...c.queue.filter((q, i) => i > 0 && !(q.kind === 'building' && q.id === a.item.id))];
      }
      return OK;
    }
    case 'dequeue': {
      const c = city!;
      if (a.index < 0 || a.index >= c.queue.length) return fail('no such item');
      c.queue.splice(a.index, 1);
      return OK;
    }
    case 'buy': {
      const err = buyItem(s, city!, a.item);
      if (!err) recomputeVisibility(s, p);
      return err ? fail(err) : OK;
    }
    case 'focus': {
      const c = city!;
      c.focus = a.focus;
      if (a.avoidGrowth !== undefined) c.avoidGrowth = a.avoidGrowth;
      assignCitizens(s, c);
      return OK;
    }
    case 'lockTile': {
      const c = city!;
      if (c.locked.includes(a.tile)) c.locked = c.locked.filter((t) => t !== a.tile);
      else {
        if (s.map.tiles[a.tile].cityId !== c.id) return fail('not this city’s tile');
        if (c.locked.length >= c.pop) c.locked.shift();
        c.locked.push(a.tile);
      }
      assignCitizens(s, c);
      return OK;
    }
    case 'buyTile': {
      const c = city!;
      if (!claimableTiles(s, c).includes(a.tile)) return fail('cannot buy that tile');
      const cost = tileBuyCost(s, c, a.tile);
      if (pl.gold < cost) return fail(`needs ${cost} gold`);
      pl.gold -= cost;
      c.tilesBought++;
      claimTile(s, c, a.tile);
      assignCitizens(s, c);
      recomputeVisibility(s, p);
      return OK;
    }
    case 'cityAttack': {
      const c = city!;
      const why = canCityAttack(s, c, a.to);
      if (why) return fail(why);
      resolveCityAttack(s, c, a.to);
      return OK;
    }
    case 'research': {
      const err = setResearch(s, p, a.tech);
      return err ? fail(err) : OK;
    }
    case 'capture': {
      const c = city!;
      if (!pl.pendingCaptures.includes(c.id)) return fail('no decision pending');
      const err = decideCapture(s, c, a.choice);
      return err ? fail(err) : OK;
    }
    case 'annexPuppet': {
      const err = annexPuppet(city!);
      return err ? fail(err) : OK;
    }
    case 'adoptPolicy': {
      const err = adoptPolicy(s, p, a.policy);
      return err ? fail(err) : OK;
    }
    case 'specialist': {
      const c = city!;
      const slots = specialistSlots(c);
      const cur = c.manualSpecialists[a.specialist] ?? 0;
      const next = cur + a.delta;
      if (next < 0) return fail('no specialist to remove');
      if (next > (slots[a.specialist] ?? 0)) return fail('no free slot');
      const total = Object.values(c.manualSpecialists).reduce((x, y) => x + y, 0) + a.delta;
      if (total > c.pop - 1) return fail('a city needs at least one citizen on the land');
      c.manualSpecialists[a.specialist] = next;
      assignCitizens(s, c);
      return OK;
    }
    case 'greatPerson': {
      const err = useGreatPerson(s, unit!, a.use);
      if (!err) recomputeVisibility(s, p);
      return err ? fail(err) : OK;
    }
    case 'trade': {
      const deal = a.deal;
      if (deal.a !== p) return fail('you must be the proposer');
      const q = deal.b;
      if (!s.players[q]?.alive || !pl.met.includes(q)) return fail('you have not met them');
      const why = dealProblem(s, deal);
      if (why) return fail(why);
      if (s.players[q].isHuman) {
        s.diplomacy.proposals.push({ deal, from: p, turn: s.turn, kind: 'deal', text: `The ${pl.name} propose a deal.` });
        return OK;
      }
      const v = dealValue(s, q, deal);
      if (v < 0) return fail(`${s.players[q].leader} declines. (They would want about ${Math.ceil(-v / 10) * 10} gold more in value.)`);
      executeDeal(s, deal, setWar);
      return OK;
    }
    case 'respond': {
      const mine = s.diplomacy.proposals.filter((x) => x.deal.b === p || (x.kind !== 'deal' && x.deal.b === p));
      const prop = mine[a.index];
      if (!prop) return fail('no such proposal');
      s.diplomacy.proposals = s.diplomacy.proposals.filter((x) => x !== prop);
      if (a.accept) {
        if (prop.kind === 'friendship') {
          declareFriendship(s, prop.from, p);
          return OK;
        }
        const why = dealProblem(s, prop.deal);
        if (why) return fail(why);
        executeDeal(s, prop.deal, setWar);
      } else if (prop.kind === 'demand') {
        notify(s, prop.from, `The ${pl.name} refused your demand.`, 'info');
        s.diplomacy.trades[prop.from][p] = Math.max(-10, s.diplomacy.trades[prop.from][p] - 5);
      }
      return OK;
    }
    case 'friendship': {
      const q = a.target;
      if (!pl.met.includes(q) || s.players[q].isMinor || s.diplomacy.war[p][q]) return fail('not possible');
      if (areFriends(s, p, q)) return fail('already friends');
      if (s.players[q].isHuman) {
        s.diplomacy.proposals.push({ deal: { a: p, b: q, items: [] }, from: p, turn: s.turn, kind: 'friendship', text: `The ${pl.name} offer a declaration of friendship.` });
        return OK;
      }
      if (opinion(s, q, p).total < 20) return fail(`${s.players[q].leader} is not ready for that.`);
      declareFriendship(s, p, q);
      return OK;
    }
    case 'denounce': {
      const q = a.target;
      if (!pl.met.includes(q) || s.players[q].isMinor) return fail('not possible');
      if (denounced(s, p, q)) return fail('already denounced');
      denounce(s, p, q);
      return OK;
    }
    case 'giftGold': {
      const err = giftGold(s, p, a.minor, a.amount);
      return err ? fail(err) : OK;
    }
    case 'giftUnit': {
      const err = giftUnit(s, p, a.minor, unit!);
      return err ? fail(err) : OK;
    }
    case 'pledge': {
      if (!s.players[a.minor]?.isMinor) return fail('not a city-state');
      const err = pledge(s, p, a.minor);
      return err ? fail(err) : OK;
    }
    case 'bully': {
      if (!s.players[a.minor]?.isMinor) return fail('not a city-state');
      const err = bully(s, p, a.minor, a.kind);
      return err ? fail(err) : OK;
    }
    case 'declareWar': {
      const q = a.target;
      if (q === p || !s.players[q] || s.players[q].isBarbarian || !s.players[q].alive) return fail('invalid target');
      if (s.players[p].isMinor) return fail('city-states do not declare war');
      if (!pl.met.includes(q)) return fail('you have not met them');
      if (s.diplomacy.war[p][q]) return fail('already at war');
      if (s.turn - s.diplomacy.changed[p][q] < D.rules.peaceTurns) return fail(`peace treaty holds for ${D.rules.peaceTurns - (s.turn - s.diplomacy.changed[p][q])} more turns`);
      setWar(s, p, q, true);
      return OK;
    }
    case 'makePeace': {
      const q = a.target;
      if (!s.diplomacy.war[p]?.[q]) return fail('not at war');
      const other = s.players[q];
      if (!other.isHuman && !aiAcceptsPeace(s, q, p)) return fail(`${other.leader} refuses to make peace.`);
      setWar(s, p, q, false);
      return OK;
    }
  }
}

export function setWar(s: GameState, a: number, b: number, war: boolean): void {
  if (s.diplomacy.war[a][b] === war) return;
  s.diplomacy.war[a][b] = s.diplomacy.war[b][a] = war;
  s.diplomacy.changed[a][b] = s.diplomacy.changed[b][a] = s.turn;
  if (war) onWarDeclared(s, a, b, setWar);
  else s.diplomacy.declaredBy[a][b] = s.diplomacy.declaredBy[b][a] = -1;
  // Attacking a city-state breaks your pledge; its protectors are displeased.
  if (war && s.players[b].isMinor) s.players[b].minor!.pledges = s.players[b].minor!.pledges.filter((x) => x !== a);
  // City-state allies follow their ally into war and out of it.
  for (const mp of minorPlayers(s)) {
    if (!mp.alive || mp.id === a || mp.id === b) continue;
    const ally = mp.minor!.ally;
    if (ally === a && !s.players[b].isMinor) setWar(s, mp.id, b, war);
    else if (ally === b && !s.players[a].isMinor) setWar(s, mp.id, a, war);
  }
  const A = s.players[a], B = s.players[b];
  const f = D.factions.get(B.faction);
  const fa = D.factions.get(A.faction);
  logEvent(s, war ? `The ${A.name} declared war on the ${B.name}.` : `The ${A.name} and the ${B.name} made peace.`, undefined, a);
  if (war) {
    notify(s, b, `The ${A.name} declared war on you! — "${fa?.lines.war ?? ''}"`, 'bad');
    notify(s, a, `You are at war with the ${B.name}. — "${f?.lines.war ?? ''}"`, 'bad');
  } else {
    notify(s, a, `Peace with the ${B.name}. — "${f?.lines.peace ?? ''}"`, 'good');
    notify(s, b, `Peace with the ${A.name}. — "${fa?.lines.peace ?? ''}"`, 'good');
  }
  if (!A.isMinor && !B.isMinor) for (const pl of s.players) if (pl.id !== a && pl.id !== b && pl.met.includes(a)) notify(s, pl.id, `The ${A.name} and the ${B.name} are ${war ? 'now at war' : 'at peace'}.`, 'info');
  // Units standing in land that is now closed to them are pushed out.
  if (!war) for (const u of Object.values(s.units)) if ((u.owner === a || u.owner === b) && s.map.tiles[u.tile].owner >= 0 && s.map.tiles[u.tile].owner !== u.owner && [a, b].includes(s.map.tiles[u.tile].owner)) bounceUnit(s, u.id);
}

function bounceUnit(s: GameState, uid: number): void {
  const u = s.units[uid];
  for (let r = 1; r <= 10; r++) {
    const at = freeTileNear(s, u.type, u.owner, u.tile, r);
    if (at >= 0 && (s.map.tiles[at].owner < 0 || s.map.tiles[at].owner === u.owner)) {
      u.tile = at;
      u.path = [];
      return;
    }
  }
  removeUnit(s, u);
}

export { militaryStrength };

installHooks(setWar);

/** AI peace rule: after the treaty minimum, accept if losing or the war has dragged on. */
export function aiAcceptsPeace(s: GameState, ai: number, other: number): boolean {
  const since = s.turn - s.diplomacy.changed[ai][other];
  if (since < D.rules.peaceTurns) return false;
  if (s.players[ai].isMinor) {
    // City-states make peace unless their ally is still fighting.
    const ally = s.players[ai].minor!.ally;
    return !(ally >= 0 && s.diplomacy.war[ally]?.[other]);
  }
  const mine = militaryStrength(s, ai), theirs = militaryStrength(s, other);
  const pers = get(D.factions, s.players[ai].faction).leader.personality;
  return mine < theirs * 0.9 || since > 20 + pers.aggression * 3;
}

// ---- Turn processing ----

export interface TurnHooks {
  /** Play an AI player's turn (move units, choose builds...). */
  ai?: (s: GameState, p: number) => void;
  /** Move barbarian units. */
  barbarians?: (s: GameState) => void;
  /** Play a city-state's turn. */
  minor?: (s: GameState, p: number) => void;
}

/** Finish a player's turn: cities, research, gold, workers, healing. */
export function endPlayerTurn(s: GameState, p: number): void {
  const pl = s.players[p];
  if (!pl.alive || pl.isBarbarian) return;
  const happy = happinessOf(s, p);
  for (const c of playerCities(s, p)) processCity(s, c, happy.net);
  const y = playerYields(s, p);
  addScience(s, p, y.science);
  pl.culture += y.culture;
  processGoldenAge(s, p, happy.net);
  processGreatPeople(s, p);
  const g = goldReport(s, p);
  pl.gold += g.net;
  if (pl.gold < 0) {
    pl.gold = 0;
    disbandForDebt(s, p);
  }
  workJobs(s, p);
  healUnits(s, p);
  if (happy.net <= D.rules.happiness.revolt && s.turn % D.rules.happiness.revoltEveryTurns === 0) {
    spawnRebels(s, p);
    notify(s, p, 'Rebels have risen against your rule!', 'bad');
  }
  if (happy.net < 0 && pl.isHuman && s.turn % 10 === 0) notify(s, p, 'Your empire is unhappy: cities grow slowly. Connect luxuries or build Shrines and Colosseums.', 'bad');
}

/** Start of a new turn for a player: refresh movement, fortify counters, continue paths. */
export function startPlayerTurn(s: GameState, p: number): void {
  for (const u of Object.values(s.units)) {
    if (u.owner !== p) continue;
    if (u.order === 'fortify' && !u.acted) u.fortifyTurns = Math.min(2, u.fortifyTurns + 1);
    if (u.order === 'skip') u.order = 'none';
    u.moves = u.job ? 0 : fullMoves(s, u);
    u.acted = false;
    u.hasAttacked = false;
    u.setUp = false;
  }
  for (const c of playerCities(s, p)) c.hasAttacked = false;
  citadelDamage(s, p);
  // Units with orders keep walking (the human's too); explorers keep exploring.
  for (const u of Object.values(s.units)) {
    if (u.owner !== p || u.job) continue;
    if (u.path.length) followPath(s, u);
    else if (u.exploring && s.players[p].isHuman) autoExplore(s, u);
  }
}

/**
 * End the human's turn (or a spectator round): every AI plays and is processed, then barbarians,
 * then a new turn starts. Players act in id order, each finishing its own turn.
 */
export function endTurn(s: GameState, hooks: TurnHooks = {}): void {
  if (s.winner) return;
  for (const pl of s.players) {
    if (!pl.alive) continue;
    if (pl.isBarbarian) {
      hooks.barbarians?.(s);
      barbarianSpawns(s);
      continue;
    }
    if (pl.isMinor) hooks.minor?.(s, pl.id);
    else if (!pl.isHuman) hooks.ai?.(s, pl.id);
    endPlayerTurn(s, pl.id);
  }
  processDiplomacy(s);
  processCityStates(s);
  s.turn++;
  for (const pl of s.players) {
    if (!pl.alive) continue;
    startPlayerTurn(s, pl.id);
    checkElimination(s, pl.id);
  }
  recomputeAllVisibility(s);
  recordTurn(s);
  checkVictory(s);
}

/** End the game: `p` wins. */
export function declareWinner(s: GameState, p: number, kind: VictoryKind, how: string): void {
  if (s.winner) return;
  s.winner = { player: p, kind };
  const pl = s.players[p];
  logEvent(s, `The ${pl.name} won a ${kind} victory: ${how}`, undefined, p);
  for (const q of majorPlayers(s)) notify(s, q.id, `The ${pl.name} ${how} — ${kind} victory!`, q.id === p ? 'good' : 'bad');
}

/** Has player p delivered every spaceship part? */
export function spaceshipComplete(s: GameState, p: number): boolean {
  const need = D.rules.spaceship;
  const have = s.players[p].spaceship;
  return Object.keys(need).every((k) => (have[k] ?? 0) >= need[k]);
}

/** Victory checks; later phases add their own to this list. */
export const VICTORY_CHECKS: ((s: GameState) => void)[] = [];

// Wonders and policies count toward score.
SCORE_HOOKS.push((s, p) => {
  const sc = D.rules.score;
  const wonders = allCities(s).filter((c) => c.owner === p).reduce((a, c) => a + c.buildings.filter((b) => D.buildings.get(b)?.wonder === 'world').length, 0);
  return wonders * sc.perWonder + s.players[p].policies.filter((x) => !x.startsWith('done:')).length * sc.perPolicy;
});

export function checkVictory(s: GameState): void {
  if (s.winner) return;
  const v = s.settings.victories;
  const majors = majorPlayers(s);
  const alive = majors.filter((p) => p.alive);
  if (v.domination) {
    const capitals = allCities(s).filter((c) => c.wasCapital);
    const founders = majors.filter((q) => capitals.some((c) => c.originalOwner === q.id));
    for (const pl of alive) {
      // Domination: you hold every original capital (your own included).
      if (founders.length >= 2 && founders.every((q) => capitals.some((c) => c.originalOwner === q.id && c.owner === pl.id))) {
        return declareWinner(s, pl.id, 'domination', 'hold every original capital');
      }
    }
    if (alive.length === 1 && majors.length > 1) return declareWinner(s, alive[0].id, 'domination', 'are the last civilization standing');
  }
  if (v.science) for (const pl of alive) if (spaceshipComplete(s, pl.id)) return declareWinner(s, pl.id, 'science', 'launched a ship to the stars');
  for (const check of VICTORY_CHECKS) {
    check(s);
    if (s.winner) return;
  }
  if (s.turn >= s.settings.maxTurns) {
    const best = [...alive].sort((a, b) => score(s, b.id) - score(s, a.id))[0];
    if (best && v.time) declareWinner(s, best.id, 'time', `had the best score when time ran out`);
    else if (best) s.winner = { player: best.id, kind: 'time' };
  }
}

/** Is it safe to say the human has nothing left to do (for the End Turn button)? */
/** Citadels hurt enemy units next to them at the start of their owner's turn. */
function citadelDamage(s: GameState, p: number): void {
  for (let i = 0; i < s.map.tiles.length; i++) {
    const t = s.map.tiles[i];
    if (t.improvement !== 'citadel' || t.pillaged || t.owner !== p) continue;
    for (const n of neighbors(s.map, i)) {
      for (const u of Object.values(s.units)) {
        if (u.tile !== n || u.owner === p || isCivilian(u) || !s.diplomacy.war[p]?.[u.owner] && !s.players[u.owner].isBarbarian) continue;
        u.hp -= D.rules.greatPeople.citadelDamage;
        if (u.hp <= 0) {
          notify(s, u.owner, `Your ${unitDef(u).name} was destroyed by a citadel.`, 'bad', n);
          removeUnit(s, u);
        }
      }
    }
  }
}

export function nextRequiredAction(s: GameState, p: number): { kind: 'research' | 'production' | 'unit' | 'capture' | 'promotion' | 'policy' | 'done'; id?: number } {
  const pl = s.players[p];
  if (pl.pendingCaptures.length) return { kind: 'capture', id: pl.pendingCaptures[0] };
  if (canPickPolicy(s, p)) return { kind: 'policy' };
  if (!pl.research && playerCities(s, p).length && pl.techs.length < D.techs.size) return { kind: 'research' };
  for (const c of playerCities(s, p)) if (!c.queue.length && !c.puppet && !c.razing) return { kind: 'production', id: c.id };
  for (const u of playerUnits(s, p)) if (u.pendingPromotions > 0 && u.moves > 0) return { kind: 'promotion', id: u.id };
  for (const u of playerUnits(s, p)) if (u.moves > 0 && u.order === 'none' && !u.job && !u.path.length && !u.exploring) return { kind: 'unit', id: u.id };
  return { kind: 'done' };
}

