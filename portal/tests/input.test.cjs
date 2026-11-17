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
    // Toggle crouch: one press on, one press off.
    input.toggleCrouch = true;
    return out;
  });
  t.ok('left stick moves', r.forward);
  t.ok('A jumps', r.jump);
  t.ok('right stick looks', r.lookX > 5, String(r.lookX));
  t.ok('RT fires the amber opening once per press', r.fireB === true && r.fireBAgain === false);
  t.ok('releasing the pad releases the actions', r.released);

  await page.keyboard.press('KeyC');
  const on = await page.evaluate(() => window.twinfold.input.isHeld('crouch'));
  await page.keyboard.press('KeyC');
  const off = await page.evaluate(() => window.twinfold.input.isHeld('crouch'));
  t.ok('toggle crouch: press on, press off', on === true && off === false);
  await page.evaluate(() => (window.twinfold.input.toggleCrouch = false));

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
