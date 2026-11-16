// Phase 13: every map type generates a playable world, and the advanced options take effect.
const { run } = require('./harness.cjs');

run('map types and options', async ({ page }, t) => {
  const r = await page.evaluate(() => {
    const h = window.hexborne;
    const C = h.core;
    const D = h.D;
    const out = { maps: {} };
    const types = ['continents', 'pangaea', 'archipelago', 'fractal', 'small_continents', 'terra', 'inland_sea', 'lakes', 'highlands', 'ice_age', 'tilted_axis', 'great_plains', 'oval', 'north_vs_south', 'skirmish', 'earth'];
    for (const type of types) {
      const t0 = performance.now();
      const s = C.newGame({ seed: 'maps-' + type, mapType: type, mapSize: 'small', spectator: true });
      const land = s.map.tiles.filter((x) => !D.terrains.get(x.terrain).water).length / s.map.tiles.length;
      const majors = s.players.filter((p) => !p.isMinor && !p.isBarbarian);
      const starts = majors.map((p) => Object.values(s.units).find((u) => u.owner === p.id && u.type === 'settler')?.tile ?? -1);
      const onLand = starts.every((i) => i >= 0 && !D.terrains.get(s.map.tiles[i].terrain).water);
      const areas = new Set(starts.map((i) => s.map.tiles[i]?.area));
      const snow = s.map.tiles.filter((x) => x.terrain === 'snow' || x.terrain === 'tundra').length;
      const mountains = s.map.tiles.filter((x) => x.terrain === 'mountain').length;
      out.maps[type] = { land: Math.round(land * 100), onLand, areas: areas.size, snow, mountains, ms: Math.round(performance.now() - t0) };
    }
    // Earth: Africa is land, the middle of the Pacific is not.
    const e = C.newGame({ seed: 'earth', mapType: 'earth', mapSize: 'standard', spectator: true });
    const at = (lon, lat) => {
      const row = Math.round(((80 - lat) / 155) * e.map.h - 0.5);
      const col = Math.round(((lon + 180) / 360) * e.map.w - 0.5);
      return e.map.tiles[row * e.map.w + col];
    };
    out.africa = !D.terrains.get(at(20, 5).terrain).water;
    out.pacific = D.terrains.get(at(-150, 0).terrain).water;
    const rnd = C.newGame({ seed: 'rnd', mapType: 'random', mapSize: 'duel', spectator: true });
    out.random = types.includes(rnd.settings.mapType);

    // --- Options ---
    const era = C.newGame({ seed: 'era', mapSize: 'duel', startEra: 4 });
    const p0 = era.players[0];
    out.eraTechs = [...D.techs.values()].filter((x) => x.era < 4).every((x) => p0.techs.includes(x.id));
    out.eraUnits = Object.values(era.units).filter((u) => u.owner === 0 && u.type === 'settler').length >= 2;
    const ab = C.newGame({ seed: 'res', mapSize: 'duel', resources: 'abundant', spectator: true });
    const sp = C.newGame({ seed: 'res', mapSize: 'duel', resources: 'sparse', spectator: true });
    out.abundant = ab.map.tiles.filter((x) => x.resource).length > sp.map.tiles.filter((x) => x.resource).length;
    const raging = C.newGame({ seed: 'rage', mapSize: 'small', raging: true, spectator: true });
    const calm = C.newGame({ seed: 'rage', mapSize: 'small', spectator: true });
    out.raging = Object.keys(raging.camps).length > Object.keys(calm.camps).length;
    // One-City Challenge and Always peace, through actions.
    const s = h.start({ seed: 'opts', mapSize: 'duel', oneCity: true, alwaysPeace: true, noRazing: true, cityStates: 0 });
    const settler = Object.values(s.units).find((u) => u.owner === 0 && u.type === 'settler');
    h.act({ type: 'found', unit: settler.id });
    const cap = Object.values(s.cities).find((c) => c.owner === 0);
    out.noSettlers = !h.act({ type: 'produce', city: cap.id, item: { kind: 'unit', id: 'settler' } }).ok;
    if (!s.players[0].met.includes(1)) s.players[0].met.push(1);
    out.peace = /peace/i.test(h.act({ type: 'declareWar', target: 1 }).error ?? '');
    s.players[0].pendingCaptures.push(cap.id);
    out.noRaze = /razing/i.test(h.act({ type: 'capture', city: cap.id, choice: 'raze' }).error ?? '');
    return out;
  });
  for (const [type, m] of Object.entries(r.maps)) t.ok(`${type}: land, starts on land`, m.land >= 15 && m.land <= 75 && m.onLand, m);
  t.ok('terra: everyone starts on one landmass', r.maps.terra.areas === 1, r.maps.terra.areas);
  t.ok('highlands have more mountains than great plains', r.maps.highlands.mountains > r.maps.great_plains.mountains * 2, [r.maps.highlands.mountains, r.maps.great_plains.mountains]);
  t.ok('ice age is colder than continents', r.maps.ice_age.snow > r.maps.continents.snow, [r.maps.ice_age.snow, r.maps.continents.snow]);
  t.ok('earth: Africa is land, the mid-Pacific is sea', r.africa && r.pacific);
  t.ok('random picks a real map type', r.random);
  t.ok('a later starting era gives earlier techs', r.eraTechs);
  t.ok('…and extra settlers', r.eraUnits);
  t.ok('abundant resources > sparse', r.abundant);
  t.ok('raging barbarians start with more camps', r.raging);
  t.ok('One-City Challenge: no settlers', r.noSettlers);
  t.ok('Always peace: no wars', r.peace);
  t.ok('No razing', r.noRaze);
});
