// Online play. Everyone connects to the relay server (civilization/server/server.mjs) and joins a
// room. The host's browser runs the authoritative game: guests send their actions to the host,
// which validates them with the same core (`applyAction`), applies them and broadcasts them in
// order; every browser applies the same actions in the same order, so the deterministic core keeps
// all copies identical (a cheap digest after each action catches any drift and triggers a full
// resync). At the end of a turn the host runs the AI and sends everyone the new state.
//
// Turn modes (settings.turnMode): simultaneous — every human moves at once and the turn ends when
// all have pressed End Turn; sequential — one human after another; hybrid — simultaneous while no
// two humans are at war, sequential otherwise.
import { applyAction, humanSeats, type NewGameOptions, newGame } from '../core/game';
import type { Action, GameState } from '../core/state';
import { migrate } from '../core/migrate';
import { bump, set, ui } from '../ui/store';

export interface Slot {
  /** Relay client id of the person in this seat. */
  peer: number;
  name: string;
  faction: string;
  ready: boolean;
  /** Still connected (a seat whose player dropped out is skipped until they rejoin). */
  online: boolean;
}

export interface NetUI {
  url: string;
  room: string;
  you: number;
  isHost: boolean;
  slots: Slot[];
  chat: { from: string; text: string }[];
  started: boolean;
  /** This device's seat (player id) once the game has started. */
  seat: number;
  /** Seats that have ended their turn. */
  done: number[];
  /** Seats allowed to act right now. */
  active: number[];
}

/** Messages between browsers (inside the relay's envelopes). */
type Msg =
  | { k: 'lobby'; slots: Slot[] }
  | { k: 'pick'; faction: string; ready: boolean }
  | { k: 'chat'; from?: string; text: string }
  | { k: 'start'; state: GameState; seat: number }
  | { k: 'action'; a: Action }
  | { k: 'applied'; seat: number; a: Action; digest: string }
  | { k: 'error'; error: string }
  | { k: 'done' }
  | { k: 'status'; done: number[]; active: number[] }
  | { k: 'state'; state: GameState }
  | { k: 'sync' };

/** What the rest of the UI provides (set by the controller, to avoid an import cycle). */
export interface NetHooks {
  /** Run the AI and end the turn; resolves with the new state. */
  runTurn(s: GameState): Promise<GameState>;
  /** A new game or state arrived: show it. */
  show(s: GameState, fresh: boolean): void;
  toast(msg: string): void;
}

let ws: WebSocket | null = null;
let hooks: NetHooks | null = null;
let ending = false;

export const net = () => ui().net;
export const online = () => !!ui().net?.started;
const patch = (p: Partial<NetUI>) => {
  const n = ui().net;
  if (n) set({ net: { ...n, ...p } });
};

export function installNet(h: NetHooks): void {
  hooks = h;
}

/** Default relay address: this host on port 8787 (GitHub Pages: a server on this computer). */
export function defaultServer(): string {
  try {
    const saved = localStorage.getItem('civ:mpServer');
    if (saved) return saved;
  } catch {
    /* storage may be unavailable */
  }
  const host = location.hostname.endsWith('github.io') || !location.hostname ? 'localhost' : location.hostname;
  return `${location.protocol === 'https:' && host !== 'localhost' ? 'wss' : 'ws'}://${host}:8787`;
}

/** A cheap fingerprint of the state, compared after every action. */
export function digest(s: GameState): string {
  let hp = 0;
  for (const u of Object.values(s.units)) hp += u.hp + u.tile;
  return `${s.turn}|${s.rng}|${s.nextId}|${Object.keys(s.units).length}|${Object.keys(s.cities).length}|${hp}`;
}

function raw(o: unknown): void {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(o));
}
const to = (target: number | 'host' | 'all', msg: Msg) => raw({ t: 'to', to: target, msg });

/** Connect to the relay and create (host) or join (guest) a room. */
export function connect(url: string, name: string, room?: string): Promise<void> {
  disconnect();
  try {
    localStorage.setItem('civ:mpServer', url);
  } catch {
    /* ignore */
  }
  return new Promise((resolve, reject) => {
    let sock: WebSocket;
    try {
      sock = new WebSocket(url);
    } catch (e) {
      return reject(new Error(`bad server address: ${String(e)}`));
    }
    ws = sock;
    let settled = false;
    sock.onopen = () => raw(room ? { t: 'join', room, name } : { t: 'create', name });
    sock.onerror = () => {
      if (!settled) reject(new Error(`could not reach the server at ${url}`));
      settled = true;
    };
    sock.onclose = () => {
      if (ws !== sock) return;
      ws = null;
      if (ui().net) {
        hooks?.toast('Disconnected from the server.');
        set({ net: null });
      }
      if (!settled) reject(new Error('the server closed the connection'));
      settled = true;
    };
    sock.onmessage = (e) => {
      const m = JSON.parse(String(e.data));
      if (m.t === 'error') {
        if (!settled) reject(new Error(m.error));
        settled = true;
        return;
      }
      if (m.t === 'joined') {
        const isHost = m.host === m.you;
        set({
          net: {
            url,
            room: m.room,
            you: m.you,
            isHost,
            slots: isHost ? [{ peer: m.you, name, faction: 'random', ready: true, online: true }] : [],
            chat: [],
            started: false,
            seat: -1,
            done: [],
            active: [],
          },
        });
        settled = true;
        resolve();
        return;
      }
      if (m.t === 'peer') return onPeer(m.id, m.name, m.joined);
      if (m.t === 'closed') {
        hooks?.toast('The host left; the online game is over.');
        disconnect();
        return;
      }
      if (m.t === 'msg') onMsg(m.from, m.msg as Msg);
    };
  });
}

