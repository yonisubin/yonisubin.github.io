// Challenges: locked until the story is finished (dev unlock for tests), medal thresholds per chamber,
// counters on the HUD, a medal + leaderboard entry when the exit is reached, boards sorted best first.
const { run } = require('./harness.cjs');

run(
  'challenges',
  async ({ page }, t) => {
    await page.click('#overlay [data-id=challenges]');
    await page.waitForSelector('#overlay [data-screen=challenges]');
    t.ok('locked before the story', await page.evaluate(() => !!document.querySelector('#overlay [data-locked]')));
    await page.click('#overlay [data-id=back]');
    await page.evaluate(() => {
      window.twinfoldShell.app.devUnlocked = true;
      window.twinfoldShell.app.menu.open('main');
    });

    const m = await page.evaluate(() => {
      const s = window.twinfoldShell, th = s.thresholds('testroom', 'portals');
      return [2, 3, 4, 8, 9].map((v) => s.medalFor(v, th));
    });
    t.ok('medals: lower is better (gold ≤ 2, silver ≤ 4, bronze ≤ 8)', JSON.stringify(m) === JSON.stringify(['gold', 'silver', 'silver', 'bronze', null]), JSON.stringify(m));

    await page.click('#overlay [data-id=challenges]');
    await page.waitForSelector('#overlay [data-id=challenge-testroom-portals]');
    t.ok('dev unlock opens the challenge list with all three modes', await page.evaluate(() => ['portals', 'steps', 'time'].every((x) => !!document.querySelector(`#overlay [data-id=challenge-testroom-${x}]`))));

    // Least portals: start, place two portals, reach the exit → gold.
    await page.click('#overlay [data-id=challenge-testroom-portals]');
    await page.waitForFunction(() => window.twinfoldShell.app.state === 'game');
    await page.evaluate(() => {
      window.twinfold.fire('a', [-8, 0.6, 12], [-1, 0, 0]);
      window.twinfold.fire('b', [8, 0.6, 12], [1, 0, 0]);
      window.twinfold.simulate(0.1);
    });
    await page.waitForTimeout(150);
    const hud = await page.evaluate(() => ({ text: document.getElementById('challengeHud').textContent, shown: getComputedStyle(document.getElementById('challengeHud')).display, c: window.twinfoldShell.session.counters() }));
    t.ok('the HUD shows the challenge timer and counters', hud.shown === 'block' && hud.text.includes('◐ 2') && hud.text.includes('⏱'), hud.text);
    const exit = () =>
      page.evaluate(() => {
        const s = window.twinfoldShell;
        s.session.events.emit('exitReached', { chamberId: 'testroom', ...s.session.counters() });
      });
    await exit();
    await page.waitForSelector('#overlay [data-screen=result]');
    t.ok('two portals: gold medal', (await page.evaluate(() => document.querySelector('#overlay [data-medal]').dataset.medal)) === 'gold');
    t.ok('the HUD timer goes away', await page.evaluate(() => getComputedStyle(document.getElementById('challengeHud')).display === 'none'));

    // Try again with more portals → silver; the board keeps both, best first.
    await page.click('#overlay [data-id=retry]');
    await page.waitForFunction(() => window.twinfoldShell.app.state === 'game');
    await page.evaluate(() => {
      for (let i = 0; i < 5; i++) window.twinfold.fire(i % 2 ? 'b' : 'a', [i % 2 ? 8 : -8, 0.6, 12 - i * 2], [i % 2 ? 1 : -1, 0, 0]);
    });
    const placed = await page.evaluate(() => window.twinfoldShell.session.counters().portals);
    t.ok('counters restart with the chamber', placed >= 3 && placed <= 4, String(placed));
    await exit();
    await page.waitForSelector('#overlay [data-screen=result]');
    t.ok('three or four portals: silver', (await page.evaluate(() => document.querySelector('#overlay [data-medal]').dataset.medal)) === 'silver');
    await page.click('#overlay [data-id=toChallenges]');
    await page.waitForSelector('#overlay [data-board="testroom:portals"]');
    const board = await page.evaluate(() => [...document.querySelectorAll('#overlay [data-board="testroom:portals"] li')].map((l) => l.textContent));
    t.ok('local leaderboard, best first', board.length === 2 && board[0].startsWith('2 ') && board[1].startsWith(`${placed} `), board.join(' / '));
    t.ok('best run shown on the challenge', await page.evaluate(() => document.querySelector('#overlay [data-best="testroom:portals"]').textContent.includes('best 2 (gold)')));

    // Least steps: walk, finish → value is the step counter.
    await page.click('#overlay [data-id=challenge-testroom-steps]');
    await page.waitForFunction(() => window.twinfoldShell.app.state === 'game');
    const steps = await page.evaluate(() => {
      const tf = window.twinfold;
      tf.aim(0, 0);
      tf.hold('forward', true);
      tf.simulate(2);
      tf.hold('forward', false);
      return window.twinfoldShell.session.counters().steps;
    });
    await exit();
    await page.waitForSelector('#overlay [data-screen=result]');
    const title = await page.evaluate(() => document.querySelector('#overlay [data-screen=result] h2').textContent);
    t.ok('least steps records the step counter', steps > 0 && title === `Least steps: ${steps}`, `${title} (${steps})`);
    t.ok('few steps: gold', (await page.evaluate(() => document.querySelector('#overlay [data-medal]').dataset.medal)) === 'gold');

    // Least time: 100 s of simulated time misses every medal.
    await page.evaluate(() => window.twinfoldShell.app.startChallenge('testroom', 'time'));
    await page.evaluate(() => window.twinfold.simulate(100));
    await exit();
    await page.waitForSelector('#overlay [data-screen=result]');
    t.ok('a slow run gets no medal', (await page.evaluate(() => document.querySelector('#overlay [data-medal]').dataset.medal)) === 'none');
    const lb = await page.evaluate(async () => {
      const req = indexedDB.open('twinfold');
      const db = await new Promise((res) => (req.onsuccess = () => res(req.result)));
      return new Promise((res) => {
        const g = db.transaction('leaderboard').objectStore('leaderboard').getAll();
        g.onsuccess = () => res(g.result.map((r) => `${r.key}:${r.entries.length}`));
      });
    });
    t.ok('leaderboards live in IndexedDB per chamber and mode', ['testroom:portals:2', 'testroom:steps:1', 'testroom:time:1'].every((k) => lb.includes(k)), lb.join(','));
  },
  { query: '' },
);
