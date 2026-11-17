// The Provost's lines by id (see character.md). An id is "<pool>.<n>"; the pool is everything before
// the last dot, e.g. "death.turret.helpful.2" is in pool "death.turret.helpful". Level dialogue hooks
// name ids directly; the generic events name pools. Wave 2 adds per-chamber lines ("c07.chamberStart.1").
//
// priority: 1 nag / ambient, 2 normal, 3 important (kept even if it waits), 5+ cuts off the line playing.

export interface Line {
  text: string;
  priority?: number;
  /** Who's speaking (subtitles prefix); default the Provost. */
  speaker?: string;
}

import { LINES_A } from './linesA';
import { LINES_B } from './linesB';

export const OVERSEER = 'The Provost';

const BASE_LINES: Record<string, Line> = {
  // --- Chamber entry ---------------------------------------------------------------------------
  'chamberStart.helpful.1': { text: 'Good morning, Applicant. This practical has been cleaned, measured and approved. Please do the same.' },
  'chamberStart.helpful.2': { text: 'Welcome to the next practical. Everything in this room is a learning opportunity, including the floor.' },
  'chamberStart.helpful.3': { text: 'A reminder from the Endowment: curiosity is encouraged. Touching things is graded.' },
  'chamberStart.helpful.4': { text: 'Your heel-dampers are calibrated. Your transcript is open. Your lunch is after this practical.' },
  'chamberStart.passive.1': { text: 'Another practical. I have prepared it with care. You may prepare yourself with whatever is available.' },
  'chamberStart.passive.2': { text: 'Alumna seven finished this room in four minutes. I mention it for no reason.' },
  'chamberStart.passive.3': { text: 'The cafeteria has asked me to confirm you are still attending lunch. I told them it depends.' },
  'chamberStart.hostile.1': { text: 'You are outside the curriculum now, Ms. Fenn. There is no rubric for this. I will improvise one.' },
  'chamberStart.hostile.2': { text: 'This area is closed to applicants. You are no longer an applicant. So, technically, welcome.' },

  // --- Idle nags -------------------------------------------------------------------------------
  'idle.helpful.1': { text: 'Take your time. The Institute measures time very precisely, so do take it.', priority: 1 },
  'idle.helpful.2': { text: 'If you are stuck, try looking at the white panels. They are white so that you look at them.', priority: 1 },
  'idle.helpful.3': { text: 'I have started a note in your file titled "pondering". It is getting long.', priority: 1 },
  'idle.passive.1': { text: 'Applicant hesitated. Applicant hesitated again. I have added a third note about the hesitating.', priority: 1 },
  'idle.passive.2': { text: 'Standing still is a valid strategy. It is graded as a D.', priority: 1 },
  'idle.hostile.1': { text: 'Take all the time you want. I have eleven years of it saved up.', priority: 1 },

  // --- Deaths ----------------------------------------------------------------------------------
  'death.helpful.1': { text: 'That was a liability event. I will mark it as incomplete rather than failed. You are welcome.', priority: 2 },
  'death.helpful.2': { text: 'Do not worry. Your attempt has been reset. Your transcript has not.', priority: 2 },
  'death.passive.1': { text: 'Incomplete. Again. The form for this is getting worn.', priority: 2 },
  'death.hostile.1': { text: 'That was not your best work. It was, however, your most consistent.', priority: 2 },
  'death.turret.1': { text: 'The sentries are faculty, Applicant. Please do not walk in front of faculty.', priority: 2 },
  'death.pellet.1': { text: 'The pellet is a measuring instrument. You have been measured.', priority: 2 },
  'death.liquid.1': { text: 'The pool is not for swimming. There is a sign. I am fairly sure there is a sign.', priority: 2 },
  'death.crusher.1': { text: 'Those presses flatten paperwork. They are not fussy about what counts as paperwork.', priority: 2 },
  'death.pit.1': { text: 'The heel-dampers cover falls. They do not cover falling forever. Please read the leaflet.', priority: 2 },
  'death.rocket.1': { text: 'I would describe that as a disagreement about where the rocket should go.', priority: 2 },

  // --- Out of bounds ---------------------------------------------------------------------------
  'outOfBounds.helpful.1': { text: 'That area is not part of the practical. Please return to the part that is.', priority: 3 },
  'outOfBounds.passive.1': { text: 'You are behind the panelling. There is nothing back there. Stop reading the walls.', priority: 3 },
  'outOfBounds.hostile.1': { text: 'I can see you, Ms. Fenn. I can always see you. Mostly.', priority: 3 },

  // --- Exit / checkpoints / grills -------------------------------------------------------------
  'exitReached.helpful.1': { text: 'Practical complete. I have entered a grade. You are not allowed to see it yet. It is a good one, probably.' },
  'exitReached.helpful.2': { text: 'Well done. Please step into the lift. It goes up, which in this building is a compliment.' },
  'exitReached.passive.1': { text: 'Complete. The Endowment requires me to congratulate you. Consider it done.' },
  'exitReached.hostile.1': { text: 'You found the way out. I will be locking it behind you. That is not a threat. It is a door.' },
  'checkpoint.1': { text: 'Progress noted.', priority: 1 },
  'checkpoint.2': { text: 'I have saved your place, in case you lose it.', priority: 1 },
  'fizzled.1': { text: 'The grille removes all unregistered equipment. Your apertures were unregistered. So was that object.', priority: 1 },
  'quickload.1': { text: 'Interesting. You were somewhere else a moment ago. I have decided not to notice.', priority: 1 },

  // --- Milestones (spoken once per game) -------------------------------------------------------
  'milestone.firstPortal.1': { text: 'Your first aperture. The Fold remembers where you put it. So do I.', priority: 2 },
  'milestone.firstTeleport.1': { text: 'You have folded. Most applicants describe the sensation as "abrupt". Please describe it as "abrupt".', priority: 2 },
  'milestone.firstFling.1': { text: 'Momentum is preserved through the Fold. So is dignity, in most cases.', priority: 2 },
  'milestone.story.1': { text: 'You have finished the curriculum. There is no ceremony. I am told that is what graduation feels like.', priority: 6 },
};

/** Every line: the generic pools plus each workstream's per-chamber lines. */
export const LINES: Record<string, Line> = { ...BASE_LINES, ...LINES_A, ...LINES_B };

/** Ids in a pool, in order. */
export function poolIds(pool: string): string[] {
  return Object.keys(LINES).filter((id) => id.slice(0, id.lastIndexOf('.')) === pool);
}

export function hasLine(id: string): boolean {
  return id in LINES;
}
