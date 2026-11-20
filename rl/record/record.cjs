// Record a clip from the viewer: steps it frame by frame (30 fps of simulated time, however
// slowly the headless browser renders), screenshots each frame, encodes MP4 + GIF with ffmpeg.
//
//   npm run rl:viewer   (in another terminal)
//   node rl/record/record.cjs <name> "<viewer query>" <seconds> [skipDecisions]
//
// Writes rl/media/<name>.mp4 and rl/media/<name>.gif.
const { chromium } = require('playwright');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

(async () => {
  const [name, query, seconds = '12', skip = '0'] = process.argv.slice(2);
  const W = Number(process.env.W ?? 960);
  const H = Number(process.env.H ?? 540);
  const url = process.env.VIEWER_URL ?? 'http://localhost:5190/';
  const frames = Math.round(Number(seconds) * 30);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `rec-${name}-`));
  const out = path.join(__dirname, '..', 'media');
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  page.on('pageerror', (e) => console.log('pageerror:', e.message));
  await page.goto(`${url}?record=1&w=${W}&h=${H}&${query}`);
  await page.waitForFunction(() => window.viewer && window.viewer.ready, null, { timeout: 300000 });
  if (Number(skip)) await page.evaluate((n) => window.viewer.skip(n), Number(skip));
  // A few frames to let the streamed chunks and the camera settle.
  for (let i = 0; i < 4; i++) await page.evaluate(() => window.viewer.frame());
  const t0 = Date.now();
  for (let i = 0; i < frames; i++) {
    await page.evaluate(() => window.viewer.frame());
    await page.screenshot({ path: path.join(tmp, `f${String(i).padStart(5, '0')}.png`) });
    if (i % 60 === 0) console.log(name, `${i}/${frames}`, `${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
  console.log(name, 'stats', JSON.stringify(await page.evaluate(() => window.viewer.stats())));
  await browser.close();
  const mp4 = path.join(out, `${name}.mp4`);
  const gif = path.join(out, `${name}.gif`);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '30', '-i', path.join(tmp, 'f%05d.png'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '23', '-preset', 'slow', mp4]);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '30', '-i', path.join(tmp, 'f%05d.png'), '-vf',
    'fps=15,scale=640:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer:bayer_scale=4', gif]);
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('wrote', mp4, gif);
})();
