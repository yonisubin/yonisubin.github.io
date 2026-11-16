// Story mode: the prologue starts by itself on a new game; every mission can be played start
// to finish (driven by teleporting to each step's target and doing what the step asks);
// choices set flags and change the world; failing (death) offers a retry; progress survives
// a reload; story missions and side jobs can't run at once; goons go down without stars.
const { run, waitForGame } = require('./harness.cjs');

/**
 * In the page: play the running story mission to the end, step by step. `choices` maps a
 * mission id to the choice index to pick in its choice scene. Returns a log of steps.
 */
async function playMissionInPage(choices) {
  const g = window.game;
  const s = g.story;
  const V = g.camera.position.constructor;
  const log = [];
  const feet = (p) => new V(p.x, g.city.terrain.surfaceAt(p.x, p.z) + 1, p.z);
  const onFoot = () => {
    if (g.player.mode !== g.onFoot) g.player.setMode(g.onFoot);
  };
  const walkTo = (p) => {
    onFoot();
    g.city.streamer.loadAround(p, 300);
    g.onFoot.placeAt(feet(p), 0, 0);
    g.simulate(0.2);
  };
  const vehicleOf = (kind) => {
    if (kind === 'heli') return g.heli;
    if (kind === 'boat') return g.boats.find((b) => b.type === 'speedboat' && b.interp.currPos.distanceTo(s.debugCtx.place('lakeDock')) < 900) ?? g.boats[0];
    return g.cars.find((c) => !c.gone && (kind === 'car' || c.type === 'taxi'));
  };
  /** The vehicle you're in now, or null. */
  const current = () => g.cars.find((c) => c.mode === g.player.mode) ?? (g.heli.mode === g.player.mode ? g.heli : null) ?? g.boats.find((b) => b.mode === g.player.mode) ?? null;
  const enter = (kind) => {
    const v = vehicleOf(kind);
    g.player.setMode(v.mode);
    g.simulate(0.1);
    return v;
  };
  const moveVehicle = (v, p, lift = 0.8) => {
    g.city.streamer.loadAround(p, 300);
    const y = lift > 20 ? p.y : (g.water.surfaceAt(p.x, p.z) ?? g.city.terrain.smoothHeight(p.x, p.z)) + lift;
    v.body.setTranslation({ x: p.x, y, z: p.z }, true);
    v.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    v.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    g.simulate(0.3);
  };
  for (let guard = 0; guard < 400; guard++) {
    const st = s.debugStep;
    if (!st) break;
    const spec = s.active.steps[st.index];
    log.push(`${st.index}:${st.kind}`);
    switch (st.kind) {
      case 'scene':
        // Advance with Space; at the choice, press the wanted number.
        for (let k = 0; k < 60 && !g.sceneUI.active; k++) g.simulate(1 / 60);
        for (let k = 0; k < 80 && g.sceneUI.active; k++) {
          const want = choices[s.active.id];
          if (g.sceneUI.choicesShowing && want !== undefined) window.dispatchEvent(new KeyboardEvent('keydown', { code: `Digit${want + 1}` }));
          else window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' }));
          // Scenes finish through promises: let them settle, as they would between frames.
          await new Promise((r) => setTimeout(r, 0));
        }
        await new Promise((r) => setTimeout(r, 0));
        g.simulate(1 / 60);
        break;
      case 'goto':
        if (spec.by === 'heli' || spec.by === 'car' || spec.by === 'boat') moveVehicle(enter(spec.by), st.target, spec.by === 'heli' ? 100 : 0.8);
        else if (spec.by === 'foot') walkTo(st.target);
        else if (current()) moveVehicle(current(), st.target, current() === g.heli ? 100 : 0.8);
        else walkTo(st.target);
        break;
      case 'enter':
        enter(spec.vehicle);
        break;
      case 'drive': {
        const v = g.cars.includes(current()) ? current() : enter('car');
        moveVehicle(v, st.target);
        break;
      }
      case 'jack': {
        const m = s.debugCtx.cars.get(spec.car);
        g.stats.buyWeapon('bat');
        g.stats.current = 'bat';
        m.car.speed = 0;
        walkTo(new V(m.car.currPos.x + 2.5, 0, m.car.currPos.z));
        const jack = g.onFoot.interactables.find((i) => /carjack/.test(i.label()));
        if (g.traffic.jackable(g.onFoot.focus(), 3.4) === m.car) jack.activate();
        else {
          // Not the nearest jackable car: take it directly, like the interaction does. The
          // stand-in car is moved there (and settled) first, so that when the slot is taken
          // you're already in a car at that spot, as with the real carjack.
          const car = g.cars.find((c) => !c.gone && c.mode !== g.player.mode) ?? g.cars[0];
          const at = m.car.currPos.clone();
          moveVehicle(car, new V(at.x + 6, 0, at.z));
          g.traffic.take(m.car);
          g.player.setMode(car.mode); // in the same step, as the real carjack does
        }
        g.simulate(0.2);
        break;
      }
      case 'wreck':
        g.traffic.damage(s.debugCtx.cars.get(spec.car).car, 9999);
        g.simulate(0.2);
        break;
      case 'follow': {
        const m = s.debugCtx.cars.get(spec.car);
        onFoot();
        for (let t = 0; t < spec.seconds + 10 && s.debugStep?.kind === 'follow'; t += 0.5) {
          const c = m.car.currPos;
          walkTo(new V(c.x + 50, 0, c.z));
          g.simulate(0.3);
        }
        break;
      }
      case 'packages':
      case 'gates':
      case 'rings':
      case 'buoys': {
        const by = st.kind === 'gates' ? 'car' : st.kind === 'rings' ? 'heli' : st.kind === 'buoys' ? 'boat' : null;
        const v = by ? (g.player.mode === g.onFoot || (by === 'heli') !== (g.player.mode === g.heli.mode) ? enter(by) : vehicleOf(by)) : null;
        for (let k = 0; k < 30 && s.debugStep?.index === st.index && s.debugStep.target; k++) {
          const t = s.debugStep.target;
          if (v) moveVehicle(v, t, by === 'heli' ? 100 : 0.6);
          else walkTo(t);
          if (by === 'heli') {
            v.body.setTranslation({ x: t.x, y: t.y, z: t.z }, true);
            g.simulate(0.05);
          }
        }
        break;
      }
      case 'loseCops':
        g.wanted.clear();
        g.simulate(0.1);
        break;
      case 'goons': {
        walkTo(st.target ?? s.debugCtx.place(spec.at));
        for (let k = 0; k < 80 && s.debugStep?.index === st.index; k++) {
          g.simulate(0.3);
          for (const p of g.pedestrians.peds) if (p.goon && p.active && p.state === 'goon') g.pedestrians.damage(p, 999, 'melee');
        }
        break;
      }
      case 'buy':
        g.stats.money += 1000;
        g.stats.buyWeapon(spec.weapon);
        g.simulate(0.1);
        break;
      case 'fare':
        g.jobs.record.taxi = { done: (g.jobs.record.taxi?.done ?? 0) + 1, earned: 0 };
        g.simulate(0.1);
        break;
      default:
        g.simulate(0.5);
    }
  }
  return { log, active: s.active?.id ?? null, last: s.log[s.log.length - 1] };
}

