// GameState: everything about a game in plain JSON (no classes, no Maps), so a save is
// JSON.stringify(state) and the AI worker can receive a structured clone of it.

export type YieldSet = { food: number; production: number; gold: number; science: number; culture: number; faith: number; tourism: number };
export const emptyYields = (): YieldSet => ({ food: 0, production: 0, gold: 0, science: 0, culture: 0, faith: 0, tourism: 0 });

export interface Tile {
  terrain: string;
  hills: boolean;
  feature: string | null;
  resource: string | null;
  /** Copies of a strategic resource on this tile. */
  resourceQty: number;
  improvement: string | null;
  pillaged: boolean;
  road: boolean;
  /** Player who built the road (pays its upkeep), -1 if none. */
  roadOwner: number;
  /** Bitmask of edges (directions 0..5, see hex.ts) with a river. */
  river: number;
  /** Owning player, -1 = nobody. */
  owner: number;
  /** City (id) whose territory this tile is in, -1 = none. */
  cityId: number;
  ruin: boolean;
  camp: boolean;
  /** Landmass id (0 = water), for AI and start placement. */
  area: number;
  /** Height used by map generation (0..1), kept for rendering shading. */
  elevation: number;
}

export interface WorkerJob {
  improvement: string; // improvement id, or "road", or "remove_<feature>", or "repair"
  turnsLeft: number;
}

export type UnitOrder = 'none' | 'fortify' | 'sleep' | 'skip';

export interface Unit {
  id: number;
  type: string;
  owner: number;
  tile: number;
  hp: number;
  /** Movement points left this turn, in rules.moveScale units per tile. */
  moves: number;
  xp: number;
  /** XP thresholds already spent on promotions (= number of promotions earned). */
  level: number;
  promotions: string[];
  /** Promotions earned but not yet picked. */
  pendingPromotions: number;
  order: UnitOrder;
  /** Turns spent fortified (0 = not fortified). */
  fortifyTurns: number;
  /** Moved or fought this turn (no healing, no fortify bonus growth). */
  acted: boolean;
  hasAttacked: boolean;
  /** Siege: has spent its set-up move this turn. */
  setUp: boolean;
  job: WorkerJob | null;
  /** Remaining multi-turn move orders (tile indices, next step first). */
  path: number[];
  /** Automated exploring (AI or the player's "explore" order). */
  exploring: boolean;
}

export interface QueueItem {
  kind: 'unit' | 'building' | 'project';
  id: string;
}

export type CityFocus = 'default' | 'food' | 'production' | 'gold' | 'science' | 'culture';

export interface City {
  id: number;
  name: string;
  owner: number;
  originalOwner: number;
  /** This city was founded as its original owner's capital. */
  wasCapital: boolean;
  isCapital: boolean;
  tile: number;
  pop: number;
  food: number;
  /** Production put into the current queue head. */
  production: number;
  queue: QueueItem[];
  buildings: string[];
  /** Culture toward the next border tile. */
  culture: number;
  tilesClaimed: number;
  tilesBought: number;
  /** Tiles worked by citizens (indices). */
  worked: number[];
  /** Tiles the player locked; the auto-assigner keeps them. */
  locked: number[];
  focus: CityFocus;
  avoidGrowth: boolean;
  hp: number;
  hasAttacked: boolean;
  /** Turns of resistance after capture (no production). */
  resistance: number;
  puppet: boolean;
  razing: boolean;
  /** Conquered and annexed without a Courthouse. */
  occupied: boolean;
  founded: number;
  /** Was attacked this turn (heals less). */
  damagedThisTurn: boolean;
  /** Citizens working as specialists, by type (the player's picks plus any auto-assigned). */
  specialists: Record<string, number>;
  /** Specialists the player asked for (kept when citizens are reassigned). */
  manualSpecialists: Record<string, number>;
}

export interface Notification {
  turn: number;
  text: string;
  /** Tile to centre on when clicked. */
  tile?: number;
  kind: 'info' | 'good' | 'bad' | 'combat';
}

