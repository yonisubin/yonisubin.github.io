// Hexborne entry point: sets up PixiJS, the map view, HUD and input, and redraws whenever the
// UI store changes. Exposes window.hexborne for automated tests.
import { Application } from 'pixi.js';
import { D } from './data';
import { applyAction, newGame, type NewGameOptions } from './core/game';
import { distance, neighbor, tileCenter, within } from './core/hex';
import { playerCities, playerUnits } from './core/query';
import type { Action, GameState } from './core/state';
import { claimableTiles, tileBuyCost } from './core/systems/cities';
import { canAttack } from './core/systems/combat';
import { findPath, reachable } from './core/systems/movement';
import { runEndTurn } from './ai';
import { HEX, MapView, type Overlay } from './render/mapView';
import { Minimap } from './render/minimap';
import { bump, set, store, ui } from './ui/store';
import { installHudEvents, refreshSaves, renderHud } from './ui/hud';
import { installInput } from './ui/input';
import { endTurn, startGame } from './ui/controller';
import { saveGame, loadGame } from './save/db';
import { damage } from './core/systems/combat';
import { cityYields, growthNeeded, tileYields } from './core/systems/yields';
import { foundCity } from './core/systems/cities';
import { createUnit } from './core/systems/units';
import { recomputeAllVisibility } from './core/systems/visibility';
import { setWar, checkVictory } from './core/game';
import { opinion } from './core/systems/diplomacy';
import { routeOptions } from './core/systems/trade';
import { influenceLevel, culturalWinner, cityCultureYields } from './core/systems/culture';
import { publicOpinion } from './core/systems/ideology';
import { recordSite } from './core/systems/archaeology';
import { delegates } from './core/systems/congress';
import { connectedLuxuries } from './core/systems/happiness';
import { dealProblem } from './core/systems/diplomacy';
import { stealTarget } from './core/systems/espionage';
import { majority, religionCityEffects } from './core/systems/religion';
import { cityStateEffects } from './core/systems/citystates';
import { playerEffects } from './core/systems/effects';
import { happinessOf } from './core/systems/happiness';
import { canEnter } from './core/systems/movement';
import { addScience } from './core/systems/research';
import './style.css';

