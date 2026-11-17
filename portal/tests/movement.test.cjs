// Player controller numbers from the spec: walk speed, jump height, crouch, step-up, air control.
const { run } = require('./harness.cjs');

run('movement', async ({ page }, t) => {
  const r = await page.evaluate(() => {
    const tf = window.twinfold, P = tf.player, out = {};
    // Standing on the floor at the spawn.
    tf.place([-3, 0, 12]);
    tf.simulate(0.3);
    out.grounded = P.grounded;
    out.eyeHeight = P.eye().y - P.feetY();
    // Walk north for 1 s: settles at 4.5 m/s.
    tf.aim(0, 0);
    tf.hold('forward', true);
    tf.simulate(1);
    out.walkSpeed = Math.hypot(P.velocity.x, P.velocity.z);
    tf.hold('forward', false);
    tf.simulate(0.3);
    out.stopSpeed = Math.hypot(P.velocity.x, P.velocity.z);
    // Jump apex.
    const y0 = P.feetY();
    let apex = 0;
    tf.hold('jump', true);
    for (let i = 0; i < 90; i++) {
      tf.simulate(1 / 60);
      apex = Math.max(apex, P.feetY() - y0);
    }
    tf.hold('jump', false);
    out.apex = apex;
    out.landed = P.grounded;
    // Crouch: shorter, slower.
    tf.hold('crouch', true);
    tf.simulate(0.5);
    out.crouched = P.crouched;
    out.crouchEye = P.eye().y - P.feetY();
    tf.hold('forward', true);
    tf.simulate(1);
    out.crouchSpeed = Math.hypot(P.velocity.x, P.velocity.z);
    tf.hold('forward', false);
    tf.hold('crouch', false);
    tf.simulate(0.5);
    out.stoodUp = !P.crouched;
    // Step up onto the 0.4 m crate at x -4.6..-3.6, z 10..11.
    tf.place([-4.1, 0, 13], 0);
    tf.hold('forward', true);
    tf.simulate(0.8);
    tf.hold('forward', false);
    out.onCrate = P.feetY();
    // Air control steers but never brakes: launch at 10 m/s east, hold "back" (west).
    tf.place([5, 3, 0], -Math.PI / 2, [10, 0, 0]);
    tf.aim(-Math.PI / 2, 0); // facing east
    tf.hold('back', true);
    tf.simulate(0.3);
    tf.hold('back', false);
    out.airSpeed = Math.hypot(P.velocity.x, P.velocity.z);
    return out;
  });
  t.ok('starts on the ground', r.grounded);
  t.near('eye height 1.63 m', r.eyeHeight, 1.63, 0.03);
  t.near('walk speed 4.5 m/s', r.walkSpeed, 4.5, 0.05);
  t.ok('ground friction stops you fast', r.stopSpeed < 0.05, r.stopSpeed.toFixed(3));
  t.near('jump height 1.1 m', r.apex, 1.1, 0.06);
  t.ok('lands again', r.landed);
  t.ok('crouches', r.crouched);
  t.ok('crouched eye is low', r.crouchEye < 0.9, r.crouchEye.toFixed(2));
  t.near('crouch speed 1/3 of walk', r.crouchSpeed, 1.5, 0.05);
  t.ok('stands up again', r.stoodUp);
  t.near('steps up onto a 0.4 m crate', r.onCrate, 0.4, 0.05);
  t.ok('air control does not cancel momentum', r.airSpeed >= 9.99, r.airSpeed.toFixed(2));
});
