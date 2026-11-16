// Phase 14 (online): the relay server, a lobby, simultaneous and sequential turns between two
// browsers, matching game states, chat, and a player dropping out.
const { spawn } = require('node:child_process');
const { join } = require('node:path');
const { chromium } = require('playwright');
const { Checks } = require('./harness.cjs');

const URL = process.env.CIV_URL || 'http://localhost:4174/civilization/';
const PORT = 8790;
const WS = `ws://localhost:${PORT}`;

(async () => {
  const t = new Checks('online multiplayer');
  const server = spawn(process.execPath, [join(__dirname, '..', 'server', 'server.mjs'), String(PORT)], { stdio: 'ignore' });
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const errors = [];
  try {
    for (let i = 0; ; i++) {
      try {
        if ((await fetch(`http://localhost:${PORT}/health`)).ok) break;
      } catch {
        /* not up yet */
      }
      if (i > 50) throw new Error('relay server did not start');
      await new Promise((r) => setTimeout(r, 200));
    }
    t.ok('relay server answers', true);
    const open = async () => {
      const ctx = await browser.newContext({ viewport: { width: 1000, height: 650 } });
      const page = await ctx.newPage();
      page.on('pageerror', (e) => errors.push(String(e)));
      await page.goto(URL);
      await page.waitForFunction(() => window.hexborne, null, { timeout: 120000 });
      return page;
    };
    const host = await open();
    const guest = await open();
    const until = (page, fn, arg) => page.waitForFunction(fn, arg, { timeout: 60000 });

    // Lobby.
    const room = await host.evaluate(async (ws) => {
      await window.hexborne.net.connect(ws, 'Ann');
      return window.hexborne.net.info().room;
    }, WS);
    t.ok('host creates a room with a code', /^[A-Z]{4}$/.test(room), room);
    await guest.evaluate(async ([ws, room]) => window.hexborne.net.connect(ws, 'Ben', room), [WS, room]);
    await until(host, () => window.hexborne.net.info().slots.length === 2);
    t.ok('the guest appears in the host’s lobby', true);
    const early = await host.evaluate(() => window.hexborne.net.startOnline({ seed: 'net', mapSize: 'tiny', cityStates: 0 }));
    t.ok('cannot start before everyone is ready', /ready/.test(early ?? ''), early);
    await guest.evaluate(() => window.hexborne.net.pick('iron', true));
    await until(host, () => window.hexborne.net.info().slots[1].ready);
    await until(guest, () => window.hexborne.net.info().slots.length === 2);
    t.ok('the guest sees the lobby (both players)', true);
    await guest.evaluate(() => window.hexborne.net.chat('hello from Ben'));
    await until(host, () => window.hexborne.net.info().chat.some((x) => x.text === 'hello from Ben'));
    t.ok('lobby chat reaches the host', true);

    // Start: simultaneous turns.
    const start = await host.evaluate(() => window.hexborne.net.startOnline({ seed: 'net', mapSize: 'tiny', cityStates: 0, turnMode: 'simultaneous' }));
    t.ok('host starts the game', start === null, start);
    await until(guest, () => window.hexborne.state && window.hexborne.net.info().started);
    const g0 = await guest.evaluate(() => ({ human: window.hexborne.state.human, faction: window.hexborne.state.players[1].faction, nick: window.hexborne.state.players[1].nick, setup: window.hexborne.store.getState().setup }));
    t.ok('the guest plays seat 2 with the civilization it picked', g0.human === 1 && g0.faction === 'iron' && g0.nick === 'Ben' && !g0.setup, g0);
    const digest = (page) => page.evaluate(() => window.hexborne.net.digest(window.hexborne.state));
    t.ok('both browsers start with the same world', (await digest(host)) === (await digest(guest)));

    // Both found their cities at the same time.
    const found = (page) =>
      page.evaluate(() => {
        const h = window.hexborne;
        const s = h.state;
        const u = Object.values(s.units).find((x) => x.owner === s.human && x.type === 'settler');
        return h.play({ type: 'found', unit: u.id });
      });
    t.ok('host founds a city', await found(host));
    t.ok('guest sends its found-city action', await found(guest));
    await until(guest, () => Object.values(window.hexborne.state.cities).filter((c) => c.owner < 2).length === 2);
    await until(host, () => Object.values(window.hexborne.state.cities).filter((c) => c.owner < 2).length === 2);
    t.ok('both cities exist in both browsers', true);
    t.ok('states match after the actions', (await digest(host)) === (await digest(guest)));
    const cross = await guest.evaluate(() => {
      const h = window.hexborne;
      const u = Object.values(h.state.units).find((x) => x.owner === 0);
      h.play({ type: 'order', unit: u.id, order: 'fortify' });
      return u.id;
    });
    await guest.waitForTimeout(300);
    t.ok('the host refuses an order for someone else’s unit', await host.evaluate((id) => window.hexborne.state.units[id].order !== 'fortify', cross));

    // End of turn: the AI moves once both are done.
    await guest.evaluate(() => window.hexborne.endTurn(true));
    await until(host, () => window.hexborne.net.info().done.includes(1));
    await until(guest, () => /Waiting/.test(document.querySelector('#endturn').textContent)).catch(() => {});
    const waiting = await guest.evaluate(() => document.querySelector('#endturn').textContent);
    t.ok('the guest waits for the host', /Waiting for Ann/.test(waiting), waiting);
    t.ok('the turn has not ended yet', (await host.evaluate(() => window.hexborne.state.turn)) === 0);
    await host.evaluate(() => window.hexborne.endTurn(true));
    await until(host, () => window.hexborne.state.turn === 1 && !window.hexborne.store.getState().busy);
    await until(guest, () => window.hexborne.state.turn === 1);
    const ai = await guest.evaluate(() => Object.values(window.hexborne.state.cities).filter((c) => c.owner >= 2).length);
    t.ok('after both ended the turn the AI moved (guest sees AI cities)', ai >= 1, ai);
    t.ok('states match after the turn', (await digest(host)) === (await digest(guest)));
    t.ok('the guest still plays its own seat', (await guest.evaluate(() => window.hexborne.state.human)) === 1);

    // Sequential mode: the guest must wait for the host.
    await host.evaluate(() => (window.hexborne.state.settings.turnMode = 'sequential'));
    await guest.evaluate(() => (window.hexborne.state.settings.turnMode = 'sequential'));
    // Refresh the host's status so the guest learns who is active.
    await host.evaluate(() => window.hexborne.net.chat('sequential now'));
    const blocked = await guest.evaluate(() => {
      const h = window.hexborne;
      const s = h.state;
      const u = Object.values(s.units).find((x) => x.owner === 1 && x.moves > 0);
      return h.play({ type: 'order', unit: u.id, order: 'sleep' });
    });
    t.ok('sequential: the second seat cannot act during the first seat’s turn', blocked === false);
    await host.evaluate(() => window.hexborne.endTurn(true));
    await until(guest, () => window.hexborne.net.info().active.includes(1));
    const moved = await guest.evaluate(() => {
      const h = window.hexborne;
      const u = Object.values(h.state.units).find((x) => x.owner === 1 && x.moves > 0);
      return h.play({ type: 'order', unit: u.id, order: 'sleep' }) && u.id;
    });
    await until(host, (id) => window.hexborne.state.units[id]?.order === 'sleep', moved);
    t.ok('sequential: then the second seat moves', true);

    // In-game chat and a player dropping out.
    await guest.evaluate(() => window.hexborne.net.chat('gg'));
    await until(host, () => window.hexborne.net.info().chat.some((x) => x.text === 'gg'));
    t.ok('in-game chat', true);
    await guest.context().close();
    await until(host, () => window.hexborne.net.info().slots[1].online === false);
    await until(host, () => window.hexborne.state.turn === 2 && !window.hexborne.store.getState().busy);
    t.ok('when a player drops out, the turn goes on without them', true);
  } catch (e) {
    t.ok('test ran to the end', false, String(e && e.stack ? e.stack.split('\n').slice(0, 3).join(' ') : e));
  } finally {
    t.finish(errors);
    await browser.close();
    server.kill();
  }
})();
