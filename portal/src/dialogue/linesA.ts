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
};
