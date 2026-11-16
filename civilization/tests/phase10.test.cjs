// Phase 10: embarkation and ships, work boats and harbors, trade routes (and plundering),
// religion (pantheon, founding, follower beliefs, missionaries, pressure), aircraft and nukes.
const { run } = require('./harness.cjs');

run('ships, trade, religion, air', async ({ page }, t) => {
  const r = await page.evaluate(() => {
    const h = window.hexborne;
    const C = h.core;
    const out = {};
    const s = h.start({ seed: 'phase10', mapSize: 'duel', barbarians: false, cityStates: 0 });
    const m = s.map;
    const center = 12 * m.w + 20;
    const far = 12 * m.w + 0;
    window.flatten(s, center, 7);
    window.flatten(s, far, 3);
    C.foundCity(s, 1, far);
    const N = (i, d) => C.neighbor(m, i, d);
    const tl = (i) => m.tiles[i];
    // A strip of water east of the centre: coast for 3 tiles, then ocean.
    const e1 = N(center, 0), e2 = N(e1, 0), e3 = N(e2, 0), e4 = N(e3, 0), e5 = N(e4, 0);
    for (const i of [e1, e2, e3]) tl(i).terrain = 'coast';
    for (const i of [e4, e5]) tl(i).terrain = 'ocean';
    const pl = s.players[0];
    const reset = () => {
      for (const id of Object.keys(s.units)) if (s.units[id].owner === 0) delete s.units[id];
    };

    // --- Embarkation ---
    const w = C.createUnit(s, 'warrior', 0, center);
    C.recomputeAllVisibility(s);
    out.noEmbark = !h.act({ type: 'move', unit: w.id, to: e1 }).ok;
    pl.techs.push('agriculture', 'pottery', 'sailing', 'optics');
    w.moves = 12;
    out.embark = h.act({ type: 'move', unit: w.id, to: e1 }).ok && s.units[w.id].tile === e1;
    w.moves = 12;
    out.noOcean = !h.act({ type: 'move', unit: w.id, to: e4 }).ok || s.units[w.id].tile !== e4;
    w.tile = e1;
    w.moves = 12;
    h.act({ type: 'move', unit: w.id, to: center });
    out.landingEndsTurn = s.units[w.id].tile === center && s.units[w.id].moves === 0;
    reset();

    // --- Ships ---
    const tri = C.createUnit(s, 'trireme', 0, e1);
    C.recomputeAllVisibility(s);
    out.triremeCoast = h.act({ type: 'move', unit: tri.id, to: e3 }).ok;
    tri.moves = 24;
    out.triremeNoOcean = s.units[tri.id] && (!h.act({ type: 'move', unit: tri.id, to: e5 }).ok || s.units[tri.id].tile !== e5);
    tri.moves = 24;
    out.shipNoLand = !h.act({ type: 'move', unit: tri.id, to: N(center, 3) }).ok;
    reset();

    // --- City, work boat, harbor ---
    const settler = C.createUnit(s, 'settler', 0, center);
    h.act({ type: 'found', unit: settler.id });
    const city = Object.values(s.cities).find((c) => c.owner === 0);
    tl(e2).resource = 'fish';
    tl(e2).owner = 0;
    tl(e2).cityId = city.id;
    const boat = C.createUnit(s, 'work_boat', 0, e2);
    out.fishing = h.act({ type: 'build', unit: boat.id, job: 'fishing_boats' }).ok && tl(e2).improvement === 'fishing_boats' && !s.units[boat.id];
    const before = C.tileYields(s, e1, 0).food;
    tl(e1).owner = 0;
    tl(e1).cityId = city.id;
    city.buildings.push('lighthouse');
    out.lighthouse = C.tileYields(s, e1, 0).food === before + 1;

    // --- Trade routes ---
    const settler2 = C.createUnit(s, 'settler', 0, N(N(N(N(N(center, 3), 3), 3), 3), 3));
    h.act({ type: 'found', unit: settler2.id });
    pl.techs.push('animal_husbandry');
    const car = C.createUnit(s, 'caravan', 0, city.tile);
    const opts = C.routeOptions(s, car);
    out.routeOptions = opts.length;
    const internal = opts.find((o) => o.to.owner === 0 && o.carries === 'food');
    const second = internal.to;
    const food0 = C.cityYields(s, second).total.food;
    out.route = h.act({ type: 'tradeRoute', unit: car.id, to: second.id, carries: 'food' }).ok && s.tradeRoutes.length === 1;
    out.routeFood = C.cityYields(s, second).total.food > food0;
    s.tradeRoutes[0].until = s.turn + 1;
    h.endTurnSync();
    h.endTurnSync();
    out.caravanBack = s.tradeRoutes.length === 0 && Object.values(s.units).some((u) => u.owner === 0 && u.type === 'caravan');

    // --- Religion ---
    pl.faith = 1000;
    out.pantheon = h.act({ type: 'pantheon', belief: 'star_watchers' }).ok && pl.pantheon === 'star_watchers';
    const prophet = C.createUnit(s, 'great_prophet', 0, city.tile);
    out.found = h.act({ type: 'foundReligion', unit: prophet.id, name: 'Test Faith', founder: 'tithes', follower: 'monastic_schools' }).ok;
    const rel = pl.religion;
    out.holy = C.majority(city) === rel;
    out.followerBelief = C.religionCityEffects(s, city).some((e) => e.source === 'Monastic Schools');
    // A missionary converts the second city.
    second.followers = {};
    const miss = C.createUnit(s, 'missionary', 0, second.tile);
    miss.religion = rel;
    miss.charges = 2;
    out.spread = h.act({ type: 'spreadReligion', unit: miss.id }).ok && (second.followers[rel] ?? 0) > 0;

    // --- Air ---
    pl.techs.push('flight', 'radar');
    const f = C.createUnit(s, 'fighter', 0, city.tile);
    out.rebase = h.act({ type: 'rebase', unit: f.id, to: second.tile }).ok && s.units[f.id].tile === second.tile;
    const enemy = Object.values(s.cities).find((c) => c.owner === 1);
    C.setWar(s, 0, 1, true);
    const bomber = C.createUnit(s, 'bomber', 0, city.tile);
    const target = C.createUnit(s, 'warrior', 1, N(N(city.tile, 1), 1));
    C.recomputeAllVisibility(s);
    const hp0 = target.hp;
    out.strike = h.act({ type: 'airStrike', unit: bomber.id, to: target.tile }).ok && (!s.units[target.id] || s.units[target.id].hp < hp0);
    // Nukes need the Nuclear Program.
    const bomb = C.createUnit(s, 'atomic_bomb', 0, city.tile);
    const victim = C.createUnit(s, 'warrior', 1, N(N(N(city.tile, 2), 2), 2));
    s.worldProjects.manhattan_project = 1;
    out.nuke = h.act({ type: 'nuke', unit: bomb.id, to: victim.tile }).ok && !s.units[victim.id] && pl.warmonger > 0;
    void enemy;
    return out;
  });
  t.ok('land units cannot enter water before Optics', r.noEmbark);
  t.ok('with Optics they embark onto the coast', r.embark);
  t.ok('ocean needs Astronomy', r.noOcean);
  t.ok('landing ends the move', r.landingEndsTurn);
  t.ok('a trireme sails the coast', r.triremeCoast);
  t.ok('…but not the ocean', r.triremeNoOcean);
  t.ok('ships cannot go on land', r.shipNoLand);
  t.ok('a work boat builds fishing boats and is used up', r.fishing);
  t.ok('a lighthouse adds food to water tiles', r.lighthouse);
  t.ok('a caravan can see route destinations', r.routeOptions > 0, r.routeOptions);
  t.ok('an internal route sends food', r.route && r.routeFood);
  t.ok('the caravan comes home when the route ends', r.caravanBack);
  t.ok('faith buys a pantheon', r.pantheon);
  t.ok('a Great Prophet founds a religion; the city follows it', r.found && r.holy);
  t.ok('follower beliefs apply to following cities', r.followerBelief);
  t.ok('a missionary converts citizens', r.spread);
  t.ok('a fighter can rebase to another city', r.rebase);
  t.ok('a bomber strike damages its target', r.strike);
  t.ok('a nuclear strike destroys units in the blast and marks a warmonger', r.nuke);
});