async function main(): Promise<void> {
  const app = new Application();
  await app.init({ resizeTo: window, background: '#0b0e14', antialias: true, autoDensity: true, resolution: Math.min(2, window.devicePixelRatio || 1) });
  document.getElementById('map')!.appendChild(app.canvas);
  const view = new MapView(app);
  const minimap = new Minimap(document.getElementById('minimap') as HTMLCanvasElement, (fx, fy) => {
    view.cam.x = fx * view.worldW;
    view.cam.y = fy * view.worldH;
    view.applyCamera();
    schedule();
  });
  installInput(view, app.canvas, document.getElementById('tooltip')!);
  installHudEvents((tile) => {
    view.centerOn(tile);
    schedule();
  });

  let lastGame: GameState | null = null;
  let lastHuman = -2;
  let lastKey = '';
  let pending = false;
  function schedule(): void {
    if (pending) return;
    pending = true;
    requestAnimationFrame(redraw);
  }
  function redraw(): void {
    pending = false;
    const st = ui();
    renderHud();
    const s = st.game;
    // Hidden while a hotseat player passes the device (no peeking at someone else's map).
    app.canvas.style.visibility = s && !st.setup && st.passTo === null ? 'visible' : 'hidden';
    if (!s || st.setup || st.passTo !== null) return;
    if (s !== lastGame || s.human !== lastHuman) {
      const seatChanged = s.human !== lastHuman;
      lastHuman = s.human;
      const fresh = !lastGame || lastGame.settings.seed !== s.settings.seed || seatChanged;
      view.setGame(s);
      if (fresh || !lastGame) centerStart(s);
      lastGame = s;
      lastKey = '';
    }
    const ov = overlay(s);
    const key = `${st.rev}|${st.selUnit}|${st.selCity}|${st.lens}|${ov.path.length}|${ov.path[ov.path.length - 1]}|${ov.pathTurns}`;
    view.update(s, s.human, ov, key !== lastKey);
    lastKey = key;
    const { width, height } = app.screen;
    minimap.draw(s, s.human, { x: view.cam.x / view.worldW, y: view.cam.y / view.worldH, w: width / view.cam.zoom / view.worldW, h: height / view.cam.zoom / view.worldH }, st.rev);
  }
  function centerStart(s: GameState): void {
    const p = Math.max(0, s.human);
    const c = playerCities(s, p)[0];
    const u = playerUnits(s, p)[0];
    view.centerOn(c ? c.tile : u ? u.tile : 0);
  }
  function overlay(s: GameState): Overlay {
    const st = ui();
    const ov: Overlay = { selectedTile: -1, reachable: new Map(), attackable: [], path: [], pathTurns: 0, city: st.selCity, showYields: st.lens, hover: st.hover, buyable: new Map() };
    const u = st.selUnit !== null ? s.units[st.selUnit] : undefined;
    if (u) {
      ov.selectedTile = u.tile;
      if (u.owner === s.human) {
        ov.reachable = reachable(s, u);
        for (const t of within(s.map, u.tile, Math.max(1, D.units.get(u.type)!.range))) if (t !== u.tile && !canAttack(s, u, t)) ov.attackable.push(t);
        if (st.hover >= 0 && st.hover !== u.tile && distance(s.map, u.tile, st.hover) < 30) {
          const path = findPath(s, u, st.hover);
          if (path) {
            ov.path = path.path;
            ov.pathTurns = path.turns;
          }
        } else if (u.path.length) {
          ov.path = u.path;
        }
      }
    }
    if (st.selCity !== null && s.cities[st.selCity]) {
      const c = s.cities[st.selCity];
      ov.selectedTile = c.tile;
      if (c.owner === s.human) for (const t of claimableTiles(s, c)) ov.buyable.set(t, tileBuyCost(s, c, t));
    }
    return ov;
  }
  store.subscribe(schedule);
  window.addEventListener('resize', schedule);
  app.ticker.add(() => {
    // Keep the minimap rectangle in step with camera moves (pan/zoom don't touch the store).
    const s = ui().game;
    if (s && !ui().setup) {
      const { width, height } = app.screen;
      minimap.draw(s, s.human, { x: view.cam.x / view.worldW, y: view.cam.y / view.worldH, w: width / view.cam.zoom / view.worldW, h: height / view.cam.zoom / view.worldH }, ui().rev);
    }
  });

  await refreshSaves();
  schedule();

  // ---- Test hooks ----
  const api = {
    D,
    store,
    view,
    get state(): GameState | null {
      return ui().game;
    },
    /** Start a game immediately (options as in newGame). */
    start(o: NewGameOptions = {}) {
      startGame(o);
      return ui().game!;
    },
    /** Apply an action as the human player. */
    act(a: Action) {
      const s = ui().game!;
      const r = applyAction(s, s.human, a);
      bump();
      return r;
    },
    /** End the turn synchronously on the main thread (AI included). */
    endTurnSync() {
      const s = ui().game!;
      runEndTurn(s);
      bump();
      return s.turn;
    },
    /** End the turn the way the button does (AI in the worker). */
    endTurn: (force = true) => endTurn(force),
    /** Headless AI-only game for `turns` turns; returns the state. */
    simulate(turns: number, o: NewGameOptions = {}) {
      const s = newGame({ ...o, spectator: true });
      for (let t = 0; t < turns && !s.winner; t++) runEndTurn(s);
      return s;
    },
    save: (name: string) => saveGame(name, ui().game!),
    load: (name: string) => loadGame(name),
    centerOn: (tile: number) => view.centerOn(tile),
    tileCenter: (tile: number) => {
      const s = ui().game!;
      const p = tileCenter(s.map, tile, HEX);
      return { x: view.world.x + p.x * view.cam.zoom, y: view.world.y + p.y * view.cam.zoom };
    },
    set,
    /** Core functions for formula and rule checks. */
    core: { delegates, connectedLuxuries, dealProblem, stealTarget, influenceLevel, publicOpinion, culturalWinner, cityCultureYields, recordSite, routeOptions, majority, religionCityEffects, opinion, cityStateEffects, playerEffects, happinessOf, canEnter, cityYields, tileYields, checkVictory, addScience, neighbor, distance, findPath, damage, growthNeeded, foundCity, createUnit, recomputeAllVisibility, setWar, newGame, runEndTurn },
  };
  (window as unknown as { hexborne: typeof api }).hexborne = api;
}

main().catch((e) => {
  console.error(e);
  document.body.innerHTML = `<pre style="color:#f88;padding:20px;white-space:pre-wrap">Hexborne failed to start:\n${String(e instanceof Error ? e.stack : e)}</pre>`;
});
