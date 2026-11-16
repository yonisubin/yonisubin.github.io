// UI state (Zustand vanilla store). The GameState itself is mutated in place by actions, so the
// store holds a reference plus `rev`, a counter bumped after every change to trigger redraws.
import { createStore } from 'zustand/vanilla';
import type { GameState } from '../core/state';

export type Panel = 'none' | 'tech' | 'relations' | 'menu' | 'help' | 'victory' | 'policies';

export interface UIState {
  game: GameState | null;
  rev: number;
  selUnit: number | null;
  selCity: number | null;
  panel: Panel;
  setup: boolean;
  busy: boolean;
  hover: number;
  lens: boolean;
  /** City ranged-attack targeting mode. */
  cityAttack: boolean;
  toast: string | null;
  /** End-of-game screen: closed by the player, current tab, graph stat, replay turn. */
  endClosed: boolean;
  endTab: string;
  endStat: string;
  replayTurn: number;
}

export const store = createStore<UIState>()(() => ({
  game: null,
  rev: 0,
  selUnit: null,
  selCity: null,
  panel: 'none',
  setup: true,
  busy: false,
  hover: -1,
  lens: false,
  cityAttack: false,
  toast: null,
  endClosed: false,
  endTab: 'summary',
  endStat: 'score',
  replayTurn: 0,
}));

export const ui = () => store.getState();
export const set = (p: Partial<UIState>) => store.setState(p);
export const bump = () => store.setState((s) => ({ rev: s.rev + 1 }));
