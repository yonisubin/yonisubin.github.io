// Going through portals: walking through a wall pair, the infinite fall, the fling, floor exits and
// the camera rolling back upright.
const { run } = require('./harness.cjs');

run('travel', async ({ page }, t) => {
  const r = await page.evaluate(() => {
    const tf = window.twinfold, P = tf.player, out = {};
    // Walk west into a west-wall portal, come out of the east wall still walking west.
    tf.fire('a', [-8, 0.6, 12], [-1, 0, 0]);
    tf.fire('b', [8, 0.6, 12], [1, 0, 0]);
    tf.place([-10, 0, 12]);
    tf.aim(Math.PI / 2, 0);
    tf.hold('forward', true);
    let speedAfter = 0;
    const w0 = P.teleports;
    for (let i = 0; i < 90 && P.teleports === w0; i++) tf.simulate(1 / 60);
    out.walkedThrough = P.teleports === w0 + 1;
    out.exitX = P.position.x;
    tf.simulate(0.3);
    speedAfter = Math.hypot(P.velocity.x, P.velocity.z);
    tf.hold('forward', false);
    out.walkSpeedAfter = speedAfter;
    out.walkVelX = P.velocity.x;
    out.yawAfter = P.rig.yaw;

    // Infinite fall: pit floor (y = -10) + ceiling (y = 10) above it.
    tf.restart();
    out.pit = tf.fire('a', [-8, 0, 0], [0, -1, 0.0001]);
    out.ceil = tf.fire('b', [-8, 0, 0], [0, 1, 0.0001]);
    tf.place([-8, -9.9, 0]);
    let maxSpeed = 0;
    for (let i = 0; i < 8 * 60; i++) {
      tf.simulate(1 / 60);
      maxSpeed = Math.max(maxSpeed, P.velocity.length());
    }
    out.fallTeleports = P.teleports - w0 - 1;
    out.fallSpeed = P.velocity.length();
    out.fallMax = maxSpeed;
    out.fallInside = P.position.y > -11 && P.position.y < 11;

    // Fling: high on the launch block's east face (x = -4), pit floor below; jump in.
    tf.restart();
    tf.place([-3, 0, 6]);
    out.launch = tf.fire('a', [-2.5, 5, 6], [-1, 0, 0]);
    out.pitFloor = tf.fire('b', [-8, 0, 0], [0, -1, 0.0001]);
    tf.place([-8, 0.5, 0], 0, [0, 0, 0]);
    tf.simulate(0.05);
    let flingSpeed = 0;
    for (let i = 0; i < 5 * 60; i++) {
      tf.simulate(1 / 60);
      const ev = tf.lastTeleport();
      if (ev && !flingSpeed && ev.to === 'a') flingSpeed = Math.hypot(P.velocity.x, P.velocity.z);
    }
    out.flingSpeed = flingSpeed;
    out.flingLanding = [P.position.x, P.feetY(), P.position.z];
    out.flingGrounded = P.grounded;

    // Floor exit: walk into a wall portal that leads to a floor portal: popped up out of the floor.
    tf.restart();
    tf.fire('a', [8, 0.6, 12], [1, 0, 0]);
    tf.place([6, 0, 0]);
    tf.fire('b', [6, 1.6, 0], [0, -1, -1]);
    tf.place([10, 0, 12]);
    tf.aim(-Math.PI / 2, 0);
    tf.hold('forward', true);
    let n0 = P.teleports;
    for (let i = 0; i < 90 && P.teleports === n0; i++) tf.simulate(1 / 60);
    tf.hold('forward', false);
    out.floorExitVy = P.velocity.y;
    let peak = -99;
    for (let i = 0; i < 60; i++) {
      tf.simulate(1 / 60);
      peak = Math.max(peak, P.feetY());
    }
    out.floorExitPeak = peak;

    // Camera roll: ceiling portal → wall portal leaves the view tilted, then it rolls back upright.
    tf.restart();
    tf.fire('a', [0, 0, -12], [0, 0, -1]);
    out.ceilB = tf.fire('b', [9, 3, 0], [0, 1, 0.0001]);
    tf.place([9, 0, 0]);
    tf.aim(0, -1.2);
    P.rig.yaw = 0.7;
    P.velocity.set(0, 0, 0);
    // Rise into the ceiling portal from below.
    tf.place([9, 7.8, 0], 0.7, [0, 8, 0]);
    P.rig.pitch = 0.4;
    let rolled = 0;
    n0 = P.teleports;
    for (let i = 0; i < 30 && P.teleports === n0; i++) tf.simulate(1 / 60);
    out.rollTeleported = P.teleports === n0 + 1;
    rolled = P.rig.residualAngle();
    tf.simulate(0.25);
    out.rollMid = P.rig.residualAngle();
    tf.simulate(0.4);
    out.rollStart = rolled;
    out.rollEnd = P.rig.residualAngle();
    return out;
  });
  t.ok('walks through a wall portal pair', r.walkedThrough, `exit x ${r.exitX.toFixed(2)}`);
  t.ok('comes out of the east wall', r.exitX > 11);
  t.near('keeps walking speed after the exit', r.walkSpeedAfter, 4.5, 0.1);
  t.ok('still walking west', r.walkVelX < -4);
  t.near('view still faces west', r.yawAfter, Math.PI / 2, 0.01);
  t.ok('pit floor and ceiling portals placed', r.pit.ok && r.ceil.ok);
  t.ok('infinite fall loops many times', r.fallTeleports >= 5, `${r.fallTeleports} passes`);
  t.near('infinite fall reaches terminal velocity', r.fallMax, 38, 0.01);
  t.near('and holds it', r.fallSpeed, 38, 0.5);
  t.ok('stays inside the room', r.fallInside);
  t.ok('fling portals placed', r.launch.ok && r.pitFloor.ok, JSON.stringify([r.launch, r.pitFloor]));
  t.ok('fling exits fast and horizontal', r.flingSpeed > 13, `${r.flingSpeed.toFixed(1)} m/s`);
  t.ok('fling clears the 6 m chasm', r.flingLanding[0] > 4.3 && Math.abs(r.flingLanding[1]) < 0.1 && r.flingGrounded, JSON.stringify(r.flingLanding));
  t.ok('leaving a floor portal pops you up', r.floorExitVy >= 6.5, r.floorExitVy.toFixed(2));
  t.ok('feet clear the floor after a floor exit', r.floorExitPeak > 0.1, r.floorExitPeak.toFixed(2));
  t.ok('ceiling → wall teleport happened', r.rollTeleported && r.ceilB.ok);
  t.ok('view is tilted right after the exit', r.rollStart > 0.2, r.rollStart.toFixed(2));
  t.ok('tilt is easing out mid-way', r.rollMid < r.rollStart && r.rollMid > 0.001, r.rollMid.toFixed(3));
  t.ok('camera is upright within ~0.5 s', r.rollEnd < 1e-3, r.rollEnd.toFixed(4));
});
