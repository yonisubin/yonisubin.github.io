// Touch / mobile mode: detection and overrides, no pointer lock, tappable menus, the on-screen
// joystick (full vs partial speed), drag-to-look, fire / jump / use / pause buttons, first-run
// performance defaults vs stored options, the portrait hint, the puzzle maker blocked on a phone
// while share links still play, and no horizontal overflow on phone screens. Desktop stays as it was.
const { run, openGame, Checks } = require('./harness.cjs');

const LANDSCAPE = { width: 844, height: 390 };
const PORTRAIT = { width: 390, height: 844 };
const PHONE = { hasTouch: true, isMobile: true, deviceScaleFactor: 2 };
// Count pointer-lock requests (touch mode must never ask for one).
const COUNT_LOCKS = () => {
  window.__lockRequests = 0;
  const orig = Element.prototype.requestPointerLock;
  Element.prototype.requestPointerLock = function (...a) {
    window.__lockRequests++;
    return orig.apply(this, a);
  };
};

/** Synthetic touch pointer event on an element (or the touch overlay). */
async function ptr(page, type, id, x, y, selector = '#touchControls') {
  await page.evaluate(
    ([type, id, x, y, selector]) => {
      document.querySelector(selector).dispatchEvent(
        new PointerEvent(type, { pointerId: id, pointerType: 'touch', isPrimary: id === 1, clientX: x, clientY: y, bubbles: true, cancelable: true }),
      );
    },
    [type, id, x, y, selector],
  );
}

const hSpeed = (page) => page.evaluate(() => Math.hypot(window.twinfold.player.velocity.x, window.twinfold.player.velocity.z));

/** Every element in the menu overlay lies inside the viewport horizontally. */
const overflow = (page) =>
  page.evaluate(() => {
    const w = innerWidth;
    const bad = [...document.querySelectorAll('#overlay *')]
      .filter((e) => e.getClientRects().length)
      .map((e) => [e, e.getBoundingClientRect()])
      .filter(([, r]) => r.width > 0 && (r.right > w + 1 || r.left < -1))
      .map(([e, r]) => `${e.tagName}.${e.className}[${e.dataset.id ?? ''}] ${Math.round(r.left)}..${Math.round(r.right)}`);
    return { scroll: document.documentElement.scrollWidth - w, bad: bad.slice(0, 3), count: bad.length };
  });

