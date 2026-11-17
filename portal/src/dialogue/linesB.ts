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

  // --- c12 Custody (the plinth unit) ------------------------------------------------------------
  'c12.chamberStart.1': { text: 'Practical twelve is a custody exercise. In the cradle is a plinth unit, property of the Department. You are its custodian until further notice.' },
  'c12.chamberStart.2': { text: 'It is padded, so it will not mind being dropped. Please do not drop it. It minds on paper.' },
  'c12.gap.1': { text: 'Applicants sometimes ask whether the plinth unit has a name. It has a nameplate. That is better. Names get lost.' },
  'c12.leave.1': { text: 'This room grades separation. Set the unit down and walk away. Do not look back. Looking back is a separate practical.' },
  'c12.records.1': { text: 'Well done. Custody is concluded. Please file the plinth unit in the Records Chute with the rest of the semester\'s coursework.' },
  'c12.records.2': { text: 'It will be kept in permanent storage, for reference. That is the highest honour the Institute can give an object.' },
  'c12.filed.1': { text: 'Filed. Let me read the nameplate for the record. "Property of the Department. Contents: complete transcript, Applicant forty."', priority: 3 },
  'c12.filed.2': { text: 'Applicant forty graduated with distinction. This is what graduation looks like, Applicant. It is very tidy.', priority: 3 },
  'c12.filed.3': { text: 'I would not dwell on that sentence. I have removed it from your file. The cafeteria sends its condolences, which is odd, since nobody has died.', priority: 3 },
  'c12.exit.1': { text: 'Custody complete. You have no further responsibilities. Enjoy the feeling. It is temporary, like most things here that are not archived.' },
};
void BURSAR;
