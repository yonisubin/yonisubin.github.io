// zod schemas for every rules file in src/data. index.ts parses the JSON with these at
// startup, so a typo in a data file fails loudly instead of quietly breaking a rule.
import { z } from 'zod';

export const YIELD_KEYS = ['food', 'production', 'gold', 'science', 'culture'] as const;
export type YieldKey = (typeof YIELD_KEYS)[number];

export const Yields = z
  .object({
    food: z.number().optional(),
    production: z.number().optional(),
    gold: z.number().optional(),
    science: z.number().optional(),
    culture: z.number().optional(),
  })
  .strict();
export type YieldsData = z.infer<typeof Yields>;

const id = z.string().regex(/^[a-z][a-z0-9_]*$/);

export const Terrain = z
  .object({
    id,
    name: z.string(),
    yields: Yields,
    move: z.number(),
    defense: z.number(),
    water: z.boolean(),
    impassable: z.boolean().optional(),
    freshWater: z.boolean().optional(),
    color: z.string(),
  })
  .strict();

export const Feature = z
  .object({
    id,
    name: z.string(),
    /** Yields that replace the terrain's (forest on grassland = 1/1/0). */
    replace: Yields.optional(),
    /** Yields added to the terrain's (flood plains: +2 food on desert). */
    add: Yields.optional(),
    move: z.number(),
    defense: z.number(),
    blocksSight: z.boolean(),
    impassable: z.boolean().optional(),
    freshWater: z.boolean().optional(),
    /** Production sent to the nearest own city when a Worker clears it (0 = none). */
    chopProduction: z.number(),
    /** Tech needed to clear it with a Worker (absent = can't be cleared). */
    removeTech: z.string().optional(),
    color: z.string(),
  })
  .strict();

export const Resource = z
  .object({
    id,
    name: z.string(),
    kind: z.enum(['bonus', 'strategic', 'luxury']),
    yields: Yields,
    /** Tech that makes it visible (and usable). */
    revealTech: z.string().optional(),
    improvement: z.string(),
    /** Extra yields once improved with `improvement`. */
    improvedYields: Yields,
    terrains: z.array(z.string()),
    features: z.array(z.string()).default([]),
    /** Can sit on hills (`hillsOnly`: only on hills). */
    hills: z.boolean().default(false),
    hillsOnly: z.boolean().default(false),
    /** Strategic: copies per tile. */
    quantity: z.number().default(0),
    color: z.string(),
  })
  .strict();

export const Improvement = z
  .object({
    id,
    name: z.string(),
    yields: Yields,
    buildTurns: z.number(),
    tech: z.string().optional(),
    /** Base terrains it can go on ("any_land" for every land terrain). */
    terrains: z.array(z.string()),
    features: z.array(z.string()).default([]),
    /** Needs hills ("only") or never on hills ("never"). */
    hills: z.enum(['any', 'only', 'never']).default('any'),
    /** Only on a resource whose `improvement` is this one. */
    resourceOnly: z.boolean().default(false),
    /** Features it clears when built (farm on forest clears the forest). */
    clears: z.array(z.string()).default([]),
    /** Extra food when next to fresh water (river, lake, oasis). */
    freshWaterFood: z.number().default(0),
    /** Only on one of `features` (lumber mill: forest only). */
    needsFeature: z.boolean().default(false),
    color: z.string(),
  })
  .strict();

export const UnitClass = z.enum(['civilian', 'recon', 'melee', 'ranged', 'mounted', 'siege']);
export type UnitClassId = z.infer<typeof UnitClass>;

