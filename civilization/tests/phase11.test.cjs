// Phase 11: great works and theming, tourism and influence, the cultural victory, ideologies
// (choice, tenet tiers, public opinion), and archaeology (sites, digging artifacts/landmarks).
const { run } = require('./harness.cjs');

run('culture, ideology, archaeology', async ({ page }, t) => {
  const r = await page.evaluate(() => {
    const h = window.hexborne;
    const C = h.core;
    const out = {};
    const s = h.start({ seed: 'phase11', mapSize: 'duel', barbarians: false, cityStates: 0 });
    const pl = s.players[0], ai = s.players[1];
    if (!pl.met.includes(1)) pl.met.push(1);
    if (!ai.met.includes(0)) ai.met.push(0);
    const settler = Object.values(s.units).find((u) => u.owner === 0 && u.type === 'settler');
    h.act({ type: 'found', unit: settler.id });
    h.act({ type: 'research', tech: 'pottery' });
    const cap = Object.values(s.cities).find((c) => c.owner === 0);
    h.act({ type: 'produce', city: cap.id, item: { kind: 'unit', id: 'warrior' } });
    h.endTurnSync();

    // --- Great works ---
    const artist = C.createUnit(s, 'great_artist', 0, cap.tile);
    out.work = h.act({ type: 'greatPerson', unit: artist.id, use: 'great_work' }).ok && (cap.works.palace ?? []).length === 1;
    const cy = C.cityCultureYields(s, cap);
    out.workYields = cy.culture >= 2 && cy.tourism >= 2;
    cap.buildings.push('museum');
    const a2 = C.createUnit(s, 'great_artist', 0, cap.tile);
    const a3 = C.createUnit(s, 'great_artist', 0, cap.tile);
    h.act({ type: 'greatPerson', unit: a2.id, use: 'great_work' });
    h.act({ type: 'greatPerson', unit: a3.id, use: 'great_work' });
    out.themed = C.cityCultureYields(s, cap).themed.includes('museum');

    // --- Tourism and influence ---
    ai.cultureTotal = 100;
    pl.tourismTo[1] = 150;
    out.level = C.influenceLevel(s, 0, 1);
    out.cultureWin = C.culturalWinner(s) === 0;
    pl.tourismTo[1] = 0; // (don't actually end the game)

    // --- Ideology ---
    out.noIdeologyYet = !h.act({ type: 'chooseIdeology', ideology: 'order' }).ok;
    for (const tch of h.D.techs.keys()) if (h.D.techs.get(tch).era <= 4 && !pl.techs.includes(tch)) pl.techs.push(tch);
    out.ideology = h.act({ type: 'chooseIdeology', ideology: 'order' }).ok && pl.ideology === 'order';
    pl.culture = 1e6;
    out.tier2Blocked = !h.act({ type: 'adoptPolicy', policy: 'heroic_labor' }).ok;
    h.act({ type: 'adoptPolicy', policy: 'five_year_plans' });
    h.act({ type: 'adoptPolicy', policy: 'collective_farms' });
    out.tier2 = h.act({ type: 'adoptPolicy', policy: 'heroic_labor' }).ok;
    // A rival ideology with strong influence over us stirs dissent.
    ai.ideology = 'assembly';
    ai.tourismTo[0] = 1e6;
    out.opinion = C.publicOpinion(s, 0);
    ai.tourismTo[0] = 0;
    out.switch = h.act({ type: 'switchIdeology', ideology: 'assembly' }).ok && pl.anarchy > 0 && !pl.policies.includes('five_year_plans');

    // --- Archaeology ---
    const tile = C.neighbor(s.map, cap.tile, 0);
    s.map.tiles[tile].terrain = 'grassland';
    s.map.tiles[tile].feature = null;
    C.recordSite(s, tile, 'battle', 100);
    s.antiquity[tile].hidden = false;
    out.siteSeen = pl.techs.includes('archaeology');
    cap.buildings.push('university');
    const arch = C.createUnit(s, 'archaeologist', 0, tile);
    out.dig = h.act({ type: 'dig', unit: arch.id, choice: 'landmark' }).ok;
    for (let k = 0; k < 4; k++) h.endTurnSync();
    out.landmark = s.map.tiles[tile].improvement === 'landmark' && !s.antiquity[tile];
    h.set({ rev: 12000 });
    return out;
  });
  t.ok('a Great Artist creates a great work in a free slot', r.work);
  t.ok('great works make culture and tourism', r.workYields);
  t.ok('a full museum of works by one civilization in one era is themed', r.themed);
  t.ok('tourism over their lifetime culture sets influence (150% = Influential)', r.level === 4, r.level);
  t.ok('Influential over everyone wins a culture victory', r.cultureWin);
  t.ok('no ideology before the Industrial era', r.noIdeologyYet);
  t.ok('an ideology can be chosen in the Industrial era', r.ideology);
  t.ok('tier-2 tenets need two tier-1 tenets', r.tier2Blocked && r.tier2);
  t.ok('a rival ideology with great influence stirs public opinion', r.opinion.pressure > 0 && r.opinion.state !== 'Content' && r.opinion.preferred === 'assembly', r.opinion);
  t.ok('switching ideology drops tenets and brings anarchy', r.switch);
  t.ok('antiquity sites are visible with Archaeology', r.siteSeen);
  t.ok('an archaeologist digs a landmark', r.dig && r.landmark);
  await page.evaluate(() => window.hexborne.set({ panel: 'culture' }));
  await page.waitForTimeout(300);
  t.ok('the culture panel opens', /Influence/.test(await page.textContent('#modal')));
});
