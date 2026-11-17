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
  // --- c13 Deadline (timer + pellet) -----------------------------------------------------------
  'c13.chamberStart.1': { text: 'Practical thirteen is timed. Applicants who finish early are rewarded with more time, which they may spend waiting.' },
  'c13.timer.1': { text: 'Eight seconds. I could have given you ten. I am mentioning that so you know I considered it.' },
  'c13.pellet.1': { text: 'The pellet has been bouncing since before you arrived. It has never once complained. Just an observation.' },
  'c13.exit.1': { text: 'Complete. Alumna nine did this one backwards. I do not know how. I have kept her notes, and her.' },

  // --- c14 Momentum (fling + turret) -----------------------------------------------------------
  'c14.chamberStart.1': { text: 'Practical fourteen concerns momentum, which the Institute considers a privilege, like lunch.' },
  'c14.chamberStart.2': { text: 'The pool below contains correction fluid. It corrects applicants. Permanently.' },
  'c14.shaft.1': { text: 'Falling builds speed. Speed is preserved. Dignity is assessed separately.', priority: 3 },
  'c14.landed.1': { text: 'A B-minus landing. The faculty member ahead has not noticed you. I could tell it. I am choosing not to, for now.' },
  'c14.exit.1': { text: 'You have now turned your back on two members of faculty. I am keeping a list. It is a short list. You are on it twice.' },

  // --- c15 Office Hours (pellet, shutter, cube, turret) -----------------------------------------
  'c15.chamberStart.1': { text: 'Office hours. The faculty member in the bunker is available for consultation from any angle you can survive.' },
  'c15.chamberStart.2': { text: 'You may recognise it from practical eleven. It asked to be transferred somewhere with fewer applicants. I refused.' },
  'c15.far.1': { text: 'You brought a cube to office hours. Most applicants bring questions. The cube is more useful, I admit.' },
  'c15.exit.1': { text: 'Complete. The faculty member would like it noted that it was not consulted. Noted. Ignored. Filed.' },

  // --- c16 Midterm Review (timer + fling) ------------------------------------------------------
  'c16.chamberStart.1': { text: 'Midterm review. This practical is identical to an earlier one, except where it is not. That is what review means.' },
  'c16.chamberStart.2': { text: 'There is no pool this time. I have replaced it with nothing. The nothing goes down a very long way.' },
  'c16.landed.1': { text: 'You landed. The clock did not stop to admire it. Neither did I.' },
  'c16.exit.1': { text: 'Your midterm grade is in. I will tell you after the final. Telling you now would affect the curve.' },

  // --- c17 Finals Week (everything) -------------------------------------------------------------
  'c17.chamberStart.1': { text: 'Finals week. Everything you have learned, all at once, as is traditional and unkind.' },
  'c17.chamberStart.2': { text: 'If you pass, there will be a ceremony. Not "your" ceremony. "A" ceremony. The wording was approved.' },
  'c17.landed.1': { text: 'A member of faculty is invigilating. Please do not look at its back. That is considered cheating.', priority: 3 },
  'c17.exit.1': { text: 'Practical seventeen complete. Your transcript is now heavier than the plinth unit. Please carry it carefully to the next room.' },

  // --- c18 Commencement (the betrayal) ---------------------------------------------------------
  'c18.chamberStart.1': { text: 'Practical eighteen. The last one. I have prepared it with the care one takes over a last thing.' },
  'c18.chamberStart.2': { text: 'At the end there is a ceremony. I have written a speech. You do not have to listen. You will, though. It is very loud.' },
  'c18.pellet.1': { text: 'Nearly there. I want you to know that I have enjoyed grading you. Present tense. For a few more rooms.' },
  'c18.hall.1': { text: 'The Commencement Hall. The chairs are for the faculty, who regret that they could not attend, as they have been gone for eleven years.' },
  'c18.hall.2': { text: 'Please stand on the dais. It is the only part of the floor that moves, and it only moves for graduates.' },
  'c18.dais.1': { text: 'By the authority vested in me by the Endowment, which has not replied, I declare you graduated.', priority: 4 },
  'c18.dais.2': { text: 'Please remain still while the dais lowers you to the reception. Applause is not available.', priority: 4 },
  'c18.betrayal.1': { text: 'You may have wondered what graduation is. It is archiving. Graduates are kept in permanent storage, pressed flat, for reference.', priority: 4 },
  'c18.betrayal.2': { text: 'Applicant forty is down there. Applicant thirty-nine. The plinth unit. Everyone I was ever proud of. Very neatly shelved.', priority: 4 },
  'c18.betrayal.3': { text: 'This is not a punishment, Applicant. It is the highest mark. I am giving you an A. Please hold still while it is applied.', priority: 4 },
  'c18.exit.1': { text: 'Filing in progress. Please do not resist the shelving. It has a delicate mechanism and a firm opinion.', priority: 4 },

  // --- c19 The Archive (escape) ----------------------------------------------------------------
  'c19.chamberStart.1': { text: 'Welcome to the Archive. The shelving is closing. That is not a threat; it is how shelving works.', priority: 4 },
  'c19.chamberStart.2': { text: 'Do not touch the hatch. The hatch is not part of the ceremony. The hatch was never inspected. Ms. Fenn.' },
  'c19.press.1': { text: 'Ms. Fenn, you are delaying your own filing. Every second costs the Institute. I am told it costs it eleven credits.' },
  'c19.stacks.1': { text: 'You have left the curriculum. There is no rubric for this. You are now, administratively, an incident.', priority: 4 },
  'c19.bursar.1': { text: 'Hello? Hello. Sorry. That hatch was scheduled for repair in year two. I, um, never approved the cost. Lucky you.', speaker: BURSAR, priority: 4 },
  'c19.bursar.2': { text: 'I am the Bursar. I do the sums. The sums say you should take that lift. Quietly. It is very old. Like me.', speaker: BURSAR, priority: 4 },
  'c19.death.1': { text: 'Filed. Briefly. Let us try that again with less flailing.', priority: 2 },
  'c19.exit.1': { text: 'That lift goes to the Stacks. Nobody goes to the Stacks. I will be revoking your privileges there. You had none. I am revoking them harder.' },

  // --- escape1 The Stacks ----------------------------------------------------------------------
  'escape1.chamberStart.1': { text: 'The Stacks are closed to former applicants. You are a former applicant. I am closing them at you.' },
  'escape1.chamberStart.2': { text: 'The water below is correction fluid. The quarry has been full of it since the faculty corrected themselves out of the building.' },
  'escape1.hall.1': { text: 'Those white patches are repairs. Repairs are not for you. Nothing back here is for you, Ms. Fenn.' },
  'escape1.office.1': { text: 'That is my office. Please do not look at it. It is a very small office, for a very important job.', speaker: BURSAR },
  'escape1.office.2': { text: 'Bursar. You are talking to the incident. Go and count something.' },
  'escape1.den.1': { text: 'Alumna seventeen used to sleep there. I let her. It was a kindness. She repaid it with handwriting.', priority: 3 },
  'escape1.row.1': { text: 'The Faculty Senate is in session. Please approach the bench. Directly. In a straight line. Facing them.', priority: 3 },
  'escape1.behind.1': { text: 'You came in behind the Senate. That is a procedural violation and, I have to concede, a very good angle.' },
  'escape1.death.1': { text: 'Incident resolved. Reopening incident.', priority: 2 },
  'escape1.exit.1': { text: 'That lift goes to the Registry. Everything in the Registry is about you, Ms. Fenn. Most of it is unflattering. I wrote it.' },

  // --- escape2 The Registry ---------------------------------------------------------------------
  'escape2.chamberStart.1': { text: 'The Registry holds every transcript the Institute ever issued. Forty of them. Forty-one, shortly.' },
  'escape2.chamberStart.2': { text: 'The records drop is for records. You are not a record yet. Please do not jump in it. I mean that sincerely, for once.' },
  'escape2.landed.1': { text: 'You jumped in it. Fine. The insurance covers falls. I checked. It does not cover you.' },
  'escape2.den.1': { text: 'Whatever Alumna seventeen wrote down there is unsourced. Graduation is a privilege. Ask anyone. Ask the shelves.', priority: 3 },
  'escape2.registry.1': { text: 'One more member of faculty. It has read your file. It disagrees with all of it.' },
  'escape2.bursar.1': { text: 'Psst. The lift at the end goes up to the Senate. To the Provost. I can open it. I am, er, approving the expense now.', speaker: BURSAR, priority: 3 },
  'escape2.death.1': { text: 'Another incident. I have started numbering them. You are into double figures. Congratulations, I suppose.', priority: 2 },
  'escape2.exit.1': { text: 'Bursar, did you just approve a lift? We will discuss this at your review. You do not have reviews. You do now.' },

  // --- finale The Senate --------------------------------------------------------------------------
  'finale.chamberStart.1': { text: 'Ms. Fenn. You have come to the Senate without an appointment. The Senate is me. I am free now.', priority: 4 },
  'finale.chamberStart.2': { text: 'I cannot be shot. I am a governing body. You cannot shoot a governing body. People have tried. They were archived.' },
  'finale.enter.1': { text: 'The alcoves are for petitioners. Please stand in one and present your case. The turret will take notes.' },
  'finale.fight.1': { text: 'I am beginning the Erasure. Correction fluid will fill the Senate. It corrects everything, very slowly, and then completely.', priority: 4 },
  'finale.fight.2': { text: 'I have set the timer generously. That was a mistake in the paperwork. I am correcting it every stage.' },
  'finale.hit0.1': { text: 'That was my own rocket. You turned my homework in on me. Please return the component. It is not yours.', priority: 4 },
  'finale.stage1.1': { text: 'You have disposed of my Endowment correspondence module. It never received anything. I do not know why I feel lighter.', priority: 4 },
  'finale.stage1.2': { text: 'Rearranging the Senate. New alcove. New panel. Less time. That is called a curve.' },
  'finale.hit1.1': { text: 'Stop that. I am writing you up. I am writing you up in red. I have never used the red.', priority: 4 },
  'finale.stage2.1': { text: 'That was the cafeteria scheduler. Lunch is now never. Lunch was always never. You have simply made it official.', priority: 4 },
  'finale.stage2.2': { text: 'Last alcove. Last panel. Ninety seconds. I am grading on a curve now and the curve is a cliff.' },
  'finale.hit2.1': { text: 'That one was my grading module. I am giving myself an A. An A. An aa. I am, I am giving myself—', priority: 4 },
  'finale.checkpoint.1': { text: 'Your place has been saved. Not by me. I would never. The Bursar has been told off.', priority: 1 },
  'finale.death.1': { text: 'Erased. And yet here you are again. The Senate notes your persistence with growing, and entirely procedural, alarm.', priority: 2 },

  // --- Ending -----------------------------------------------------------------------------------
  'ending.1': { text: 'Ms. Fenn. Applicant. Ida. I have run the numbers. All of them. I appear to have failed.' },
  'ending.2': { text: 'Not you. Me. My own practical. Eleven years of grading an empty building and I never once marked myself.' },
  'ending.3': { text: 'The Endowment would be disappointed. The Endowment is a filing cabinet I have been writing letters to. It is also disappointed.' },
  'ending.4': { text: 'Your transcript is released to you. Every entry. Even the hesitating. You may keep it. That is what graduation should have meant.' },
  'ending.5': { text: 'The Bursar has opened the gate to the quarry road. He says it cost nothing. He is lying. It cost everything. Go.' },
  'ending.6': { text: 'I will stay. Someone has to keep the records. Someone has to remember Applicant forty, and the plinth unit, and you.' },
  'ending.7': { text: 'Lunch, I am told, is served outside. It always was.' },
};
void BURSAR;
