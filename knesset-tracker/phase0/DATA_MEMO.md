# Phase 0 data memo

Explored 8 Nov 2026 against `https://knesset.gov.il/OdataV4/ParliamentInfo/`.
Everything below can be re-run with `phase0/explore.py` (counts, samples, field lists) and
`phase0/measure_size.py` (Postgres bytes per row). The raw output is in `phase0/out/`.

## TL;DR: answers to the open questions

| Question | Answer | Effect on scope |
| --- | --- | --- |
| Are vote tables public? | **Yes.** `KNS_PlenumVote` (36,168 votes, 2003 to Jul 2026) and `KNS_PlenumVoteResult` (1.95M per-MK rows) both work. | MK voting records are **in scope**, with caveats (see below). |
| Does any bill status history exist? | **Not on `KNS_Bill`** (it only has the current `StatusID`). **But** every plenum and committee agenda item (`KNS_PlmSessionItem`, `KNS_CmtSessionItem`) carries the bill's `StatusID` *at that session*, and the session has a date. `KNS_PlenumVote` is dated and linked by `ItemID`. `KNS_BillName` holds the bill's name per stage. `KNS_DocumentBill` holds the document per stage. | The timeline can be **reconstructed for past bills** from session items and votes, not only going forward from our change log. This is better than the project description assumed. |
| Which Knesset terms fit in Neon's 1 GB? | Everything, stored as raw JSONB, is ~1.7 GB, so not all of it. **Measured** after a real backfill of the v1 scope: 57 MB without vote results, ~150 MB projected with them (see "Measured after the first backfill"). | **v1 scope: Knesset 23, 24, 25 (and 26 when it starts) for term-scoped data; all reference data.** Older terms can be added later; the scope is one config value. |
| Is `LastUpdatedDate` usable as a high-water mark? | Yes. It is present on all the entities we need, `$filter=LastUpdatedDate gt ...` works, and we saw 35 bills and 49 committee sessions change in the last week. | Incremental sync design holds. |

## API facts that shape the code

- **Page size is fixed at 100.** `$top=5000` still returns 100 rows plus an `@odata.nextLink`.
  A request takes about 1 s, so a full mirror of everything is ~33,000 requests (~9 hours);
  the v1 scope (Knesset 23+) is a few thousand requests. The backfill must be resumable.
- **Server-side timeouts come back as an empty `200 OK`.** A heavy `$count` on
  `KNS_PlenumVoteResult` filtered by date returned HTTP 200 with an empty body after 30 s.
  The client must treat a non-JSON body as a retryable error, never as "no rows".
- **Filters on navigation properties work**, e.g.
  `KNS_BillInitiator?$filter=KNS_Bill/KnessetNum ge 23` (35,004 rows). This lets child tables
  (initiators, documents, session items, votes) be scoped by term without a join on our side.
- **Filters are capped at 100 nodes.** `Id eq 1 or Id eq 2 or ...` fails with HTTP 400 after about
  20 terms ("The node count limit of '100' has been exceeded"). Batch id lookups.
- `$apply=groupby(...)` works, but returns a bare JSON array instead of `{"value": [...]}`, and
  `aggregate($count as n)` fails with an unusual `HTTP 473`.
- **The service document and the metadata disagree on names.** The root lists
  `KNS_DocumentQuerie`, `V_Lobbyists` and `V_LobbyistsClients`, which all 404. The metadata
  names `KNS_DocumentQuery` and `V_Lobbyist`; `KNS_DocumentQuery` works but returns
  **camelCase** keys (`queryID`, `filePath`) and a bare array, unlike every other entity.
  `V_Lobbyist` returns nothing. The entity registry must use explicit names, not discovery.
- **`LastUpdatedDate` cascades.** When a bill changes, its plenum session items get the same
  `LastUpdatedDate` (e.g. bill 2196528 and all seven of its plenum items: `2026-11-03T08:43:38.87`).
  Each bill change therefore re-sends its child rows. The content hash makes this cheap, but it is
  one reason the hash step matters.
