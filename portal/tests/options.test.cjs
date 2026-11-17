// Options: every tab changes what it should (session settings, audio buses, HUD, input, CSS),
// persists in localStorage `twinfold:options` / `twinfold:bindings`, and is re-applied after a reload.
const { run } = require('./harness.cjs');

/** Set a range / select / checkbox in the options screen like a user would. */
async function setOpt(page, key, value) {
  await page.evaluate(
    ([k, v]) => {
      const el = document.querySelector(`#overlay [data-opt=${k}]`);
      if (el.type === 'checkbox') {
        el.checked = v;
        el.dispatchEvent(new Event('change', { bubbles: true }));
      } else {
        el.value = String(v);
        el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
      }
    },
    [key, value],
  );
}

run(
  'options',
  async ({ page }, t) => {
    await page.click('#overlay [data-id=options]');
    // Video
    await setOpt(page, 'fov', 104);
    await setOpt(page, 'recursionDepth', 4);
    await setOpt(page, 'brightness', 1.2);
    const ratio0 = await page.evaluate(() => window.twinfold.gl.getPixelRatio());
    await setOpt(page, 'renderScale', 0.5);
    await setOpt(page, 'frameCap', 30);
    let r = await page.evaluate(async () => {
      const tf = window.twinfold;
      const f0 = tf.framesDrawn, t0 = performance.now();
      await new Promise((res) => setTimeout(res, 1000));
      const fps = ((tf.framesDrawn - f0) * 1000) / (performance.now() - t0);
      return { fov: tf.camera.fov, depth: tf.renderer.recursionDepth, filter: document.getElementById('game').style.filter, ratio: tf.gl.getPixelRatio(), canvasW: document.getElementById('game').width, innerW: window.innerWidth, cap: tf.frameCap, fps };
    });
    t.ok('FOV reaches the camera through applySettings', r.fov === 104, JSON.stringify(r));
    t.ok('recursion depth applies', r.depth === 4);
    t.ok('brightness is a CSS filter on the game canvas', r.filter.includes('brightness(1.2)'), r.filter);
    t.ok('render scale sets the drawing buffer size', Math.abs(r.ratio - ratio0 * 0.5) < 1e-6 && Math.abs(r.canvasW - r.innerW * r.ratio) <= 1, JSON.stringify({ ratio0, ratio: r.ratio, canvasW: r.canvasW }));
    t.ok('frame cap limits the frames drawn', r.cap === 30 && r.fps <= 33, `${r.fps.toFixed(1)} fps`);
    await setOpt(page, 'renderScale', 1);
    await setOpt(page, 'frameCap', 0);
    t.ok('… and both go back', await page.evaluate((r0) => window.twinfold.gl.getPixelRatio() === r0 && window.twinfold.frameCap === 0, ratio0));

    // Audio
    await page.click('#overlay [data-id=tab-audio]');
    await setOpt(page, 'music', 0.25);
    await setOpt(page, 'subtitles', false);
    await setOpt(page, 'captions', true);
    r = await page.evaluate(() => {
      const a = window.twinfoldShell.app;
      return { music: a.sound.volumes.music, subs: a.dialogue.subtitles, caps: a.dialogue.captions };
    });
    t.ok('music volume reaches the music bus', r.music === 0.25);
    t.ok('subtitles can be turned off, captions on', r.subs === false && r.caps === true);

    // Controls
    await page.click('#overlay [data-id=tab-controls]');
    await setOpt(page, 'mouseSensitivity', 2);
    await setOpt(page, 'invertY', true);
    await setOpt(page, 'toggleCrouch', true);
    await setOpt(page, 'gamepadSensitivity', 1.5);
    r = await page.evaluate(() => {
      const a = window.twinfoldShell.app;
      const rig = window.twinfold.player.rig;
      return { scale: rig.sensitivity / window.twinfold.config.camera.mouseSensitivity, inv: rig.invertY, toggle: window.twinfold.player.toggleCrouch, pad: a.input.gamepadSensitivity };
    });
    t.ok('mouse sensitivity and invert Y reach the camera rig', Math.abs(r.scale - 2) < 1e-9 && r.inv === true, JSON.stringify(r));
    t.ok('toggle crouch and gamepad sensitivity apply', r.toggle === true && r.pad === 1.5);
    // Rebind jump to K.
    await page.click('#overlay [data-id=bind-jump-0]');
    t.ok('rebinding waits for a key', await page.evaluate(() => document.querySelector('#overlay [data-id=bind-jump-0]').textContent.includes('Press')));
    await page.keyboard.press('KeyK');
    r = await page.evaluate(() => ({ jump: window.twinfoldShell.app.input.bindings.jump, label: document.querySelector('#overlay [data-id=bind-jump-0]').textContent, stored: JSON.parse(localStorage.getItem('twinfold:bindings')).jump }));
    t.ok('jump is rebound to K', r.jump[0] === 'KeyK' && r.label === 'K' && r.stored[0] === 'KeyK', JSON.stringify(r));

    // Gameplay + accessibility
    await page.click('#overlay [data-id=tab-gameplay]');
    await setOpt(page, 'crosshairIndicator', false);
    await setOpt(page, 'assist', true);
    await page.click('#overlay [data-id=tab-accessibility]');
    await setOpt(page, 'palette', 'tritanopia');
    await setOpt(page, 'reduceRoll', true);
    await setOpt(page, 'highContrastHazards', true);
    r = await page.evaluate(() => {
      const s = window.twinfoldShell;
      const paths = [...document.querySelectorAll('#crosshair path')];
      return { stroke: paths[0].getAttribute('stroke'), vis: paths[0].style.visibility, colors: s.session.settings.portalColors, roll: window.twinfold.player.rig.reduceRoll, assist: s.session.settings.assist, hc: document.body.classList.contains('highContrast') && s.session.settings.highContrastHazards };
    });
    t.ok('colour-blind palette recolours the crosshair', r.stroke === '#00c7b4', r.stroke);
    t.ok('… and goes to the session', r.colors.a === 0x00c7b4 && r.colors.b === 0xff2d6f);
    t.ok('crosshair indicator can be hidden', r.vis === 'hidden');
    t.ok('reduce roll, assist, high-contrast hazards apply', r.roll && r.assist && r.hc);
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('twinfold:options')));
    t.ok('options are stored in twinfold:options', stored.fov === 104 && stored.palette === 'tritanopia' && stored.music === 0.25);

    // Reload: everything comes back and is applied at start.
    await page.reload();
    await page.waitForFunction(() => window.twinfoldShell && window.twinfoldShell.ready, null, { timeout: 120000 });
    r = await page.evaluate(() => {
      const s = window.twinfoldShell, tf = window.twinfold;
      return { fov: tf.camera.fov, depth: tf.renderer.recursionDepth, music: s.app.sound.volumes.music, palette: s.app.options.palette, jump: s.app.input.bindings.jump[0], stroke: document.querySelector('#crosshair path').getAttribute('stroke'), subs: s.app.dialogue.subtitles };
    });
    t.ok('after a reload the options persist and apply', r.fov === 104 && r.depth === 4 && r.music === 0.25 && r.palette === 'tritanopia' && r.stroke === '#00c7b4' && r.subs === false, JSON.stringify(r));
    t.ok('… and so do the key bindings', r.jump === 'KeyK');
    // The rebound key works in play.
    await page.evaluate(() => window.twinfoldShell.app.startCampaignAt(window.twinfoldShell.chambers.getChamber('testroom')));
    await page.keyboard.down('KeyK');
    const held = await page.evaluate(() => window.twinfold.input.isHeld('jump'));
    await page.keyboard.up('KeyK');
    t.ok('the new key drives the action', held === true);

    // Reset to defaults; garbage in storage falls back to defaults.
    await page.evaluate(() => window.twinfoldShell.app.quitToMenu());
    await page.click('#overlay [data-id=options]');
    await page.click('#overlay [data-id=resetOptions]');
    r = await page.evaluate(() => ({ fov: window.twinfold.camera.fov, palette: window.twinfoldShell.app.options.palette }));
    t.ok('reset to defaults', r.fov === 90 && r.palette === 'standard', JSON.stringify(r));
    await page.evaluate(() => localStorage.setItem('twinfold:options', '{"fov":"wide","music":7,"palette":"plaid"}'));
    await page.reload();
    await page.waitForFunction(() => window.twinfoldShell && window.twinfoldShell.ready, null, { timeout: 120000 });
    r = await page.evaluate(() => window.twinfoldShell.app.options);
    t.ok('bad stored values are cleaned up', r.fov === 90 && r.music === 1 && r.palette === 'standard', JSON.stringify({ fov: r.fov, music: r.music, palette: r.palette }));
  },
  { query: '' },
);
