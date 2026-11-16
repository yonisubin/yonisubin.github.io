// Shared helpers for Hexborne's headless tests (see README.md). Each test opens the built game
// in headless Chromium (Playwright) and drives it through window.hexborne.
const { chromium } = require('playwright');

const URL = process.env.CIV_URL || 'http://localhost:4174/civilization/';

async function openGame(options = {}) {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
    const context = await browser.newContext({ viewport: options.viewport ?? { width: 1100, height: 700 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    await page.goto(URL);
    await page.waitForFunction(() => window.hexborne, null, { timeout: 120000 });
    // Install a scenario helper: a flat, empty patch of grassland around a tile.
    await page.evaluate(() => {
      window.flatten = (s, center, radius) => {
        const w = s.map.w;
        const cr = Math.floor(center / w), cc = center % w;
        for (let i = 0; i < s.map.tiles.length; i++) {
          const r = Math.floor(i / w), c = i % w;
          let dc = Math.abs(c - cc);
          dc = Math.min(dc, w - dc);
          if (Math.abs(r - cr) <= radius && dc <= radius + 1) {
            Object.assign(s.map.tiles[i], { terrain: 'grassland', hills: false, feature: null, resource: null, resourceQty: 0, improvement: null, road: false, roadOwner: -1, river: 0, owner: -1, cityId: -1, ruin: false, camp: false, area: 1 });
          }
        }
        for (const id of Object.keys(s.units)) delete s.units[id];
        for (const id of Object.keys(s.cities)) delete s.cities[id];
        for (const k of Object.keys(s.camps)) delete s.camps[k];
      };
    });
    return { browser, page, errors };
  } catch (e) {
    await browser.close();
    throw e;
  }
}

class Checks {
  constructor(name) {
    this.name = name;
    this.failed = 0;
    this.passed = 0;
    console.log(`\n# ${name}`);
  }
  ok(label, condition, detail = '') {
    if (condition) this.passed++;
    else this.failed++;
    const d = typeof detail === 'string' ? detail : JSON.stringify(detail);
    console.log(`${condition ? '  ✓' : '  ✗'} ${label}${d ? ` — ${d}` : ''}`);
  }
  finish(errors = []) {
    this.ok('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
    console.log(`  ${this.passed} passed, ${this.failed} failed`);
    process.exitCode = this.failed ? 1 : 0;
  }
}

async function run(name, body, options) {
  const checks = new Checks(name);
  let game;
  try {
    game = await openGame(options);
    await body(game, checks);
  } catch (e) {
    checks.ok('test ran to the end', false, String(e && e.stack ? e.stack.split('\n').slice(0, 3).join(' ') : e));
  } finally {
    checks.finish(game ? game.errors : []);
    if (game) await game.browser.close();
  }
}

module.exports = { run, openGame, Checks };
