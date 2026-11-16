// Glue between the UI and the core: player actions, ending the turn (AI in a Web Worker),
// selection, new games, saves.
import { D } from '../data';
import { applyAction, humanSeats, isMultiplayer, newGame, nextRequiredAction, nextSeat, type NewGameOptions } from '../core/game';
import { eraOf, playerUnits, unitDef } from '../core/query';
import { musicOn, play, setMusicEra, startMusic, type Sfx } from '../audio/sound';
import type { Action, GameState } from '../core/state';
import { runEndTurn } from '../ai';
import { loadGame, saveGame } from '../save/db';
import { bump, set, store, ui } from './store';
import { forceEndTurn, installNet, net, netAct, netDone, online } from '../net/session';

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
  const sfx = soundFor(s, a);
  if (online()) {
    const ok = netAct(a);
    if (ok) play(sfx);
    return ok;
  }
  const res = applyAction(s, s.human, a);
  if (res.ok) play(sfx);
  if (!res.ok && res.error) toast(res.error);
  // A unit that died or was consumed can't stay selected.
  const sel = ui().selUnit;
  if (sel !== null && !s.units[sel]) set({ selUnit: null });
  bump();
  return res.ok;
}

/** The sound an action makes. */
function soundFor(s: GameState, a: Action): Sfx {
  switch (a.type) {
    case 'move':
      return 'step';
    case 'attack': {
      const u = s.units[a.unit];
      return u && unitDef(u).range > 0 ? 'shot' : 'melee';
    }
    case 'found':
      return 'found';
    case 'produce':
    case 'buy':
    case 'build':
      return 'build';
    default:
      return 'click';
  }
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
    case 'policy':
      return 'Choose a policy';
    case 'pantheon':
      return 'Choose a pantheon';
    case 'ideology':
      return 'Choose an ideology';
    case 'congress':
      return 'World Congress votes';
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
    if (n.kind === 'policy') return set({ panel: 'policies' });
    if (n.kind === 'pantheon') return set({ panel: 'religion' });
    if (n.kind === 'ideology') return set({ panel: 'culture' });
    if (n.kind === 'congress') return set({ panel: 'congress' });
  }
  // Hotseat: the next human seat moves before the AI does.
  if (isHotseat(s)) {
    const nxt = nextSeat(s, s.human);
    if (nxt >= 0) return passSeat(s, nxt);
  }
  if (online()) return netDone();
  set({ busy: true, selUnit: null, cityAttack: false });
  try {
    const next = await runTurn(s);
    // Back to the first seat still in the game for the new turn.
    if (isHotseat(next)) next.human = humanSeats(next)[0] ?? next.human;
    set({ game: next, busy: false });
    bump();
    afterTurn(next);
  } catch (e) {
    console.error(e);
    toast('Something went wrong while the other players moved.');
    set({ busy: false });
  }
}

/** Every AI plays and the turn ends: in the Web Worker, or on the main thread without one. */
export function runTurn(s: GameState): Promise<GameState> {
  const w = getWorker();
  const local = () =>
    new Promise<GameState>((resolve) =>
      setTimeout(() => {
        runEndTurn(s);
        resolve(s);
      }, 0),
    );
  if (!w) return local();
  return new Promise<GameState>((resolve, reject) => {
    w.onmessage = (e: MessageEvent<{ ok: boolean; state?: GameState; error?: string }>) => {
      if (e.data.ok && e.data.state) resolve(e.data.state);
      else reject(new Error(e.data.error));
    };
    w.onerror = (err) => {
      console.error(err);
      // Fall back to the main thread for good.
      worker = null;
      local().then(resolve);
    };
    w.postMessage(s);
  });
}

let startedAt = Date.now();
export const turnStartedAt = () => startedAt;

