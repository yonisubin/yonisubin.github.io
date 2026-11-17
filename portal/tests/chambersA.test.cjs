// Workstream A's chambers (c01–c10, adv1–adv6): every chamber loads through the loader with no
// errors, its `next` exists (or is c11, B's first chamber), its dialogue lines exist, and a scripted
// solution replay per chamber drives the player through window.twinfold (held actions, aim, fire,
// use, fixed-step simulate) until the exit elevator reports `exitReached`.
//   npm run test:portal -- chambersA          every chamber
//   CHAMBERS=c03,c05 npm run test:portal -- chambersA   only some replays
const { run } = require('./harness.cjs');

const A_IDS = ['c01', 'c02', 'c03', 'c04', 'c05', 'c06', 'c07', 'c08', 'c09', 'c10', 'adv1', 'adv2', 'adv3', 'adv4', 'adv5', 'adv6'];

// In-page helpers: installed once as window.__A.
function installHelpers() {
  const tf = window.twinfold, P = tf.player, sh = window.twinfoldShell;
  const H = {};
  const STEP = 1 / 60;
  H.tf = tf;
  H.P = P;
  H.log = [];
  H.say = (s) => H.log.push(s);
  H.load = (id) => {
    tf.session.loadChamber(sh.chambers.getChamber(id));
    tf.simulate(1.0); // the entry booth opens
  };
  H.el = (id) => tf.element(id);
  H.events = (name) => tf.log.filter((e) => e[0] === name).map((e) => e[1]);
  H.at = () => [P.position.x, P.feetY(), P.position.z];
  H.fmt = (v) => v.map((x) => x.toFixed(2)).join(' ');
  /** Point the view at a world point. */
  H.look = (t) => {
    const e = P.eye();
    const dx = t[0] - e.x, dy = t[1] - e.y, dz = t[2] - e.z;
    P.rig.yaw = Math.atan2(-dx, -dz);
    P.rig.pitch = Math.atan2(dy, Math.hypot(dx, dz));
  };
  /** Turn the view toward a yaw (and pitch) at a human rate: a held prop can't keep up with a snap. */
  const TURN = 0.09;
  const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  H.steer = (yaw, pitch) => {
    const d = wrap(yaw - P.rig.yaw);
    P.rig.yaw += Math.max(-TURN, Math.min(TURN, d));
    if (pitch !== undefined) P.rig.pitch += Math.max(-TURN, Math.min(TURN, pitch - P.rig.pitch));
    return Math.abs(d);
  };
  H.turn = (yaw, pitch) => {
    for (let i = 0; i < 120; i++) {
      const d = H.steer(yaw, pitch);
      if (d < 1e-3 && (pitch === undefined || Math.abs(pitch - P.rig.pitch) < 1e-3)) break;
      tf.simulate(STEP);
    }
  };
  /** Turn smoothly to look at a point (use while carrying). */
  H.turnToward = (t) => {
    const e = P.eye();
    const dx = t[0] - e.x, dy = t[1] - e.y, dz = t[2] - e.z;
    H.turn(Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz)));
  };
  H.release = () => ['forward', 'back', 'left', 'right', 'jump', 'crouch'].forEach((a) => tf.hold(a, false));
  /** Walk (steering every step) until the feet are within tol of (x, z). opts.until(): stop early. */
  H.walkTo = (x, z, opts = {}) => {
    const tol = opts.tol ?? 0.25;
    const max = (opts.max ?? 25) * 60;
    for (let i = 0; i < max; i++) {
      const dx = x - P.position.x, dz = z - P.position.z;
      if (Math.hypot(dx, dz) < tol) break;
      if (opts.until && opts.until()) break;
      const err = H.steer(Math.atan2(-dx, -dz), opts.pitch);
      tf.hold('forward', err < 0.5);
      if (opts.jumpAt && Math.hypot(dx, dz) < opts.jumpAt && P.grounded) {
        tf.hold('jump', true);
        tf.simulate(STEP);
        tf.hold('jump', false);
        continue;
      }
      tf.simulate(STEP);
    }
    tf.hold('forward', false);
    tf.simulate(opts.settle ?? 0.2);
    return Math.hypot(x - P.position.x, z - P.position.z);
  };
  /** Walk straight ahead (current yaw) for some seconds. */
  H.forward = (seconds, yaw) => {
    if (yaw !== undefined) P.rig.yaw = yaw;
    tf.hold('forward', true);
    tf.simulate(seconds);
    tf.hold('forward', false);
  };
  H.jump = () => {
    tf.hold('jump', true);
    tf.simulate(STEP * 2);
    tf.hold('jump', false);
  };
  /** Wait (simulate) until cond() or the time runs out; returns whether cond() held. */
  H.waitFor = (cond, seconds = 20) => {
    for (let i = 0; i < seconds * 60; i++) {
      if (cond()) return true;
      tf.simulate(STEP);
    }
    return cond();
  };
  /** Aim at a point and fire a portal from the eye. */
  H.shoot = (id, target) => {
    H.look(target);
    const r = tf.fire(id);
    H.say(`fire ${id} at ${H.fmt(target)} → ${r.ok ? 'ok ' + H.fmt(r.position) : r.reason}`);
    return r;
  };
  H.held = () => tf.chamber.heldId();
  /** Look at a prop and press Use to pick it up. */
  H.grab = (id) => {
    const p = H.el(id).position();
    H.look([p.x, p.y, p.z]);
    tf.use();
    tf.simulate(0.3);
    H.say(`grab ${id}: ${H.held()}`);
    return H.held() === id;
  };
  H.drop = () => {
    if (H.held()) tf.use();
    tf.simulate(1.0);
  };
  /** Carrying a prop, walk until the prop is over (x, z), then drop it. */
  H.carryTo = (x, z, opts = {}) => {
    const id = H.held();
    if (!id) return false;
    const pr = H.el(id);
    for (let i = 0; i < (opts.max ?? 20) * 60; i++) {
      const c = pr.position();
      const d = Math.hypot(c.x - x, c.z - z);
      if (d < (opts.tol ?? 0.3)) break;
      const dx = x - P.position.x, dz = z - P.position.z;
      const err = H.steer(Math.atan2(-dx, -dz), opts.pitch ?? 0);
      tf.hold('forward', err < 0.5 && (d > 0.6 || Math.hypot(dx, dz) > 1.6));
      tf.simulate(STEP);
    }
    tf.hold('forward', false);
    tf.simulate(0.4);
    if (opts.keep) return true;
    H.drop();
    const c = pr.position();
    H.say(`dropped ${id} at ${H.fmt([c.x, c.y, c.z])}`);
    return true;
  };
  /** Walk into a portal (or through anything) heading at (x, z) until a teleport happens. */
  H.through = (x, z, max = 6) => {
    const n = P.teleports;
    H.walkTo(x, z, { tol: 0.05, max, until: () => P.teleports > n, settle: 0 });
    tf.hold('forward', false);
    tf.simulate(0.3);
    return P.teleports > n;
  };
  /** Is the player standing on this mover element? */
  H.onMover = (el) => el.parts.some((p) => p.collider.handle === P.groundHandle);
  /** Step onto a moving platform: follow its centre until standing on it, then stand still. */
  H.board = (el, seconds = 4) => {
    for (let i = 0; i < seconds * 60 && !H.onMover(el); i++) {
      const c = el.current();
      const dx = c.x - P.position.x, dz = c.z - P.position.z;
      H.steer(Math.atan2(-dx, -dz));
      tf.hold('forward', Math.hypot(dx, dz) > 0.3);
      tf.simulate(STEP);
    }
    // A few more steps toward the middle, then stop.
    for (let i = 0; i < 20; i++) {
      const c = el.current();
      const dx = c.x - P.position.x, dz = c.z - P.position.z;
      H.steer(Math.atan2(-dx, -dz));
      tf.hold('forward', Math.hypot(dx, dz) > 0.4);
      tf.simulate(STEP);
    }
    tf.hold('forward', false);
    return H.onMover(el);
  };
  /** Airborne: steer toward (x, z) with air control until landing or a teleport (or time out). */
  H.airTo = (x, z, seconds = 4) => {
    const n = P.teleports;
    // Still on the ground: walk toward the target until the feet leave it.
    for (let i = 0; i < 120 && P.grounded; i++) {
      P.rig.yaw = Math.atan2(-(x - P.position.x), -(z - P.position.z));
      tf.hold('forward', true);
      tf.simulate(STEP);
    }
    for (let i = 0; i < seconds * 60; i++) {
      if (P.grounded || P.teleports > n) break;
      // Air control as a velocity servo: wish toward (wanted velocity − current velocity).
      const ex = x - P.position.x, ez = z - P.position.z;
      const k = Math.min(1, 4.5 / Math.max(1e-6, 2 * Math.hypot(ex, ez)));
      const wx = ex * 2 * k - P.velocity.x, wz = ez * 2 * k - P.velocity.z;
      P.rig.yaw = Math.atan2(-wx, -wz);
      tf.hold('forward', Math.hypot(wx, wz) > 0.3);
      tf.simulate(STEP);
    }
    tf.hold('forward', false);
    return P.teleports > n;
  };
  /** Look at a pedestal button and press it. */
  H.press = (id) => {
    const p = H.el(id).entity.position;
    H.look([p[0], p[1] + 1.15, p[2]]);
    tf.use();
    tf.simulate(0.2);
    return H.el(id).outputs.pressed;
  };
  H.exited = () => H.events('exitReached').some((e) => e.chamberId === tf.session.current().id);
  /** Walk into the exit booth and wait for exitReached. */
  H.toExit = () => {
    const ex = H.el('exit').entity.position;
    const door = H.el('exitDoor').entity.position;
    H.walkTo(door[0], door[2] + 1.2, { tol: 0.3 });
    H.walkTo(door[0], door[2] - 1.0, { tol: 0.3 });
    H.walkTo(ex[0], ex[2], { tol: 0.3 });
    return H.waitFor(H.exited, 2);
  };
  H.result = () => ({ exited: H.exited(), counters: tf.session.counters(), at: H.at(), log: H.log, dead: tf.chamber.health <= 0 });
  window.__A = H;
}

