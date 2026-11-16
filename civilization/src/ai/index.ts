// The turn hooks the core calls for computer players.
import type { TurnHooks } from '../core/game';
import { endTurn } from '../core/game';
import type { GameState } from '../core/state';
import { barbarianTurn } from './barbarians';
import { aiTurn } from './major';
import { minorTurn } from './minor';

export const AI_HOOKS: TurnHooks = { ai: aiTurn, barbarians: barbarianTurn, minor: minorTurn };

/** End the turn with the computer players playing theirs. */
export function runEndTurn(s: GameState): void {
  endTurn(s, AI_HOOKS);
}