const first = run(
  'mobile',
  async ({ page }, t) => {
    // --- Phone in landscape, from the main menu ----------------------------------------------
    const det = await page.evaluate(() => ({
      cls: document.documentElement.classList.contains('touch'),
      app: window.twinfoldShell.app.touchMode,
      input: window.twinfold.input.touchMode,
      o: window.twinfoldShell.app.options,
      ratio: window.twinfold.gl.getPixelRatio(),
      stored: localStorage.getItem('twinfold:options'),
    }));
    t.ok('touch device detected (html.touch, app, input)', det.cls && det.app && det.input);
    t.ok('first run on touch: recursion 3, render scale 0.75, 60 fps cap', det.o.recursionDepth === 3 && det.o.renderScale === 0.75 && det.o.frameCap === 60, JSON.stringify([det.o.recursionDepth, det.o.renderScale, det.o.frameCap]));
    t.near('pixel ratio capped at 1.5 × render scale', det.ratio, 1.5 * 0.75, 1e-6);
    t.ok('touch defaults are not written to storage', det.stored === null);

    const mainButtons = await page.evaluate(() => [...document.querySelectorAll('#overlay .mainMenu button')].map((b) => b.getBoundingClientRect().height));
    t.ok('menu tap targets ≥ 44 px', mainButtons.length >= 8 && mainButtons.every((hh) => hh >= 44 - 0.5), JSON.stringify(mainButtons));
    let ov = await overflow(page);
    t.ok('main menu: no horizontal overflow (landscape)', ov.scroll <= 0 && ov.count === 0, JSON.stringify(ov));

    await page.tap('[data-id=options]');
    t.ok('tapping Options opens the options screen', (await page.evaluate(() => window.twinfoldShell.app.menu.screen)) === 'options');
    for (const tab of ['video', 'audio', 'controls', 'gameplay', 'accessibility']) {
      await page.tap(`[data-id=tab-${tab}]`);
      ov = await overflow(page);
      t.ok(`options ${tab}: no horizontal overflow (landscape)`, ov.scroll <= 0 && ov.count === 0, JSON.stringify(ov));
    }
    await page.tap('[data-id=tab-controls]');
    const touchRows = await page.evaluate(() => ({
      pref: !!document.querySelector('[data-opt=touchControls]'),
      look: !!document.querySelector('[data-opt=touchLookSensitivity]'),
    }));
    t.ok('controls tab: touch controls + touch look sensitivity', touchRows.pref && touchRows.look);
    await page.tap('[data-id=back]');

    // Extras → puzzle maker is blocked on a phone, with a message.
    await page.tap('[data-id=extras]');
    await page.tap('[data-id=puzzleMaker]');
    const ed = await page.evaluate(() => ({
      state: window.twinfoldShell.app.state,
      editor: !!window.twinfoldShell.app.editor,
      note: !document.querySelector('[data-id=editorBlocked]').hidden,
    }));
    t.ok('puzzle maker blocked on a phone with a friendly note', ed.state === 'menu' && !ed.editor && ed.note, JSON.stringify(ed));
    await page.tap('[data-id=back]');

    await page.tap('[data-id=newGame]');
    await page.waitForFunction(() => window.twinfoldShell.app.state === 'game' && window.twinfold.chamber, null, { timeout: 30000 });
    await page.waitForTimeout(200);
    const started = await page.evaluate(() => ({
      chamber: window.twinfold.chamber.chamberId(),
      locks: window.__lockRequests,
      shown: getComputedStyle(document.getElementById('touchControls')).display !== 'none',
      hint: getComputedStyle(document.getElementById('rotateHint')).display,
    }));
    t.ok('New Game starts practical 01', started.chamber === 'c01', started.chamber);
    t.ok('no pointer lock requested in touch mode', started.locks === 0, String(started.locks));
    t.ok('touch controls shown in play', started.shown);
    t.ok('no portrait hint in landscape', started.hint === 'none');

    // Move into the gray-box room for movement / firing checks.
    await page.evaluate(() => {
      const tf = window.twinfold;
      tf.session.loadChamber(tf.levels.testroom);
      tf.place([-3, 0, 12], 0); // the spawn (x = 0 is over the pit)
      tf.player.rig.pitch = 0;
      tf.simulate(0.3);
    });
    await page.waitForTimeout(100);

    // Joystick: full deflection = walk speed, half deflection = slower.
    const R = 56;
    await ptr(page, 'pointerdown', 11, 200, 250);
    await ptr(page, 'pointermove', 11, 200, 250 - R * 1.5);
    await page.evaluate(() => window.twinfold.simulate(0.4));
    const full = await hSpeed(page);
    const dirZ = await page.evaluate(() => window.twinfold.player.velocity.z);
    t.near('full joystick deflection walks at 4.5 m/s', full, 4.5, 0.05);
    t.ok('pushing up walks forward (−z at yaw 0)', dirZ < -4);
    await ptr(page, 'pointermove', 11, 200, 250 - R * 0.5);
    await page.evaluate(() => window.twinfold.simulate(0.4));
    const half = await hSpeed(page);
    t.ok('half deflection walks slower', half > 0.8 && half < 3, half.toFixed(2));

    // Look with a second finger while the stick is held (multi-touch).
    const yaw0 = await page.evaluate(() => window.twinfold.player.rig.yaw);
    await ptr(page, 'pointerdown', 12, 600, 200);
    await ptr(page, 'pointermove', 12, 700, 200);
    await page.waitForFunction((y0) => window.twinfold.player.rig.yaw !== y0, yaw0, { timeout: 5000 }).catch(() => undefined);
    const yaw1 = await page.evaluate(() => window.twinfold.player.rig.yaw);
    t.near('dragging right turns the view right (100 px × 1.6 × 0.0022 rad)', yaw0 - yaw1, 100 * 1.6 * 0.0022, 0.02);
    const stillMoving = await page.evaluate(() => window.twinfold.input.stick().y);
    t.ok('stick still held during the look drag', stillMoving > 0.2, stillMoving.toFixed(2));
    await ptr(page, 'pointerup', 12, 700, 200);
    await ptr(page, 'pointerup', 11, 200, 250);
    await page.evaluate(() => window.twinfold.simulate(0.4));
    t.ok('releasing the stick stops the player', (await hSpeed(page)) < 0.05);

    // Fire buttons place the openings (aim at the white north wall).
    await page.evaluate(() => {
      const tf = window.twinfold;
      tf.portals.clear();
      tf.place([0, 0, 12], 0);
      tf.player.rig.yaw = 0;
      tf.player.rig.pitch = 0.25;
    });
    await page.tap('#touchControls .fireA');
    await page.evaluate(() => window.twinfold.simulate(0.05));
    await page.evaluate(() => (window.twinfold.player.rig.yaw = 0.35));
    await page.tap('#touchControls .fireB');
    await page.evaluate(() => window.twinfold.simulate(0.05));
    const placed = await page.evaluate(() => [!!window.twinfold.portals.a, !!window.twinfold.portals.b]);
    t.ok('BLUE places the blue opening', placed[0]);
    t.ok('AMBER places the amber opening', placed[1]);

    // Jump (held).
    await page.evaluate(() => {
      window.twinfold.player.rig.pitch = 0;
      window.twinfold.place([-3, 0, 12], 0);
      window.twinfold.simulate(0.3);
    });
    await ptr(page, 'pointerdown', 21, 0, 0, '#touchControls .jump');
    const feet0 = await page.evaluate(() => window.twinfold.player.feetY());
    await page.evaluate(() => window.twinfold.simulate(0.25));
    const jumped = await page.evaluate(() => window.twinfold.player.feetY());
    await ptr(page, 'pointerup', 21, 0, 0, '#touchControls .jump');
    t.ok('JUMP jumps', jumped - feet0 > 0.5, (jumped - feet0).toFixed(2));
    t.ok('JUMP released', !(await page.evaluate(() => window.twinfold.input.isHeld('jump'))));

    // Crouch (held).
    await page.evaluate(() => window.twinfold.simulate(1));
    await ptr(page, 'pointerdown', 22, 0, 0, '#touchControls .crouch');
    await page.evaluate(() => window.twinfold.simulate(0.2));
    const crouched = await page.evaluate(() => window.twinfold.player.crouched);
    await ptr(page, 'pointerup', 22, 0, 0, '#touchControls .crouch');
    await page.evaluate(() => window.twinfold.simulate(0.3));
    t.ok('CROUCH crouches while held, stands on release', crouched && !(await page.evaluate(() => window.twinfold.player.crouched)));

    // Use: lit while a use prompt shows; a tap sends `use`.
    const use = await page.evaluate(() => {
      const tf = window.twinfold;
      const btn = document.querySelector('#touchControls .use');
      tf.events.emit('prompt', { text: 'E  pick up' });
      const lit = btn.classList.contains('ready');
      const text = document.getElementById('prompt').textContent;
      tf.events.emit('prompt', { text: null });
      const unlit = !btn.classList.contains('ready');
      return { lit, unlit, text };
    });
    t.ok('USE lights up while a use prompt shows', use.lit && use.unlit);
    t.ok('use prompt names the USE button', use.text.startsWith('USE'), use.text);
    await page.evaluate(() => {
      const i = window.twinfold.input;
      window.__presses = [];
      const orig = i.press.bind(i);
      i.press = (a) => {
        window.__presses.push(a);
        orig(a);
      };
    });
    await page.tap('#touchControls .use');
    t.ok('USE sends the use action', (await page.evaluate(() => window.__presses)).includes('use'));

    // Pause → resume.
    await page.tap('#touchControls .pause');
    await page.waitForFunction(() => window.twinfoldShell.app.state === 'paused', null, { timeout: 5000 }).catch(() => undefined);
    const paused = await page.evaluate(() => ({
      state: window.twinfoldShell.app.state,
      hidden: getComputedStyle(document.getElementById('touchControls')).display === 'none',
      enabled: window.twinfold.input.enabled,
    }));
    t.ok('PAUSE opens the pause menu, controls hidden, input off', paused.state === 'paused' && paused.hidden && !paused.enabled, JSON.stringify(paused));
    ov = await overflow(page);
    t.ok('pause menu: no horizontal overflow', ov.scroll <= 0 && ov.count === 0, JSON.stringify(ov));
    await page.tap('[data-id=resume]');
    await page.waitForTimeout(150);
    const resumed = await page.evaluate(() => ({
      state: window.twinfoldShell.app.state,
      shown: getComputedStyle(document.getElementById('touchControls')).display !== 'none',
      locks: window.__lockRequests,
    }));
    t.ok('Resume returns to play with the controls, still no pointer lock', resumed.state === 'game' && resumed.shown && resumed.locks === 0, JSON.stringify(resumed));
  },
  { query: '', viewport: LANDSCAPE, ...PHONE, init: COUNT_LOCKS },
);

