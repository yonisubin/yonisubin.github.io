// Per-chamber lines for c11–c19, escape1, escape2, finale (workstream B). Ids like "c07.chamberStart.1"; see lines.ts and character.md.
import type { Line } from './lines';

const BURSAR = 'The Bursar';

export const LINES_B: Record<string, Line> = {
  // --- c11 Faculty (turrets) -------------------------------------------------------------------
  'c11.chamberStart.1': { text: 'Practical eleven introduces the faculty. They are tenured. Please do not argue with them in their field of view.' },
  'c11.chamberStart.2': { text: 'The sentries have read your file. They have a few questions. Each question is about four percent of you.' },
  'c11.hall.1': { text: 'Note that this sentry is facing away from you. That is called a blind spot. Most of my staff have one. Mine is the cafeteria.' },
  'c11.passage.1': { text: 'A weighted cube stops a bullet roughly as well as a textbook. I am told textbooks were also used for this.' },
  'c11.exit.1': { text: 'You relocated a member of faculty without a transfer form. I have filled one in on your behalf. You disagreed with yourself.' },
};
void BURSAR;
