// Default advanced game options (setup screen). Kept apart so saves can be filled in too.
import type { Settings } from './state';

export const DEFAULT_OPTIONS: Pick<
  Settings,
  | 'worldAge' | 'temperature' | 'rainfall' | 'seaLevel' | 'resources' | 'startEra' | 'raging' | 'noRazing' | 'oneCity' | 'completeKills'
  | 'policySaving' | 'promotionSaving' | 'noStartBias' | 'alwaysWar' | 'alwaysPeace' | 'turnTimer' | 'quickCombat' | 'quickMovement' | 'tutorial'
> = {
  worldAge: 4,
  temperature: 'temperate',
  rainfall: 'normal',
  seaLevel: 'medium',
  resources: 'standard',
  startEra: 0,
  raging: false,
  noRazing: false,
  oneCity: false,
  completeKills: false,
  policySaving: false,
  promotionSaving: false,
  noStartBias: false,
  alwaysWar: false,
  alwaysPeace: false,
  turnTimer: 0,
  quickCombat: false,
  quickMovement: false,
  tutorial: true,
};
