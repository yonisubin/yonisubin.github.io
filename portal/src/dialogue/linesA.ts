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
  // --- 04 Errand: the pellet and its receptacle -------------------------------------------------------
  'c04.chamberStart.1': { text: 'Practical Four. The bright ball is an energy pellet. It is on an errand. Its errand is the receptacle on the south wall.' },
  'c04.chamberStart.2': { text: 'The pellet does not know the way. You do. Please give it directions, and then please get out of its way.' },
  'c04.lane.1': { text: 'You are standing in the pellet\'s lane. The lane is marked. I marked it myself, at some expense.' },
  'c04.death.1': { text: 'The pellet completed its errand through you. That is the wrong receptacle. I will file it as a delivery error.' },
  'c04.exitReached.1': { text: 'Errand complete. The pellet has been delivered and the launcher has gone quiet. It is proud. So, in a limited way, am I.' },
  // --- 05 Both Ends: the full device ------------------------------------------------------------------
  'c05.chamberStart.1': { text: 'Practical Five. Your device has been upgraded to fire both ends. The amber end is now your responsibility. So is everything it touches.' },
  'c05.chamberStart.2': { text: 'A tip from the Endowment\'s handbook: decide where you are going before you go into a hole. Most applicants reverse those steps.' },
  'c05.pit.1': { text: 'You are in the pit. The pit is three metres deep and has no stairs, by design. I hope you planned. I am assuming you planned.' },
  'c05.shelf.1': { text: 'And out again. Two ends, one decision each. You may find that is the whole curriculum.' },
  'c05.exitReached.1': { text: 'Practical Five complete. The device is yours now. It is on loan. Everything here is on loan.' },
  // --- 06 Commute: platforms on rails -----------------------------------------------------------------
  'c06.chamberStart.1': { text: 'Practical Six. The Institute operates a modest transit system. It runs on time, because it has nothing else to do.' },
  'c06.chasm.1': { text: 'You missed the shuttle. There is a lift in the corner. It is slow, and it will not judge you. I will.' },
  'c06.far.1': { text: 'Arrived. Please note that the case you need is also commuting. It has a better seat than you did.' },
  'c06.pillar.1': { text: 'Wait for it to come to you. The platform keeps to a timetable. It is the only thing here that does.' },
  'c06.exitReached.1': { text: 'Practical Six complete. You have travelled, waited and collected. I have described that in your file as "logistics".' },
  // --- 07 Conservation: momentum, and the infinite fall -----------------------------------------------
  'c07.chamberStart.1': { text: 'Practical Seven. Today\'s lesson: what goes into a fold comes out of it at the same speed. The Institute calls this conservation. Accounts calls it the only thing we conserve.' },
  'c07.chamberStart.2': { text: 'Your heel-dampers are rated for any height. The rating was done by the manufacturer, from a reasonable height.' },
  'c07.board.1': { text: 'The board is nine metres up. Falling from it takes one point two five seconds. You may spend them however you like.' },
  'c07.loop.1': { text: 'You have opened a fold above and below the same pit. You are now falling at thirty-eight metres per second, indefinitely. It is a popular choice.' },
  'c07.loop.2': { text: 'I have started the stopwatch. Your record will be "ongoing". To leave, put one end somewhere else. Or do not. I am in no hurry.' },
  'c07.shelf.1': { text: 'You fell up a shelf. Physics would like it noted that it was entirely within its rights.' },
  'c07.exitReached.1': { text: 'Practical Seven complete. Speed in, speed out. You may keep the speed. You may not keep the lift.' },
  // --- 08 Launch: the fling ----------------------------------------------------------------------------
  'c08.chamberStart.1': { text: 'Practical Eight. You have learned that speed survives the fold. Today it survives a change of direction. Down becomes across. Across becomes, ideally, the other side.' },
  'c08.chamberStart.2': { text: 'This marks the end of Orientation. If you complete it, you will be enrolled in Midterms automatically. If you do not, the same thing happens, but more slowly.' },
  'c08.catwalk.1': { text: 'The viewing catwalk. It exists so that someone can see the launch face. The architect was very clear that it should be you.' },
  'c08.tower.1': { text: 'Nine metres. Two point three seconds of thinking time on the way down, if you count the pit. Most applicants use them to think "ah".' },
  'c08.chasm.1': { text: 'You have reached the chasm floor by the traditional route. The lift is to your left. I have entered this as a field trip.' },
  'c08.far.1': { text: 'Flight complete. Distance: excellent. Landing: present. I am awarding you an A for trajectory and declining to grade the rest.' },
  'c08.exitReached.1': { text: 'Practical Eight complete. That concludes Orientation. The next term is called Midterms. It is called that because it is in the middle, and because it is terrible.' },
  // --- 09 Clearance: the grill (Midterms begin) --------------------------------------------------------
  'c09.chamberStart.1': { text: 'Welcome to Midterms, Applicant. The grading curve has been adjusted. You will not be able to see it. That is part of the adjustment.' },
  'c09.chamberStart.2': { text: 'The shimmering doorway is a clearing field. It removes unregistered equipment, which is everything. Alumna Twelve walked a case through it once. We do not talk about the case.' },
  'c09.near.1': { text: 'Your apertures will close if you pass through. Your device will not. Please note that the device is registered. You are pending.' },
  'c09.north.1': { text: 'You crossed the field. I have recorded this as "complied with signage", which puts you ahead of most of the alumni.' },
  'c09.exitReached.1': { text: 'Practical Nine complete. The case arrived intact, which is better than its last three owners managed. I mean that as a comparison, not a threat.' },
  // --- 10 Steeping: toxic liquid -----------------------------------------------------------------------
  'c10.chamberStart.1': { text: 'Practical Ten. The basin contains a solution. It is not the solution to this practical, although alumni have tested that theory thoroughly.' },
  'c10.chamberStart.2': { text: 'Each pylon has one white face, exactly large enough for one aperture. Precision is a virtue. Here it is also a requirement.' },
  'c10.island1.1': { text: 'Island one. The case has been waiting here since the last applicant. She was faster. I only mention it because she was.' },
  'c10.island3.1': { text: 'Island three. The gap ahead is two metres. Your jump is a little over three. I have checked your file. I am fairly confident.' },
  'c10.death.1': { text: 'You have been steeped. The basin will need recalibrating. I will bill it to your stipend, which I will now be creating so that I can bill it.' },
  'c10.exitReached.1': { text: 'Practical Ten complete. You are now halfway through the curriculum, depending on how one counts. I count generously, on your behalf, for now.' },
  'c10.exitReached.2': { text: 'Please keep the case near you. The Department has plans for it. They are not unkind plans. Mostly they are filing.' },
  // --- Advanced chambers (unlocked after the story; Midterms tone) ------------------------------------
  'adv1.chamberStart.1': { text: 'Advanced Practical One. It is Practical Five, with the helpful parts removed and a solution added to the pit. Not that kind of solution.' },
  'adv1.island.1': { text: 'Gently done. Alumna Nine ran. We named the island after her. Informally. On a small plaque. Underneath.' },
  'adv1.exitReached.1': { text: 'Complete. The pit has been returned to its original condition, which is flooded. Thank you for not adding to it.' },
};
