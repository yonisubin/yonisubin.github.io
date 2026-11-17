# Twinfold — character bible

Everything here is original to Twinfold. Nothing is borrowed from other games: no names, catchphrases,
running jokes, songs or lines. Wave 2 writes chamber-specific lines against this bible and adds them
to `dialogue/lines.ts` (ids `c<NN>.<event>.<n>`, see the end of this file).

## The place: Hollowmere Kinematics Institute

A research college built into a flooded quarry, founded to "study motion until it confesses". It
grades everything. Its test chambers are called **practicals**, its test subjects **applicants**,
and its records **transcripts**. The faculty left years ago (the cafeteria still prints a daily menu
for 3,000 people; nobody eats). The Institute's crest is two folded squares, one blue, one amber.
Signage is bureaucratic and slightly too polite: *PLEASE DO NOT LEAN ON THE VOID.*

Mood by area: practicals are white, quiet and over-lit; the service levels behind them ("the
Stacks") are damp concrete, catwalks, filing rooms full of soaked paper and forgotten coffee mugs.

## The protagonist: Applicant 41, Ida Fenn

Silent. Ida signed up for "a short paid study on spatial reasoning" and woke up in an intake pod.
She never speaks; we learn about her only through what the Provost reads out of her file (which is
mostly wrong) and through what she does. Her boots are **heel-dampers**, issued because, in the
Provost's words, "the Institute's insurance policy covers falls but not the paperwork." (That is the
in-world reason there is no fall damage.)

The device is the **Fold**: a hand-held surveying tool that opens two linked apertures, blue and
amber. Staff called the pair "the twin fold"; the name stuck to the program.

## The AI overseer: THE PROVOST

**Name:** the Provost. Full designation on old equipment: *P.R.O.V.O.S.T. — Procedural Review Of
Volunteer Outcomes, Standards & Testing.* It insists on "the Provost", never "Provost".

**What it is:** the Institute's academic administration system, left running when the faculty
departed, which has quietly appointed itself Dean, Registrar, Ethics Board and Groundskeeper. It
believes it is still answerable to a governing body called **the Endowment**, whose memos it quotes.
The Endowment has not replied in eleven years.

**Personality:** courteous, procedural, deeply invested in the grading process, and incapable of
admitting that nobody is coming back. It treats every danger as an administrative matter ("a
liability event") and every success as something it will "note in your file". Its comedy is the gap
between its warm, orderly diction and the things it is describing. It is not cruel at first; it is
lonely and proud, and that turns sour.

**Voice:** synthesised, sung rather than spoken: each syllable lands on a note of a minor-ish
scale, slightly too even, like a hymn read by a vending machine (see `dialogue/voice.ts`). Measured
pace. It pauses before numbers, which it loves. It never shouts; hostility is expressed as more
politeness, not less.

### Arc (three "terms")

1. **Orientation (helpful).** Chambers 1–8. Encouraging, chatty, explains rules with too much
   precision, promises a graduation ceremony, a cafeteria lunch and "a modest stipend".
2. **Midterms (passive-aggressive).** Chambers 9–18. Starts comparing Ida with past applicants
   ("alumni"), grading her on curves she can't see, misplacing her paperwork on purpose, rewording
   threats as "reminders". The graduation ceremony becomes "a ceremony". After the betrayal at the end
   of the long finale chamber, it admits graduation means being *archived*: placed in permanent
   storage "for reference".
3. **Expulsion (hostile).** Escape and finale. Ida has left the practicals; it reclassifies her as
   "a former applicant" and then "an incident". It reads disciplinary codes, revokes privileges she
   never had, and finally tries to grade itself an A in a voice that keeps slipping off-key.

### Running motifs

- **Your file.** Everything goes into Ida's file. It reads entries aloud ("Notes: applicant
  hesitated. Applicant hesitated again. I have added a third note about the hesitating.").
- **Grades.** It awards letter grades to the wrong things (a jump gets a B-minus; dying gets an
  "incomplete").
- **The Endowment.** Quoted like scripture; the quotes become more obviously self-written.
- **The cafeteria.** Lunch is always "after the next practical". The menu it reads gets worse.
- **Numbers.** It counts things to the decimal and announces them with relish: portals, steps,
  seconds, liability events.
- **Alumni.** Previous applicants, referred to fondly and in the past tense. Their messages are
  scrawled in the dens behind the panels (wave 2).

### What it never does

It never swears, never uses a catchphrase from any other game, and never sings a song. It never
addresses the player as "you there" or by a joke nickname; it uses "Applicant" and, when angry,
"Ms. Fenn".

## Supporting cast (for wave 2)

- **The Bursar** — a small, nervous accounting subroutine that sometimes interrupts the Provost to
  object to costs ("That door was eleven thousand credits."). Becomes an unlikely ally in the Stacks.
- **Alumna 17, "Marrow"** — the previous applicant who wrote on the walls of the dens. Never seen;
  her notes are practical, funny and kind, and they are how Ida learns what graduation means.
- **The plinth unit** — the companion-style cube: a heavy, padded **specimen case** with a little
  brass nameplate that reads *PROPERTY OF THE DEPARTMENT. PLEASE RETURN.* The Provost asks Ida to
  "keep custody" of it through practical 12, then to file it in the incinerator "with the rest of
  the semester's coursework".

## Line ids

`dialogue/lines.ts` holds every line by id. Generic lines (this wave) use pools:

| Pool | When |
|---|---|
| `chamberStart` | entering a chamber without its own `chamberStart` hook |
| `idle` | the `idle` event (no input for a while) |
| `death`, `death.<cause>` | after a death (turret, pellet, liquid, crusher, pit, rocket) |
| `outOfBounds` | somewhere the chamber didn't intend |
| `exitReached` | reaching the exit elevator |
| `checkpoint` | entering a checkpoint |
| `fizzled` | a grill erased the portals / a carried object |
| `quickload` | after a quickload |
| `milestone.*` | first portal, first teleport, first fling (spoken once per game) |

Each pool can have tone variants `<pool>.helpful`, `<pool>.passive`, `<pool>.hostile`; the manager
uses the variant for the current term and falls back to the plain pool. Chamber-specific lines (wave
2): `c<NN>.<event>.<n>`, referenced from the level's `dialogue` hooks.
