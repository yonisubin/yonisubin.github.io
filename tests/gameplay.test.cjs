// Gameplay fixes from the audit: wreck cash you can pick up (and dropped cash that expires),
// a boat left on land that doesn't fall away, menus that don't unfreeze each other, Vera's
// target car being carjacked, a cap on carjacked cars, weapon models built once, and P
// closing the look picker.
const { run } = require('./harness.cjs');

run('gameplay: cash drops, parked boats, menus, mission target, jacked cars, weapons, picker', async ({ page }, t) => {
  // --- Wreck a traffic car: the cash lands at road height and can be picked up.
  const cash = await page.evaluate(() => {
    const g = window.game;
    g.renderer.setAnimationLoop(null);
    g.simulate(1);
    const car = g.traffic.cars.find((c) => c.active && c.wrecked < 0);
    const count = g.cash.pickups.length;
    g.traffic.damage(car, 9999);
    const added = g.cash.pickups.length - count;
    const drop = g.cash.pickups[g.cash.pickups.length - 1];
    const road = g.city.terrain.smoothHeight(drop.position.x, drop.position.z);
    // Walk onto it.
    const V = g.camera.position.constructor;
    const money = g.stats.money;
    g.city.streamer.loadAround(drop.position, 200);
    g.onFoot.placeAt(new V(drop.position.x, g.city.terrain.surfaceAt(drop.position.x, drop.position.z) + 1, drop.position.z), 0, 0);
    g.simulate(0.5);
    return { added, dropped: drop.dropped, dropY: drop.position.y, road, carY: car.currPos.y, gained: g.stats.money - money };
  });
  t.ok('wrecking a car drops one new bundle of cash', cash.added === 1 && cash.dropped, `${cash.added} new, dropped=${cash.dropped}`);
  t.ok('wreck cash is dropped at road height', Math.abs(cash.dropY - cash.road) < 1.5, `y ${cash.dropY.toFixed(2)}, road ${cash.road.toFixed(2)}`);
  t.ok('…and can be picked up', cash.gained > 0, `+$${cash.gained}`);
  const expiry = await page.evaluate(() => {
    const g = window.game;
    const V = g.camera.position.constructor;
    for (let k = 0; k < 40; k++) g.cash.drop(new V(5000, 0, 5000 + k), 10); // far away: nobody picks them up
    const full = g.cash.pickups.filter((p) => p.dropped).length;
    g.simulate(121);
    const left = g.cash.pickups.filter((p) => p.dropped).length;
    g.cash.drop(new V(5000, 0, 5000), 10);
    return { full, left, again: g.cash.pickups.filter((p) => p.dropped).length };
  });
  t.ok('dropped cash nobody collects expires after 2 minutes', expiry.full === 40 && expiry.left === 0, `${expiry.full} → ${expiry.left}`);
  t.ok('…so new drops still appear', expiry.again === 1);

  // --- A boat left on land: its ground unloads when you go 1.5 km away; it must not fall.
  const boat = await page.evaluate(() => {
    const g = window.game;
    const b = g.boats[0];
    const V = g.camera.position.constructor;
    // Put it on the beach above the water line, near the player.
    const x = b.interp.currPos.x;
    let z = b.interp.currPos.z;
    while (g.city.terrain.heightAt(x, z) < 0.6) z -= 2;
    z -= 3;
    g.city.streamer.loadAround(new V(x, 0, z), 300);
    g.simulate(0.1);
    b.body.setTranslation({ x, y: g.city.terrain.heightAt(x, z) + 1, z }, true);
    g.simulate(3);
    const y0 = b.body.translation().y;
    // Go far away and let the world unload the beach.
    const away = new V(x, 0, z - 1500);
    g.city.streamer.loadAround(away, 450);
    g.onFoot.placeAt(new V(away.x, g.city.terrain.surfaceAt(away.x, away.z) + 1, away.z), 0, 0);
    for (let k = 0; k < 40; k++) {
      g.city.update(away);
      g.simulate(0.25);
    }
    return { y0, y1: b.body.translation().y, loaded: g.city.isLoaded(x, z) };
  });
  t.ok('a boat on land stays put when its ground unloads', !boat.loaded && Math.abs(boat.y1 - boat.y0) < 0.5, `y ${boat.y0.toFixed(1)} → ${boat.y1.toFixed(1)} (ground loaded: ${boat.loaded})`);

  // --- Menus: closing the map must not unfreeze the game under the look picker.
  const order = await page.evaluate(() => {
    const g = window.game;
    g.onFoot.placeAt(g.city.spawn.clone(), 0, 0);
    g.city.streamer.loadAround(g.city.spawn, 450);
    g.simulate(0.2);
    g.picker.open();
    const picker = g.input.isBlocked;
    g.fullMap.open(); // e.g. tapping the minimap while the picker is up
    const both = g.fullMap.isOpen && g.picker.isOpen;
    g.fullMap.close();
    const afterMap = g.input.isBlocked;
    g.picker.close();
    return { picker, both, afterMap, afterPicker: g.input.isBlocked };
  });
  t.ok('look picker open blocks input', order.picker);
  t.ok('closing the map (opened over the picker) leaves input blocked', order.both && order.afterMap === true, JSON.stringify(order));
  t.ok('closing the picker too gives input back', order.afterPicker === false);
  // P closes the picker.
  await page.evaluate(() => window.game.picker.open());
  await page.keyboard.press('KeyP');
  t.ok('P closes the look picker', !(await page.evaluate(() => window.game.picker.isOpen)));

  // --- Vera's wreck mission: carjacking the target ends it ("the car got away").
  const mission = await page.evaluate(() => {
    const g = window.game;
    const vera = g.missions.givers.find((v) => v.kinds.includes('wreck'));
    g.missions.start(vera, 'wreck');
    const target = g.missions.mission?.target;
    if (!target) return { started: false };
    g.stats.money = 1000;
    g.stats.buyWeapon('pistol');
    g.traffic.take(target);
    for (let k = 0; k < 10; k++) g.simulate(0.1);
    return { started: true, active: !!g.missions.mission };
  });
  t.ok('carjacking the wreck target ends the mission', mission.started && !mission.active, JSON.stringify(mission));

  // --- Carjacked cars: at most 4 are kept, and the geometry count doesn't grow.
  const jacked = await page.evaluate(() => {
    const g = window.game;
    const jack = g.onFoot.interactables.find((i) => /carjack/.test(i.label()));
    const before = g.cars.length;
    const bodies0 = g.world.bodies.len();
    let jacks = 0;
    for (let k = 0; k < 10; k++) {
      g.player.setMode(g.onFoot);
      const car = g.traffic.cars.find((c) => c.active && c.wrecked < 0 && c.speed < 4);
      if (!car) {
        g.simulate(1);
        continue;
      }
      const V = g.camera.position.constructor;
      g.onFoot.placeAt(new V(car.currPos.x + 2, g.city.terrain.surfaceAt(car.currPos.x + 2, car.currPos.z) + 1, car.currPos.z), 0, 0);
      g.simulate(1 / 60);
      const n = g.cars.length;
      jack.activate();
      if (g.cars.length > n || g.player.mode !== g.onFoot) jacks++;
      g.simulate(0.2);
    }
    g.player.setMode(g.onFoot);
    return { jacks, added: g.cars.length - before, bodies: g.world.bodies.len() - bodies0 };
  });
  t.ok('10 carjacks keep exactly 4 jacked cars', jacked.jacks >= 5 && jacked.added === 4, `${jacked.jacks} carjacks → +${jacked.added} cars, +${jacked.bodies} physics bodies`);

  // --- Weapon switching reuses the models.
  const weapons = await page.evaluate(() => {
    const g = window.game;
    g.stats.money = 5000;
    g.stats.buyWeapon('bat');
    g.stats.buyWeapon('rifle');
    const geo = () => g.renderer.info.memory.geometries;
    const sw = (n) => {
      for (let k = 0; k < n; k++) {
        g.stats.cycleWeapon();
        g.onFoot.render(1, 1 / 60);
        g.renderer.render(g.scene, g.camera);
      }
    };
    sw(8); // every model built once
    const a = geo();
    sw(40);
    return { a, b: geo() };
  });
  t.ok('switching weapons 40 times adds no geometries', weapons.b === weapons.a, `${weapons.a} → ${weapons.b}`);
}, { people: true });
