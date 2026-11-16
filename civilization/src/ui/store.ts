// UI state (Zustand vanilla store). The GameState itself is mutated in place by actions, so the
// store holds a reference plus `rev`, a counter bumped after every change to trigger redraws.
import { createStore } from 'zustand/vanilla';
import type { Deal, GameState } from '../core/state';
import type { NetUI } from '../net/session';

export type Panel = 'none' | 'chat' | 'pedia' | 'tech' | 'relations' | 'menu' | 'help' | 'victory' | 'policies' | 'leader' | 'trade' | 'citystate' | 'religion' | 'prophet' | 'routes' | 'culture' | 'congress' | 'spies';

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
  /** Diplomacy: the other player shown in the leader / city-state panel, and the deal being built. */
  diploWith: number;
  tradeDeal: Deal | null;
  /** A unit waiting for a target tile (air strike, rebase, nuke, debate) and the prophet mode. */
  targeting: { kind: 'strike' | 'rebase' | 'nuke' | 'theological'; unit: number } | null;
  prophetMode: 'found' | 'enhance';
  panelUnit: number;
  /** Draft World Congress votes (before casting). */
  votes: number[] | null;
  /** Hotseat: the screen is covered until this seat's player clicks "Begin" (null: no cover). */
  passTo: number | null;
  /** Online game / lobby (null: not connected). */
  net: NetUI | null;
  /** Encyclopedia: category, entry and search text. */
  pediaCat: string;
  pediaId: string;
  pediaQuery: string;
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
  diploWith: -1,
  tradeDeal: null,
  targeting: null,
  prophetMode: 'found',
  panelUnit: -1,
  votes: null,
  passTo: null,
  net: null,
  pediaCat: 'concepts',
  pediaId: '',
  pediaQuery: '',
}));

export const ui = () => store.getState();
export const set = (p: Partial<UIState>) => store.setState(p);
export const bump = () => store.setState((s) => ({ rev: s.rev + 1 }));