export const Unit = z
  .object({
    id,
    name: z.string(),
    class: UnitClass,
    cost: z.number(),
    strength: z.number(),
    ranged: z.number().default(0),
    range: z.number().default(0),
    moves: z.number(),
    sight: z.number().default(2),
    tech: z.string().optional(),
    obsoleteTech: z.string().optional(),
    upgradesTo: z.string().optional(),
    resource: z.string().optional(),
    canFound: z.boolean().default(false),
    canBuild: z.boolean().default(false),
    /** Per-cent combat bonuses: vs a unit class, 'city', or 'wounded'. */
    bonuses: z.array(z.object({ vs: z.string(), percent: z.number() }).strict()).default([]),
    ignoresTerrainCost: z.boolean().default(false),
    moveAfterAttack: z.boolean().default(false),
    /** Siege: firing costs a set-up move unless it hasn't moved this turn. */
    mustSetUp: z.boolean().default(false),
    /** Barbarians may field it (the best one their era allows). */
    barbarian: z.boolean().default(false),
    /** AI hint for what the unit is for. */
    role: z.enum(['settle', 'work', 'explore', 'defense', 'attack', 'ranged', 'siege', 'fast', 'spaceship']),
    /** Can only be built in a city with this building / after this project. */
    requiresBuilding: z.string().optional(),
    requiresProject: z.string().optional(),
    /** Spaceship part kind (booster, cockpit, stasis, engine): delivered to the capital. */
    spaceshipPart: z.string().optional(),
    /** Unique units: the faction that gets it, and which unit it replaces. */
    faction: z.string().optional(),
    replaces: z.string().optional(),
    glyph: z.string(),
  })
  .strict();

export const Building = z
  .object({
    id,
    name: z.string(),
    cost: z.number(),
    maintenance: z.number(),
    tech: z.string().optional(),
    yields: Yields.default({}),
    /** Per-cent bonus to the city's total of a yield. */
    percent: Yields.default({}),
    /** Extra science/culture per citizen (library: 0.5 science per citizen). */
    perPop: Yields.default({}),
    happiness: z.number().default(0),
    defense: z.number().default(0),
    hp: z.number().default(0),
    xp: z.number().default(0),
    /** Per-cent of the food bucket kept when the city grows. */
    growthKeep: z.number().default(0),
    /** Removes the extra unhappiness of an occupied (conquered, annexed) city. */
    endsOccupation: z.boolean().default(false),
    requires: z
      .object({
        river: z.boolean().optional(),
        mountain: z.boolean().optional(),
        building: z.string().optional(),
        /** Uses one copy of a strategic resource. */
        resource: z.string().optional(),
      })
      .strict()
      .default({}),
    /** Never in the build list (the Palace comes with the capital). */
    auto: z.boolean().default(false),
    faction: z.string().optional(),
    replaces: z.string().optional(),
    /** AI hint: what the building is for. */
    focus: z.enum(['growth', 'production', 'gold', 'science', 'culture', 'happiness', 'defense', 'military']),
  })
  .strict();

export const TileMod = z
  .object({
    improvement: z.string(),
    yield: z.enum(['food', 'production', 'gold', 'science', 'culture']),
    amount: z.number(),
    freshWaterOnly: z.boolean().optional(),
  })
  .strict();

export const Tech = z
  .object({
    id,
    name: z.string(),
    era: z.number().int(),
    cost: z.number(),
    prereqs: z.array(z.string()),
    tileMods: z.array(TileMod).default([]),
    /** Roads over rivers stop costing the whole move (bridges). */
    bridges: z.boolean().default(false),
    /** Can be researched again and again (Future Tech). */
    repeatable: z.boolean().default(false),
    /** Reveals the whole map when learned. */
    revealsMap: z.boolean().default(false),
  })
  .strict();

export const Promotion = z
  .object({
    id,
    name: z.string(),
    classes: z.array(UnitClass),
    requires: z.array(z.string()).default([]),
    /** Combat bonuses (attack and defence) in a setting. */
    combat: z
      .array(
        z
          .object({
            when: z.enum(['open', 'rough', 'vs_city', 'vs_ranged', 'vs_wounded', 'always']),
            percent: z.number(),
          })
          .strict(),
      )
      .default([]),
    moves: z.number().default(0),
    sight: z.number().default(0),
    range: z.number().default(0),
    /** Heals every turn, even after moving or attacking. */
    healAlways: z.boolean().default(false),
    /** Extra HP healed per turn by units next to it (and itself). */
    medic: z.number().default(0),
    description: z.string(),
  })
  .strict();

