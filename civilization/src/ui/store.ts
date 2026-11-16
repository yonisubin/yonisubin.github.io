// UI state (Zustand vanilla store). The GameState itself is mutated in place by actions, so the
// store holds a reference plus `rev`, a counter bumped after every change to trigger redraws.
import { createStore } from 'zustand/vanilla';
import type { GameState } from '../core/state';

export type Panel = 'none' | 'tech' | 'relations' | 'menu' | 'help';

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
}));

export const ui = () => store.getState();
export const set = (p: Partial<UIState>) => store.setState(p);
export const bump = () => store.setState((s) => ({ rev: s.rev + 1 }));
