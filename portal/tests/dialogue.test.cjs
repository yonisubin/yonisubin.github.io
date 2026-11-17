// Dialogue: priority queue, lines never overlap, interrupts, stale nags dropped, subtitles, ducking,
// captions, the synthesised voice (pitch-quantised syllables), bus hooks and level dialogue hooks.
const { run } = require('./harness.cjs');

run('dialogue', async ({ page }, t) => {
  const r = await page.evaluate(() => {
    const s = window.twinfoldShell, d = s.app.dialogue, out = {};
    d.clear();
    d.history.length = 0;
    // Queue: a normal line plays at once; then a nag (1), an important line (3) and a normal (2).
    d.sayText('First line, playing.', 2, 'The Provost', 'first');
    d.sayText('A nag.', 1, 'The Provost', 'nag');
    d.sayText('An important line.', 3, 'The Provost', 'important');
    d.sayText('A normal line.', 2, 'The Provost', 'normal');
    out.speaking = d.speaking;
    out.subtitle = document.getElementById('subtitles').textContent;
    out.subtitleShown = getComputedStyle(document.getElementById('subtitles')).display;
    out.ducked = s.app.sound.isDucked;
    d.advance(30);
    out.order = d.history.map((h) => h.id);
    out.overlap = d.history.some((h, i) => i > 0 && h.start < d.history[i - 1].end);
    out.gaps = d.history.slice(1).map((h, i) => +(h.start - d.history[i].end).toFixed(3));
    out.afterSpeaking = d.speaking;
    out.afterSubtitle = getComputedStyle(document.getElementById('subtitles')).display;
    out.afterDucked = s.app.sound.isDucked;
    // Interrupt: priority 6 cuts a priority-2 line off; it never plays over it.
    d.history.length = 0;
    d.sayText('This line will be cut off before it ends, because something urgent happens.', 2, 'The Provost', 'long');
    d.advance(0.5);
    d.sayText('Urgent!', 6, 'The Provost', 'urgent');
    d.advance(10);
    out.interrupt = d.history.map((h) => ({ id: h.id, interrupted: h.interrupted, start: h.start, end: h.end }));
    // Stale: a nag queued behind 15 s of important lines is dropped.
    d.history.length = 0;
    for (let i = 0; i < 4; i++) d.sayText('An important announcement that takes quite a few seconds to read out loud, slowly.', 3, 'The Provost', `imp${i}`);
    d.sayText('Hey.', 1, 'The Provost', 'stale');
    d.advance(60);
    out.staleIds = d.history.map((h) => h.id);
    return out;
  });
  t.ok('a line plays straight away with a subtitle', r.speaking && r.subtitleShown === 'block' && r.subtitle.includes('First line'), r.subtitle);
  t.ok('music and effects duck while speaking', r.ducked === true);
  t.ok('queue order: playing line, then by priority, then arrival', JSON.stringify(r.order) === JSON.stringify(['first', 'important', 'normal', 'nag']), r.order.join(','));
  t.ok('lines never overlap', !r.overlap, r.gaps.join(','));
  t.ok('a gap between lines', r.gaps.every((g) => g >= 0.3), r.gaps.join(','));
  t.ok('subtitle hides and ducking ends after the last line', !r.afterSpeaking && r.afterSubtitle === 'none' && r.afterDucked === false);
  const [cut, urgent] = r.interrupt;
  t.ok('a priority-6 line interrupts a normal one', cut && cut.id === 'long' && cut.interrupted && urgent && urgent.id === 'urgent', JSON.stringify(r.interrupt));
  t.ok('… and starts only after it stopped', urgent && urgent.start >= cut.end);
  t.ok('stale nags are dropped', !r.staleIds.includes('stale') && r.staleIds.length === 4, r.staleIds.join(','));

  // Voice synthesis: syllables follow the text, pitches snap to the scale.
  const v = await page.evaluate(() => {
    const s = window.twinfoldShell;
    const short = s.planUtterance('Good.');
    const long = s.planUtterance('Good morning, Applicant. This practical has been cleaned, measured and approved.');
    const q = s.planUtterance('Are you still there?');
    const base = 168, scale = [0, 2, 3, 5, 7, 9, 10, 12];
    const quantised = long.syllables.every((x) => scale.some((k) => Math.abs(12 * Math.log2(x.pitch / base) - k) < 1e-6));
    const sorted = long.syllables.every((x, i) => i === 0 || x.start >= long.syllables[i - 1].start + long.syllables[i - 1].dur - 1e-9);
    const ctx = s.app.sound.ctx;
    return { short: short.duration, long: long.duration, n: long.syllables.length, quantised, sorted, qEnd: q.syllables[q.syllables.length - 1].pitch, qStart: q.syllables[0].pitch, running: ctx && ctx.state, syl: s.app.dialogue.voice.stats.syllables };
  });
  t.ok('longer text speaks longer', v.long > v.short * 4, `${v.short.toFixed(2)} s vs ${v.long.toFixed(2)} s`);
  t.ok('about one syllable per vowel group', v.n >= 20 && v.n <= 34, String(v.n));
  t.ok('every syllable pitch is quantised to the scale', v.quantised);
  t.ok('syllables never overlap', v.sorted);
  t.ok('questions rise at the end', v.qEnd > v.qStart, `${v.qStart.toFixed(0)} → ${v.qEnd.toFixed(0)} Hz`);
  t.ok('the voice reached Web Audio (when audio runs)', v.running !== 'running' || v.syl > 0, `${v.running}, ${v.syl} syllables`);

  // Bus hooks.
  const b = await page.evaluate(() => {
    const s = window.twinfoldShell, d = s.app.dialogue, ev = s.session.events, out = {};
    d.clear();
    d.history.length = 0;
    ev.emit('chamberStart', { chamberId: 'testroom' });
    out.start = d.current && d.current.id;
    d.clear();
    ev.emit('death', { cause: 'turret' });
    out.death = d.current && d.current.id;
    d.clear();
    ev.emit('outOfBounds', {});
    out.oob = d.current && d.current.id;
    d.clear();
    // A level with its own hooks: chamberStart and a trigger.
    const lvl = JSON.parse(JSON.stringify(window.twinfold.level));
    lvl.id = 'hooked';
    lvl.dialogue = [
      { event: 'chamberStart', lines: ['exitReached.helpful.2'] },
      { event: 'doorway', lines: ['checkpoint.2'] },
    ];
    s.session.loadChamber(lvl);
    out.hookStart = d.current && d.current.id;
    d.clear();
    ev.emit('trigger', { name: 'doorway' });
    out.hookTrigger = d.current && d.current.id;
    d.clear();
    // Tone follows the chamber number.
    d.setToneFor({ info: { number: 12 } });
    out.tone12 = d.tone;
    d.setToneFor({ info: { number: 20 } });
    out.tone20 = d.tone;
    d.setToneFor(null);
    // Captions for sfx events (captions were turned on? use the option).
    s.app.setOption('captions', true);
    ev.emit('sfx', { name: 'doorOpen', caption: '[door slides open]' });
    out.caption = document.getElementById('captions').textContent;
    s.app.setOption('captions', false);
    ev.emit('sfx', { name: 'buttonPress', caption: '[button clicks]' });
    out.caption2 = document.getElementById('captions').textContent;
    // Subtitles option off: the line still plays, no subtitle.
    s.app.setOption('subtitles', false);
    d.sayText('Quiet line.', 2);
    out.noSub = getComputedStyle(document.getElementById('subtitles')).display;
    s.app.setOption('subtitles', true);
    out.subBack = getComputedStyle(document.getElementById('subtitles')).display;
    d.clear();
    // Every line has text; ids are pool.n.
    out.badLines = Object.entries(s.LINES).filter(([id, l]) => !l.text || !/^[\w.]+\.\d+$/.test(id)).map(([id]) => id);
    return out;
  });
  t.ok('chamber entry plays an entry line', /^chamberStart\./.test(b.start || ''), b.start);
  t.ok('a death plays a death quip', /^death\./.test(b.death || ''), b.death);
  t.ok('out of bounds plays its line', /^outOfBounds\./.test(b.oob || ''), b.oob);
  t.ok("a level's own chamberStart hook replaces the generic line", b.hookStart === 'exitReached.helpful.2', b.hookStart);
  t.ok('trigger events play their hooks', b.hookTrigger === 'checkpoint.2', b.hookTrigger);
  t.ok('tone follows the arc (helpful → passive → hostile)', b.tone12 === 'passive' && b.tone20 === 'hostile');
  t.ok('closed captions show sfx captions when on', b.caption.includes('[door slides open]') && !b.caption2.includes('[button clicks]'), b.caption + ' / ' + b.caption2);
  t.ok('subtitles can be turned off (and back on mid-line)', b.noSub === 'none' && b.subBack === 'block');
  t.ok('every line has text and an id like pool.n', b.badLines.length === 0, b.badLines.join(','));
});
