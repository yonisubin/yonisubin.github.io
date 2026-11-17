// Shared helpers for Twinfold's headless tests (see README.md). Each test opens the built game in
// headless Chromium (Playwright) and drives it through window.twinfold.
const { chromium } = require('playwright');

const URL = process.env.PORTAL_URL || 'http://localhost:4175/portal/';

async function openGame(options = {}) {
  // Audio may start without a click (the shell's music / voice checks need a running AudioContext).
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
  try {
    // Phone checks pass { hasTouch, isMobile, deviceScaleFactor } (tests/mobile.test.cjs); the default is a desktop.
    const ctx = { viewport: options.viewport ?? { width: 640, height: 400 } };
    for (const k of ['hasTouch', 'isMobile', 'deviceScaleFactor']) if (options[k] !== undefined) ctx[k] = options[k];
    const context = await browser.newContext(ctx);
    if (options.init) await context.addInitScript(options.init);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    // By default the game starts straight in the gray-box test room (?chamber=testroom skips the main
    // menu; the checks of movement, placement, travel... are written against it now that the
    // campaign's first chamber is a real practical). Pass { query: '?autostart' } for the campaign's
    // first chamber, or { query: '' } (or another query / hash) to test the shell from the menu.
    await page.goto(URL + (options.query ?? '?chamber=testroom'));
    await page.waitForFunction(() => window.twinfold && window.twinfold.ready, null, { timeout: 120000 });
    if (options.shell !== false) await page.waitForFunction(() => window.twinfoldShell && window.twinfoldShell.ready, null, { timeout: 60000 });
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
  near(label, actual, expected, tol) {
    this.ok(label, Math.abs(actual - expected) <= tol, `${Number(actual).toFixed(3)} (want ${expected} ± ${tol})`);
  }
  finish(errors = []) {
    this.ok('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
    console.log(`  ${this.passed} passed, ${this.failed} failed`);
    process.exitCode = this.failed ? 1 : 0;
  }
}

async function run(name, body, options = {}) {
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