// --- Other devices / orientations (after the first part; run() resolves when it's done) -------
async function more() {
  const t = new Checks('mobile: portrait, overrides, stored options, share links, desktop');
  const errors = [];
  const close = async (g) => {
    errors.push(...g.errors);
    await g.browser.close();
  };
  try {
    // Portrait phone: no overflow on menu / options; the rotate hint in play, dismissible.
    let g = await openGame({ query: '', viewport: PORTRAIT, ...PHONE });
    let p = g.page;
    let ov = await overflow(p);
    t.ok('main menu: no horizontal overflow (portrait)', ov.scroll <= 0 && ov.count === 0, JSON.stringify(ov));
    await p.tap('[data-id=options]');
    for (const tab of ['video', 'audio', 'controls', 'gameplay', 'accessibility']) {
      await p.tap(`[data-id=tab-${tab}]`);
      ov = await overflow(p);
      t.ok(`options ${tab}: no horizontal overflow (portrait)`, ov.scroll <= 0 && ov.count === 0, JSON.stringify(ov));
    }
    await p.tap('[data-id=back]');
    await p.tap('[data-id=newGame]');
    await p.waitForFunction(() => window.twinfoldShell.app.state === 'game', null, { timeout: 30000 });
    await p.waitForTimeout(200);
    t.ok('portrait: "turn your phone" hint shows in play', (await p.evaluate(() => getComputedStyle(document.getElementById('rotateHint')).display)) === 'block');
    await p.tap('#rotateHint');
    await p.waitForTimeout(100);
    t.ok('the hint is dismissed by a tap', (await p.evaluate(() => getComputedStyle(document.getElementById('rotateHint')).display)) === 'none');
    // A share link made here plays on a phone.
    const hash = await p.evaluate(async () => window.twinfoldShell.encodeLevel(window.twinfold.levels.testroom));
    await close(g);

    g = await openGame({ query: '#play=' + hash, viewport: LANDSCAPE, ...PHONE, init: COUNT_LOCKS });
    p = g.page;
    t.ok('share link on a phone: no "open in the puzzle maker"', !(await p.$('[data-id=editShared]')));
    await p.tap('[data-id=playShared]');
    await p.waitForFunction(() => window.twinfoldShell.app.state === 'game', null, { timeout: 30000 }).catch(() => undefined);
    const shared = await p.evaluate(() => ({ state: window.twinfoldShell.app.state, run: window.twinfoldShell.app.run.kind, locks: window.__lockRequests }));
    t.ok('share link plays on a phone', shared.state === 'game' && shared.run === 'custom' && shared.locks === 0, JSON.stringify(shared));
    await close(g);

    // Stored options win over the touch defaults.
    g = await openGame({
      query: '',
      viewport: LANDSCAPE,
      ...PHONE,
      init: () => localStorage.setItem('twinfold:options', JSON.stringify({ recursionDepth: 7, frameCap: 0 })),
    });
    const stored = await g.page.evaluate(() => window.twinfoldShell.app.options);
    t.ok('stored options win over touch defaults', stored.recursionDepth === 7 && stored.frameCap === 0 && stored.renderScale === 1, JSON.stringify([stored.recursionDepth, stored.frameCap, stored.renderScale]));
    await close(g);

    // ?desktop on a phone: the desktop game.
    g = await openGame({ query: '?desktop', viewport: LANDSCAPE, ...PHONE });
    const off = await g.page.evaluate(() => ({ cls: document.documentElement.classList.contains('touch'), app: window.twinfoldShell.app.touchMode, input: window.twinfold.input.touchMode }));
    t.ok('?desktop turns touch mode off on a phone', !off.cls && !off.app && !off.input, JSON.stringify(off));
    await close(g);

    // Desktop: unchanged (no touch, pointer lock requested on New Game, desktop defaults); ?touch forces it.
    g = await openGame({ query: '', init: COUNT_LOCKS });
    p = g.page;
    const desk = await p.evaluate(() => ({
      cls: document.documentElement.classList.contains('touch'),
      depth: window.twinfoldShell.app.options.recursionDepth,
      scale: window.twinfoldShell.app.options.renderScale,
      cap: window.twinfoldShell.app.options.frameCap,
    }));
    t.ok('desktop: no touch mode, desktop defaults', !desk.cls && desk.depth === 9 && desk.scale === 1 && desk.cap === 0, JSON.stringify(desk));
    await p.click('[data-id=newGame]');
    await p.waitForFunction(() => window.twinfoldShell.app.state === 'game', null, { timeout: 30000 });
    const desk2 = await p.evaluate(() => ({ locks: window.__lockRequests, shown: getComputedStyle(document.getElementById('touchControls')).display !== 'none' }));
    t.ok('desktop: New Game still asks for pointer lock, no touch controls', desk2.locks > 0 && !desk2.shown, JSON.stringify(desk2));
    await close(g);

    g = await openGame({ query: '?touch&chamber=testroom' });
    const forced = await g.page.evaluate(() => ({ cls: document.documentElement.classList.contains('touch'), shown: getComputedStyle(document.getElementById('touchControls')).display !== 'none' }));
    t.ok('?touch forces touch mode on a desktop', forced.cls && forced.shown, JSON.stringify(forced));
    await close(g);
  } catch (e) {
    t.ok('second part ran to the end', false, String(e && e.stack ? e.stack.split('\n').slice(0, 3).join(' ') : e));
  }
  const prev = process.exitCode;
  t.finish(errors);
  if (prev) process.exitCode = prev;
}

first.then(more);
