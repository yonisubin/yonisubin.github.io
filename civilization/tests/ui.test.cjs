// Playing through the interface: Play now, found a city with B, pick research and production
// from the End Turn prompts, end the turn (AI runs in the worker), tooltips and the tech tree.
const { run } = require('./harness.cjs');

run('ui', async ({ page }, t) => {
  await page.click('[data-a="play-now"]');
  await page.waitForFunction(() => window.hexborne.state && !window.hexborne.store.getState().setup);
  // The settler is selected first.
  await page.waitForTimeout(300);
  const sel = await page.evaluate(() => {
    const st = window.hexborne.store.getState();
    return st.selUnit !== null ? window.hexborne.state.units[st.selUnit].type : null;
  });
  t.ok('a unit is selected at the start', !!sel, sel);
  await page.evaluate(() => {
    const s = window.hexborne.state;
    const settler = Object.values(s.units).find((u) => u.owner === 0 && u.type === 'settler');
    window.hexborne.set({ selUnit: settler.id });
  });
  await page.keyboard.press('b');
  await page.waitForFunction(() => /research/i.test(document.querySelector('#endturn').textContent), null, { timeout: 5000 }).catch(() => {});
  const cities = await page.evaluate(() => Object.values(window.hexborne.state.cities).filter((c) => c.owner === 0).length);
  t.ok('B founds a city', cities === 1);
  const label1 = await page.textContent('#endturn');
  t.ok('End Turn asks for research first', /research/i.test(label1), label1);
  await page.click('[data-a="end-turn"]');
  await page.waitForSelector('.tech.avail');
  await page.click('.tech.avail');
  const research = await page.evaluate(() => window.hexborne.state.players[0].research);
  t.ok('clicking a tech starts research', !!research, research);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => /production/i.test(document.querySelector('#endturn').textContent), null, { timeout: 5000 }).catch(() => {});
  const label2 = await page.textContent('#endturn');
  t.ok('then it asks for production', /production/i.test(label2), label2);
  await page.click('[data-a="end-turn"]');
  await page.waitForSelector('#city [data-a="produce"]');
  await page.click('#city [data-a="produce"]');
  const queued = await page.evaluate(() => Object.values(window.hexborne.state.cities).find((c) => c.owner === 0).queue.length);
  t.ok('clicking an item queues it', queued === 1);
  await page.keyboard.press('Escape');
  await page.click('[data-a="end-turn"]');
  await page.waitForFunction(() => window.hexborne.state.turn === 1 && !window.hexborne.store.getState().busy, null, { timeout: 60000 });
  t.ok('ending the turn runs the other players (worker) and advances', true);
  // Hovering a tile shows a tooltip.
  const pos = await page.evaluate(() => window.hexborne.tileCenter(Object.values(window.hexborne.state.cities).find((c) => c.owner === 0).tile));
  await page.mouse.move(pos.x, pos.y);
  await page.waitForTimeout(200);
  const tip = await page.textContent('#tooltip');
  t.ok('tile tooltip shows the city', /City/.test(tip), tip.slice(0, 80));
  // The tech tree opens with T.
  await page.keyboard.press('t');
  await page.waitForSelector('.tech', { timeout: 5000 }).catch(() => {});
  t.ok('T opens the tech tree', (await page.locator('.tech').count()) >= 40);
  await page.keyboard.press('Escape');
  // Several more turns through the button.
  for (let k = 0; k < 5; k++) {
    await page.evaluate(() => window.hexborne.endTurn(true));
    await page.waitForFunction(() => !window.hexborne.store.getState().busy, null, { timeout: 60000 });
  }
  t.ok('five more turns', (await page.evaluate(() => window.hexborne.state.turn)) === 6);
});