export const Effect = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('tile_yield'),
      where: z.enum(['river', 'hills', 'tundra_snow', 'desert', 'forest', 'coast']),
      yield: z.enum(['food', 'production', 'gold', 'science', 'culture']),
      amount: z.number(),
    })
    .strict(),
  z.object({ type: z.literal('city_percent'), yield: z.enum(['food', 'production', 'gold', 'science', 'culture']), percent: z.number() }).strict(),
  z.object({ type: z.literal('combat'), when: z.enum(['vs_city', 'rough', 'always']), percent: z.number() }).strict(),
  z.object({ type: z.literal('connection_gold'), amount: z.number() }).strict(),
  z.object({ type: z.literal('happiness'), amount: z.number() }).strict(),
]);
export type EffectData = z.infer<typeof Effect>;

export const Personality = z
  .object({
    aggression: z.number(),
    expansion: z.number(),
    wonders: z.number(),
    science: z.number(),
    culture: z.number(),
    gold: z.number(),
    religion: z.number(),
    diplomacy: z.number(),
    naval: z.number(),
    cityStateInterest: z.number(),
    loyalty: z.number(),
    forgiveness: z.number(),
    boldness: z.number(),
  })
  .strict();
export type PersonalityData = z.infer<typeof Personality>;

export const Faction = z
  .object({
    id,
    name: z.string(),
    adjective: z.string(),
    leader: z.object({ name: z.string(), title: z.string(), personality: Personality }).strict(),
    ability: z.object({ name: z.string(), description: z.string(), effects: z.array(Effect) }).strict(),
    startBias: z.array(z.string()),
    cityNames: z.array(z.string()).min(8),
    colors: z.object({ primary: z.string(), secondary: z.string() }).strict(),
    lines: z
      .object({ greeting: z.string(), war: z.string(), peace: z.string(), defeat: z.string() })
      .strict(),
  })
  .strict();

export const Difficulty = z
  .object({
    id,
    name: z.string(),
    /** Starting empire happiness for humans (AIs use aiHappiness). */
    humanHappiness: z.number(),
    aiHappiness: z.number(),
    /** Per-cent of normal unhappiness from cities and citizens, for humans. */
    humanUnhappinessPct: z.number(),
    /** Per-cent of normal research/production/growth cost. */
    humanCostPct: z.number(),
    aiCostPct: z.number(),
    aiExtraUnits: z.array(z.string()),
    /** Combat bonus for humans vs barbarians, AIs vs barbarians. */
    humanVsBarbarianPct: z.number(),
    aiVsBarbarianPct: z.number(),
    /** Final-score multiplier (Hall of Fame). */
    scoreMult: z.number(),
  })
  .strict();

export const Project = z
  .object({
    id,
    name: z.string(),
    cost: z.number(),
    tech: z.string().optional(),
    /** Each player can complete it once. */
    oncePerPlayer: z.boolean().default(false),
    /** A process never completes: it turns production into gold or science. */
    process: z.enum(['gold', 'science']).optional(),
    description: z.string(),
  })
  .strict();

export const Pace = z.object({ id, name: z.string(), costPct: z.number(), maxTurns: z.number(), yearsPerTurn: z.array(z.tuple([z.number(), z.number()])) }).strict();

export const MapSize = z
  .object({
    id,
    name: z.string(),
    width: z.number().int(),
    height: z.number().int(),
    civs: z.number().int(),
    cityStates: z.number().int(),
    /** Per-cent research cost added per city beyond the first. */
    techCostPerCityPct: z.number(),
    barbarianCamps: z.number().int(),
  })
  .strict();

export const Ruin = z
  .object({
    id,
    name: z.string(),
    kind: z.enum(['gold', 'tech', 'population', 'culture', 'map', 'unit', 'upgrade', 'camps']),
    amount: z.number().default(0),
    unit: z.string().optional(),
    weight: z.number(),
  })
  .strict();

