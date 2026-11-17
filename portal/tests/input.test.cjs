// Input: gamepad (standard mapping, simulated), toggle crouch, menus disable gameplay keys,
// F5 / F9 don't reach the browser.
const { run } = require('./harness.cjs');

run('input', async ({ page }, t) => {
  const r = await page.evaluate(() => {
    const input = window.twinfold.input, out = {};
    // A fake pad: left stick up, right stick right, A held, then RT pressed (edge).
    const pad = { connected: true, axes: [0, -1, 1, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
    pad.buttons[0].pressed = true;
    navigator.getGamepads = () => [pad];
    const d = input.takeMouseDelta();
    out.forward = input.isHeld('forward');
    out.jump = input.isHeld('jump');
    out.lookX = d.dx;
    pad.buttons[7].pressed = true;
    input.pollGamepad();
    out.fireB = input.consume('fireB');
    input.pollGamepad();
    out.fireBAgain = input.consume('fireB'); // held, not a new press
    pad.buttons[0].pressed = false;
    pad.axes = [0, 0, 0, 0];
    pad.buttons[7].pressed = false;
    input.pollGamepad();
    out.released = !input.isHeld('forward') && !input.isHeld('jump');
    // Toggle crouch (the option goes to the player through the session): one press on, one off.
    window.twinfoldShell.app.setOption('toggleCrouch', true);
    return out;
  });
  t.ok('left stick moves', r.forward);
  t.ok('A jumps', r.jump);
  t.ok('right stick looks', r.lookX > 5, String(r.lookX));
  t.ok('RT fires the amber opening once per press', r.fireB === true && r.fireBAgain === false);
  t.ok('releasing the pad releases the actions', r.released);

  // Each key press is seen by the fixed step (simulate while the key is down, then after release).
  const tap = async () => {
    await page.keyboard.down('KeyC');
    await page.evaluate(() => window.twinfold.simulate(0.1));
    await page.keyboard.up('KeyC');
    return page.evaluate(() => {
      window.twinfold.simulate(0.3);
      return window.twinfold.player.crouched;
    });
  };
  const on = await tap();
  const off = await tap();
  t.ok('toggle crouch: press on, press off', on === true && off === false, JSON.stringify([on, off]));
  await page.evaluate(() => window.twinfoldShell.app.setOption('toggleCrouch', false));

  // In the pause menu gameplay keys do nothing.
  await page.evaluate(() => window.twinfoldShell.app.pause());
  await page.keyboard.down('KeyW');
  const heldInMenu = await page.evaluate(() => window.twinfold.input.isHeld('forward'));
  await page.keyboard.up('KeyW');
  t.ok('menus disable gameplay keys', heldInMenu === false);
  await page.evaluate(() => window.twinfoldShell.app.resume());
  const prevented = await page.evaluate(() => {
    const e = new KeyboardEvent('keydown', { code: 'F5', cancelable: true });
    window.dispatchEvent(e);
    return e.defaultPrevented;
  });
  t.ok('F5 is kept from reloading the page', prevented);
});
