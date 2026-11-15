// Side jobs: a taxi fare, an ambulance run and a delivery run (the vehicle is teleported to
// each stop: this tests the job logic, not driving), the shift ending when you get out, and
// a plain sedan not being a job vehicle.
const { run } = require('./harness.cjs');

run('jobs: taxi, ambulance, delivery', async ({ page }, t) => {
  await page.evaluate(() => {
    const g = window.game;
    g.renderer.setAnimationLoop(null);
    const V = g.camera.position.constructor;
    window.__drive = (car) => {
      g.city.streamer.loadAround(car.interp.currPos, 300);
      g.simulate(0.1);
      g.player.setMode(car.mode);
    };
    window.__tp = (car, x, z) => {
      g.city.streamer.loadAround(new V(x, 0, z), 300);
      car.body.setTranslation({ x, y: g.city.terrain.smoothHeight(x, z) + 0.6, z }, true);
      car.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      car.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      g.simulate(1.2);
    };
    window.__job = () => {
      g.input.pressAction('job');
      g.simulate(1 / 60);
      g.input.releaseAction('job');
    };
  });
  const taxi = await page.evaluate(() => {
    const g = window.game;
    const J = g.jobs;
    const car = g.cars.find((c) => c.type === 'taxi');
    window.__drive(car);
    const m0 = g.stats.money;
    window.__job();
    const started = J.kind === 'taxi' && g.navigator.owner === 'job' && !!g.navigator.waypoint;
    window.__tp(car, J.task.target.x, J.task.target.z);
    const pickedUp = J.stage === 'dropoff';
    window.__tp(car, J.task.target.x, J.task.target.z);
    const paid = g.stats.money - m0;
    g.player.setMode(g.onFoot);
    g.simulate(0.1);
    return { started, pickedUp, paid, ended: J.kind === null, waypoint: g.navigator.waypoint };
  });
  t.ok('taxi: J starts a shift with a route to the fare', taxi.started);
  t.ok('taxi: stopping at the fare picks them up', taxi.pickedUp);
  t.ok('taxi: the drop-off pays', taxi.paid > 25, `+$${taxi.paid}`);
  t.ok('getting out ends the shift and clears its route', taxi.ended && taxi.waypoint === null);

  const amb = await page.evaluate(() => {
    const g = window.game;
    const J = g.jobs;
    const car = g.cars.find((c) => c.livery === 'ambulance');
    window.__drive(car);
    window.__job();
    window.__tp(car, J.task.target.x, J.task.target.z);
    const door = g.places.nearestHospital(J.task.target.x, J.task.target.z).door;
    const toHospital = Math.hypot(J.task.target.x - door.x, J.task.target.z - door.z);
    const m = g.stats.money;
    window.__tp(car, J.task.target.x, J.task.target.z);
    const paid = g.stats.money - m;
    window.__job();
    return { ambulances: g.cars.filter((c) => c.livery === 'ambulance').length, toHospital, paid, ended: J.kind === null };
  });
  t.ok('an ambulance at every hospital', amb.ambulances === 8, `${amb.ambulances}`);
  t.ok('ambulance: the patient goes to the nearest hospital', amb.toHospital < 60, `${amb.toHospital.toFixed(0)} m from its door`);
  t.ok('ambulance: delivering the patient pays', amb.paid > 60, `+$${amb.paid}`);
  t.ok('J again ends the shift', amb.ended);

  const del = await page.evaluate(() => {
    const g = window.game;
    const J = g.jobs;
    const car = g.cars.find((c) => c.type === 'van' && !c.livery);
    window.__drive(car);
    window.__job();
    const label = J.task.label;
    const total = J.dropsTotal;
    const m = g.stats.money;
    for (let k = 0; k < total && J.kind; k++) window.__tp(car, J.task.target.x, J.task.target.z);
    const paid = g.stats.money - m;
    const record = J.record.delivery;
    J.end();
    const sedan = g.cars.find((c) => c.type === 'sedan');
    window.__drive(sedan);
    window.__job();
    return { label, total, paid, record, sedanJob: J.kind };
  });
  t.ok('delivery: the label counts the real number of drops', del.label === `Deliver (1/${del.total})` && del.total >= 1, del.label);
  t.ok('delivery: every drop pays, plus the run bonus', del.paid === 30 * del.total + 60, `+$${del.paid} for ${del.total} drops`);
  t.ok('job records are kept (for the save)', del.record?.done === 1);
  t.ok('a plain sedan is not a job vehicle', del.sedanJob === null);
}, { people: true });
