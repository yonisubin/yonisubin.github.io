// Saving and loading through IndexedDB keeps the whole game.
const { run } = require('./harness.cjs');

run('save', async ({ page }, t) => {
  const r = await page.evaluate(async () => {
    const h = window.hexborne;
    const s = h.start({ seed: 'save', mapSize: 'duel' });
    const settler = Object.values(s.units).find((u) => u.owner === 0 && u.type === 'settler');
    h.act({ type: 'found', unit: settler.id });
    h.act({ type: 'research', tech: 'pottery' });
    for (let k = 0; k < 5; k++) h.endTurnSync();
    await h.save('test-save');
    const loaded = await h.load('test-save');
    return { same: JSON.stringify(loaded) === JSON.stringify(s), turn: loaded.turn, cities: Object.keys(loaded.cities).length };
  });
  t.ok('a loaded save equals the saved game', r.same, r);
  // Through the menu: Continue appears on the setup screen after a reload.
  await page.reload();
  await page.waitForFunction(() => window.hexborne);
  const text = await page.textContent('#setup');
  t.ok('setup screen lists saves', /test-save/.test(text) || /Continue/.test(text));
});