run('story: prologue, all missions, choices, world, failure, save', async ({ page }, t) => {
  // --- A new game: the prologue starts by itself.
  const start = await page.evaluate(() => {
    const g = window.game;
    g.renderer.setAnimationLoop(null);
    g.simulate(0.5);
    return { active: g.story.active?.id, kind: g.story.debugStep?.kind, stars: g.story.markers().stars.length };
  });
  t.ok('a new game starts the prologue (Off the Bus)', start.active === 'p1', JSON.stringify(start));

  // --- Play everything in order. Choices: warn Hank (m6: option 2), Jules quits (m8: option 1), clean ending (m13: option 1).
  const choices = { m6: 1, m8: 0, m13: 0 };
  const order = ['p1', 'p2', 'p3', 'm1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9', 'm10', 'm11', 'm12', 'm13'];
  const results = {};
  for (const id of order) {
    const r = await page.evaluate(
      async ([id, choices, play]) => {
        const g = window.game;
        const s = g.story;
        g.wanted.clear();
        g.police.reset();
        g.stats.health = 100;
        if (!s.active) {
          const m = s.available().find((x) => x.id === id);
          if (!m) return { error: `not available: ${id}; available ${s.available().map((x) => x.id).join(',')}` };
          // Walk up to the giver (if they have one) and press E, like a player.
          if (m.giver) {
            const p = s.cast.position(m.giver);
            if (!p) return { error: `${m.giver} not present for ${id}` };
            if (g.player.mode !== g.onFoot) g.player.setMode(g.onFoot);
            const V = g.camera.position.constructor;
            g.city.streamer.loadAround(p, 300);
            g.onFoot.placeAt(new V(p.x + 1.5, g.city.terrain.surfaceAt(p.x + 1.5, p.z) + 1, p.z), 0, 0);
            g.simulate(0.1);
            const it = s.interactables.find((i) => i.available() && i.position().distanceTo(p) < 0.01);
            if (!it) return { error: `no ★ interaction at ${m.giver} for ${id}` };
            it.activate();
          } else s.start(id);
        }
        // eslint-disable-next-line no-new-func
        const r = await new Function(`return (${play})`)()(choices);
        return { ...r, done: s.done.has(id), money: g.stats.money };
      },
      [id, choices, playMissionInPage.toString()],
    );
    results[id] = r;
    t.ok(`mission ${id} completes`, r.done === true, r.error ?? `${r.last} · ${r.log?.join(' ')}`);
    if (!r.done) break;
  }

  const after = await page.evaluate(() => {
    const g = window.game;
    const s = g.story;
    return {
      flags: s.flags,
      props: ['garage-new', 'diner-lit', 'kane-tape', 'kane-sold', 'farm-crops', 'farm-sold', 'shack-fishing'].map((id) => `${id}:${s.world.showing(id)}`),
      jules: s.cast.present('jules'),
      hank: s.cast.present('hank'),
      phone: g.phone.log.length,
      discount: g.stats.priceFactor,
    };
  });
  t.ok('choices set their flags', after.flags.hank === 'warned' && after.flags.jules === 'quit' && after.flags.ending === 'clean', JSON.stringify(after.flags));
  t.ok('the world shows the clean ending', after.props.join(' ').includes('garage-new:true') && after.props.join(' ').includes('kane-tape:true') && after.props.join(' ').includes('kane-sold:false'), after.props.join(' '));
  t.ok('warned Hank keeps his farm (crops, no sold sign); Jules has quit', after.props.includes('farm-crops:true') && after.props.includes('farm-sold:false') && after.props.includes('shack-fishing:true') && after.hank && !after.jules, after.props.join(' '));
  t.ok('phone messages arrived along the way', after.phone >= 10, `${after.phone} messages`);
  t.ok("Dolores's discount applies", after.discount === 0.85);

  // --- Save and reload: the story survives.
  await page.evaluate(() => window.game.autosave.now());
  await page.reload({ timeout: 180000 });
  await waitForGame(page, true);
  const reloaded = await page.evaluate(() => {
    const s = window.game.story;
    return { done: s.done.size, flags: s.flags, active: s.active?.id ?? null, garage: s.world.showing('garage-new'), phone: window.game.phone.log.length };
  });
  t.ok('story progress survives a reload', reloaded.done === 16 && reloaded.flags.ending === 'clean' && reloaded.active === null && reloaded.garage && reloaded.phone >= 10, JSON.stringify(reloaded));

  // --- Branch check on a fresh story state: scaring Hank removes his mission and his farm.
  const branch = await page.evaluate(() => {
    const s = window.game.story;
    s.load({ done: ['p1', 'p2', 'p3', 'm1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9', 'm10', 'm11'], flags: { hank: 'scared', jules: 'stayed' }, phone: [] });
    return { avail: s.available().map((m) => m.id), hank: s.cast.present('hank'), sold: s.world.showing('farm-sold'), crops: s.world.showing('farm-crops'), jules: s.cast.present('jules') };
  });
  t.ok('scaring Hank: no Hold the Line, the finale opens, the farm is sold', !branch.avail.includes('m12') && branch.avail.includes('m13') && !branch.hank && branch.sold && !branch.crops, JSON.stringify(branch));
  t.ok('Jules stayed: she is still at her shack', branch.jules);

  // --- Failing: dying in a mission fails it, and the giver offers it again.
  const fail = await page.evaluate(async () => {
    const g = window.game;
    const s = g.story;
    s.load({ done: ['p1', 'p2', 'p3'], flags: {}, phone: [] });
    s.start('m2');
    g.simulate(0.1);
    // Skip the intro scene.
    for (let k = 0; k < 20 && g.sceneUI.active; k++) window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape' }));
    g.simulate(0.2);
    const during = { active: s.active?.id, jobBlocked: g.jobs.hooks.blocked?.() ?? null, missionsBlocked: g.missions.interactables.every((i) => !i.available()) };
    g.stats.damage(1000);
    await new Promise((r) => setTimeout(r, 3200));
    return { during, after: s.active?.id ?? null, failed: s.log[s.log.length - 1], offered: s.offerFrom('dolores')?.id ?? null };
  });
  t.ok('during a story mission, side jobs and side missions are blocked', fail.during.active === 'm2' && !!fail.during.jobBlocked && fail.during.missionsBlocked, JSON.stringify(fail.during));
  t.ok('dying fails the mission and Dolores offers it again', fail.after === null && /fail m2/.test(fail.failed) && fail.offered === 'm2', JSON.stringify(fail));

  // --- Skipping the prologue: its missions count as done (and pay), Act 1 opens.
  const skip = await page.evaluate(async () => {
    const g = window.game;
    const s = g.story;
    s.load({ done: [], flags: {}, phone: [] });
    s.startPrologue();
    const money = g.stats.money;
    s.skipPrologue();
    await new Promise((r) => setTimeout(r, 0));
    return { done: [...s.done], paid: g.stats.money - money, active: s.active?.id ?? null, avail: s.available().map((m) => m.id) };
  });
  t.ok('skipping the prologue counts it done, pays it, and opens Act 1', skip.done.join() === 'p1,p2,p3' && skip.paid === 300 && skip.active === null && skip.avail.includes('m1') && skip.avail.includes('m2'), JSON.stringify(skip));

  // --- Goons: knocking them out adds no stars.
  const goons = await page.evaluate(() => {
    const g = window.game;
    g.wanted.clear();
    const p = g.onFoot.focus();
    g.pedestrians.summonGoon(p.x + 5, p.z);
    g.simulate(0.2);
    const goon = g.pedestrians.peds.find((x) => x.goon && x.active);
    g.pedestrians.damage(goon, 999, 'melee');
    g.simulate(0.2);
    return { stars: g.wanted.stars, heat: g.wanted.heat, down: goon.state };
  });
  t.ok('knocking out a goon is not a crime', goons.down === 'down' && goons.heat === 0, JSON.stringify(goons));
}, { people: true, prologue: true });