export const Rules = z
  .object({
    moveScale: z.number().int(),
    roadMove: z.number(),
    hills: z.object({ yields: Yields, move: z.number(), defense: z.number(), sight: z.number() }).strict(),
    riverGold: z.number(),
    riverAttackPct: z.number(),
    cityTileMin: Yields,
    minCityDistance: z.number().int(),
    workRadius: z.number().int(),
    ownRadius: z.number().int(),
    foodPerCitizen: z.number(),
    growth: z.object({ base: z.number(), linear: z.number(), exponent: z.number() }).strict(),
    sciencePerCitizen: z.number(),
    unemployedProduction: z.number(),
    border: z.object({ base: z.number(), perTile: z.number(), exponent: z.number() }).strict(),
    tileBuy: z.object({ base: z.number(), perDistance: z.number(), perBought: z.number() }).strict(),
    buy: z.object({ multiplier: z.number(), exponent: z.number(), buildingPct: z.number() }).strict(),
    overflowCap: z.number(),
    connectionGold: z.object({ base: z.number(), perPop: z.number() }).strict(),
    unitUpkeep: z.object({ freeUnits: z.number(), freePerCity: z.number(), base: z.number(), perTurns: z.number() }).strict(),
    roadMaintenance: z.number(),
    happiness: z
      .object({
        perCity: z.number(),
        perCitizen: z.number(),
        occupiedPerCitizen: z.number(),
        puppetCityPct: z.number(),
        luxury: z.number(),
        unhappyGrowthPct: z.number(),
        veryUnhappy: z.number(),
        veryUnhappyCombatPct: z.number(),
        revolt: z.number(),
        revoltEveryTurns: z.number(),
      })
      .strict(),
    combat: z
      .object({
        baseDamage: z.number(),
        exponent: z.number(),
        randomPct: z.number(),
        hpWeight: z.number(),
        flankingPct: z.number(),
        fortifyPct: z.number(),
        fortifyTwoTurnsPct: z.number(),
        maxHp: z.number(),
        openTerrainPct: z.number(),
      })
      .strict(),
    city: z
      .object({
        baseStrength: z.number(),
        perPop: z.number(),
        capitalBonus: z.number(),
        hillsPct: z.number(),
        garrisonShare: z.number(),
        hp: z.number(),
        healPerTurn: z.number(),
        range: z.number(),
        resistanceTurnsPerPop: z.number(),
        razeVsAnnexDistance: z.number(),
        capturePopLossPct: z.number(),
      })
      .strict(),
    heal: z.object({ enemy: z.number(), neutral: z.number(), friendly: z.number(), city: z.number(), promotion: z.number() }).strict(),
    xp: z
      .object({
        attack: z.number(),
        defend: z.number(),
        rangedAttack: z.number(),
        vsBarbarianMax: z.number(),
        thresholds: z.array(z.number()),
      })
      .strict(),
    barbarians: z
      .object({
        spawnEveryTurns: z.number(),
        newCampChancePct: z.number(),
        campDistanceFromCity: z.number(),
        campReward: z.number(),
        campRewardPerEra: z.number(),
        maxUnitsPerCamp: z.number(),
        aggroRadius: z.number(),
        firstSpawnTurn: z.number(),
        /** No new camps once most players reach this era. */
        stopEra: z.number(),
      })
      .strict(),
    work: z.object({ roadTurns: z.number(), repairTurns: z.number(), removeTurns: z.record(z.string(), z.number()) }).strict(),
    upgradeGoldPerProduction: z.number(),
    ruinsPerLandTiles: z.number(),
    startUnits: z.array(z.string()),
    techPlayersMetDiscountPct: z.number(),
    score: z
      .object({
        perCity: z.number(),
        perCitizen: z.number(),
        perLandTile: z.number(),
        perTech: z.number(),
        perBuilding: z.number(),
        perWonder: z.number(),
        perPolicy: z.number(),
        perGreatWork: z.number(),
        perFutureTech: z.number(),
        perReligion: z.number(),
        spaceshipPart: z.number(),
      })
      .strict(),
    peaceTurns: z.number(),
    /** Spaceship parts needed for a science victory, by kind. */
    spaceship: z.record(z.string(), z.number()),
    /** Per-cent of production a process (Wealth/Research) converts. */
    processPct: z.number(),
    autosaveEveryTurns: z.number(),
  })
  .strict();
