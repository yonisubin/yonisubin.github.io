# CLAUDE.md — Hexborne (`civilization/`)

## Project

**Hexborne** is a hex-based, turn-based 4X strategy game in the browser, the second game in this repo. It's served at `https://yonisubin.github.io/civilization/` (the URL path is just the folder name; the game's name on screen is Hexborne, never "Civilization"). The open-world city game at the site root is a separate project (root `CLAUDE.md`); never import between `src/` and `civilization/src/`.

The rules follow the design spec below (the user's spec, kept verbatim). Its originality rules apply: original title, art (everything is drawn in code), factions, leaders, city names and text; generic tech/unit/building names are fine.

## Stack and commands

TypeScript (strict) + Vite, **PixiJS 8** (map rendering), **zod 4** (validates `src/data/*.json` at load), **Zustand 5** (UI store). Dependencies live in the root `package.json` (shared `node_modules`); ask before adding more. Run from the repo root:

```bash
npm run dev:civ        # http://localhost:5174/civilization/
npm run typecheck:civ
npm run build:civ      # → civilization/dist (deployed to /civilization/ by its own CI job)
npm run test:civ       # headless checks in civilization/tests (needs build:civ + Playwright)
npm run server:civ     # online relay on :8787 (also serves civilization/dist)
```

Before considering a task done: `npm run typecheck:civ`, `npm run build:civ` and `npm run test:civ` pass, and the main game's `npm run build` still passes.

## Structure

```
civilization/src/
  data/        # all rules data as JSON + schema.ts (zod) + index.ts (validated, indexed access)
  core/        # pure simulation: state.ts (GameState), hex.ts, rng.ts, game.ts (applyAction / endTurn)
    systems/   # one file per system (yields, cities, research, units, movement, combat, ...)
  mapgen/      # world generation (continents, pangaea)
  ai/          # AI players + barbarians; worker.ts runs end-of-turn off the main thread
  render/      # PixiJS map view (terrain, fog, units, cities, overlays, camera)
  ui/          # DOM panels driven by a Zustand store (top bar, unit/city panels, tech tree, ...)
  save/        # IndexedDB saves (db "hexborne")
  net/         # online play (session.ts: lobby, action relay, turn modes)
  main.ts      # wiring; exposes window.hexborne for tests
civilization/server/ # server.mjs: the online relay (Node built-ins only)
civilization/tests/  # Playwright checks through window.hexborne
```

## Architecture rules

- **Core is pure and deterministic.** `core/` and `mapgen/` never touch the DOM, Pixi or `Math.random`; all randomness comes from the seeded RNG stored in `GameState`. Same seed + same actions → same game.
- **State is plain JSON.** `GameState` holds only plain objects/arrays/numbers/strings, so saving is `JSON.stringify` and the AI worker gets a copy via `postMessage`.
- **Actions in place.** `applyAction(state, action)` validates, then *mutates* `state` and returns `{ ok, error? }` (cloning thousands of tiles per action would make the AI too slow). The UI and the AI change the game only through actions and `endTurn`.
- **Numbers live in data.** Every tunable number is in `src/data/*.json` (`rules.json` for formulas), never hard-coded in systems.
- **Storage.** Saves use IndexedDB database `hexborne`; any `localStorage` key starts with `civ:` (the site root's game shares the origin).
- **Assets** go in `civilization/public/` and are referenced through `import.meta.env.BASE_URL`.

## Status

Phases 1–6 of the plan at the end of the spec are built: map + generator (Continents, Pangaea) + fog + camera + tooltips; units, A*, ZOC, 1UPT, Settlers, Workers; cities (growth, queue, buildings, borders, gold, buying); research + tech tree, happiness + luxuries; combat, promotions, barbarians, ruins; AI, end-turn loop (AI in a Web Worker), save/load. Phase 7: 80 techs (Ancient → Information, repeatable Future Tech), late-era units, buildings and strategic resources (coal, oil, aluminum, uranium), projects (Apollo Program) and processes (Wealth, Research), spaceship parts carried to the capital and the science victory, victory toggles and turn limit, per-turn statistics, a territory replay, the end-of-game screen (summary, graphs, replay) and the Hall of Fame (localStorage `civ:hallOfFame`).

Phase 8: one effects system (`core/systems/effects.ts`: every bonus from abilities, policies, wonders — later beliefs and tenets — is an Effect record, documented in `data/schema.ts`); 9 original policy trees (`data/policies.json`); golden ages; specialists (slots in buildings) and 7 kinds of great people with their actions and special tiles (Academy, Manufactory, Customs House, Landmark, Citadel); 39 world wonders and 5 national wonders (`wonder` field in `data/buildings.json`).

Phase 9: diplomacy (`core/systems/diplomacy.ts`: embassies, open borders, defensive pacts, research agreements, friendship, denouncing, trade deals valued by the AI in gold, warmongering, and the opinion model behind each AI's mood), AI diplomacy (`ai/diplomacy.ts`), the leader / trade / proposal screens (`ui/diplomacy.ts`), and 24 original city-states (`data/cityStates.json`, `core/systems/citystates.ts`: influence, friend/ally bonuses, allies' resources and wars, quests, gifts, pledges, bullying; their AI in `ai/minor.ts`).

Phase 10: domains (`core/systems/domain.ts`: ships on water — some only on the coast — land units embarking after Optics/Astronomy, aircraft in cities and on carriers), naval units, work boats and fishing boats, harbors and lighthouses, Great Admirals; aircraft, interception and nuclear weapons (`core/systems/air.ts`, the Nuclear Program world project); trade routes with caravans and cargo ships (`core/systems/trade.ts`); faith and religion (`core/systems/religion.ts`, `data/beliefs.json`: pantheons, founding/enhancing/reforming, follower beliefs, pressure, missionaries, inquisitors, theological combat, buying with faith). AI for all of it in `ai/phase10.ts`.

Phase 11: great works in building/wonder slots with theming bonuses, tourism and influence levels and the culture victory (`core/systems/culture.ts`), three original ideologies with tiered tenets, public opinion, switching and anarchy (`core/systems/ideology.ts`, `data/ideologies.json`), and archaeology (`core/systems/archaeology.ts`: antiquity sites from battles, ruins, camps and razed cities; Archaeologists dig artifacts or Landmarks). The Culture panel (`ui/culture.ts`) shows influence, great works and ideology.

Phase 12: the World Congress / United Nations (`core/systems/congress.ts`, `data/resolutions.json`: delegates, sessions, proposals, voting, resolutions in force, the World Fair, the World Leader vote and the diplomatic victory) and espionage (`core/systems/espionage.ts`: spies by era, stealing technology, diplomats, rigging elections, coups, counter-intelligence). AI in `ai/congress.ts`; screens in `ui/congress.ts`.

Phase 13: 16 map types (`mapgen/generate.ts` scripts + `mapgen/earth.ts` outlines) and every advanced setup option (`core/options.ts` defaults): world age, temperature, rainfall, sea level, resources (sparse … legendary start, strategic balance), civilization and city-state counts, starting era, victory toggles, turn limit, raging barbarians, no razing, One-City Challenge, complete kills, policy/promotion saving, start bias off, always war/peace, turn timer, quick combat/movement, advisor hints.

Phase 14 (hotseat): several humans on one device (`humans` in `NewGameOptions`; setup screen "Hotseat"). `s.human` is the seat whose turn it is; ending a seat's turn passes to the next (`nextSeat`, core/game.ts) behind a cover screen (`ui().passTo`), and after the last seat the AI moves. Human↔human proposals (deals, friendship, peace) wait for the other seat's answer.

Phase 14 (online): `server/server.mjs` is a dependency-free WebSocket relay (rooms by code; also serves `dist/` at /civilization/), `npm run server:civ`. `src/net/session.ts`: lobby (seats, civilization pick, ready, chat), the host's browser is authoritative — guests send actions, the host validates and broadcasts them in order, everyone applies them (a digest after each catches drift → full resync), and at the end of a turn the host runs the AI and sends the new state. Turn modes `settings.turnMode`: sequential, simultaneous, hybrid. Dropped players rejoin by name.

Extension points for later phases: `EFFECT_SOURCES`, `TILE_HOOKS`, `CITY_HOOKS`, `HAPPINESS_HOOKS`, `GOLD_HOOKS`, `COMBAT_HOOKS`, `GP_USE_HOOKS`/`GP_DO_HOOKS`, `EFFECT_TEXT`, and `VICTORY_CHECKS` (core/game.ts), `SCORE_HOOKS` (core/systems/economy.ts), `MIGRATIONS` (core/migrate.ts, fills new fields in old saves), `VICTORY_ROWS` (ui/hud.ts).

Deliberate simplifications so far (say so before changing them):
- At peace, a major civilization's land is closed unless it gave you open borders; city-states' land is always open.
- Puppets pick their own buildings.
- Barbarians sack cities (steal gold) instead of capturing them.
- `applyAction` mutates the state in place instead of returning a new one (see Architecture rules).

---

# Design spec

This spec describes the rules and systems of a hex-based, turn-based 4X strategy game modeled on Civilization V with both expansions (Gods & Kings, Brave New World), written so Claude Code can build a playable clone. Numbers are approximate, recalled from the game rather than looked up; treat them as starting values and keep every one in data files so you can tune them.

**Originality ground rules (important).** Game rules and mechanics can be reimplemented, but the game's creative assets cannot be copied. Tell Claude Code to:

- Use an original title, logo and branding. Do not use the name "Civilization" or Firaxis/2K marks.
- Create original art, unit models, icons, leader portraits, music and sound.
- Write original encyclopedia ("Civilopedia") entries, tech/wonder quotes, leader dialogue and flavor text.
- Design original faction abilities and unique units rather than copying the shipped civilizations' named abilities. Historical people, places and generic tech names (Pottery, Iron Working) are fine to use.

**Suggested prompt to Claude Code:** "Build the game described in this spec as a browser game in TypeScript. Follow the phased plan in the last section. Keep all rules data in JSON. Ask me before deviating from the spec."

## Game overview and core loop

The player leads one faction from 4000 BC to the near future on a hex map, competing with AI or human rivals and independent city-states. The game is turn-based: each turn every player moves units, sets city production, picks research and makes diplomatic choices, then presses End Turn.

Core loop per turn:

1. Collect yields from every worked tile and building: food, production, gold, science, culture, faith, tourism, and global happiness.
2. Apply yields: cities grow, finish builds, borders expand; research advances; culture buys social policies; faith buys religious options.
3. Player acts: move/attack with units, change production, buy items, trade, conduct diplomacy.
4. AI players act (sequential), or all players act at once (simultaneous mode).
5. Resolve end-of-turn events: barbarian spawns, city-state quests, World Congress sessions, golden ages, notifications.

The game ends when one player meets a victory condition or the turn limit is reached (time victory by score).

**Eras:** Ancient, Classical, Medieval, Renaissance, Industrial, Modern, Atomic, Information. A player's era is the latest era of any tech they own; era changes affect unit art, city art, some costs and World Congress unlocks.

## Game setup options

The setup screen offers a quick "Play Now" with defaults and an Advanced Setup with every option below.

**Basic options**

- Faction/leader: pick one or Random.
- Map type: Continents, Pangaea, Archipelago, Fractal, Small Continents, Terra (all players start on one landmass; the rest is unexplored), Inland Sea, Lakes, Highlands, Ice Age, Tilted Axis, Great Plains, Oval, North vs South, Skirmish, plus real-world Earth maps. Random picks one.
- Map size, difficulty, game pace (tables below).

| Map size | Grid (W×H hexes) | Default civs | Default city-states |
| --- | --- | --- | --- |
| Duel | 40×24 | 2 | 4 |
| Tiny | 56×36 | 4 | 8 |
| Small | 66×42 | 6 | 12 |
| Standard | 80×52 | 8 | 16 |
| Large | 104×64 | 10 | 20 |
| Huge | 128×80 | 12 | 24 |

| Difficulty | Effect on human player vs AI |
| --- | --- |
| Settler | Large human bonuses (extra happiness, cheap costs), AI penalized |
| Chieftain | Human bonuses, smaller |
| Warlord | Small human bonuses |
| Prince | Neutral baseline: no bonuses either side |
| King | AI gets modest bonuses |
| Emperor | AI gets more bonuses and an extra starting unit |
| Immortal | AI gets large bonuses and extra starting units |
| Deity | AI gets the largest bonuses: extra settlers, workers, cheaper costs, free techs |

Difficulty modifiers to model as data: unhappiness per city and per citizen, research/production/growth cost percent for AI, free starting units, barbarian strength bonus vs human, AI combat bonus vs barbarians.

| Game pace | Cost multiplier (research, build, growth, policies) | Approx. max turns |
| --- | --- | --- |
| Quick | 67% | 330 |
| Standard | 100% | 500 |
| Epic | 150% | 750 |
| Marathon | 300% | 1500 |

Pace also scales the turn-to-date calendar (e.g. early turns span 40 years on Standard).

**Map options (Advanced)**

- World age: 3, 4 or 5 billion years (more or fewer hills/mountains).
- Temperature: cool, temperate, hot (more tundra/snow vs desert/jungle).
- Rainfall: arid, normal, wet (forest/jungle/marsh density).
- Sea level: low, medium, high.
- Resources: sparse, standard, abundant, legendary start, strategic balance (each start gets horses, iron, etc.).
- Number of civilizations and city-states (sliders, default from map size).
- Starting era: Ancient through Information (gives the techs, policies-free and extra starting units of that era).

**Game options (Advanced checkboxes)**

- Victory types on/off: Time, Science, Domination, Cultural, Diplomatic.
- Max turns (custom value).
- No barbarians; Raging barbarians (more and earlier).
- No ancient ruins; No city razing; One-City Challenge (human cannot found more cities).
- Complete kills (a player is eliminated only when all units and cities are gone).
- Policy saving and Promotion saving (bank them for later).
- Disable start bias (factions normally prefer coast/river/terrain matching their ability).
- New random seed; Quick combat (skip animations); Quick movement.
- Always war (AI permanently at war with you); Always peace; Lock mods.
- Enable Turn Timer (multiplayer and single).
- Tutorial level and advisor popups.

**Multiplayer modes**

- Hotseat (several humans on one device, passing turns).
- LAN and Internet (host/join lobby, chat, ready-up, player slots: Human, AI, Closed).
- Turn modes: Simultaneous (all move at once), Sequential, Hybrid (simultaneous in peace, sequential when two players are at war).
- Turn timer options and "pitboss-style" long games (optional).
- Scenarios: preset maps with special rules (optional, build last).

**Save/load:** quick save/load, autosaves every N turns, named saves, replay viewer at game end, and a Hall of Fame of past results.

## Map, terrain, features, resources, improvements

The world is a hex grid that wraps east–west (cylinder) with impassable poles. Each tile has one base terrain, at most one feature, at most one resource, at most one improvement, optional river edges, an owner, and a fog-of-war state per player (unexplored, explored-but-not-visible, visible).

**Base terrain** (food/production/gold; move cost; defense modifier):

| Terrain | Yield F/P/G | Move | Defense | Notes |
| --- | --- | --- | --- | --- |
| Grassland | 2/0/0 | 1 | 0 |  |
| Plains | 1/1/0 | 1 | 0 |  |
| Desert | 0/0/0 | 1 | 0 | Flood plains add +2 food |
| Tundra | 1/0/0 | 1 | 0 |  |
| Snow | 0/0/0 | 1 | 0 |  |
| Coast | 1/0/1 | 1 (naval) | 0 | Shallow water; early boats only here |
| Ocean | 1/0/1 | 1 (naval) | 0 | Needs Astronomy-era ships to enter safely |
| Lake | 2/0/1 | 1 (naval) | 0 | Gives fresh water |
| Hills (overlay) | 0/2/0 | 2 | +25% | Sight bonus; cities on hills defend better |
| Mountain | 0/0/0 | impassable | — | Blocks sight; some buildings need adjacency |

**Features:** Forest (1F/1P, move 2, +25% defense, blocks sight), Jungle (1F, move 2, +25%; trading posts on jungle get bonus science later), Marsh (−1F, move 2, −15%), Flood plains (+2F on desert), Oasis (3F/1G, fresh water), Ice (impassable), Atoll (1F/1P on coast), Fallout (−3 yields after nukes, must be cleaned). Workers can chop forest/jungle/marsh, which gives a one-time production burst to the nearest city when cut.

**Rivers** run along hex edges. They give +1 gold to adjacent tiles, provide fresh water (farms bonus, garden/watermill), make crossing cost all remaining movement unless a road bridge exists (after Engineering), and give attackers a −20% penalty when attacking across them.

**Natural wonders:** about 15–20 unique special tiles, each impassable or special, with big yields (e.g. +2 culture/+3 science) and a one-time happiness bonus to the first player to discover each. Design original ones.

**Resources:**

- Bonus (visible from start, add yield): wheat, cattle, sheep, deer, bananas, fish, stone.
- Strategic (revealed by tech, give quantity per tile, consumed by units/buildings): horses (Animal Husbandry), iron (Bronze Working), coal (Industrialization), oil (Biology), aluminum (Electricity), uranium (Atomic Theory). Each unit using one reserves 1 unit; a shortfall gives combat penalties.
- Luxury (each distinct type gives +4 global happiness once; extra copies tradeable): roughly 20+ types (silk, spices, dyes, wine, incense, gold, silver, gems, pearls, ivory, furs, sugar, cotton, citrus, cocoa, copper, crab, truffles, salt, whales, marble), plus a few that only city-states or certain wonders provide.

**Improvements** (built by Workers over several turns; can be pillaged by enemies for gold/heal and repaired):

| Improvement | Where | Base effect |
| --- | --- | --- |
| Farm | flat land | +1 food (more with fresh water and later techs) |
| Mine | hills, ore resources | +1 production |
| Pasture | horses, cattle, sheep | connects resource, +1 yield |
| Plantation | luxuries like silk, sugar | connects resource, +1 gold or food |
| Camp | deer, ivory, furs | connects resource |
| Quarry | stone, marble | +1 production |
| Fishing boats | sea resources (built by Work Boat, consumed) | connects resource |
| Offshore platform | oil at sea | connects resource |
| Oil well | oil on land | connects resource |
| Lumber mill | forest, after Construction | +1 production |
| Trading post | most land (later called village) | +1 gold, grows with roads |
| Fort / Citadel | any land | defense bonus; Citadel also damages adjacent enemies and steals tiles |
| Road / Railroad | any land | movement 1/3 per tile on road, 1/10 on railroad; city connection gives gold and production |
| Great-person tiles | Academy, Manufactory, Customs House, Holy Site, Landmark | large yields |

Tile yields also rise from techs, policies, buildings, religion beliefs and golden ages; implement yield as a stack of modifiers computed per tile.

## Cities

Cities are the engine of the game: they work tiles, build units/buildings/wonders, and generate every yield.

**Founding.** A Settler founds a city on its tile (not within 3 tiles of another city). The first city is the capital (gets the Palace: +3 production, +3 science, +3 gold, +1 culture, defense). The city gets the 7 tiles of radius 1 as its starting territory. City tile always gives at least 2F/1P/1G plus its terrain.

**Population and growth.** Each citizen works one tile within 3 rings of the city (owned by the city) or fills a specialist slot. Each citizen eats 2 food. Surplus food fills a growth bucket; food needed for the next citizen at size n ≈ floor(15 + 6(n−1) + (n−1)^1.8), times the pace multiplier. Starvation shrinks the city. Some buildings keep a share of food after growth (Aqueduct keeps 40%).

**Citizen management.** Default auto-assignment uses a focus setting: Default, Food, Production, Gold, Science, Culture, Great People, Faith, plus an "Avoid growth" toggle. The player can lock tiles manually or assign specialists.

**Specialists:** Scientist, Engineer, Merchant, Artist, Writer, Musician. Each gives a yield (e.g. +3 science) and great-person points. Unemployed citizens default to 1 production. Each specialist costs 2 food like any citizen.

**Borders.** Culture accumulates per city; when it reaches the threshold the city claims one new adjacent tile (cost grows with each claim). Tiles can also be bought with gold (cost rises with distance and number already bought). Max city radius 3 for working, up to 5 for ownership.

**Production.** Each city builds one item at a time from a queue: units, buildings, wonders, projects, or processes (convert production to gold or science). Overflow carries to the next item. Items can be bought outright with gold (units/buildings) or faith (religious units, some buildings and late-game great people). Wonders cannot be bought.

**Buildings** (one of each per city; most have gold maintenance). Key chain:

| Category | Buildings (in rough order) |
| --- | --- |
| Food/growth | Granary, Water Mill, Aqueduct, Hospital, Medical Lab, Harbor, Lighthouse |
| Production | Workshop, Forge, Windmill, Factory (needs coal), Power plants (Hydro, Nuclear, Solar), Seaport, Stable, Circus |
| Gold | Market, Bank, Stock Exchange, Caravansary, Mint |
| Science | Library, University, Public School, Research Lab, Observatory |
| Culture/tourism | Monument, Amphitheater, Opera House, Museum, Broadcast Tower (with great-work slots) |
| Faith | Shrine, Temple, religious buildings bought with faith |
| Happiness | Colosseum, Zoo, Stadium, Circus |
| Defense | Walls, Castle, Arsenal, Military Base (raise city strength and HP) |
| Military | Barracks, Armory, Military Academy, Stable, Heroic Epic (XP for new units) |
| National wonders | One per empire, require a building in every city (e.g. a national library-type wonder), cost scales with city count |

Requirements to model: tech prerequisite, terrain/adjacency (river, coast, mountain), resource, other building, and city count for national wonders.

**City defense.** Every city has combat strength (based on population, terrain, walls) and 200+ HP, regenerates each turn, and can fire one ranged attack per turn at range 2. A city at 0 HP can be captured by a melee unit. Cities never die from combat alone.

**Capture options.** On capture: Annex (full control; needs a Courthouse to remove extra unhappiness), Puppet (AI-controlled, no input, lower costs, can annex later), Raze (city burns down 1 pop per turn; original capitals cannot be razed), or Liberate (return to original owner for diplomatic credit). Captured cities enter Resistance for some turns (no production). Occupied cities produce extra unhappiness.

**Connections.** A city linked to the capital by road, railroad or harbor counts as connected: gives gold and enables a production bonus with railroads.

## Happiness and golden ages

Happiness is one empire-wide number: total happiness minus total unhappiness. It is the main brake on expansion.

**Sources of unhappiness:** about 3 per city (scaled by map size and difficulty), 1 per citizen, extra per citizen in annexed/occupied cities, ideology pressure from more influential foreign ideologies, and some puppet/religious effects. Policies and buildings can reduce per-city or per-citizen unhappiness.

**Sources of happiness:** starting base (about 9 on Prince), +4 per distinct luxury resource connected (+bonuses from some policies), happiness buildings, wonders, natural wonder discovery, policies, religious beliefs, city-state alliances (Mercantile), and difficulty bonus.

**Thresholds:**

| Empire happiness | Effect |
| --- | --- |
| 0 or more | Normal |
| −1 to −9 (Unhappy) | City growth −75% |
| −10 to −19 (Very unhappy) | No growth, cannot build Settlers, combat strength penalty |
| −20 or lower | Rebel units spawn and cities may defect to a civ whose ideology the public prefers |

**Golden ages.** Positive happiness accumulates each turn into a golden-age meter; when it fills, a golden age starts (about 10 turns, shorter or longer with modifiers). Each subsequent threshold grows. Great Artists can also trigger one instantly. During a golden age: +1 production on tiles already producing at least one, +1 gold on tiles producing gold, +20% culture, and +tourism bonus with certain policies or ideologies.

**We-Love-the-King Day.** A city periodically requests a specific luxury; supplying it gives +25% growth for 20 turns.

## Science and tech tree

Science comes mainly from population (about 1 per citizen), buildings, specialists, policies, trade routes and great scientists. It flows into one tech at a time; the player can queue a path and the game auto-picks prerequisites. Overflow carries over.

**Tree structure.** About 80 techs in a directed acyclic graph, laid out left to right by era. Each tech has 1–3 prerequisites and unlocks units, buildings, wonders, improvements, resource visibility, abilities (embarkation, ocean travel, river bridges) and sometimes a free bonus.

**Cost scaling.** Base cost rises by era. Each city beyond the first raises tech cost by about 5% (map-size adjusted), discouraging wide empires. Techs already known by players you have met get a small discount.

**Suggested tech list by era** (generic names; adjust freely):

| Era | Techs |
| --- | --- |
| Ancient | Agriculture, Pottery, Animal Husbandry, Archery, Mining, Sailing, Calendar, Writing, Trapping, The Wheel, Masonry, Bronze Working |
| Classical | Optics, Horseback Riding, Mathematics, Construction, Philosophy, Drama and Poetry, Currency, Engineering, Iron Working |
| Medieval | Theology, Civil Service, Guilds, Metal Casting, Compass, Education, Chivalry, Machinery, Physics, Steel |
| Renaissance | Astronomy, Acoustics, Banking, Printing Press, Gunpowder, Navigation, Architecture, Economics, Metallurgy, Chemistry |
| Industrial | Archaeology, Scientific Theory, Industrialization, Rifling, Military Science, Fertilizer, Biology, Electricity, Steam Power, Dynamite |
| Modern | Refrigeration, Radio, Replaceable Parts, Flight, Railroad, Plastics, Electronics, Ballistics, Combustion |
| Atomic | Penicillin, Atomic Theory, Radar, Combined Arms, Ecology, Nuclear Fission, Rocketry, Computers |
| Information | Telecommunications, Mobile Tactics, Advanced Ballistics, Satellites, Robotics, Lasers, Globalization, Particle Physics, Nuclear Fusion, Nanotechnology, Stealth, Future Tech (repeatable, adds score) |

**Key unlock milestones to wire up:** Pottery → Granary and Shrine; Bronze Working → Spearman and reveals iron; Iron Working → swordsmen; Optics → embarkation; Astronomy → ocean entry; Scientific Theory → Public School; Industrialization → Factory and reveals coal; Biology → oil; Electricity → aluminum; Atomic Theory → uranium; Rocketry → Apollo Program; Ecology/Satellites → reveal map.

**Research agreements** between two players cost gold and give each a tech boost after 20+ turns of peace. **Tech stealing** happens through spies and capturing cities.

## Culture, social policies, ideologies

Culture comes from buildings, wonders, great works, policies and some tiles. Accumulated empire culture buys social policies; city culture separately grows borders.

**Policy cost.** Cost of the next policy rises with the number already adopted and by about 10% per city beyond the first (map-size adjusted). When enough culture accumulates, the player picks one policy (or saves it if Policy Saving is on).

**Policy trees.** Nine trees, each with an opener (adopting it unlocks the tree and gives a bonus), five policies with internal prerequisites, and a finisher bonus when all five are taken. Some trees are unlocked by era and some exclude each other.

| Tree | Era unlocked | Theme |
| --- | --- | --- |
| Tradition | Ancient | Tall play: capital growth, border growth, free buildings in first cities |
| Liberty | Ancient | Wide play: free settler/worker, cheap settlers, golden age, free great person |
| Honor | Ancient | Military: bonus vs barbarians, XP, culture from kills, cheaper unit upkeep |
| Piety | Classical | Faith and religion; excludes Rationalism |
| Patronage | Medieval | City-state influence and gifts |
| Aesthetics | Medieval | Great artists/writers/musicians, culture |
| Commerce | Medieval | Gold, capital boost, naval/merchant bonus |
| Exploration | Medieval | Navy, coastal cities, hidden archaeology sites |
| Rationalism | Renaissance | Science; excludes Piety |

Completing trees also unlocks the right to buy specific late great people with faith. Pre-expansion rules used "complete five trees, then build a utopia-style project" as the culture victory; the expansion rules replaced this with tourism (see Victory). Pick one and make the other optional.

**Ideologies.** Unlocked when a player enters the Industrial era or builds 3 factories (first players to unlock get a free tenet). Three ideologies:

- Freedom: culture, tourism, specialists, democracy-style bonuses.
- Order: production, cities, happiness from buildings, communist-style planning.
- Autocracy: military, conquest, fascist-style unit and fear bonuses.

Each ideology has three tiers of tenets (about 7, 4 and 3). You need two tier-1 tenets before a tier-2 slot, and two tier-2 before a tier-3. Each policy pick may go to a tenet instead of a classic tree.

**Public opinion.** Other civs with greater tourism influence and a different ideology add unhappiness to your empire. Opinion states: Content, Dissidents, Civil Resistance, Revolutionary Wave. Under heavy pressure the player can switch ideology (losing tenets and suffering anarchy turns).

## Religion and faith

Faith is a separate currency from shrines, temples, holy sites, natural wonders, some city-states and beliefs. It buys religious progress and, later, great people and special buildings.

**Progression:**

1. **Pantheon.** When faith reaches a threshold (about 10 on Standard, rising for each later pantheon), pick one pantheon belief. Each belief can be held by only one player. Pantheon beliefs give small tile/yield bonuses (e.g. +1 faith from desert tiles, +1 culture from pastures).
2. **Founding.** A Great Prophet (earned via faith thresholds) uses a Holy Site-capable city to found a religion. The world has a limited number of religions (roughly half the player count + 1, max 7). The founder picks one Founder belief and one Follower belief, and names the religion (custom name and icon).
3. **Enhancing.** A second Great Prophet enhances it: add one more Follower belief and one Enhancer belief. Enhancement unlocks buying religious units with faith in any city.
4. **Reformation.** Completing the Piety tree adds one Reformation belief.

**Belief categories:** Pantheon, Founder (benefits only the founder, often scaled by number of follower cities), Follower (benefits every city following the religion), Enhancer (affects spread), Reformation. Plan about 15 pantheon, 10 founder, 15 follower, 10 enhancer, 8 reformation beliefs; give them original names.

**Spread.** Each city has a follower count per religion; the majority religion decides which follower beliefs apply. Holy cities and cities following a religion exert passive pressure on cities within \~10 tiles each turn (more with trade routes). Pressure converts citizens over time.

**Religious units** (bought with faith):

| Unit | Use |
| --- | --- |
| Missionary | Spread religion to a city (2 charges), loses strength in foreign territory |
| Inquisitor | Remove other religions from your city; defend against missionaries when stationed in a city |
| Great Prophet | Found/enhance, spread strongly (4 charges), or build a Holy Site |

Religious units can engage in theological combat with rival religious units in adjacent tiles, reducing their strength. Religion can be disabled for a simplified mode.

## Units, movement, combat, promotions

**Stacking rule (1UPT).** At most one military unit and one civilian unit per tile. Units can swap places with friendly units. This rule is the heart of the tactical game.

**Unit stats:** combat strength (melee), ranged strength and range (ranged units), movement points, sight (usually 2), HP (always 100 for units), cost, upkeep, resource requirement, unit class, upgrade path, obsolete tech, promotions.

**Unit classes:**

| Class | Examples by era | Notes |
| --- | --- | --- |
| Civilian | Settler, Worker, Work Boat, Caravan, Cargo Ship, Archaeologist, great people, religious units | Captured (not killed) if attacked alone |
| Recon | Scout → Explorer → Paratrooper | Ignore terrain costs, find ruins |
| Melee infantry | Warrior → Spearman → Pikeman → Musketman → Rifleman → Infantry → Mechanized Infantry | Can capture cities |
| Anti-cavalry | Spearman, Pikeman, Lancer, Anti-Tank Gun | Bonus vs mounted |
| Ranged | Archer → Composite Bowman → Crossbowman → Gatling Gun → Machine Gun → Bazooka | Attack without counterattack damage |
| Mounted / armor | Horseman → Knight → Cavalry → Landship → Tank → Modern Armor; Chariot Archer | Can move after attacking, penalty vs cities |
| Siege | Catapult → Trebuchet → Cannon → Artillery → Rocket Artillery | Must set up (1 move) before firing, bonus vs cities |
| Naval melee | Trireme → Caravel → Ironclad → Destroyer | Can capture coastal cities |
| Naval ranged | Galleass → Frigate → Battleship; Submarine; Carrier | Subs invisible unless adjacent |
| Air | Fighter → Jet Fighter; Bomber → Stealth Bomber; Guided Missile; Atomic Bomb; Nuclear Missile | Based in cities/carriers, strike within range, intercept |
| Late special | A giant robot superunit requiring uranium (design your own) |  |

**Movement.** Each tile costs 1 move; forest/jungle/hills/marsh cost 2; rivers stop movement unless bridged; roads reduce cost. A unit can always enter a tile if it has any movement left (even if cost exceeds remaining). Zone of Control: entering a tile adjacent to an enemy from another adjacent tile ends movement. **Embarkation:** land units can enter water after a tech, becoming weak transport units (defense only, move 2 to 4+ by era). Disembarking costs all movement.

**Combat (melee).** Attacker and defender compute modified strength S (base × (1 + sum of percent modifiers)). Use this tunable approximation of the original curve: ratio r = S\_att / S\_def; damage to defender = round(30 × r^0.8 ± random 0–20%), damage to attacker = round(30 / r^0.8 ± random). Units lose strength proportionally as HP falls (strength × (0.5 + 0.5 × HP/100)). If the defender dies, the melee attacker moves into the tile. Show a combat preview before attacking.

**Ranged combat.** Ranged attacker deals damage with the same formula using its ranged strength vs defender's strength and takes no damage back. Ranged attacks need line of sight (hills and forest block).

**Modifiers to implement:** terrain defense (hills/forest/jungle +25%, marsh/open −something), river crossing −20%, flanking +10% per adjacent friendly unit, fortify +25% (+50% after 2 turns), great general aura +15%, unhappiness penalty, missing resource penalty, attacking a city with mounted −, siege vs cities +, amphibious attack penalty, difficulty bonus vs barbarians.

**Healing per turn:** 10 HP in enemy territory, 15 neutral, 20 friendly, 25 in a city; units that move or attack do not heal (unless promoted).

**Experience and promotions.** Units earn XP from combat (about 5 for attacking, 4 for defending, less vs barbarians, capped vs barbarians). Thresholds 10, 30, 60, 100, 150... Each promotion chosen from a tree per class (Shock/Drill/Accuracy/Barrage/Cover/March/Blitz/Logistics/Medic/Amphibious/Range/Sentry etc.). A promotion can instead heal 50 HP. Buildings like Barracks give starting XP.

**Upgrades.** Obsolete units can upgrade in friendly territory for gold (cost proportional to production difference), keeping XP and promotions.

**Supply and upkeep.** Gold upkeep per unit grows over time; a supply limit (based on cities and population) imposes production penalties when exceeded.

**Nuclear weapons.** Atomic Bomb and Nuclear Missile destroy units in a radius, damage cities (halve population), create fallout, and trigger diplomatic penalties. The World Congress can ban them.

## Great people, great works, wonders

**Great people.** Each city earns great-person points from specialists, some buildings and wonders. Each type has its own empire-wide meter; when full, a great person appears in the city that pushed it over, and the next threshold rises.

| Great person | Source of points | Uses |
| --- | --- | --- |
| Scientist | Scientist specialists | Instant science lump, or build an Academy tile |
| Engineer | Engineer specialists | Hurry production (incl. wonders), or build a Manufactory |
| Merchant | Merchant specialists | Trade mission (gold + city-state influence), or build a Customs House |
| Artist | Artist specialists | Start golden age, create a great work of art, or build a Landmark |
| Writer | Writer specialists | Create great work of writing, or instant culture lump |
| Musician | Musician specialists | Create great work of music, or concert tour (tourism burst) |
| Prophet | Faith thresholds | Found/enhance religion, spread, Holy Site |
| General | Land combat XP | +15% combat aura, build Citadel, extend golden age (some factions) |
| Admiral | Naval combat XP | Naval aura, heal fleet, travel to a port |

Late in the game, great people (non-military) can be bought with faith if the matching policy tree is completed.

**Great works.** Writing, art, music and artifacts go into slots in buildings and wonders (Amphitheater, Museum, Opera House, palace, some wonders). Each work gives culture and tourism. A building filled with works matching a theme (same era, different civs, or artifacts) gets a theming bonus. Works can be swapped between players by trade.

**World wonders.** About 50 world wonders, one per world: whoever finishes first gets it, others lose their progress (converted to gold). Each gives a strong unique effect plus culture, great-person points or great-work slots. Examples of effect patterns to design original wonders around: free tech, free great person, +happiness per building type, all units heal faster, extra trade route, cheaper policies, spaceship part boost, defense for all cities, extra delegates. Some require terrain (mountain, river, coast) or a religion.

**National wonders.** One per empire; need a supporting building in every city. Examples: a national college for science, an epic for military XP, a national treasury, a grand temple for faith, an intelligence agency for spies, a visitor center for tourism.

**Projects.** Repeatable or one-time city builds that aren't buildings: the nuclear program project (unlocks nukes for everyone), the Apollo-style project (unlocks spaceship parts), the World's Fair / International Games / Space Station projects voted by the World Congress, and the utopia project if using pre-expansion culture victory.

## Economy and trade routes

**Gold.** Income from tiles, city connections, buildings, trade routes, city-state allies, deals and pillaging. Expenses: building maintenance, unit upkeep, road/railroad maintenance (1 gold per tile per turn outside cities), and per-turn payments in deals. If the treasury hits zero with negative income, a unit is disbanded each turn.

Gold buys units and buildings in cities, tiles, city-state influence (gifts), unit upgrades, and is traded in deals (lump sum or per turn for 30 turns).

**Trade routes.** Built with Caravans (land, range about 10 tiles) and Cargo Ships (sea, range about 20 tiles). Slots: one from Animal Husbandry, more from Sailing and later techs and some wonders; each city can be the origin of several routes. A route lasts about 30 turns, then the unit can be re-assigned.

| Route type | Effect |
| --- | --- |
| International (to another civ) | Gold to both (origin more), science to whichever is behind in tech, religious pressure both ways, tourism boost with some policies |
| To a city-state | Gold to origin, extra if allied |
| Internal | Food or production sent from origin to target city (no gold) |

Routes can be plundered by enemy military units for gold, which ends the route and is an act of war unless at war already. Caravans travel visibly on the map; plan them with a path preview. Some buildings (Caravansary, Harbor) extend range or add gold.

**Deal trading.** Luxury and strategic resources, gold, gold per turn, open borders, embassies, research agreements, cities, great works, votes, and third-party peace/war declarations are tradeable (see Diplomacy).

## Diplomacy, AI, city-states, World Congress, espionage

**Contact.** Players meet when their units or borders see each other. Each pair has a war/peace state and an AI opinion state.

**Diplomatic actions (major civs):**

- Declare war; make peace (peace treaty lasts 10 turns, during which war cannot be redeclared).
- Trade screen with both sides' offer columns (see Economy).
- Embassy (needed for most agreements; reveals capital).
- Open borders (units may pass through; time-limited, 30 turns).
- Defensive pact (auto war if the partner is attacked; 30 turns).
- Research agreement.
- Declaration of friendship (public; 50 turns) and Denouncement (public; 50 turns).
- Requests and demands ("give me X or else"), and asks to stop settling near them, stop converting their cities, stop spying, or stop digging their artifacts.
- Coordinated war against a third party; embargo.

**AI opinion model.** Track per-pair modifiers with decay: shared enemies/friends, denouncements, broken promises, land disputes, wonder competition, warmongering score (from captures, with penalties reduced if the target was the aggressor or the city is liberated), religious differences, ideology differences, trade history, victory competition. Visible states: Afraid, Guarded, Neutral, Friendly, Hostile, Deceptive (hidden), War. Each AI leader has a personality with weights (0–10) for: aggression, expansion, wonders, science, culture, gold, religion, diplomacy, naval, city-state interest, loyalty, forgiveness, boldness, warmonger hate, nuke use.

**City-states.** Minor single-city factions that never expand.

| Type | Friend bonus (Influence ≥ 30) | Ally bonus (≥ 60 and highest) |
| --- | --- | --- |
| Maritime | +food in capital | +food in all cities |
| Cultured | +culture | more culture |
| Militaristic | Periodic gift units | More frequent units |
| Mercantile | +happiness, unique luxury | More happiness, luxury |
| Religious | +faith | more faith |

Allies also receive the city-state's resources, its votes in the World Congress, and it joins wars on the ally's side. Personalities: Friendly, Neutral, Hostile, Irrational (affects influence decay and quest frequency).

Influence comes from gold gifts, unit gifts, completing quests (connect a resource, build a wonder, kill barbarians, clear a camp, find a natural wonder, spread religion, trade route, most culture/faith in a contest, kill a rival city-state, etc.), protecting them (pledge), trade missions, and policies. Influence decays toward a resting point each turn. Bullying: demand gold or a worker by threatening with nearby units (loses influence). Capturing a city-state angers everyone.

**World Congress.** Founded when one player has met all civs and reached the Renaissance (or earlier in the tech tree). Founder is host. Sessions every \~30 turns: two proposals voted on, with delegates per civ (base, plus host bonus, plus allied city-states, plus wonders and religion). Later becomes the United Nations, enabling the World Leader vote (diplomatic victory). Resolution examples: embargo a civ, ban a luxury, World Religion, World Ideology, arts/science funding, scholars-in-residence, nuclear non-proliferation, standing army tax, international projects, cultural heritage sites, international space station.

**Espionage.** Unlocked in the Renaissance with the first spy (more spies per era). Spies can be stationed:

- In an enemy city: steal techs, uncover intrigue (plans to attack), and after a delay can see the city.
- In a city-state: rig elections (shift influence to you) or stage a coup if near-ally status.
- In your own city: counterspy, catch enemy spies (spy may be killed or identified).
- As a diplomat in a rival capital (during peace): gives extra delegates support and trade visibility without stealing.

Spies rank up (Recruit → Agent → Special Agent) and can be killed; a killed spy is replaced after several turns.

## Barbarians and ancient ruins

**Barbarians.** Encampments spawn in fogged tiles not visible to any player, at a rate set by difficulty and the barbarian option. Each camp periodically spawns a unit of the most advanced type the world's tech level allows (warriors early, later archers, horsemen, swordsmen, galleys at sea). Barbarians attack units and cities, pillage, and capture civilians (and can hold captured cities on some settings). Clearing a camp gives gold (about 25, scaling) and may satisfy city-state quests. Barbarians stop spawning in later eras once the map is fully claimed.

**Ancient ruins.** Scattered at game start; the first unit to enter one gets a random reward (rewards cannot repeat for the same player until all are seen): +gold, free tech, +1 population to nearest city, free culture, faith toward pantheon, map reveal of the area, a free unit (Scout/Warrior upgrade), an upgrade of the entering unit, or reveal barbarian camps. Scouts with a promotion can choose instead of random.

## Tourism and archaeology

**Tourism.** Generated by great works, wonders (late-game), landmarks, some buildings and policies, and doubled by modifiers. It accumulates toward each other civ separately. Your cumulative tourism vs their lifetime culture determines your **influence level** over them: Unknown, Exotic, Familiar, Popular, Influential, Dominant (thresholds at 10%, 30%, 60%, 100%, 200%).

Tourism toward a civ is modified by: open borders (+25%), trade route between you (+25%), shared religion (+25%), different ideology (−), same ideology (+), certain wonders/policies, and the Internet-style late tech.

Influence matters beyond victory: higher influence reduces their war-weariness benefits against you, lets your spies work faster, and raises ideological pressure on them.

**Archaeology.** Archaeology tech reveals Antiquity Sites (generated from past battles, ruins and barbarian camps over the game). Archaeologists (civilian, built in a city with a University) dig a site over several turns, then the player chooses: create a Landmark tile (culture/tourism for the tile owner) or extract an Artifact into a great-work slot. Digging in a foreign territory annoys the owner unless permitted. Hidden sites appear with the Exploration finisher.

## Victory conditions and scoring

| Victory | Condition |
| --- | --- |
| Domination | Hold every other major civ's original capital at the same time (you must still own your own). |
| Science | Research Rocketry-era techs, build the Apollo-style project, then build and deliver 6 spaceship parts to the capital: 3 boosters, 1 cockpit, 1 stasis chamber, 1 engine. Launch wins. |
| Cultural (expansion rules) | Be Influential (or higher) over every other surviving major civ. |
| Diplomatic | Win the World Leader vote in the United Nations with the required delegate count (scales with player count). |
| Time | At the turn limit, the highest score wins. |

All victory types can be toggled off in setup. A player who loses their last city is eliminated; with Complete Kills they also need to lose all units.

**Score** (shown live, also used for time victory): points for land tiles, population, cities, wonders, techs, future techs, policies, great works, religion, and a bonus multiplier by difficulty if winning earlier. Store the formula as data.

**End-of-game screen:** victory/defeat movie-style splash (original art), stats graphs over time (score, population, military, production, gold, science, culture, land), replay map showing borders turn by turn, and a Hall of Fame entry.

## Factions template

The expansion version ships 43 playable factions. For a clone, create original factions (they may be named after real historical peoples and leaders, but write new ability names, effects, dialogue and art). Each faction is a data record:

```json
{
  "id": "faction_river_league",
  "name": "The River League",
  "leader": { "name": "...", "portrait": "...", "personality": { "aggression": 4, "expansion": 7, "wonders": 6, "science": 5, "culture": 5, "gold": 8, "religion": 3, "diplomacy": 7, "naval": 6, "cityStateInterest": 6, "loyalty": 5, "forgiveness": 5, "boldness": 4 } },
  "ability": { "name": "...", "effects": [ { "type": "yield_bonus", "target": "river_tile", "yield": "gold", "amount": 1 } ] },
  "uniques": [
    { "kind": "unit", "replaces": "spearman", "changes": { "strength": 9, "freePromotions": ["cover"] } },
    { "kind": "building", "replaces": "market", "changes": { "gold": 3, "extra": "+1 trade route" } }
  ],
  "startBias": ["river", "grassland"],
  "cityNames": ["..."],
  "spyNames": ["..."],
  "colors": { "primary": "#...", "secondary": "#..." }
}
```

Each faction has: one unique ability, two uniques (any mix of unique unit, unique building, unique improvement), a start bias, a city-name list used in order, spy names, colors, an AI personality, and diplomacy text lines (greeting, war, peace, defeat, trade, denounce). Aim for ability archetypes that cover each victory type and playstyle: wide expansion, tall growth, early rush, naval, religious, culture/tourism, science, gold/trade, city-state diplomacy, defense.

City-states are also data records: name, type, personality, unique luxury (for some), and color.

## UI/UX screens and controls

Design an original visual style; the layout patterns below are what players of this genre expect.

**Main map view**

- Top bar: science per turn, gold total (+/−), happiness, golden-age progress, culture toward next policy, faith, tourism, strategic resource counts, turn number and date, menu buttons.
- Minimap (bottom right) with overlay toggles: resource icons, yield icons, grid, trade routes, religion, tourism.
- Unit panel (bottom left): portrait, strength, moves, HP, XP bar, action buttons (move, attack, fortify, sleep, sentry, alert, skip, explore auto, pillage, build improvements, found city, embark, upgrade, delete, promotions).
- Notification stack (right side): clickable cards for every event (city grew, tech done, enemy spotted, golden age, quest).
- End Turn button showing the next required action ("Choose research", "Unit needs orders", "Choose production").
- Strategic view: a flat 2D iconic map toggle.
- Lenses: tile yields, settler suggestions (good spots), religion, tourism, ideology.
- Hover tooltips on tiles: terrain, feature, resource, improvement, yields, owner, defense, movement cost.
- Path preview with turn count; attack preview with predicted damage both sides.
- City banners on the map: name, population, growth turns, production icon and turns, HP bar, religion, capital star, ranged-attack button.

**Screens**

- City screen: worked tiles overlay (click to lock), citizen focus, specialists, buildings list, great-work slots, production queue, buy buttons, yields summary, growth/border progress, tile purchase.
- Tech tree: scrollable graph by era, queue path, current research and turns.
- Social policies: tree panels plus ideology tenet grid.
- Religion: belief chooser, world religions overview.
- Diplomacy: leader scene (original art) with options, trade screen with two-column offers, global relations overview, deals history.
- City-state panel: influence bar, bonuses, quests, gift/bully/pledge buttons.
- World Congress: proposals, vote allocation, history.
- Espionage: spy list, city potential, actions.
- Culture overview: great works by building, swap, tourism influence per civ.
- Trade route chooser with yield preview per destination.
- Military overview, economic overview (all cities table), demographics (rank vs rivals), victory progress screen per victory type, info encyclopedia (original text).
- Main menu, setup, options (graphics, audio, interface, autosave frequency, edge-pan, tooltip delay, keybinding), multiplayer lobby, load/save, Hall of Fame, mods manager (optional).

**Default hotkeys** (configurable): Enter end turn; Space skip unit; F fortify; S sleep; A alert; B build city; Alt-move for attack; R road; M mine; I farm; P pillage; F1–F10 overview screens; Ctrl+S quick save; Ctrl+L quick load; arrow keys/WASD pan; mouse wheel zoom.

**Audio:** original music per era and per faction mood, ambient tile sounds, combat sounds, notification chimes.

## Implementation plan for Claude Code

Build a deterministic, data-driven simulation first and keep rendering separate, so AI, saves, multiplayer and tests all reuse the same core.

**Suggested stack:** TypeScript, Vite, a 2D hex renderer (PixiJS) first with an optional three.js 3D view later, Zustand or plain state store for UI, Web Workers for AI turns, IndexedDB for saves, WebSocket server (Node) for multiplayer.

**Architecture (modules):**

- `data/` — JSON for terrains, features, resources, improvements, techs, policies, beliefs, units, promotions, buildings, wonders, factions, city-states, difficulty, pace, map sizes. Validate with a schema (zod).
- `core/` — pure game state plus rules: `GameState`, `applyAction(state, action) → state`, `endTurn(state)`. No DOM, no randomness except a seeded RNG stored in state.
- `core/systems/` — one file per system: map, yields, cities, growth, borders, production, happiness, research, culture, religion, units, movement/pathfinding (A\* on hex), combat, diplomacy, trade, city-states, congress, espionage, tourism, barbarians, victory, score.
- `mapgen/` — scripts per map type: heightmap/plate generation → land/sea → terrain by latitude/temperature/rainfall → rivers → features → resources (with balance pass) → start positions with bias → city-states → ruins/natural wonders.
- `ai/` — strategic layer (grand strategy by victory type, weighted by personality), operational layer (city build choices, settle-site scoring, tech/policy picks), tactical layer (unit moves, attack target scoring). Utility scoring with personality weights.
- `render/` — hex map, fog, units, banners, overlays, animations.
- `ui/` — screens listed in the UI section.
- `net/` — action serialization; server validates actions against the same core.

**Phased build:**

1. Hex map, map generator (Continents), fog of war, camera, tile tooltips.
2. Units: move, pathfinding, ZOC, 1UPT, Settlers found cities, Workers build improvements.
3. Cities: tiles, growth, production queue, buildings, borders, gold, buying.
4. Research and tech tree screen; happiness and luxuries.
5. Combat (melee, ranged, city), promotions, barbarians, ruins.
6. Basic AI that expands, builds and fights; end-turn loop; save/load.
7. Domination and science victories; score and time victory; end-game screens.
8. Social policies, golden ages, great people, wonders.
9. Diplomacy screens and AI opinion; city-states and quests.
10. Religion; trade routes; naval and air units; embarkation.
11. Ideologies, tourism, great works, archaeology, cultural victory.
12. World Congress and diplomatic victory; espionage.
13. All map types and setup options; difficulty and pace tables.
14. Hotseat, then online multiplayer with simultaneous/hybrid turns.
15. Polish: animations, audio, encyclopedia, tutorial, balance passes.

**Testing:** unit tests for every formula (growth, combat, costs), golden-file tests of map generation by seed, and AI-vs-AI headless simulations run to turn 500 to catch crashes and balance issues.

**Tip for working with Claude Code:** give it this doc plus one phase at a time, ask it to write the JSON data for that phase before the code, and ask for a short playtest checklist at the end of each phase.
