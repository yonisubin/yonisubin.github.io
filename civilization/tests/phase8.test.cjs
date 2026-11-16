// Phase 8: social policies (openers, prerequisites, exclusions, finishers), golden ages,
// specialists and great people, world and national wonders.
const { run } = require('./harness.cjs');

run('policies, golden ages, great people, wonders', async ({ page }, t) => {
  const r = await page.evaluate(() => {
    const h = window.hexborne;
    const C = h.core;
    const out = {};
    const s = h.start({ seed: 'phase8', mapSize: 'duel', barbarians: false });
    const pl = s.players[0];
    const settler = Object.values(s.units).find((u) => u.owner === 0 && u.type === 'settler');
    h.act({ type: 'found', unit: settler.id });
    const cap = Object.values(s.cities).find((c) => c.owner === 0);
    h.act({ type: 'research', tech: 'pottery' });
    h.act({ type: 'produce', city: cap.id, item: { kind: 'unit', id: 'warrior' } });

    // --- Policies ---
    out.noCulture = h.act({ type: 'adoptPolicy', policy: 'heritage' }).ok;
    const before = C.cityYields(s, cap).total.culture;
    pl.culture = 1000;
    out.needOpener = h.act({ type: 'adoptPolicy', policy: 'hearth_laws' }).ok;
    out.open = h.act({ type: 'adoptPolicy', policy: 'heritage' }).ok;
    out.cultureGain = C.cityYields(s, cap).total.culture - before;
    out.needPrereq = h.act({ type: 'adoptPolicy', policy: 'elder_council' }).ok;
    pl.culture = 100000;
    for (const id of ['hearth_laws', 'old_families', 'elder_council', 'royal_court', 'unbroken_line']) h.act({ type: 'adoptPolicy', policy: id });
    out.finished = pl.policies.includes('done:heritage');
    out.freeAqueduct = cap.buildings.includes('aqueduct');
    // Exclusions: Reason (Renaissance) and Devotion (Classical) exclude each other.
    for (const t of ['philosophy', 'writing', 'calendar', 'drama', 'theology', 'civil_service', 'trapping', 'animal_husbandry', 'education', 'astronomy', 'compass', 'optics', 'sailing', 'acoustics', 'agriculture', 'mining', 'bronze_working', 'currency', 'iron_working']) if (!pl.techs.includes(t)) pl.techs.push(t);
    out.devotion = h.act({ type: 'adoptPolicy', policy: 'devotion' }).ok;
    const reason = h.act({ type: 'adoptPolicy', policy: 'reason' });
    out.excluded = !reason.ok && /combined/.test(reason.error);

    // --- Golden age ---
    pl.goldenAge.points = 100000;
    const tileBefore = C.tileYields(s, cap.worked[0] ?? cap.tile, 0);
    h.endTurnSync();
    out.golden = pl.goldenAge.turnsLeft > 0 && pl.goldenAge.count === 1;
    const tileAfter = C.tileYields(s, cap.worked[0] ?? cap.tile, 0);
    out.goldenProd = tileBefore.production >= 1 ? tileAfter.production > tileBefore.production : true;

    // --- Specialists and great people ---
    cap.buildings.push('library');
    cap.pop = 4;
    const sciBefore = C.cityYields(s, cap).total.science;
    out.spec = h.act({ type: 'specialist', city: cap.id, specialist: 'scientist', delta: 1 }).ok;
    out.specScience = C.cityYields(s, cap).total.science - sciBefore;
    pl.gpPoints.scientist = 10000;
    h.endTurnSync();
    const gs = Object.values(s.units).find((u) => u.owner === 0 && u.type === 'great_scientist');
    out.scientistBorn = !!gs;
    if (gs) {
      const sci = Object.values(pl.techProgress).reduce((a, b) => a + b, 0) + pl.techs.length * 1000;
      out.dbg = { research: pl.research, prog: JSON.stringify(pl.techProgress), n: pl.techs.length };
      out.discover = h.act({ type: 'greatPerson', unit: gs.id, use: 'discover' }).ok;
      out.discovered = Object.values(pl.techProgress).reduce((a, b) => a + b, 0) + pl.techs.length * 1000 > sci;
      out.dbg2 = { research: pl.research, prog: JSON.stringify(pl.techProgress), n: pl.techs.length };
    }

    out.noTrainGp = !h.act({ type: 'produce', city: cap.id, item: { kind: 'unit', id: 'great_scientist' } }).ok;
    // --- Wonders ---
    // House of Scrolls (Writing): one per world, gives a free tech.
    const techs = pl.techs.length;
    h.act({ type: 'produce', city: cap.id, item: { kind: 'building', id: 'house_of_scrolls' } });
    cap.production = 100000;
    out.wonderNotBuyable = !h.act({ type: 'buy', city: cap.id, item: { kind: 'building', id: 'house_of_scrolls' } }).ok;
    h.endTurnSync();
    out.wonderBuilt = s.wonders.house_of_scrolls === cap.id;
    out.freeTech = pl.techs.length > techs;
    out.onlyOnce = !h.act({ type: 'produce', city: cap.id, item: { kind: 'building', id: 'house_of_scrolls' } }).ok;
    // National wonder: needs a Library in every city.
    const far = Object.values(s.cities).find((c) => c.owner === 1);
    out.national = h.act({ type: 'produce', city: cap.id, item: { kind: 'building', id: 'grand_archive' } }).ok;
    void far;
    return out;
  });
  t.ok('no policy without culture', r.noCulture === false);
  t.ok('a policy needs its tree opened first', r.needOpener === false);
  t.ok('opening Heritage adds +3 culture in the capital', r.open && r.cultureGain >= 3, r.cultureGain);
  t.ok('policies respect their prerequisites', r.needPrereq === false);
  t.ok('all five policies complete the tree (finisher: free Aqueducts)', r.finished && r.freeAqueduct);
  t.ok('Devotion and Reason exclude each other', r.devotion && r.excluded);
  t.ok('a full meter starts a golden age', r.golden);
  t.ok('golden ages add production to productive tiles', r.goldenProd);
  t.ok('a Scientist specialist adds science', r.spec && r.specScience >= 3, r.specScience);
  t.ok('a full meter brings a Great Scientist', r.scientistBorn);
  t.ok('using it adds a lump of science', r.discover && r.discovered);
  t.ok('great people cannot be trained in cities', r.noTrainGp);
  t.ok('wonders cannot be bought', r.wonderNotBuyable);
  t.ok('a world wonder is built and gives its one-shot (free tech)', r.wonderBuilt && r.freeTech);
  t.ok('a world wonder can only be built once', r.onlyOnce);
  t.ok('a national wonder can be started when every city has the building', r.national, r.national);
  // UI: the policies panel opens and shows the trees.
  await page.evaluate(() => window.hexborne.set({ panel: 'policies' }));
  await page.waitForSelector('.tree-card');
  t.ok('the policies panel lists 9 trees', (await page.locator('.tree-card').count()) === 9);
});
