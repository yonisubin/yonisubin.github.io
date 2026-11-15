// Saved progress: round trip through a reload, corrupt and hostile data falling back safely,
// and "New game".
const { run } = require('./harness.cjs');

const KEY = 'opencity.save.v1';

run('save: round trip, corrupt and hostile saves, new game', async ({ page }, t) => {
  await page.evaluate(() => {
    const g = window.game;
    g.stats.money = 1000;
    g.stats.buyWeapon('pistol');
    g.stats.buyAddon('pistol', 'grip');
    g.missions.record = { Marco: { done: 2, best: 41 } };
    const V = g.camera.position.constructor;
    g.city.streamer.loadAround(new V(600, 0, 300), 300);
    g.onFoot.placeAt(new V(600, g.city.terrain.surfaceAt(600, 300) + 1, 300), 1, 1);
    g.navigator.setWaypoint(-500, 700);
    g.dayNight.hours = 21.5;
    g.autosave.now();
  });
  await page.reload({ timeout: 180000 });
  await page.waitForFunction(() => window.game, null, { timeout: 180000 });
  const back = await page.evaluate(() => {
    const g = window.game;
    const f = g.onFoot.focus();
    return { money: g.stats.money, current: g.stats.current, grip: g.stats.hasAddon('pistol', 'grip'), x: f.x, z: f.z, hours: g.dayNight.hours, wp: g.navigator.waypoint, marco: g.missions.record.Marco?.done };
  });
  t.ok('money and weapons come back', back.money === 620 && back.current === 'pistol' && back.grip, JSON.stringify(back));
  t.ok('position, time and destination come back', Math.abs(back.x - 600) < 1 && Math.abs(back.z - 300) < 1 && Math.abs(back.hours - 21.5) < 0.1 && back.wp?.x === -500);
  t.ok('mission record comes back', back.marco === 2);

  // Hostile values: prototype keys, NaN time, bad records, bad radio station.
  const hostile = async (save, audio) => {
    await page.evaluate(
      ([key, save, audio]) => {
        window.game.autosave.stop();
        localStorage.setItem(key, save);
        if (audio) localStorage.setItem('opencity.audio', audio);
      },
      [KEY, save, audio],
    );
    await page.reload({ timeout: 180000 });
    await page.waitForFunction(() => window.game, null, { timeout: 180000 });
    return page.evaluate(() => ({ money: window.game.stats.money, current: window.game.stats.current, owned: [...window.game.stats.owned], hours: window.game.dayNight.hours, station: window.game.director.radio.station }));
  };
  const corrupt = await hostile('{not json');
  t.ok('corrupt save: a new game', corrupt.money === 200, `$${corrupt.money}`);
  const proto = await hostile(
    JSON.stringify({
      version: 1,
      stats: { money: 500, health: 100, owned: ['fists', 'constructor', '__proto__'], ammo: {}, apAmmo: {}, addons: ['toString:x'], current: 'constructor' },
      missions: { Marco: 5 },
      jobs: { taxi: 'lots' },
      player: { x: 0, z: 0, heading: 0 },
      hours: 12,
      waypoint: null,
    }),
    JSON.stringify({ muted: false, station: 7 }),
  );
  t.ok('prototype names are not weapons', proto.current === 'fists' && proto.owned.join() === 'fists', JSON.stringify(proto));
  t.ok('a radio station that doesn’t exist falls back', proto.station === 0, `${proto.station}`);
  const nan = await hostile(JSON.stringify({ version: 1, stats: { money: 300 }, missions: {}, jobs: {}, player: { x: 0, z: 0, heading: 0 }, waypoint: null }));
  t.ok('a save without a time of day is rejected (no NaN clock)', nan.money === 200 && Number.isFinite(nan.hours), JSON.stringify(nan));

  // New game: confirm, the save is gone, back to the start.
  await page.evaluate(() => {
    const g = window.game;
    g.stats.money = 5000;
    g.autosave.now();
  });
  page.on('dialog', (d) => d.accept());
  await page.evaluate(() => window.game.fullMap.open());
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.includes('New game')).click());
  await page.waitForTimeout(1500);
  await page.waitForFunction(() => window.game, null, { timeout: 180000 });
  const fresh = await page.evaluate((key) => ({ money: window.game.stats.money, saved: localStorage.getItem(key) }), KEY);
  t.ok('New game starts over and clears the save', fresh.money === 200 && fresh.saved === null, JSON.stringify(fresh));
});
