// Per-chamber lines for c01–c10 and adv1–adv6 (workstream A). Ids like "c07.chamberStart.1"; see
// lines.ts and character.md. Tone: Orientation (helpful, dry, procedural) through c08, drifting into
// Midterms (comparisons with alumni, grading on curves) in c09–c10 and the advanced chambers.
import type { Line } from './lines';

export const LINES_A: Record<string, Line> = {
  // --- 01 Intake: walking, jumping, the cube, the plate ------------------------------------------
  'c01.chamberStart.1': { text: 'Welcome to Hollowmere, Applicant forty-one. This is Practical One. It has a floor, a shelf and a box. You will be graded on all three.' },
  'c01.chamberStart.2': { text: 'The box is a weighted specimen case. The round plate is a pressure plate. They have been looking forward to meeting each other.' },
  'c01.shelf.1': { text: 'A jump. I have recorded it as a B-minus. Height was fine. Form was a matter of opinion.' },
  'c01.leaving.1': { text: 'You may leave the case behind. It does not need you. That will be a recurring theme in your file.' },
  'c01.exitReached.1': { text: 'Practical One complete in a time I will describe as "a time". Please step in. The lift is part of the course.' },

  // --- 02 Standing Fold: a fixed pair, the far end flips between three cells ------------------------
  'c02.chamberStart.1': { text: 'Practical Two. The Institute has installed a fold for you. Two apertures, one blue, one amber. Walk into one and you leave by the other.' },
  'c02.chamberStart.2': { text: 'The amber aperture is on a rota. It visits each cell for four seconds. The rota was set by a committee. It shows.' },
  'c02.west.1': { text: 'A specimen case. It came through the fold in one piece, which is more than the committee managed.' },
  'c02.middle.1': { text: 'This plate only accepts cases. Please do not stand on it. It finds that familiar, and the paperwork is awkward.' },
  'c02.east.1': { text: 'You have now visited all three cells. A full rotation. In some departments that counts as a degree.' },
  'c02.exitReached.1': { text: 'Practical Two complete. I have noted that you waited for things. Patience is graded separately, and quietly.' },
  // --- 03 Half a Fold: the device fires blue; amber is fixed ---------------------------------------
  'c03.chamberStart.1': { text: 'You have been issued the Fold. It is a surveying instrument. Please do not point it at anyone, or at me, or at the cafeteria.' },
  'c03.chamberStart.2': { text: 'For now it opens the blue end only. The amber end has been installed by staff. Staff are no longer available for questions.' },
  'c03.floor.1': { text: 'Apertures take to the white panels. Dark metal declines. This is not personal. Metal declines everything.' },
  'c03.shelf.1': { text: 'Up you go. The shelf is three and a half metres high. You did not climb it. I will be writing "arrived" rather than "climbed".' },
  'c03.exitReached.1': { text: 'Practical Three complete. You have carried a case through a hole in the wall. Your file now lists you as "a carrier". It is a compliment.' },
};
