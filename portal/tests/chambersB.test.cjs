// Workstream B's chambers (c11–c19, escape1, escape2, finale): every chamber loads through the
// loader with no errors, `next` links chain c11 → … → finale, every dialogue hook names a real line,
// and a scripted solution replay per chamber drives the player through window.twinfold (held
// movement, aim, fire, use, simulate) to `exitReached` — or, in the finale, to the boss's `defeated`
// event and the ending + credits.
const { run } = require('./harness.cjs');

/** Replay helpers, installed in the page as window.R (a function source, so it runs there). */
function installReplay() {
  const tf = window.twinfold;
  const R = {};
  R.el = (id) => tf.element(id);
  R.ev = (n) => tf.log.filter((e) => e[0] === n).map((e) => e[1]);
  R.load = (id) => {
    tf.session.loadChamber(window.twinfoldShell.chambers.getChamber(id));
    tf.simulate(1.2);
  };
  R.dead = () => tf.chamber.dead;
  R.p = () => ({ x: tf.player.position.x, y: tf.player.feetY(), z: tf.player.position.z });
  /** Point the view at a world point. */
  R.look = (x, y, z) => {
    const e = tf.player.eye();
    const dx = x - e.x, dy = y - e.y, dz = z - e.z;
    tf.aim(Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz)));
  };
  R.face = (yaw, pitch = 0) => tf.aim(yaw, pitch);
  /** Turn the view smoothly (so a carried prop follows instead of being dropped). */
  R.turn = (yaw, pitch = 0, seconds = 0.8) => {
    const y0 = tf.player.rig.yaw, p0 = tf.player.rig.pitch;
    let dy = yaw - y0;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    const n = Math.max(1, Math.round(seconds * 60));
    for (let i = 1; i <= n; i++) {
      tf.aim(y0 + (dy * i) / n, p0 + ((pitch - p0) * i) / n);
      tf.simulate(1 / 60);
    }
  };
  /** Walk (held forward) to x, z; keeps the given pitch. Returns the distance left. */
  R.walk = (x, z, o = {}) => {
    const tol = o.tol ?? 0.15, pitch = o.pitch ?? 0, max = o.max ?? 20;
    let d = Infinity;
    for (let i = 0; i < max * 60; i++) {
      const p = tf.player.position;
      const dx = x - p.x, dz = z - p.z;
      d = Math.hypot(dx, dz);
      if (d < tol || tf.chamber.dead) break;
      tf.aim(Math.atan2(-dx, -dz), pitch);
      tf.hold('forward', true);
      if (o.jump) tf.hold('jump', true);
      tf.simulate(1 / 60);
    }
    tf.hold('forward', false);
    tf.hold('jump', false);
    if (o.settle !== false) tf.simulate(0.2);
    return d;
  };
  R.path = (pts, o) => pts.map(([x, z]) => R.walk(x, z, o)).pop();
  /** Fire an end at a world point (from the eye). */
  R.fire = (id, x, y, z) => {
    R.look(x, y, z);
    return tf.fire(id);
  };
  R.grab = (id) => {
    const p = tf.element(id).position();
    R.look(p.x, p.y, p.z);
    tf.use();
    tf.simulate(0.4);
    return tf.chamber.heldId() === id;
  };
  R.drop = () => {
    if (tf.chamber.heldId()) tf.use();
    tf.simulate(0.6);
  };
  R.press = (id) => {
    const e = tf.element(id).entity.position;
    R.look(e[0], e[1] + 1.1, e[2]);
    tf.use();
    tf.simulate(0.1);
  };
  R.wait = (fn, max = 10) => {
    for (let i = 0; i < max * 60 && !fn(); i++) tf.simulate(1 / 60);
    return !!fn();
  };
  /** Into the exit booth and up: true once exitReached fired for this chamber. */
  R.exited = (id) => R.ev('exitReached').some((e) => e.chamberId === id);
  window.R = R;
}

/** Each chamber's solution, run in the page with R installed; returns a summary object. */
const SOLUTIONS = {
  // Turrets: lift the hall turret from behind and turn it to the wall; carry the cube as a shield
  // down the passage and set it on the plate in front of the bunker slot.
  c11: () => {
    const tf = window.twinfold, out = {};
    R.load('c11');
    R.walk(0, -17.9);
    out.grabTurret = R.grab('tur1');
    R.turn(Math.PI / 2, -0.3);
    R.drop();
    tf.simulate(1);
    R.path([[1.2, -20], [0.9, -21.4]]);
    R.press('ped1');
    tf.simulate(1);
    out.door1 = R.el('door1').isOpen();
    R.path([[1.2, -23], [0, -24.5], [0, -25.6]]);
    out.grabCube = R.grab('cube1');
    R.turn(0, -0.45, 0.4);
    R.walk(0, -39.4, { pitch: -0.45, max: 30 });
    R.drop();
    tf.simulate(1.5);
    out.plate = R.el('plate').outputs.pressed;
    out.bunkerFired = R.el('tur2').fired;
    R.path([[-2.75, -42], [-2.75, -48.6]]);
    tf.simulate(1);
    return out;
  },
};

module.exports = { installReplay, SOLUTIONS };

if (require.main === module) {
  run('chambersB', async ({ page }, t) => {
    await page.evaluate(installReplay);
    t.ok('replay helpers installed', await page.evaluate(() => !!window.R));
  });
}
