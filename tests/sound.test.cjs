// Sound: starts on the first click, plays (engine + radio when driving), one-shots clean up
// after themselves, it goes quiet in a hidden tab, and mute works and is remembered.
const { run } = require('./harness.cjs');

run('sound: start, driving + radio, cleanup, hidden tab, mute', async ({ page }, t) => {
  t.ok('no audio before a click (browsers forbid it)', !(await page.evaluate(() => !!window.game.sound.ctx)));
  await page.mouse.click(320, 200);
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    const s = window.game.sound;
    const a = s.ctx.createAnalyser();
    a.fftSize = 2048;
    s.master.connect(a);
    window.__level = () => {
      const buf = new Float32Array(a.fftSize);
      a.getFloatTimeDomainData(buf);
      return Math.sqrt(buf.reduce((n, v) => n + v * v, 0) / buf.length);
    };
  });
  t.ok('audio starts on the first click', (await page.evaluate(() => window.game.sound.ctx.state)) === 'running');
  await page.evaluate(() => {
    const g = window.game;
    g.player.setMode(g.cars[0].mode);
    g.input.setStick(0, 1);
  });
  await page.waitForTimeout(5000);
  const driving = await page.evaluate(() => ({ level: window.__level(), notes: window.game.director.radio.booked }));
  t.ok('driving with the radio on makes sound', driving.level > 0.005 && driving.notes > 20, `level ${driving.level.toFixed(4)}, ${driving.notes} radio notes`);
  const cleanup = await page.evaluate(async () => {
    const g = window.game;
    g.input.setStick(0, 0); // stop driving: no crash sounds of its own during the count
    await new Promise((r) => setTimeout(r, 1500));
    const base = g.sound.live;
    const at = g.player.mode.focus();
    for (let k = 0; k < 25; k++) {
      g.sound.gunshot(at, k % 2 === 0);
      g.sound.crash(at, 0.5);
    }
    const peak = g.sound.live;
    await new Promise((r) => setTimeout(r, 2500));
    return { base, peak, after: g.sound.live };
  });
  t.ok('50 one-shot sounds all clean up', cleanup.peak - cleanup.base === 50 && cleanup.after <= cleanup.base, `${cleanup.base} → ${cleanup.peak} → ${cleanup.after}`);
  // Hidden tab: the audio context suspends; visible again: it resumes.
  const hidden = await page.evaluate(async () => {
    const s = window.game.sound;
    const setVisibility = (v) => {
      Object.defineProperty(document, 'visibilityState', { value: v, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    };
    setVisibility('hidden');
    await new Promise((r) => setTimeout(r, 300));
    const whileHidden = s.ctx.state;
    setVisibility('visible');
    await new Promise((r) => setTimeout(r, 300));
    return { whileHidden, back: s.ctx.state };
  });
  t.ok('a hidden tab suspends the audio, showing it resumes', hidden.whileHidden === 'suspended' && hidden.back === 'running', JSON.stringify(hidden));
  await page.keyboard.press('KeyN');
  await page.waitForTimeout(1200);
  const muted = await page.evaluate(() => ({ muted: window.game.sound.muted, level: window.__level(), saved: JSON.parse(localStorage.getItem('opencity.audio')).muted }));
  t.ok('N mutes (silence) and the setting is saved', muted.muted && muted.level < 0.0005 && muted.saved, JSON.stringify(muted));
});