// One scripted solution per chamber: (H) => void, run inside the page.
const SOLUTIONS = {
  c01: (H) => {
    const { tf, P } = H;
    H.walkTo(0, -3);
    H.walkTo(-1.8, -10);
    // Run west and jump onto the shelf.
    P.rig.yaw = Math.PI / 2;
    tf.hold('forward', true);
    tf.simulate(0.1);
    H.jump();
    tf.simulate(0.35);
    tf.hold('forward', false);
    tf.simulate(0.5);
    H.grab('cube1');
    H.walkTo(-1, -10, { tol: 0.3 });
    H.carryTo(2, -10);
    H.say(`plate ${H.el('plate').outputs.pressed}`);
    H.toExit();
  },
  c02: (H) => {
    const F = H.el('flip');
    // The amber end has just arrived in cell k.
    const fresh = (k) => () => F.index === k && F.timer < 0.1;
    H.walkTo(0, -6.5);
    H.waitFor(fresh(0), 15);
    H.through(0, -12); // → west cell
    H.walkTo(-10.75, -14.3, { tol: 0.2 });
    H.grab('cube1');
    H.through(-10.75, -11); // → hub, carrying the cube
    H.walkTo(0, -6.5);
    H.waitFor(fresh(1), 15);
    H.through(0, -12); // → middle cell
    H.carryTo(0, -16.6);
    H.say(`plate ${H.el('plate').outputs.pressed}`);
    H.walkTo(0, -14.2);
    H.waitFor(() => F.index === 1, 15);
    H.through(0, -11); // → hub
    H.walkTo(0, -6.5);
    H.waitFor(fresh(2), 15);
    H.through(0, -12); // → east cell
    H.toExit();
  },
  c03: (H) => {
    H.walkTo(0, -3);
    H.walkTo(4, -4.9, { tol: 0.2 });
    H.grab('cube1');
    H.walkTo(-4, -7, { tol: 0.3 });
    H.turnToward([-8, 1.0, -7]); // the low white panel on the west wall
    H.say(`fire a ${H.tf.fire('a').ok}`);
    H.through(-9, -7); // out of the fixed amber end on the shelf, still carrying
    H.carryTo(3, -16.5);
    H.say(`plate ${H.el('plate').outputs.pressed}`);
    H.toExit();
  },
  c04: (H) => {
    H.walkTo(0, -2);
    H.shoot('a', [8, 1.2, -8]); // the white panel where the pellet bounces
    H.waitFor(() => H.el('catcher').outputs.caught, 25);
    H.say(`caught ${H.el('catcher').outputs.caught}`);
    H.toExit();
  },
  c05: (H) => {
    H.walkTo(0, -3);
    H.shoot('b', [4, 5.5, -24]); // amber on the panel above the shelf, seen from the floor
    H.walkTo(-4, -6.5);
    H.walkTo(-4, -9.5, { tol: 0.3 }); // drop into the pit
    H.waitFor(() => H.P.grounded, 3);
    H.walkTo(-4.5, -11.4, { tol: 0.2 });
    H.grab('cube1');
    H.turnToward([-1, -2, -11]); // blue on the pit's east wall
    H.say(`fire a ${H.tf.fire('a').ok}`);
    H.through(0, -11); // out onto the shelf
    H.carryTo(-0.5, -20.5);
    H.say(`plate ${H.el('plate').outputs.pressed}`);
    H.toExit();
  },
  c06: (H) => {
    const S = H.el('shuttle'), C = H.el('carrier');
    const sz = () => S.current().z;
    H.walkTo(0, -5.4);
    // Let the shuttle go and come back, then step on as it arrives.
    H.waitFor(() => sz() < -15, 20);
    H.waitFor(() => sz() > -7.6, 20);
    H.say(`boarded ${H.board(S)}`);
    H.waitFor(() => sz() < -15.2, 10);
    H.walkTo(0, -20, { tol: 0.3 }); // walk off at the far side
    H.shoot('a', [-8, 1.2, -24]); // far side, low west panel
    H.shoot('b', [8, 5, -13.5]); // panel above the pillar
    H.through(-9, -24);
    H.walkTo(4.6, -12.5, { tol: 0.2 });
    H.waitFor(() => C.current().x > 2.7, 20); // the carrier stops by the pillar
    H.grab('cube1');
    H.walkTo(6, -16.5, { tol: 0.3 });
    H.walkTo(6, -20, { tol: 0.3 }); // off the pillar's north end
    H.carryTo(0, -24);
    H.say(`plate ${H.el('plate').outputs.pressed}`);
    H.toExit();
  },
  c07: (H) => {
    H.walkTo(0, -3);
    H.walkTo(-5.5, -9, { tol: 0.2 }); // onto the lift
    H.waitFor(() => H.el('lift').outputs.top, 8);
    H.walkTo(-4.5, -13, { tol: 0.3 });
    H.walkTo(-3.4, -13, { tol: 0.1 }); // the end of the diving board
    H.shoot('a', [0.5, -3, -13]); // blue on the pit floor
    H.shoot('b', [0, 0, -18.6]); // amber on the white floor before the shelf
    H.say(`dove in ${H.airTo(0.5, -13, 4)}`);
    H.tf.simulate(0.15);
    H.airTo(0, -23.5, 4); // rising out of amber: steer onto the shelf
    H.walkTo(0, -23.8, { tol: 0.3 });
    H.say(`bell ${H.press('bell')}`);
    H.toExit();
  },
  c08: (H) => {
    H.walkTo(0, -3);
    H.walkTo(7, -4);
    H.walkTo(7, -14.5);
    H.walkTo(7, -21, { tol: 0.3 }); // the end of the catwalk
    H.shoot('b', [0, 3.6, -16.01]); // amber on the launch face
    H.walkTo(7, -14.5);
    H.walkTo(7, -3);
    H.walkTo(-5.5, -3.5, { tol: 0.2 }); // tower lift
    H.waitFor(() => H.el('towerLift').outputs.top, 8);
    H.walkTo(-4.5, -9, { tol: 0.3 });
    H.walkTo(-3.4, -9, { tol: 0.1 });
    H.shoot('a', [1, -4, -9]); // blue on the drop pit's floor
    H.say(`dove ${H.airTo(1, -9, 4)} at ${H.fmt([H.P.velocity.x, H.P.velocity.y, H.P.velocity.z])}`);
    H.airTo(0, -31, 4); // flung over the chasm
    H.walkTo(3, -31.8, { tol: 0.3 });
    H.say(`bell ${H.press('bell')}`);
    H.toExit();
  },
  c09: (H) => {
    H.walkTo(0, -3);
    H.walkTo(0, -7, { tol: 0.2 });
    H.shoot('b', [0, 1.2, -26]); // through the grill: amber on the north room's far panel
    H.walkTo(4.5, -4, { tol: 0.3 });
    H.grab('cube1');
    H.walkTo(-5, -6.5, { tol: 0.3 });
    H.turnToward([-8, 1.0, -6.5]); // blue on the south room's west panel
    H.say(`fire a ${H.tf.fire('a').ok}`);
    H.through(-9, -6.5); // around the grill, cube and all
    H.carryTo(-4, -20);
    H.say(`plate ${H.el('plate').outputs.pressed} grill erased ${H.el('grill').erased}`);
    H.toExit();
  },
  c10: (H) => {
    const { tf, P } = H;
    H.walkTo(0, -3);
    H.walkTo(2, -4, { tol: 0.3 });
    H.shoot('b', [-5.5, 1.2, -10.5]); // pylon 1
    H.walkTo(-6, -2.8, { tol: 0.3 });
    H.turnToward([-10, 1.1, -2.75]); // start ledge's west panel
    H.say(`a ${tf.fire('a').ok}`);
    H.through(-11, -2.75); // → island 1
    H.walkTo(-3.6, -10.5, { tol: 0.2 });
    H.grab('cube1');
    H.turnToward([5.5, 1.2, -18.5]); // amber moves to pylon 2
    H.say(`b ${tf.fire('b').ok}`);
    H.turnToward([-5.5, 1.2, -10.5]); // blue on pylon 1 behind us
    H.say(`a ${tf.fire('a').ok}`);
    H.through(-7, -10.5); // → island 2
    H.turnToward([-5.5, 1.2, -26]); // amber moves to pylon 3
    H.say(`b ${tf.fire('b').ok}`);
    H.turnToward([5.5, 1.2, -18.5]); // blue on pylon 2
    H.say(`a ${tf.fire('a').ok}`);
    H.through(7, -18.5); // → island 3
    H.walkTo(-4, -25, { tol: 0.3 });
    H.turn(0, 0);
    tf.hold('forward', true); // run and jump the last gap
    H.waitFor(() => P.position.z < -27.3, 2);
    H.jump();
    tf.simulate(0.9);
    tf.hold('forward', false);
    tf.simulate(0.3);
    H.carryTo(-4, -33);
    H.say(`plate ${H.el('plate').outputs.pressed}`);
    H.toExit();
  },
  adv1: (H) => {
    const { tf, P } = H;
    H.walkTo(0, -3);
    H.shoot('b', [5.3, 5.2, -24]); // the narrow shelf panel
    H.walkTo(1, -6.5);
    H.walkTo(0.2, -11.6, { tol: 0.2 });
    H.turn(Math.PI / 2, 0);
    // Creep off the east lip so the fall lands on the island, not in the liquid.
    tf.hold('crouch', true);
    tf.hold('forward', true);
    H.waitFor(() => !P.grounded, 3);
    tf.hold('forward', false);
    tf.hold('crouch', false);
    H.waitFor(() => P.grounded, 3);
    tf.simulate(0.3);
    H.grab('cube1');
    H.turnToward([-1, -1.2, -11.6]); // blue high on the pit's east wall
    H.say(`a ${tf.fire('a').ok}`);
    H.through(0, -11.6);
    H.carryTo(-0.5, -20.5);
    H.say(`plate ${H.el('plate').outputs.pressed}`);
    H.toExit();
  },
  adv2: (H) => {
    const S = H.el('shuttle'), C = H.el('carrier');
    const sz = () => S.current().z;
    H.walkTo(0, -5.4);
    // Let the shuttle go and come back, then step on as it arrives.
    H.waitFor(() => sz() < -15, 20);
    H.waitFor(() => sz() > -7.6, 20);
    H.say(`boarded ${H.board(S)}`);
    H.waitFor(() => sz() < -15.2, 10);
    H.walkTo(0, -20, { tol: 0.3 }); // walk off at the far side
    H.shoot('a', [-8, 1.15, -24]); // far side: the one-aperture west panel
    H.shoot('b', [8, 5, -13.5]); // panel above the pillar
    H.through(-9, -24);
    H.walkTo(4.6, -12.5, { tol: 0.2 });
    H.waitFor(() => C.current().x > 2.7, 20); // the carrier stops by the pillar
    H.grab('cube1');
    H.walkTo(6, -16.5, { tol: 0.3 });
    H.walkTo(6, -20, { tol: 0.3 }); // off the pillar's north end
    H.carryTo(0, -24);
    H.say(`plate ${H.el('plate').outputs.pressed}`);
    H.toExit();
  },
  adv3: (H) => {
    H.walkTo(0, -3);
    H.walkTo(-5.5, -9, { tol: 0.2 }); // onto the lift
    H.waitFor(() => H.el('lift').outputs.top, 8);
    H.walkTo(-4.5, -13, { tol: 0.3 });
    H.walkTo(-3.4, -13, { tol: 0.1 }); // the end of the diving board
    H.shoot('a', [0.4, -3, -13]); // blue on the pit's only dry pad
    H.shoot('b', [0, 0, -18.5]); // amber on the pad in the moat
    H.say(`dove in ${H.airTo(0.2, -13, 4)}`);
    H.tf.simulate(0.15);
    H.airTo(0, -23.5, 4); // rising out of amber: steer onto the shelf
    H.walkTo(0, -23.8, { tol: 0.3 });
    H.say(`bell ${H.press('bell')}`);
    H.toExit();
  },
  adv4: (H) => {
    H.walkTo(0, -3);
    H.walkTo(7, -4);
    H.walkTo(7, -14.5);
    H.walkTo(7, -21, { tol: 0.3 }); // the end of the catwalk
    H.shoot('b', [0, 3.6, -16.01]); // amber on the launch face
    H.walkTo(7, -14.5);
    H.walkTo(7, -3);
    H.walkTo(-5.5, -3.5, { tol: 0.2 }); // tower lift
    H.waitFor(() => H.el('towerLift').outputs.top, 8);
    H.walkTo(-4.5, -9, { tol: 0.3 });
    H.walkTo(-3.4, -9, { tol: 0.1 });
    H.shoot('a', [1, -4, -9]); // blue on the drop pit's floor
    H.say(`dove ${H.airTo(1, -9, 4)} at ${H.fmt([H.P.velocity.x, H.P.velocity.y, H.P.velocity.z])}`);
    H.airTo(0, -31, 4); // flung over the bottomless chasm onto the pier
    H.walkTo(3, -31.8, { tol: 0.3 });
    H.say(`bell ${H.press('bell')}`);
    H.toExit();
  },
  adv5: (H) => {
    const { tf, P } = H;
    const hop = () => {
      // Run north and jump the trench.
      H.turn(0, 0);
      tf.hold('forward', true);
      H.waitFor(() => P.position.z < -14.6, 2);
      H.jump();
      tf.simulate(0.7);
      tf.hold('forward', false);
      tf.simulate(0.3);
    };
    H.walkTo(-5, -3);
    H.walkTo(0, -9, { tol: 0.2 });
    H.walkTo(0, -14, { tol: 0.3 }); // through the grill (no apertures to lose yet)
    hop();
    H.walkTo(0, -20, { tol: 0.3 });
    H.shoot('b', [0, 1.2, 0]); // back through the grill: amber on the south room's panel
    H.walkTo(-4, -20.9, { tol: 0.2 });
    H.grab('cube1');
    H.walkTo(4, -20, { tol: 0.3 });
    H.turnToward([8, 1.1, -20]); // blue on the north room's east panel
    H.say(`a ${tf.fire('a').ok}`);
    H.through(9, -20); // the cube goes home around the grill
    H.carryTo(4, -5);
    H.say(`plate ${H.el('plate').outputs.pressed}`);
    H.walkTo(0, -9, { tol: 0.2 });
    H.walkTo(0, -14, { tol: 0.3 });
    hop();
    H.toExit();
  },
};

