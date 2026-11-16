// Shared helpers for the headless game tests (see tests/README.md).
//
// Each test opens the built game in headless Chromium (Playwright), drives it through
// `window.game` (see main.ts) and records checks. `game.simulate(seconds)` runs physics
// steps immediately, so tests don't depend on the (slow) headless frame rate.

const { chromium } = require('playwright');

const URL = process.env.GAME_URL || 'http://localhost:4173/';

/** A saved look, so the character picker doesn't open on first visit and block input. */
function seedStorage(prologue) {
  localStorage.setItem('city.look.v1', JSON.stringify({ id: 'm_casual', skin: 3, hair: 0, outfit: 2, height: 1.78 }));
  // No story prologue popping up during unrelated checks (story.test.cjs asks for it).
  if (!prologue) localStorage.setItem('opencity.noPrologue', '1');
}

/**
 * Open the game. Options: `people` (wait until every pedestrian model has loaded), `prologue`
 * (let a new game start the story's prologue, as it does for players),
 * `viewport`, `context` (extra Playwright context options), `args` (extra browser args).
 */
async function openGame(options = {}) {
  const browser = await chromium.launch({
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required', ...(options.args ?? [])],
  });
  // If anything below fails (the page or the game doesn't load), close the browser: an open
  // browser keeps Node alive, and the test would hang instead of failing.
  try {
    const context = await browser.newContext({ viewport: options.viewport ?? { width: 640, height: 400 }, ...(options.context ?? {}) });
    await context.addInitScript(seedStorage, !!options.prologue);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    await page.goto(URL);
    await waitForGame(page, options.people);
    return { browser, context, page, errors };
  } catch (e) {
    await browser.close();
    throw e;
  }
}

async function waitForGame(page, people = false) {
  await page.waitForFunction(
    (people) => window.game && (!people || !window.game.pedestrians || window.game.pedestrians.debugPeds.length === 0 || window.game.pedestrians.peds.every((p) => p.model)),
    people,
    { timeout: 180000 },
  );
}

/** Collects pass/fail checks and prints them; `finish()` sets the exit code. */
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
    console.log(`${condition ? '  ✓' : '  ✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  }

  finish(errors = []) {
    this.ok('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
    console.log(`  ${this.passed} passed, ${this.failed} failed`);
    process.exitCode = this.failed ? 1 : 0;
  }
}

/** Run a test body with a fresh game, always closing the browser. */
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
    await game?.browser.close();
  }
}

module.exports = { URL, openGame, waitForGame, Checks, run };