- **`LastUpdatedDate` is not a creation date.** Many tables were bulk-touched (all of
  `KNS_PlenumVote` has `LastUpdatedDate >= 2021-07-22`), so it cannot be used to date events.
- Datetimes come with Israel offsets (`+02:00`/`+03:00`). Store as `timestamptz`.
- Document URLs mix slashes: `https://fs.knesset.gov.il/25\law\25_ls1_6067787.pdf`.
  Normalise `\` to `/` when storing.

## Current state of the Knesset

- `KNS_KnessetDates` marks Knesset 25, assembly 2, plenum period 4 (19 Oct 2025 to 17 Jul 2026)
  as current. The last plenum session in the data is 28 Jul 2026. Committees still meet a little
  (latest session 4 Nov 2026).
- A new Knesset term (26) is expected to start after the elections. The design must not hardcode
  25: "current term" is read from `KNS_KnessetDates.IsCurrent`, and scope is "term >= 23".
- Committee sessions appear in the API only days ahead (the latest, on 4 Nov, was published on
  3 Nov). The "upcoming sessions" calendar will have a short horizon. Say so on the page.

## Data quality findings (first entries for the `data_issue` checker)

1. **`KNS_Query.KnessetNum` is wrong for most rows.** Values 0-9 appear (e.g. 7,439 rows with
   `KnessetNum = 9`, 2,901 with `5`), although the oldest question was submitted in 2013
   (Knesset 19). Only ~5,250 of 42,824 rows have a plausible term. Many of the bad rows also have
   a null `SubmitDate`. Questions must be scoped by date or ID, not by `KnessetNum`, and the
   bad rows flagged.
2. **`KNS_Person.IsCurrent` is true for 199 people**, not 120. It cannot mean "sitting MK".
   Derive "current MK" from `KNS_PersonToPosition` (position 43/61 = MK, `IsCurrent`, current term).
3. **`KNS_Person.Email` sometimes holds a name** (e.g. person 134's email field is her name).
4. **Vote results list only MKs who were recorded.** A recent no-confidence vote (46701) has 28
   "for" and 4 "present" rows and nothing else. Absent MKs mostly have no row at all, even though
   code 10 ("absent") exists. Per-MK pages must say "no recorded vote", never "absent", unless
   code 10 is present. Before showing vote records publicly, check a sample against knesset.gov.il.
5. **`KNS_Status.OrderTransition` is null for every bill status**, and several descriptions
   repeat with different IDs (e.g. "הכנה לקריאה ראשונה" is both 101 and 108; "לאישור פיצול
   במליאה" is 158, 161, 162 and 165). The status → stage mapping and stage order must be written
   by hand (`backend/app/stages.py`).
6. **Duplicate document rows.** Bill 2196528 lists the same second/third-reading PDF twice.
   Hasadna issue #148 reports duplicate IDs in committee-session documents.
7. Hasadna's tracker also has open reports of mismatching person data (#147) and stale committee
   membership (#133). Treat committee membership from `KNS_PersonToPosition` as "as reported".
8. `KNS_DocumentIsraelLaw` is empty (0 rows), so laws have no documents in the API.
9. 11 bills in Knesset 25 have no `CommitteeID`.

## Measured size

Measured by loading the newest 1,000 rows of every entity into a `(id int primary key, payload
jsonb)` table in Postgres 16 and extrapolating (`phase0/out/sizes.json`). JSONB is an upper bound:
typed domain tables are smaller (a typed vote-result table measured **96 B/row** with two indexes,
against 475 B/row as JSONB).

| Entity | Rows (all terms) | Raw JSONB, all terms | In v1 scope (Knesset 23+) |
| --- | ---: | ---: | --- |
| KNS_PlenumVoteResult | 1,953,709 | 928 MB | ~12k votes × ~50-60 rows, typed: **~60-70 MB** |
| KNS_DocumentCommitteeSession | 201,807 | 117 MB | not in v1 (link to the session page instead) |
| KNS_PlmSessionItem | 168,801 | 93 MB | 24,135 rows |
| KNS_SecondaryLaw | 60,338 | 86 MB | not in v1 |
| KNS_CommitteeSession | 109,277 | 84 MB | 16,014 rows |
| KNS_Bill | 60,137 | 61 MB | 14,490 rows |
| KNS_BillInitiator | 169,348 | 54 MB | 35,004 rows |
| KNS_DocumentBill | 111,663 | 51 MB | 27,064 rows |
| KNS_CmtSessionItem | 80,790 | 39 MB | 20,270 rows |
| KNS_Query | 42,824 | 28 MB | all (term field unreliable; scoped by date) |
| everything else | | ~200 MB | |
| **Total** | **~3.3M** | **~1.7 GB** | **~250-350 MB normalised, estimate** |

Conclusions:
- **Never keep raw payloads.** The project description already planned to clear the payload
  after processing. The measurement makes it mandatory: the Phase 1 pipeline stores only a content
  hash per record, and keeps a payload only for records that failed validation (quarantine).
- Votes are the only table that threatens the budget. Typed and scoped to Knesset 23+, they fit.
- The estimate above was replaced by a measurement; see the next section.

## Measured after the first backfill (local Postgres 16, 8 Nov 2026)

The Phase 1 pipeline backfilled the whole v1 scope except vote results, plus 10 minutes of vote
results, into a local Postgres. No errors, no quarantined records.

| | Value |
| --- | --- |
| Rows mirrored | 229,444 (18 entities complete, vote results partial) |
| Requests | 2,306 in 63 minutes (with a 0.25 s politeness gap) |
| Database size without vote results | **57 MB** |
| Vote results | 119 B/row measured. ~550-800k rows in scope (526k since Nov 2022 alone), so **~65-95 MB** |
| **Projected total for v1 scope** | **~150 MB, about 15% of Neon's 1 GB** |

| Largest tables | Rows | Size |
| --- | ---: | ---: |
| parl_query (all terms) | 42,824 | 8.3 MB |
| plenum_session_item | 24,135 | 6.5 MB |
| committee_session_item | 20,270 | 5.7 MB |
| bill_document | 27,062 | 5.5 MB |
| committee_session | 16,014 | 5.5 MB |
| bill | 14,490 | 5.2 MB |

What the measurement changed:
- The first version kept hashes in a separate `record_hash` table. It was the largest table
  (32 MB, ~200 B/row) and would have grown past the data it describes. Hashes are now an 8-byte
  column on each domain row.
- There is room to widen the scope later (e.g. `MIN_KNESSET=20`) without leaving the free tier.
- **Vote results are slow to fetch:** 2.7 s per page with the two-level navigation filter
  (`Vote/KNS_PlenumSession/KnessetNum`), against ~0.3-1 s elsewhere, so the full vote-result
  backfill is ~6 hours. Run it overnight from a laptop. A possible fix: filter by
  `VoteID ge <first vote id of Knesset 23>` instead, which was fast in Phase 0 spot checks.

## Entities in v1 scope

Reference (all rows): `KNS_Status`, `KNS_ItemType`, `KNS_KnessetDates`, `KNS_Position`,
`KNS_GovMinistry`, `KNS_Person`, `KNS_Faction`, `KNS_Committee`, `KNS_IsraelLaw`.

Term-scoped (Knesset >= 23): `KNS_PersonToPosition`, `KNS_Bill`, `KNS_BillInitiator`,
`KNS_BillName`, `KNS_DocumentBill`, `KNS_CommitteeSession`, `KNS_CmtSessionItem`,
`KNS_PlenumSession`, `KNS_PlmSessionItem`, `KNS_PlenumVote`, `KNS_PlenumVoteResult`, `KNS_Query`
(by `SubmitDate`, see finding 1), `KNS_Agenda`.

Deferred: secondary legislation (`KNS_SecondaryLaw` and its bindings), law bindings and
corrections, committee-session documents, lobbyists (endpoint broken), broadcast links.