export interface Player {
  id: number;
  name: string;
  faction: string;
  leader: string;
  color: string;
  color2: string;
  isHuman: boolean;
  isBarbarian: boolean;
  alive: boolean;
  gold: number;
  techs: string[];
  /** Science stored per tech (beakers already put in). */
  techProgress: Record<string, number>;
  research: string | null;
  /** Techs to research after the current one. */
  researchQueue: string[];
  /** Explored tiles (1) as a string of '0'/'1' would be compact, but an array is simpler. */
  explored: number[];
  /** Currently visible (recomputed whenever units/cities change). */
  visible: number[];
  /** Players met (ids). */
  met: number[];
  /** Index into faction city names. */
  nextCityName: number;
  /** Ruin rewards already received (ids), reset once all are seen. */
  ruinsSeen: string[];
  /** Pending city-capture decisions for a human (city ids). */
  pendingCaptures: number[];
  /** Total culture produced (score/stats). */
  cultureTotal: number;
  notifications: Notification[];
  /** Turn when the player first had a city (for elimination). */
  hadCity: boolean;
  /** Per-turn statistics for the end-of-game graphs. */
  stats: TurnStats[];
  /** Completed projects (Apollo Program...). */
  projects: string[];
  /** Spaceship parts delivered to the capital, by kind. */
  spaceship: Record<string, number>;
  /** Times Future Tech was researched. */
  futureTechs: number;
  /** Adopted policy trees (their ids) and policies; finished trees as "done:<tree>". */
  policies: string[];
  /** Culture saved toward the next policy. */
  culture: number;
  /** Policies that can be picked for free (wonders, finishers). */
  freePolicies: number;
  goldenAge: { points: number; turnsLeft: number; count: number };
  /** Great person points and how many of each type were born. */
  gpPoints: Record<string, number>;
  gpCount: Record<string, number>;
}

export interface TurnStats {
  turn: number;
  score: number;
  pop: number;
  military: number;
  production: number;
  gold: number;
  science: number;
  culture: number;
  land: number;
}

export interface GameEvent {
  turn: number;
  text: string;
  tile?: number;
  player?: number;
}

export type VictoryKind = 'domination' | 'science' | 'culture' | 'diplomatic' | 'time';

export interface Diplomacy {
  /** war[a][b] — symmetric. */
  war: boolean[][];
  /** Turn of the last war/peace change between a and b (peace can't be broken for rules.peaceTurns). */
  changed: number[][];
}

export interface Settings {
  seed: string;
  mapType: 'continents' | 'pangaea';
  mapSize: string;
  difficulty: string;
  pace: string;
  barbarians: boolean;
  ruins: boolean;
  /** All players are AI (headless simulations). */
  spectator: boolean;
  /** Which victories can be won. */
  victories: Record<VictoryKind, boolean>;
  /** Turn limit (default: the pace's). */
  maxTurns: number;
}

export interface GameState {
  version: 1;
  settings: Settings;
  rng: number;
  turn: number;
  map: { w: number; h: number; tiles: Tile[] };
  players: Player[];
  units: Record<string, Unit>;
  cities: Record<string, City>;
  nextId: number;
  diplomacy: Diplomacy;
  /** Turn each camp tile last spawned (camp tile index → turn). */
  camps: Record<string, number>;
  winner: { player: number; kind: VictoryKind } | null;
  /** Territory owners over time (run-length encoded), one entry per turn, for the replay. */
  replay: { turn: number; owners: string }[];
  /** Notable events (cities founded and taken, wars, wonders...) for the replay. */
  events: GameEvent[];
  /** World wonders built: wonder id → city id. */
  wonders: Record<string, number>;
  /** Bumped whenever a player's effects change (policies, wonders...), to refresh caches. */
  modGen: number;
  /** The human player id (0 normally; -1 in spectator games). */
  human: number;
}

export type Action =
  | { type: 'move'; unit: number; to: number }
  | { type: 'attack'; unit: number; to: number }
  | { type: 'found'; unit: number }
  | { type: 'build'; unit: number; job: string }
  | { type: 'order'; unit: number; order: UnitOrder | 'wake' | 'explore' }
  | { type: 'delete'; unit: number }
  | { type: 'pillage'; unit: number }
  | { type: 'promote'; unit: number; promotion: string }
  | { type: 'upgrade'; unit: number }
  | { type: 'produce'; city: number; item: QueueItem; append?: boolean }
  | { type: 'dequeue'; city: number; index: number }
  | { type: 'buy'; city: number; item: QueueItem }
  | { type: 'focus'; city: number; focus: CityFocus; avoidGrowth?: boolean }
  | { type: 'lockTile'; city: number; tile: number }
  | { type: 'buyTile'; city: number; tile: number }
  | { type: 'cityAttack'; city: number; to: number }
  | { type: 'research'; tech: string }
  | { type: 'capture'; city: number; choice: 'annex' | 'puppet' | 'raze' }
  | { type: 'annexPuppet'; city: number }
  | { type: 'adoptPolicy'; policy: string }
  | { type: 'specialist'; city: number; specialist: string; delta: 1 | -1 }
  | { type: 'greatPerson'; unit: number; use: 'discover' | 'hurry' | 'trade' | 'golden_age' | 'inspire' | 'concert' | 'improve' }
  | { type: 'declareWar'; target: number }
  | { type: 'makePeace'; target: number };

export interface ActionResult {
  ok: boolean;
  error?: string;
}
