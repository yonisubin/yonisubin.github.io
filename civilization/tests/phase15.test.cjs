// Phase 15 (polish): the encyclopedia, advisor hints, sound settings, unit slides and damage
// floaters (and their quick-movement / quick-combat switches), and the late-game tech pace.
const { run } = require('./harness.cjs');

run('polish', async ({ page }, t) => {
  // Every encyclopedia entry has an article.
  const pedia = await page.evaluate(() => {
    const h = window.hexborne;
    const D = h.D;
    const cats = {
      units: [...D.units.keys()],
      buildings: [...D.buildings.values()].filter((b) => !b.wonder).map((b) => b.id),
      wonders: [...D.buildings.values()].filter((b) => b.wonder).map((b) => b.id),
      techs: [...D.techs.keys()],
      policies: [...D.policyTrees.keys()],
      beliefs: [...D.beliefs.keys()],
      ideologies: [...D.ideologies.keys()],
      terrain: [...D.terrains.keys(), ...D.features.keys()],
      resources: [...D.resources.keys()],
      improvements: [...D.improvements.keys()],
      promotions: [...D.promotions.keys()],
      factions: [...D.factions.keys()],
      citystates: [...D.cityStates.keys()],
      concepts: ['start', 'combat', 'victory'],
    };
    const empty = [];
    let n = 0;
    for (const [c, ids] of Object.entries(cats))
      for (const id of ids) {
        n++;
        const html = h.pedia(c, id);
        const art = html.split('pedia-article">')[1] ?? '';
        if (!/<h3>/.test(art)) empty.push(`${c}:${id}`);
      }
    const search = h.pedia('concepts', '', 'spear');
    return { n, empty, search: /Spearman/.test(search) };
  });
  t.ok(`all ${pedia.n} encyclopedia entries have an article`, pedia.empty.length === 0, pedia.empty.slice(0, 5));
  t.ok('encyclopedia search finds units', pedia.search);

  // Advisor hints.
  await page.evaluate(() => {
    localStorage.removeItem('civ:hints');
    window.hexborne.start({ seed: 'polish', mapSize: 'duel', cityStates: 0 });
  });
  await page.waitForTimeout(150);
  const hint1 = await page.textContent('#hint');
  t.ok('a new game shows the found-a-city hint', /Settler/.test(hint1 ?? ''), hint1);
  await page.click('[data-a="hint-ok"]');
  await page.waitForTimeout(100);
  const hint2 = await page.evaluate(() => (document.getElementById('hint').style.display === 'none' ? '' : document.getElementById('hint').textContent));
  t.ok('Got it moves on to another hint', !/Settler/.test(hint2), hint2);
  await page.evaluate(() => window.hexborne.state.settings.tutorial === true && document.querySelector('[data-a="hints-off"]')?.click());
  await page.waitForTimeout(100);
  t.ok('hints can be turned off', await page.evaluate(() => document.getElementById('hint').style.display === 'none' && !window.hexborne.state.settings.tutorial));

  // Encyclopedia through the interface (F1).
  await page.keyboard.press('F1');
  await page.waitForTimeout(150);
  t.ok('F1 opens the encyclopedia', /Getting started/.test((await page.textContent('#modal')) ?? ''));
  await page.click('.pedia .tab[data-c="units"]');
  await page.click('.pedia-list [data-i="spearman"]');
  await page.waitForTimeout(100);
  t.ok('an entry shows its numbers', /Strength/.test((await page.textContent('.pedia-article')) ?? ''));
  await page.keyboard.press('Escape');

  // Sound settings persist.
  const snd = await page.evaluate(() => {
    window.hexborne.set({ panel: 'menu' });
    return true;
  });
  await page.waitForTimeout(100);
  await page.click('[data-a="toggle-sfx"]');
  await page.click('[data-a="toggle-music"]');
  const prefs = await page.evaluate(() => [localStorage.getItem('civ:mute'), localStorage.getItem('civ:music')]);
  t.ok('sound effects and music toggles are saved', snd && prefs[0] === '1' && prefs[1] === '1', prefs);
  await page.click('[data-a="toggle-music"]');

  // Slides and floaters.
  const anim = await page.evaluate(async () => {
    const h = window.hexborne;
    const run = async (quick) => {
      const s = h.start({ seed: 'anim', mapSize: 'duel', cityStates: 0, quickMovement: quick, quickCombat: quick });
      window.flatten(s, s.map.w * 10 + 20, 4);
      const at = s.map.w * 10 + 20;
      const a = h.core.createUnit(s, 'warrior', 0, at);
      const b = h.core.createUnit(s, 'warrior', 1, at + 2);
      s.players[0].met.push(1);
      s.players[1].met.push(0);
      h.core.setWar(s, 0, 1, true);
      h.core.recomputeAllVisibility(s);
      h.set({ passTo: null });
      h.centerOn(at);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      h.play({ type: 'move', unit: a.id, to: at + 1 });
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const slides = h.view.slides.size;
      a.moves = 2;
      h.play({ type: 'attack', unit: a.id, to: b.tile });
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      return { slides, floaters: h.view.floaters.length };
    };
    return { normal: await run(false), quick: await run(true) };
  });
  t.ok('a moving unit slides to its new tile', anim.normal.slides >= 1, anim.normal);
  t.ok('combat shows damage numbers', anim.normal.floaters >= 1, anim.normal);
  t.ok('quick movement and quick combat skip them', anim.quick.slides === 0 && anim.quick.floaters === 0, anim.quick);

  // Late-game pace: on Quick, the leader is near the end of the tree by turn 300.
  const pace = await page.evaluate(() => {
    const s = window.hexborne.simulate(300, { seed: 'bal1', mapSize: 'tiny', pace: 'quick' });
    return Math.max(...s.players.filter((p) => !p.isMinor && !p.isBarbarian).map((p) => p.techs.length));
  });
  t.ok('quick game: the leader has 70+ of 80 techs by turn 300', pace >= 70, pace);
});