export function disconnect(): void {
  const s = ws;
  ws = null;
  s?.close();
  set({ net: null });
}

// ---- Lobby ----

function onPeer(id: number, name: string, joined: boolean): void {
  const n = net();
  if (!n?.isHost) return;
  if (joined) {
    // A player who dropped out can take their seat back by joining with the same name.
    const back = n.slots.find((x) => !x.online && x.name === name);
    if (back) {
      back.peer = id;
      back.online = true;
    } else if (n.started) {
      to(id, { k: 'error', error: 'that game has already started' });
      return;
    } else n.slots.push({ peer: id, name, faction: 'random', ready: false, online: true });
    patch({ slots: [...n.slots] });
    sendLobby();
    if (n.started && back) {
      const s = ui().game!;
      to(id, { k: 'start', state: s, seat: n.slots.indexOf(back) });
      sendStatus();
    }
  } else {
    const slot = n.slots.find((x) => x.peer === id);
    if (!slot) return;
    if (n.started) slot.online = false;
    else n.slots.splice(n.slots.indexOf(slot), 1);
    patch({ slots: [...n.slots] });
    sendLobby();
    if (n.started) {
      hooks?.toast(`${name} disconnected; their seat is skipped until they rejoin.`);
      sendStatus();
      maybeEndTurn();
    }
  }
}

function sendLobby(): void {
  const n = net();
  if (n?.isHost) to('all', { k: 'lobby', slots: n.slots });
}

/** Guest: choose a civilization and say whether you're ready. */
export function pick(faction: string, ready: boolean): void {
  const n = net();
  if (!n) return;
  if (n.isHost) {
    n.slots[0].faction = faction;
    patch({ slots: [...n.slots] });
    sendLobby();
  } else to('host', { k: 'pick', faction, ready });
}

export function chat(text: string): void {
  const n = net();
  if (!n || !text.trim()) return;
  const me = n.slots.find((x) => x.peer === n.you)?.name ?? 'me';
  const line = { from: me, text: text.trim().slice(0, 300) };
  patch({ chat: [...n.chat, line].slice(-50) });
  to('all', { k: 'chat', from: me, text: line.text });
}

/** Host: start the game with the lobby's players as the human seats. */
export function startOnline(o: NewGameOptions): string | null {
  const n = net();
  if (!n?.isHost) return 'only the host can start';
  if (n.slots.some((x) => !x.ready)) return 'not everyone is ready';
  const s = newGame({ ...o, humans: n.slots.map((x) => ({ faction: x.faction, name: x.name })) });
  s.online = true;
  s.human = 0;
  patch({ started: true, seat: 0, done: [] });
  n.slots.forEach((x, seat) => seat > 0 && to(x.peer, { k: 'start', state: s, seat }));
  hooks?.show(s, true);
  sendStatus();
  return null;
}

// ---- During the game ----

function onMsg(from: number, m: Msg): void {
  const n = net();
  if (!n) return;
  switch (m.k) {
    case 'lobby':
      patch({ slots: m.slots });
      return;
    case 'chat':
      patch({ chat: [...n.chat, { from: m.from ?? '?', text: m.text }].slice(-50) });
      if (n.started) hooks?.toast(`${m.from}: ${m.text}`);
      if (n.isHost) {
        // Pass it on to the other guests.
        for (const x of n.slots) if (x.peer !== from && x.peer !== n.you && x.online) to(x.peer, m);
      }
      return;
    case 'pick': {
      const slot = n.slots.find((x) => x.peer === from);
      if (!slot || n.started) return;
      slot.faction = m.faction;
      slot.ready = m.ready;
      patch({ slots: [...n.slots] });
      sendLobby();
      return;
    }
    case 'start': {
      const s = migrate(m.state);
      s.human = m.seat;
      patch({ started: true, seat: m.seat });
      hooks?.show(s, true);
      return;
    }
    case 'action': {
      if (!n.isHost) return;
      const seat = n.slots.findIndex((x) => x.peer === from);
      const err = hostApply(seat, m.a);
      if (err) to(from, { k: 'error', error: err });
      return;
    }
    case 'applied': {
      const s = ui().game;
      if (!s || n.isHost) return;
      applyAction(s, m.seat, m.a);
      if (digest(s) !== m.digest) to('host', { k: 'sync' });
      const sel = ui().selUnit;
      if (sel !== null && !s.units[sel]) set({ selUnit: null });
      bump();
      return;
    }
    case 'error':
      hooks?.toast(m.error);
      return;
    case 'sync': {
      const s = ui().game;
      const seat = n.slots.findIndex((x) => x.peer === from);
      if (n.isHost && s && seat > 0) to(from, { k: 'start', state: s, seat });
      return;
    }
    case 'done': {
      if (!n.isHost) return;
      const seat = n.slots.findIndex((x) => x.peer === from);
      markDone(seat);
      return;
    }
    case 'status':
      patch({ done: m.done, active: m.active });
      return;
    case 'state': {
      const s = migrate(m.state);
      s.human = n.seat;
      patch({ done: [] });
      hooks?.show(s, false);
      return;
    }
  }
}