run('chambersA', async ({ page }, t) => {
  await page.evaluate(installHelpers);
  // --- Every chamber: loader, next, dialogue lines. --------------------------------------------
  const meta = await page.evaluate((ids) => {
    const sh = window.twinfoldShell;
    return ids.map((id) => {
      const lvl = sh.chambers.getChamber(id);
      if (!lvl) return { id, missing: true };
      const v = sh.validateLevel(JSON.parse(JSON.stringify(lvl)));
      const lines = (lvl.dialogue ?? []).flatMap((d) => d.lines);
      return {
        id,
        errors: v.errors,
        warnings: v.warnings,
        next: lvl.next ?? null,
        nextOk: !!lvl.next && (lvl.next === 'c11' || !!sh.chambers.getChamber(lvl.next)),
        missingLines: lines.filter((l) => !(l in sh.LINES)),
        hasAnatomy: ['entry', 'sign', 'exit', 'exitDoor'].every((e) => (lvl.entities ?? []).some((x) => x.id === e)),
        info: lvl.info,
      };
    });
  }, A_IDS);
  for (const m of meta) {
    if (m.missing) {
      t.ok(`${m.id} is registered`, false);
      continue;
    }
    t.ok(`${m.id} loads with no loader errors`, m.errors.length === 0, m.errors.slice(0, 2).join('; '));
    t.ok(`${m.id} has no loader warnings`, m.warnings.length === 0, m.warnings.slice(0, 2).join('; '));
    t.ok(`${m.id} → next ${m.next} exists (or is c11)`, m.nextOk);
    t.ok(`${m.id} dialogue lines exist`, m.missingLines.length === 0, m.missingLines.join(', '));
    t.ok(`${m.id} has the anatomy (entry, sign, exit door, exit booth) and an info sign number`, m.hasAnatomy && typeof m.info?.number === 'number');
  }

  // --- Solution replays. ------------------------------------------------------------------------
  const only = (process.env.CHAMBERS || '').split(',').filter(Boolean);
  for (const id of A_IDS) {
    if (only.length && !only.includes(id)) continue;
    const sol = SOLUTIONS[id];
    if (!sol) {
      t.ok(`${id}: has a solution replay`, false);
      continue;
    }
    const r = await page.evaluate(
      ({ id, src }) => {
        const H = window.__A;
        H.log = [];
        H.load(id);
        const body = new Function('H', `return (${src})(H);`);
        try {
          body(H);
        } catch (e) {
          H.say(`threw ${e && e.stack ? e.stack.split('\n')[0] : e}`);
        }
        H.release();
        const out = H.result();
        // Ride the elevator out so a later chamber starts clean.
        H.tf.simulate(0.1);
        return out;
      },
      { id, src: sol.toString() },
    );
    const c = r.counters;
    t.ok(`${id}: scripted solution reaches the exit`, r.exited, `${r.exited ? '' : 'at ' + r.at.map((x) => x.toFixed(2)).join(' ') + ' · ' + r.log.slice(-6).join(' | ')}`);
    if (r.exited) console.log(`    ${id}: ${c.portals} portals, ${c.steps} steps, ${c.time.toFixed(1)} s`);
    // Medal tables are set from these runs: a clean scripted run earns at least silver everywhere.
    const medals = await page.evaluate((id) => window.twinfoldShell.chambers.CHALLENGES[id] ?? null, id);
    if (medals && r.exited) {
      const short = Object.entries(medals).filter(([mode, th]) => c[mode] > th.silver).map(([mode, th]) => `${mode} ${c[mode].toFixed(1)} > ${th.silver}`);
      t.ok(`${id}: the replay earns silver or better in every challenge`, short.length === 0, short.join(', '));
    }
    if (process.env.VERBOSE) console.log(r.log.join('\n'));
  }
});
