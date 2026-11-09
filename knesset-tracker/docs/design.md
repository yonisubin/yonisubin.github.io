# Design plan

Written with the `frontend-design` skill: plan first, review the plan against the brief, then build.

## The brief

- **Subject:** the legislative record of the Knesset. Bills move through fixed stages, and those
  stages are published in a statute book (Reshumot).
- **Audience:** journalists, NGO staff, students and engaged citizens, in Hebrew first and
  English second. They come to check where something stands, and to follow it.
- **Primary job:** find a bill, MK or committee, see exactly where it stands and what happens
  next, then follow it.
- **Constraints:**
  - neutral across the political spectrum, and not mistakable for an official Knesset or
    government site;
  - right-to-left and left-to-right from one stylesheet;
  - Lighthouse 90+ and accessibility 100;
  - existing test selectors keep working.

## First draft (rejected parts struck through after review)

- Colour: white, a slate ink, and ~~Israeli flag blue `#0038B8` as the accent~~.
- Type: a Hebrew book serif for titles, a Hebrew sans for the interface.
- Layout: ~~every section in its own rounded, bordered card~~ (that's what the site has now).
- Hero: ~~site name, a one-line tagline, and three buttons (Bills / MKs / Committees)~~.

## Review against the brief

| Draft choice | Problem | Revision |
| --- | --- | --- |
| Flag blue accent | It reads as an official state site and borrows national symbolism. That hurts both neutrality and credibility: the site must never look like it speaks for the Knesset. | **Verdigris**, the green patina of the bronze Knesset Menorah: civic and specific to the place, with no party or flag behind it. **Bronze** marks enacted law: the one moment a bill becomes permanent. |
| A card around every section | This is the generic "SaaS card kit": identical rounded boxes, one radius for everything, no hierarchy. | Sections are open text on the page, with a heading and space. Only one thing gets a panel: the stage track, which is the page's purpose. |
| Name + tagline + three buttons | A template hero that could front any product. | The hero is the job: one large search field, then **the latest movement in the Knesset**, a real bill with its stage track. The most characteristic thing in this world is a bill moving from one reading to the next. |
| Middle-dot meta strings, all-caps type labels, "›" after links, monospace table names | Template chrome that the current build has (all of it). | Metadata on separate labelled lines or in plain runs with spacing; sentence-case labels with a colour dot; links say what they do with no arrow; identifiers in the interface face. |

A similar prompt ("civic data tracker") would most likely produce flag colours or a
navy-and-white government palette, cards, and a stats hero. The revised plan avoids all three on
purpose.

## Revised token system

**Colour** (light; dark mode keeps the same roles)

| Name | Hex | Role |
| --- | --- | --- |
| Paper | `#F5F6F3` | page background: cool grey-green, deliberately not cream |
| Ink | `#1C2733` | text and the wordmark (a slate ink, not a tinted black) |
| Verdigris | `#1E6B66` | links, actions, the current position on the track |
| Bronze | `#875F12` | enacted law: the "passed" stage and its badge |
| Stone | `#646B74` | secondary text; stages a bill will never reach |
| Rule | `#D6DBD7` | the few lines that separate things |

Dark: paper `#131B22`, ink `#E4EAEE`, verdigris `#71C2BA`, bronze `#D8B166`, stone `#9EA7B1`,
rule `#2A3540`.

**Type**
- **Frank Ruhl Libre**: titles, bill names, the wordmark, stage names on the track. Frank Rühl is
  the classic Hebrew book face, the voice of Israeli print and statute books. Weights 500 and 700.
- **IBM Plex Sans Hebrew**: everything else. It is a sober, engineered face with a matching
  Latin, so English pages stay one family. Weights 400 and 600.
- **Scale:** Bringhurst's classic scale: 14 / 16 / 18 / 21 / 24 / 36 / 48 px. Body is 16/1.65
  (sans). Serif titles are 1.25, and serif body text, such as summaries, is 1.75. Prose is capped
  at 68ch.

**Layout**

```
home                                       bill page (desktop)
+------------------------------------+     +--------------------------+-----------+
| wordmark      nav         language |     | bill name, serif, 36px   |           |
+------------------------------------+     | type, Knesset, committee | Follow    |
| What the Knesset is doing,         |     +--------------------------+-----------+
| step by step          (serif 48)   |     | [ STAGE TRACK: the one panel ]       |
| [ search ......................  ] |     |  o----o----o----*-----o-----o        |
|                                    |     |  current stage, then what happens next|
| Latest movement                    |     +--------------------------+-----------+
|  bill name (serif)                 |     | timeline (date | event)  | initiators|
|  o----o----*----o----o  track      |     |                          | committee |
|                                    |     |                          | documents |
| Recently updated bills (list)      |     |                          | names     |
+------------------------------------+     +--------------------------+-----------+
```

Text is start-aligned everywhere (right in Hebrew, left in English), never centred or justified:
the content is records, not posters. Phones get one column, with the track running vertically.

**Principles**
1. **The stage track is the signature.** It is the one bold element, on the home page and on
   every bill page. Everything around it stays quiet.
2. **A record, not a feed.** Serif for what the Knesset wrote (bill names, summaries); sans for
   what the site says about it.
3. **Colour carries meaning, never decoration.** Verdigris means "here, now, actionable". Bronze
   means "enacted". Stone means "not reached" or "ended". There are no gradients.
4. **One motion:** the track fills to the current stage when a bill page loads (off with
   `prefers-reduced-motion`). Nothing else moves unless the user acts.
5. **Plain words.** Buttons say what happens ("Follow this bill", "Email me a sign-in link"), with
   no arrows and no labels above headings.

## Notes from building it (self-critique from screenshots)

- **The hero heading broke badly in Hebrew**, leaving one word alone on the second line.
  Fixed with `text-wrap: balance` and a wider measure.
- **The header search duplicated the hero search** on the home page. I removed it there
  (Chanel's rule: take one accessory off).
- **The "translated" dotted underline shouted** once the stage track was full of English labels.
  Its colour is now 40% of the text colour: still a marker, no longer a decoration.
- **Removing the middle dots exposed a bidi bug.** Gregorian and Hebrew-calendar dates ran
  together into "202618". The Hebrew date is now isolated with `<bdi>` and set in parentheses,
  the natural typographic form for an alternative date.
- **The home panel caused a layout shift of 0.49**, because it appeared only after its data
  loaded. It is now rendered at its final size from the start, and on phones the compact track
  stays horizontal, labelling only the current stage, so its height is predictable. The shift is
  now 0.02-0.05.
- The favicon now repeats the signature: two filled markers and the current-stage ring.

**Next time, try:** printing the track as a proper "statute book" view of a law's full history,
and setting long bill names with a hanging indent for the year part ("התשפ"ו–2026").
