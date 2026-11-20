// Quick check: open the viewer with the given query, step some frames, save a screenshot.
// node rl/record/shot.cjs "<query>" out.png [frames]
const { chromium } = require('playwright');
(async () => {
  const [query, out, frames = '60'] = process.argv.slice(2);
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  page.on('console', (m) => console.log('console:', m.text()));
  page.on('pageerror', (e) => console.log('pageerror:', e.message));
  await page.goto(`http://localhost:5190/?record=1&w=960&h=540&${query}`);
  await page.waitForFunction(() => window.viewer && window.viewer.ready, null, { timeout: 180000 });
  const t0 = Date.now();
  for (let i = 0; i < Number(frames); i++) await page.evaluate(() => window.viewer.frame());
  console.log('frames', frames, 'in', Date.now() - t0, 'ms', JSON.stringify(await page.evaluate(() => window.viewer.stats())));
  await page.screenshot({ path: out });
  await browser.close();
})();
