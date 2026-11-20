// AI drivers (src/ai, trained in rl/): traffic near the player drives with the network, and
// the car autopilot (bought at a store) takes you to the waypoint and stops there.
const { run } = require('./harness.cjs');

run('AI drivers: traffic and autopilot', async ({ page }, t) => {
  await page.waitForFunction(() => window.game.traffic.hasPolicy, null, { timeout: 60000 });
  const traffic = await page.evaluate(() => {
    const g = window.game;
    g.renderer.setAnimationLoop(null);
    g.simulate(20);
    const cars = g.traffic.debugCars.filter((c) => c.active);
    const ai = cars.filter((c) => c.physics);
    const st = g.traffic.stats;
    return {
      ai: ai.length,
      moving: ai.filter((c) => c.speed > 1).length,
      msPerDecision: st.aiMs / Math.max(1, st.aiDecisions),
      decisions: st.aiDecisions,
      fallbacks: st.aiFallbacks,
      upright: ai.every((c) => Number.isFinite(c.pos.y)),
    };
  });
  t.ok('traffic near the player is AI-driven', traffic.ai >= 8, `${traffic.ai} AI cars`);
  t.ok('AI traffic moves', traffic.moving >= traffic.ai / 3, `${traffic.moving} of ${traffic.ai} moving`);
  t.ok('an AI decision costs well under a millisecond', traffic.msPerDecision < 1, `${traffic.msPerDecision.toFixed(3)} ms (${traffic.decisions} decisions)`);
  t.ok('AI drivers rarely hand back to rule-based driving', traffic.fallbacks <= 6, `${traffic.fallbacks} hand-backs in 20 s`);

  const refused = await page.evaluate(() => {
    const g = window.game;
    const car = g.cars.find((c) => c.type === 'sedan' && !c.livery);
    g.city.streamer.loadAround(car.interp.currPos, 400);
    g.simulate(0.1);
    g.player.setMode(car.mode);
    g.input.pressAction('autopilot');
    g.simulate(1 / 60);
    g.input.releaseAction('autopilot');
    return g.autopilot.engaged;
  });
  t.ok('no autopilot until you buy one', !refused);

  const bought = await page.evaluate(() => {
    const g = window.game;
    g.stats.money = 1000;
    const ok = g.stats.buyAutopilot(50);
    return { ok, money: g.stats.money, owned: g.stats.autopilot, saved: g.stats.toJSON().autopilot };
  });
  t.ok('buying the autopilot', bought.ok && bought.owned && bought.money === 950 && bought.saved === true);

  const trip = await page.evaluate(() => {
    const g = window.game;
    const V = g.camera.position.constructor;
    const net = g.city.layout.streets.net;
    const car = g.cars.find((c) => c.mode === g.player.mode);
    // Put the car on a road, facing along it.
    const p = car.interp.currPos;
    const hit = net.nearest(p.x, p.z, 300);
    const e = net.edges[hit.edge];
    const at = net.pointAt(e, Math.min(e.length - 10, Math.max(10, e.cum[hit.seg])), { x: 0, z: 0, tx: 0, tz: 0 });
    const x = at.x - at.tz * 1.75;
    const z = at.z + at.tx * 1.75;
    g.city.streamer.loadAround(new V(x, 0, z), 500);
    const yaw = Math.atan2(-at.tz, at.tx);
    car.body.setTranslation({ x, y: g.city.terrain.smoothHeight(x, z) + 0.3, z }, true);
    car.body.setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }, true);
    car.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    g.simulate(1);
    // A destination 350–550 m away.
    const dest = net.nodes.find((n) => {
      const d = Math.hypot(n.x - x, n.z - z);
      return d > 350 && d < 550 && n.edges.length >= 2;
    });
    g.navigator.setWaypoint(dest.x, dest.z);
    g.simulate(0.2);
    g.input.pressAction('autopilot');
    g.simulate(1 / 60);
    g.input.releaseAction('autopilot');
    const engaged = g.autopilot.engaged;
    const route = g.autopilot.remaining;
    let t = 0;
    let maxImpact = 0;
    while (t < 150 && g.autopilot.engaged) {
      g.city.streamer.loadAround(car.interp.currPos, 400);
      g.simulate(2);
      t += 2;
      maxImpact = Math.max(maxImpact, car.takeImpact());
    }
    const end = car.interp.currPos;
    return {
      engaged,
      route,
      seconds: t,
      arrived: g.autopilot.stats.arrived,
      toDest: Math.hypot(end.x - dest.x, end.z - dest.z),
      speed: Math.abs(car.speed),
      maxImpact,
      shield: g.autopilot.stats.shieldSteps / Math.max(1, g.autopilot.stats.steps / 4),
    };
  });
  t.ok('O with a waypoint engages the autopilot', trip.engaged, `route ${trip.route?.toFixed(0)} m`);
  t.ok('the autopilot drives you to the waypoint and stops', trip.arrived === 1 && trip.speed < 1, `${trip.seconds}s, ${trip.toDest.toFixed(0)} m from the waypoint`);
  t.ok('no hard crash on the way', trip.maxImpact < 4, `biggest jolt ${trip.maxImpact.toFixed(1)} m/s`);

  const takeover = await page.evaluate(() => {
    const g = window.game;
    const net = g.city.layout.streets.net;
    const car = g.cars.find((c) => c.mode === g.player.mode);
    const p = car.interp.currPos;
    const dest = net.nodes.find((n) => Math.hypot(n.x - p.x, n.z - p.z) > 300);
    g.navigator.setWaypoint(dest.x, dest.z);
    g.simulate(0.2);
    g.input.pressAction('autopilot');
    g.simulate(1 / 60);
    g.input.releaseAction('autopilot');
    const on = g.autopilot.engaged;
    g.simulate(2);
    g.input.pressAction('moveBack');
    g.simulate(0.2);
    g.input.releaseAction('moveBack');
    return { on, off: !g.autopilot.engaged, auto: car.autoDrive };
  });
  t.ok('touching the controls hands the car back', takeover.on && takeover.off && takeover.auto === null);
});
