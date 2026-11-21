// Record a clip in the real game (not the RL viewer): the player's car on the autopilot, with
// the AI traffic around it. Steps the game 1/30 s per frame (game.frame) and screenshots
// each frame, then encodes MP4 + GIF into rl/media/.
//
//   npm run build && npx vite preview --port 4173   (in another terminal)
//   node rl/record/game.cjs <name> <seconds> [destination metres away, default 600] [x,z start]
//
// GAME_URL overrides the server (add ?ai=0 to film the old rule-based traffic).
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
process.env.GAME_URL ??= 'http://localhost:4173/';
const { openGame } = require('../../tests/harness.cjs');

(async () => {
  const [name, seconds = '15', distance = '600', start = ''] = process.argv.slice(2);
  const W = 960;
  const H = 540;
  const frames = Math.round(Number(seconds) * 30);
  const { browser, page, errors } = await openGame({ viewport: { width: W, height: H } });
  try {
    if (!process.env.GAME_URL.includes('ai=0')) await page.waitForFunction(() => window.game.traffic.hasPolicy, null, { timeout: 60000 });
    const setup = await page.evaluate(
      ({ distance, start }) => {
        const g = window.game;
        g.renderer.setAnimationLoop(null);
        // No "Click to play" curtain or fps readout in the video.
        for (const d of document.querySelectorAll('div')) {
          if (d.style.position === 'fixed' && /Click to play|draw calls/.test(d.textContent ?? '')) d.style.setProperty('visibility', 'hidden', 'important');
        }
        g.dayNight.hours = 15;
        const V = g.camera.position.constructor;
        const net = g.city.layout.streets.net;
        const car = g.cars.find((c) => c.type === 'sedan' && !c.livery);
        // Start on a road (near `start`, else near the car's parking spot), facing along it.
        const [sx, sz] = start ? start.split(',').map(Number) : [car.interp.currPos.x, car.interp.currPos.z];
        const hit = net.nearest(sx, sz, 400);
        const e = net.edges[hit.edge];
        const at = net.pointAt(e, Math.min(e.length - 10, Math.max(10, e.cum[hit.seg])), { x: 0, z: 0, tx: 0, tz: 0 });
        const x = at.x - at.tz * 1.75;
        const z = at.z + at.tx * 1.75;
        g.city.streamer.loadAround(new V(x, 0, z), 600);
        const yaw = Math.atan2(-at.tz, at.tx);
        car.body.setTranslation({ x, y: g.city.terrain.smoothHeight(x, z) + 0.3, z }, true);
        car.body.setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }, true);
        car.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        g.player.setMode(car.mode);
        g.simulate(3); // traffic settles around us
        // A destination about `distance` m away, at a junction.
        const dest = net.nodes
          .filter((n) => n.edges.length >= 2)
          .sort((a, b) => Math.abs(Math.hypot(a.x - x, a.z - z) - distance) - Math.abs(Math.hypot(b.x - x, b.z - z) - distance))[0];
        g.navigator.setWaypoint(dest.x, dest.z);
        g.stats.money = Math.max(g.stats.money, 100);
        g.stats.buyAutopilot(50);
        for (let i = 0; i < 10; i++) g.frame(1 / 30);
        g.input.pressAction('autopilot');
        g.frame(1 / 30);
        g.input.releaseAction('autopilot');
        return { engaged: g.autopilot.engaged, route: g.autopilot.remaining };
      },
      { distance: Number(distance), start },
    );
    console.log(name, 'autopilot', JSON.stringify(setup));
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `game-${name}-`));
    const t0 = Date.now();
    let arrivedAt = -1;
    for (let i = 0; i < frames; i++) {
      const s = await page.evaluate(() => {
        window.game.frame(1 / 30);
        return { arrived: window.game.autopilot.stats.arrived, engaged: window.game.autopilot.engaged };
      });
      if (s.arrived && arrivedAt < 0) arrivedAt = i;
      await page.screenshot({ path: path.join(tmp, `f${String(i).padStart(5, '0')}.png`) });
      if (i % 90 === 0) console.log(name, `${i}/${frames}`, `${((Date.now() - t0) / 1000).toFixed(0)}s`);
      // Keep two seconds after arriving, then stop.
      if (arrivedAt >= 0 && i - arrivedAt > 60) break;
    }
    const stats = await page.evaluate(() => ({ autopilot: window.game.autopilot.stats, traffic: window.game.traffic.stats }));
    console.log(name, 'stats', JSON.stringify(stats), 'errors', errors.length);
    const out = path.join(__dirname, '..', 'media');
    fs.mkdirSync(out, { recursive: true });
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '30', '-i', path.join(tmp, 'f%05d.png'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '23', '-preset', 'slow', path.join(out, `${name}.mp4`)]);
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(out, `${name}.mp4`), '-vf',
      'fps=12,scale=560:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle', path.join(out, `${name}.gif`)]);
    fs.rmSync(tmp, { recursive: true, force: true });
    console.log('wrote', path.join(out, `${name}.mp4`));
  } finally {
    await browser.close();
  }
})();
