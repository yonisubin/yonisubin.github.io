# Knesset Tracker

A bilingual (Hebrew/English) tracker for the Knesset's official open data: mirror it,
detect every change, and let people follow a bill, an MK or a committee.

> Lives in this subfolder for now. To give it its own repository later, keeping history:
> `git subtree split --prefix knesset-tracker -b knesset-tracker` and push that branch.

## Status

| Phase | State |
| --- | --- |
| 0. Explore the data | **Done.** See [`phase0/DATA_MEMO.md`](phase0/DATA_MEMO.md). |
| 1. Mirror | **Code done, not deployed yet.** Resumable backfill, incremental sync with hashing and change events, nightly reconciliation, `/admin` sync-status page, integration tests on recorded fixtures, CI. Remaining: create the Neon project and Wasmer app, run the backfill into Neon, then two weeks of unattended syncs. |
| 2. Read-only site | Not started |
| 3. Search | Not started |
| 4. Accounts and alerts | Not started |
| 5. Polish and launch | Not started |

## What Phase 0 changed in the plan

- **Votes are public** (`KNS_PlenumVote`, `KNS_PlenumVoteResult`), so MK voting records are in scope.
  Results only list MKs who were recorded, so pages must say "no recorded vote", not "absent".
- **Bill history is mostly recoverable.** Plenum and committee agenda items carry the bill's
  status at each dated session, so past timelines can be rebuilt, not only future ones.
- **Raw payloads cannot be kept.** Everything as JSONB is ~1.7 GB, more than Neon's free 1 GB. The
  pipeline stores a content hash per record instead of `raw_*` tables.
- **Scope is Knesset 23 and later** (one setting, `MIN_KNESSET`), plus all reference data.

## Sync design (backend/app/sync.py)

One code path does the backfill, the 30-minute sync and the nightly reconciliation.

- **Passes.** For each entity, a pass walks `$filter=LastUpdatedDate gt (mark − 1h)` ordered by
  `(LastUpdatedDate, Id)`. The first pass has no lower bound: that is the backfill.
- **One transaction per page.** Each page commits the domain upserts, the new hashes, the change
  events and the checkpoint (next page URL) together. A crash loses at most one page, and the next
  run resumes from the checkpoint. The high-water mark moves only when the last page commits.
- **Hashing.** The hash leaves out `LastUpdatedDate`, which the API bumps on child rows when a parent
  changes. Unchanged records stop there, so the overlap window costs almost nothing and re-runs are
  idempotent.
- **Change events.** Changed records are diffed against the current domain row. Classifiers turn
  diffs into `bill.new`, `bill.stage_changed`, `committee_session.scheduled`, `mk.faction_changed`,
  `query.answered`, `vote.recorded` and so on. The backfill emits nothing.
- **Time budget.** A run stops starting new pages at `SYNC_TIME_BUDGET_SECONDS` (about 80% of the cron
  timeout) and leaves the checkpoint for the next run.
- **Failing loudly.** If a record is missing an expected field, `SchemaChanged` stops the run before
  anything is written. A single bad value only quarantines that record, with its payload.
  An empty `200 OK` (how this API reports a server-side timeout) is retried, never read as "no rows".
- **Reconciliation.** Every night, small entities are re-read in full to catch deletions and changes
  whose timestamp didn't move. It refuses to delete more than half a table in one go.
- **No foreign keys between Knesset tables.** The source has referential gaps. We mirror it as
  published and report the gaps in the data-quality layer (Phase 5).

Known limit: offset paging over a changing result set can skip a row that moves during a pass.
The overlap window usually catches it; for small entities the nightly reconciliation always does.

## Running it

```bash
cd backend
python -m venv .venv && . .venv/bin/activate && pip install -e ".[dev]"
export DATABASE_URL=postgresql+psycopg://postgres@localhost/knesset
alembic upgrade head
python -m scripts.backfill                 # resumable; Ctrl-C and re-run any time
python -m scripts.backfill KNS_Bill        # or just some entities
INTERNAL_TOKEN=dev uvicorn app.main:app    # then: curl -XPOST -H 'X-Internal-Token: dev' :8000/internal/sync
open http://localhost:8000/admin           # sync status per entity
TEST_DATABASE_URL=postgresql+psycopg://postgres@localhost/knesset_test pytest
```

The integration tests replay real API responses recorded by `scripts/record_fixtures.py`, through a
fake OData server that pages 3 rows at a time. A synthetic "day 2" on top of them must produce
exactly the expected set of events.

## Deploying (Phase 1 to-do)

1. Create the Neon project (Free plan, compute pinned to 0.25 CU) and run `alembic upgrade head`.
2. Run the backfill from your machine against the Neon URL, then record `pg_database_size` in the memo.
3. Create the Wasmer app. Check `backend/wasmer.toml` against your existing FastAPI deploy, and use
   `postgresql+pg8000://` on Wasmer, because psycopg's binary build is a native extension.
   Set `DATABASE_URL`, `INTERNAL_TOKEN` and `SYNC_TIME_BUDGET_SECONDS=240` as app secrets.
4. In GitHub, add the secrets `NEON_DATABASE_URL`, `INTERNAL_TOKEN` and `WASMER_TOKEN`, then set the
   variable `WASMER_DEPLOY=true`. Pushes to `main` will then migrate Neon and deploy, with the cron
   jobs from `backend/app.yaml`.