// Turn timer: when it runs out, the turn ends by itself.
setInterval(() => {
  const st = ui();
  const s = st.game;
  if (!s || st.setup || st.busy || st.passTo !== null || s.winner || s.settings.turnTimer <= 0) return;
  bump();
  if (Date.now() - startedAt >= s.settings.turnTimer * 1000) {
    if (online()) {
      // The host ends the turn for everyone; a guest just says it is done.
      if (net()!.isHost) forceEndTurn();
      else endTurn(true);
      startedAt = Date.now();
    } else endTurn(true);
  }
}, 1000);

// Online games: how the network session shows new states and runs the AI.
installNet({
  runTurn: (s) => {
    set({ busy: true, selUnit: null, cityAttack: false });
    return runTurn(s);
  },
  show: (s, fresh) => {
    if (fresh) {
      set({ game: s, setup: false, panel: 'none', selCity: null, selUnit: null, busy: false, endClosed: false, endTab: 'summary', replayTurn: 0, passTo: null });
      startedAt = Date.now();
      bump();
      nextUnit();
    } else {
      set({ game: s, busy: false });
      bump();
      afterTurn(s);
    }
  },
  toast,
});

/** Several humans take turns on this device. */
export const isHotseat = (s: GameState) => isMultiplayer(s) && !s.online;

/** Hand the device to another seat: cover the screen until they click "Begin". */
function passSeat(s: GameState, seat: number): void {
  s.human = seat;
  startedAt = Date.now();
  set({ passTo: seat, selUnit: null, selCity: null, panel: 'none', cityAttack: false, targeting: null, votes: null, tradeDeal: null });
  bump();
}

/** The seat's player is at the screen: show their empire. */
export function beginSeat(): void {
  set({ passTo: null });
  startedAt = Date.now();
  bump();
  nextUnit();
}

/** What the human had last turn, to pick the sounds of the new one. */
let lastTechs = -1;
let lastWinner = false;

function turnSounds(s: GameState): void {
  if (s.human < 0) return;
  const pl = s.players[s.human];
  if (s.winner && !lastWinner) play(s.winner.player === s.human ? 'victory' : 'defeat');
  else if (lastTechs >= 0 && pl.techs.length > lastTechs) play('tech');
  else if (pl.notifications.some((n) => n.turn === s.turn - 1 && n.kind === 'bad')) play('bad');
  else play('turn');
  lastTechs = pl.techs.length;
  lastWinner = !!s.winner;
  setMusicEra(eraOf(pl));
}

/** Start the music if the player turned it on (after a click, so the browser allows audio). */
function music(s: GameState): void {
  lastTechs = s.human >= 0 ? s.players[s.human].techs.length : -1;
  lastWinner = !!s.winner;
  if (musicOn()) startMusic(s.human >= 0 ? eraOf(s.players[s.human]) : 0);
}

function afterTurn(s: GameState): void {
  startedAt = Date.now();
  turnSounds(s);
  // Hotseat: the winner's seat sees the end screen.
  if (isHotseat(s) && s.winner && s.players[s.winner.player].isHuman) s.human = s.winner.player;
  if (isHotseat(s) && !s.winner) set({ passTo: s.human, selUnit: null, selCity: null, panel: 'none' });
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
  startedAt = Date.now();
  set({ game: s, setup: false, panel: 'none', selCity: null, selUnit: null, endClosed: false, endTab: 'summary', replayTurn: 0, passTo: isHotseat(s) ? s.human : null });
  bump();
  music(s);
  if (!isHotseat(s)) nextUnit();
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
    set({ game: s, setup: false, panel: 'none', selCity: null, selUnit: null, busy: false, endClosed: false, endTab: 'summary', replayTurn: 0, passTo: isHotseat(s) && !s.winner ? s.human : null });
    bump();
    music(s);
    toast(`Loaded “${name}” (turn ${s.turn}).`);
    return true;
  } catch (e) {
    toast(`Could not load: ${String(e)}`);
    return false;
  }
}

export { store };
