// Web Worker: plays the computer players' turns off the main thread so the page stays
// responsive. Receives a GameState, runs endTurn with the AI hooks, posts the new state back.
import { runEndTurn } from './index';
import type { GameState } from '../core/state';

self.onmessage = (e: MessageEvent<GameState>) => {
  const s = e.data;
  try {
    runEndTurn(s);
    (self as unknown as Worker).postMessage({ ok: true, state: s });
  } catch (err) {
    (self as unknown as Worker).postMessage({ ok: false, error: String(err instanceof Error ? err.stack ?? err.message : err) });
  }
};
