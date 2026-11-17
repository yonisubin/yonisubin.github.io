// Main menu, pause menu, HUD from events, the campaign end → unlocks. Starts at the main menu.
const { run } = require('./harness.cjs');

const screen = (page) => page.evaluate(() => window.twinfoldShell.app.menu.screen);
const state = (page) => page.evaluate(() => window.twinfoldShell.app.state);

run(
  'menus',
  async ({ page }, t) => {
    // --- Main menu --------------------------------------------------------------------------
    t.ok('opens on the main menu', (await screen(page)) === 'main');
    t.ok('menu root is #overlay and visible', await page.evaluate(() => getComputedStyle(document.getElementById('overlay')).display === 'flex'));
    const ids = await page.evaluate(() => [...document.querySelectorAll('#overlay .mainMenu button')].map((b) => b.dataset.id));
    t.ok('every main menu entry', ['newGame', 'continue', 'loadGame', 'chapterSelect', 'challenges', 'advanced', 'extras', 'options', 'quit'].every((i) => ids.includes(i)), ids.join(','));
    t.ok('Continue is disabled without saves', await page.evaluate(() => document.querySelector('#overlay [data-id=continue]').disabled));
    t.ok('the logo is drawn in code (SVG)', await page.evaluate(() => !!document.querySelector('#overlay svg.logo')));
    await page.waitForTimeout(600);
    t.ok('animated 3D background renders', await page.evaluate(() => window.twinfoldShell.app.background.frameCount > 2), await page.evaluate(() => window.twinfoldShell.app.background.frameCount));

    // Sub-screens and Back (button and Esc).
    await page.click('#overlay [data-id=options]');
    t.ok('Options opens', (await screen(page)) === 'options');
    await page.click('#overlay [data-id=back]');
    t.ok('Back returns to the main menu', (await screen(page)) === 'main');
    await page.click('#overlay [data-id=extras]');
    await page.click('#overlay [data-id=credits]');
    t.ok('Extras → Credits', (await screen(page)) === 'credits');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);
    t.ok('Esc goes back one screen', (await screen(page)) === 'extras');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);
    t.ok('Esc again: main menu', (await screen(page)) === 'main');
    await page.click('#overlay [data-id=challenges]');
    await page.waitForSelector('#overlay [data-screen=challenges]');
    t.ok('Challenges are locked before the story is finished', await page.evaluate(() => !!document.querySelector('#overlay [data-locked]')));
    await page.click('#overlay [data-id=back]');
    await page.click('#overlay [data-id=chapterSelect]');
    t.ok('Chapter select lists the test room', await page.evaluate(() => !!document.querySelector('#overlay [data-id=chamber-testroom]')));
    await page.click('#overlay [data-id=back]');
    await page.focus('#overlay [data-id=newGame]');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    t.ok('arrow keys move between entries (skipping disabled ones)', await page.evaluate(() => document.activeElement.dataset.id === 'chapterSelect'), await page.evaluate(() => document.activeElement.dataset.id));
    await page.click('#overlay [data-id=quit]');
    t.ok('Quit shows a title card', (await screen(page)) === 'quit');
    await page.click('#overlay [data-id=returnToMenu]');
    t.ok('… with a way back to the menu', (await screen(page)) === 'main');

    // --- New game → play -------------------------------------------------------------------
    await page.click('#overlay [data-id=newGame]');
    await page.waitForFunction(() => window.twinfoldShell.app.state === 'game');
    const started = await page.evaluate(() => {
      const s = window.twinfoldShell;
      return { overlay: getComputedStyle(document.getElementById('overlay')).display, chamber: s.session.current().id, log: s.app.log.slice(), bg: getComputedStyle(s.app.background.canvas).display };
    });
    t.ok('New Game hides the menu', started.overlay === 'none');
    t.ok('… and the background', started.bg === 'none');
    t.ok('… and starts the first chamber', started.chamber === 'testroom' && started.log.includes('chamberStart testroom'), started.log.join(' | '));

    // --- Pause menu ------------------------------------------------------------------------
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.twinfoldShell.app.state === 'paused');
    const paused = await page.evaluate(() => {
      const s = window.twinfoldShell;
      return { screen: s.app.menu.screen, sessionPaused: s.session.isPaused(), inputOn: s.app.input.enabled, ids: [...document.querySelectorAll('#overlay .mainMenu button')].map((b) => b.dataset.id) };
    });
    t.ok('Esc in play opens the pause menu', paused.screen === 'pause');
    t.ok('pausing pauses the session and input', paused.sessionPaused === true && paused.inputOn === false);
    t.ok('pause menu entries', ['resume', 'save', 'load', 'options', 'restart', 'quitToMenu'].every((i) => paused.ids.includes(i)), paused.ids.join(','));
    await page.click('#overlay [data-id=resume]');
    t.ok('Resume returns to play', (await state(page)) === 'game' && (await page.evaluate(() => !window.twinfoldShell.session.isPaused())));
    // Restart chamber from the pause menu puts you back at the spawn.
    await page.evaluate(() => window.twinfold.place([5, 0, -5]));
    await page.evaluate(() => window.twinfoldShell.app.pause());
    await page.click('#overlay [data-id=restart]');
    const afterRestart = await page.evaluate(() => {
      const p = window.twinfold.player.position;
      return { state: window.twinfoldShell.app.state, x: p.x, z: p.z };
    });
    t.ok('Restart chamber respawns at the start', afterRestart.state === 'game' && Math.abs(afterRestart.x + 3) < 0.01 && Math.abs(afterRestart.z - 12) < 0.01, JSON.stringify(afterRestart));

    // --- HUD from events -------------------------------------------------------------------
    const hud = await page.evaluate(() => {
      const ev = window.twinfoldShell.session.events;
      ev.emit('prompt', { text: 'E  pick up' });
      const prompt = document.getElementById('prompt').textContent;
      const shown = getComputedStyle(document.getElementById('prompt')).display;
      ev.emit('prompt', { text: null });
      const hidden = getComputedStyle(document.getElementById('prompt')).display;
      ev.emit('damage', { amount: 10, health: 90 });
      return { prompt, shown, hidden, vignette: window.twinfoldShell.app.hud.vignetteOpacity };
    });
    t.ok('use prompt from `prompt` events', hud.prompt === 'E  pick up' && hud.shown === 'block' && hud.hidden === 'none', JSON.stringify(hud));
    t.ok('red damage vignette from `damage` events', hud.vignette > 0.2, hud.vignette.toFixed(2));
    await page.waitForTimeout(1300);
    t.ok('the vignette fades', await page.evaluate(() => window.twinfoldShell.app.hud.vignetteOpacity < 0.05));

    // --- Chamber complete → elevator → end of the (one-chamber) campaign → unlocks ----------
    await page.evaluate(() => {
      const s = window.twinfoldShell;
      s.session.events.emit('exitReached', { chamberId: 'testroom', ...s.session.counters() });
    });
    const card = await page.evaluate(() => ({ text: document.getElementById('chamberCard').textContent, display: getComputedStyle(document.getElementById('chamberCard')).display, state: window.twinfoldShell.app.state }));
    t.ok('exit shows the chamber-complete card', card.display === 'block' && card.text.includes('Practical complete') && card.state === 'elevator', JSON.stringify(card));
    // The test room has no exit elevator: send the end of the ride as its exit booth would.
    await page.waitForTimeout(300);
    await page.evaluate(() => window.twinfoldShell.session.events.emit('elevatorDone', { chamberId: 'testroom' }));
    await page.waitForFunction(() => window.twinfoldShell.app.menu.screen === 'end', null, { timeout: 10000 });
    const end = await page.evaluate(() => ({ story: window.twinfoldShell.app.saves.progress.storyFinished, log: window.twinfoldShell.app.log.slice(-3) }));
    t.ok('the last chamber ends the story', end.story === true, end.log.join(' | '));
    await page.click('#overlay [data-id=toMain]');
    await page.waitForSelector('#overlay [data-id=challenges]');
    t.ok('challenges unlock after the story', await page.evaluate(() => !document.querySelector('#overlay [data-id=challenges]').textContent.includes('🔒')));
    await page.click('#overlay [data-id=challenges]');
    await page.waitForSelector('#overlay [data-screen=challenges]');
    t.ok('… and open', await page.evaluate(() => !document.querySelector('#overlay [data-locked]') && !!document.querySelector('#overlay [data-id^=challenge-testroom]')));
  },
  { query: '' },
);