/** Which seats may act now (see the turn modes at the top). */
export function activeSeats(s: GameState, done: number[]): number[] {
  const seats = humanSeats(s).filter((q) => !done.includes(q));
  const humans = humanSeats(s);
  const humanWar = humans.some((a) => humans.some((b) => a !== b && s.diplomacy.war[a][b]));
  const sequential = s.settings.turnMode === 'sequential' || (s.settings.turnMode === 'hybrid' && humanWar);
  return sequential ? seats.slice(0, 1) : seats;
}

function hostApply(seat: number, a: Action): string | null {
  const s = ui().game;
  const n = net();
  if (!s || !n || seat < 0 || ending) return 'please wait';
  if (!activeSeats(s, n.done).includes(seat)) return n.done.includes(seat) ? 'you have ended your turn' : 'wait for your turn';
  const r = applyAction(s, seat, a);
  if (!r.ok) return r.error ?? 'not possible';
  to('all', { k: 'applied', seat, a, digest: digest(s) });
  bump();
  return null;
}

/** An action by this device's player: applied by the host, sent to the host by a guest. */
export function netAct(a: Action): boolean {
  const n = net()!;
  if (n.isHost) {
    const err = hostApply(n.seat, a);
    if (err) hooks?.toast(err);
    return !err;
  }
  if (!activeSeats(ui().game!, n.done).includes(n.seat)) {
    hooks?.toast(n.done.includes(n.seat) ? 'You have ended your turn.' : 'Wait for your turn.');
    return false;
  }
  to('host', { k: 'action', a });
  return true;
}

/** This device's player presses End Turn. */
export function netDone(): void {
  const n = net()!;
  if (n.done.includes(n.seat)) return;
  if (n.isHost) markDone(n.seat);
  else {
    patch({ done: [...n.done, n.seat] });
    to('host', { k: 'done' });
  }
}

function markDone(seat: number): void {
  const n = net();
  const s = ui().game;
  if (!n || !s || seat < 0 || n.done.includes(seat)) return;
  patch({ done: [...n.done, seat] });
  sendStatus();
  maybeEndTurn();
}

/** Host: the turn timer ran out — everyone is done. */
export function forceEndTurn(): void {
  const n = net();
  const s = ui().game;
  if (!n?.isHost || !s) return;
  patch({ done: humanSeats(s) });
  maybeEndTurn();
}

function sendStatus(): void {
  const n = net();
  const s = ui().game;
  if (!n?.isHost || !s) return;
  // Seats whose player is offline count as done.
  const done = [...new Set([...n.done, ...n.slots.map((x, i) => (x.online ? -1 : i)).filter((i) => i >= 0)])];
  const active = activeSeats(s, done);
  patch({ active });
  to('all', { k: 'status', done, active });
}

async function maybeEndTurn(): Promise<void> {
  const n = net();
  const s = ui().game;
  if (!n?.isHost || !s || ending || !hooks) return;
  const offline = n.slots.map((x, i) => (x.online ? -1 : i));
  if (!humanSeats(s).every((q) => n.done.includes(q) || offline.includes(q))) return;
  ending = true;
  try {
    const next = await hooks.runTurn(s);
    next.human = n.seat;
    patch({ done: [] });
    for (const x of n.slots) if (x.peer !== n.you && x.online) to(x.peer, { k: 'state', state: next });
    hooks.show(next, false);
    sendStatus();
  } finally {
    ending = false;
  }
}

/** Text for the End Turn button while waiting for others (null: not waiting). */
export function waitingLabel(s: GameState): string | null {
  const n = net();
  if (!n?.started) return null;
  const names = (seats: number[]) => seats.map((q) => s.players[q]?.nick ?? s.players[q]?.name).join(', ');
  if (n.done.includes(n.seat)) {
    const left = humanSeats(s).filter((q) => !n.done.includes(q));
    return left.length ? `Waiting for ${names(left)}` : 'Ending the turn…';
  }
  if (n.active.length && !n.active.includes(n.seat)) return `${names(n.active)} is moving`;
  return null;
}
