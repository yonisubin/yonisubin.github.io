// Glue between the UI and the core: player actions, ending the turn (AI in a Web Worker),
// selection, new games, saves.
import { D } from '../data';
import { applyAction, newGame, nextRequiredAction, type NewGameOptions } from '../core/game';
import { playerUnits } from '../core/query';
import type { Action, GameState } from '../core/state';
import { runEndTurn } from '../ai';
import { loadGame, saveGame } from '../save/db';
import { bump, set, store, ui } from './store';

let worker: Worker | null = null;
function getWorker(): Worker | null {
  if (worker) return worker;
  try {
    worker = new Worker(new URL('../ai/worker.ts', import.meta.url), { type: 'module' });
  } catch {
    worker = null;
  }
  return worker;
}

export function game(): GameState {
  const g = ui().game;
  if (!g) throw new Error('no game');
  return g;
}

export function toast(msg: string): void {
  set({ toast: msg });
  const at = Date.now();
  setTimeout(() => {
    if (ui().toast === msg && Date.now() - at >= 2900) set({ toast: null });
  }, 3000);
}

/** Apply an action for the human player; shows the error if it fails. */
export function act(a: Action): boolean {
  const s = game();
  if (ui().busy) return false;
  const res = applyAction(s, s.human, a);
  if (!res.ok && res.error) toast(res.error);
  // A unit that died or was consumed can't stay selected.
  const sel = ui().selUnit;
  if (sel !== null && !s.units[sel]) set({ selUnit: null });
  bump();
  return res.ok;
}

export function selectUnit(id: number | null): void {
  set({ selUnit: id, selCity: null, cityAttack: false });
}

export function selectCity(id: number | null): void {
  set({ selCity: id, selUnit: null, cityAttack: false });
}

/** Select the next unit that still needs orders. */
export function nextUnit(): boolean {
  const s = game();
  const units = playerUnits(s, s.human).filter((u) => u.moves > 0 && u.order === 'none' && !u.job && !u.path.length && !u.exploring);
  if (!units.length) return false;
  const cur = ui().selUnit;
  const i = units.findIndex((u) => u.id === cur);
  const next = units[(i + 1) % units.length];
  selectUnit(next.id);
  return true;
}

/** What the End Turn button would do now. */
export function endTurnLabel(): string {
  const s = game();
  if (s.winner) return 'Game over';
  const n = nextRequiredAction(s, s.human);
  switch (n.kind) {
    case 'research':
      return 'Choose research';
    case 'production':
      return 'Choose production';
    case 'capture':
      return 'Decide city fate';
    case 'promotion':
      return 'Promotion ready';
    default: {
      const idle = playerUnits(s, s.human).filter((u) => u.moves > 0 && u.order === 'none' && !u.job && !u.path.length && !u.exploring).length;
      return idle ? `End turn (${idle} idle)` : 'End turn';
    }
  }
}

export async function endTurn(force = false): Promise<void> {
  const s = game();
  if (ui().busy || s.winner) return;
  const n = nextRequiredAction(s, s.human);
  if (!force) {
    if (n.kind === 'research') return set({ panel: 'tech' });
    if (n.kind === 'production' || n.kind === 'capture') return selectCity(n.id!);
    if (n.kind === 'promotion') return selectUnit(n.id!);
  }
  set({ busy: true, selUnit: null, cityAttack: false });
  const done = (next: GameState) => {
    set({ game: next, busy: false });
    bump();
    afterTurn(next);
  };
  const w = getWorker();
  if (!w) {
    // No worker support: run on the main thread.
    setTimeout(() => {
      runEndTurn(s);
      done(s);
    }, 0);
    return;
  }
  await new Promise<void>((resolve) => {
    w.onmessage = (e: MessageEvent<{ ok: boolean; state?: GameState; error?: string }>) => {
      if (e.data.ok && e.data.state) done(e.data.state);
      else {
        console.error(e.data.error);
        toast('Something went wrong while the other players moved.');
        set({ busy: false });
      }
      resolve();
    };
    w.onerror = (err) => {
      console.error(err);
      // Fall back to the main thread for good.
      worker = null;
      runEndTurn(s);
      done(s);
      resolve();
    };
    w.postMessage(s);
  });
}

function afterTurn(s: GameState): void {
  if (s.turn % D.rules.autosaveEveryTurns === 0) saveGame('Autosave', s).catch(() => {});
  try {
    localStorage.setItem('civ:lastSave', 'Autosave');
  } catch {
    /* storage may be unavailable */
  }
  nextUnit();
}

export function startGame(o: NewGameOptions): void {
  const s = newGame(o);
  set({ game: s, setup: false, panel: 'none', selCity: null, selUnit: null, endClosed: false, endTab: 'summary', replayTurn: 0 });
  bump();
  nextUnit();
  saveGame('Autosave', s).catch(() => {});
}

export async function quickSave(name = 'Quicksave'): Promise<void> {
  try {
    await saveGame(name, game());
    toast(`Saved “${name}”.`);
  } catch (e) {
    toast(`Could not save: ${String(e)}`);
  }
}

export async function load(name: string): Promise<boolean> {
  try {
    const s = await loadGame(name);
    if (!s) {
      toast(`No save called “${name}”.`);
      return false;
    }
    set({ game: s, setup: false, panel: 'none', selCity: null, selUnit: null, busy: false, endClosed: false, endTab: 'summary', replayTurn: 0 });
    bump();
    toast(`Loaded “${name}” (turn ${s.turn}).`);
    return true;
  } catch (e) {
    toast(`Could not load: ${String(e)}`);
    return false;
  }
}

export { store };
