"""The sync engine: one resumable code path for the backfill, the 30-minute incremental
sync and the nightly reconciliation.

Per entity, a *pass* walks `$filter=LastUpdatedDate gt <mark - overlap>` ordered by
(LastUpdatedDate, Id), page by page. For every page, in ONE transaction:

1. hash each record (excluding LastUpdatedDate, which cascades from parents);
2. skip records whose hash is unchanged (cheap overlap window, idempotent re-runs);
3. transform changed records, diff them against the current domain row;
4. upsert the domain rows (with their new hash), write change events;
5. save the pass checkpoint (the next page URL).

The high-water mark advances only when the last page of a pass commits. The first
pass of an entity (the backfill) has no lower bound and emits no events.
"""
from __future__ import annotations

import hashlib
import json
import logging
import time
from dataclasses import asdict, dataclass
from datetime import date, datetime, timedelta
from typing import Any

from sqlalchemy import Connection, Engine, delete, func, insert, select, true, update
from sqlalchemy.dialects.postgresql import insert as pg_insert

from .config import Settings
from .entities import ENTITIES, EntitySpec, Row, to_dt
from .models import change_event, quarantine, sync_run, sync_state
from .odata import ODataClient, build_url, odata_datetime

log = logging.getLogger("knesset.sync")

ORDERBY = "LastUpdatedDate asc,Id asc"


class SchemaChanged(RuntimeError):
    """The API's shape no longer matches the registry. Stop rather than write bad data."""


@dataclass
class PageResult:
    fetched: int = 0
    inserted: int = 0
    changed: int = 0
    unchanged: int = 0
    quarantined: int = 0
    events: int = 0
    max_seen: datetime | None = None

    def add(self, other: PageResult) -> None:
        for k in ("fetched", "inserted", "changed", "unchanged", "quarantined", "events"):
            setattr(self, k, getattr(self, k) + getattr(other, k))
        if other.max_seen and (self.max_seen is None or other.max_seen > self.max_seen):
            self.max_seen = other.max_seen


@dataclass
class EntityRun:
    entity: str
    kind: str
    pages: int = 0
    fetched: int = 0
    inserted: int = 0
    changed: int = 0
    unchanged: int = 0
    deleted: int = 0
    quarantined: int = 0
    events: int = 0
    pass_completed: bool = False
    error: str | None = None


def content_hash(raw: Row) -> int:
    """First 8 bytes of SHA-256 as a signed BIGINT. Hashes are only ever compared with the
    previous hash of the same record, so 64 bits is plenty and saves ~150 B/row over hex
    strings in a separate table (measured during the first local backfill)."""
    body = {k: v for k, v in raw.items() if k != "LastUpdatedDate" and not k.startswith("@")}
    data = json.dumps(body, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return int.from_bytes(hashlib.sha256(data.encode()).digest()[:8], "big", signed=True)


def jsonable(v: Any) -> Any:
    return v.isoformat() if isinstance(v, datetime | date) else v


def check_schema(spec: EntitySpec, rows: list[Row]) -> None:
    for raw in rows:
        missing = spec.required_fields - raw.keys()
        if missing:
            raise SchemaChanged(
                f"{spec.odata} record {raw.get('Id')} is missing fields {sorted(missing)}")


def process_page(conn: Connection, spec: EntitySpec, rows: list[Row], *,
                 emit_events: bool) -> PageResult:
    res = PageResult(fetched=len(rows))
    if not rows:
        return res
    check_schema(spec, rows)
    for raw in rows:
        seen = to_dt(raw.get("LastUpdatedDate"))
        if seen and (res.max_seen is None or seen > res.max_seen):
            res.max_seen = seen

    # The API can repeat a record across pages; keep the last copy.
    by_id = {int(r["Id"]): r for r in rows}
    hashes = {i: content_hash(r) for i, r in by_id.items()}
    t = spec.table
    stored = dict(conn.execute(
        select(t.c.id, t.c.content_hash).where(t.c.id.in_(list(by_id)))).all())
    todo = [i for i in by_id if stored.get(i) != hashes[i]]
    res.unchanged = len(by_id) - len(todo)
    if not todo:
        return res

    after: dict[int, Row] = {}
    for i in todo:
        try:
            after[i] = spec.transform(by_id[i])
        except Exception as e:  # noqa: BLE001 - quarantine anything a record can throw
            res.quarantined += 1
            stmt = pg_insert(quarantine).values(
                entity=spec.odata, knesset_id=i, payload=by_id[i], error=repr(e)[:2000])
            conn.execute(stmt.on_conflict_do_update(
                index_elements=["entity", "knesset_id"],
                set_={"payload": stmt.excluded.payload, "error": stmt.excluded.error,
                      "quarantined_at": func.now()}))
    if not after:
        return res

    before = {r["id"]: dict(r) for r in conn.execute(
        select(t).where(t.c.id.in_(list(after)))).mappings()}

    events: list[Row] = []
    volatile = spec.volatile_columns
    for i, new in after.items():
        old = before.get(i)
        if old is None:
            res.inserted += 1
            diff_before, diff_after = None, {k: jsonable(v) for k, v in new.items()}
        else:
            diff = [k for k in new if k not in volatile and old.get(k) != new[k]]
            if not diff:  # only unmapped fields changed: upsert the new hash, no event
                res.unchanged += 1
                continue
            res.changed += 1
            diff_before = {k: jsonable(old.get(k)) for k in diff}
            diff_after = {k: jsonable(new[k]) for k in diff}
        if emit_events and spec.events:
            for event_type in spec.events(old, new):
                events.append({
                    "entity_type": spec.table_name, "entity_id": i, "event_type": event_type,
                    "before": diff_before, "after": diff_after,
                    "source_updated_at": to_dt(by_id[i].get("LastUpdatedDate")),
                })

    stmt = pg_insert(t).values([{**row, "content_hash": hashes[i]} for i, row in after.items()])
    conn.execute(stmt.on_conflict_do_update(
        index_elements=["id"], set_={c.name: stmt.excluded[c.name] for c in t.c if c.name != "id"}))
    if events:
        conn.execute(insert(change_event), events)
        res.events = len(events)
    return res


# ---------------------------------------------------------------- runs

def _start_run(engine: Engine, entity: str, kind: str) -> int:
    with engine.begin() as conn:
        return conn.execute(
            insert(sync_run).values(entity=entity, kind=kind).returning(sync_run.c.id)
        ).scalar_one()


def _finish_run(engine: Engine, run_id: int, run: EntityRun) -> None:
    values = {k: v for k, v in asdict(run).items() if k not in ("entity", "kind")}
    with engine.begin() as conn:
        conn.execute(update(sync_run).where(sync_run.c.id == run_id)
                     .values(**values, finished_at=func.now()))


def _load_state(conn: Connection, entity: str) -> dict[str, Any]:
    row = conn.execute(select(sync_state).where(sync_state.c.entity == entity)).mappings().first()
    if row is None:
        conn.execute(insert(sync_state).values(entity=entity))
        return {"entity": entity, "high_water_mark": None, "pass_next_url": None,
                "pass_lower_bound": None, "pass_max_seen": None, "pass_started_at": None}
    return dict(row)


def sync_entity(engine: Engine, client: ODataClient, spec: EntitySpec, settings: Settings,
                deadline: float) -> EntityRun:
    run = EntityRun(entity=spec.odata, kind="incremental")
    run_id = _start_run(engine, spec.odata, run.kind)
    try:
        with engine.begin() as conn:
            state = _load_state(conn, spec.odata)
        hwm: datetime | None = state["high_water_mark"]
        emit = hwm is not None  # the first pass is the backfill: no events
        url = state["pass_next_url"]
        max_seen: datetime | None = state["pass_max_seen"]
        started_at = state["pass_started_at"]
        if url is None:  # start a new pass
            lower = hwm - timedelta(seconds=settings.overlap_seconds) if hwm else None
            filters = [f for f in (spec.scope(settings.min_knesset),) if f]
            if lower:
                filters.append(f"LastUpdatedDate gt {odata_datetime(lower)}")
            url = build_url(client.base_url, spec.odata, filters=filters, orderby=ORDERBY)
            max_seen, started_at = None, datetime.now().astimezone()

        while url and time.monotonic() < deadline:
            page = client.get_page(url)
            with engine.begin() as conn:
                res = process_page(conn, spec, page.rows, emit_events=emit)
                if res.max_seen and (max_seen is None or res.max_seen > max_seen):
                    max_seen = res.max_seen
                values: dict[str, Any] = {"pass_next_url": page.next_url,
                                          "pass_max_seen": max_seen,
                                          "pass_started_at": started_at}
                if page.next_url is None:  # pass complete: advance the mark
                    # the latest server timestamp seen; our own clock only if the pass saw
                    # nothing at all (an empty entity), so the next pass is incremental
                    new_hwm = max((d for d in (hwm, max_seen) if d), default=started_at)
                    values |= {"high_water_mark": new_hwm, "pass_max_seen": None,
                               "pass_started_at": None, "last_pass_completed_at": func.now()}
                conn.execute(update(sync_state).where(sync_state.c.entity == spec.odata)
                             .values(**values))
            run.pages += 1
            for k in ("fetched", "inserted", "changed", "unchanged", "quarantined", "events"):
                setattr(run, k, getattr(run, k) + getattr(res, k))
            url = page.next_url
            run.pass_completed = url is None
    except Exception as e:
        run.error = f"{type(e).__name__}: {e}"[:2000]
        raise
    finally:
        _finish_run(engine, run_id, run)
    return run


def run_sync(engine: Engine, client: ODataClient, settings: Settings,
             entities: list[EntitySpec] | None = None) -> list[EntityRun]:
    """Run every entity until the time budget is used. Stops on the first error."""
    deadline = time.monotonic() + settings.time_budget_seconds
    runs = []
    for spec in entities or ENTITIES:
        if time.monotonic() >= deadline:
            break
        runs.append(sync_entity(engine, client, spec, settings, deadline))
    return runs


def reconcile_entity(engine: Engine, client: ODataClient, spec: EntitySpec,
                     settings: Settings) -> EntityRun:
    """Re-read a small entity completely: catches changes whose LastUpdatedDate did not
    move (via the hash) and deletions (ids no longer returned)."""
    run = EntityRun(entity=spec.odata, kind="reconcile")
    run_id = _start_run(engine, spec.odata, run.kind)
    try:
        filters = [f for f in (spec.scope(settings.min_knesset),) if f]
        url: str | None = build_url(client.base_url, spec.odata, filters=filters,
                                    orderby="Id asc")
        seen: set[int] = set()
        while url:
            page = client.get_page(url)
            with engine.begin() as conn:
                res = process_page(conn, spec, page.rows, emit_events=True)
            seen.update(int(r["Id"]) for r in page.rows)
            run.pages += 1
            for k in ("fetched", "inserted", "changed", "unchanged", "quarantined", "events"):
                setattr(run, k, getattr(run, k) + getattr(res, k))
            url = page.next_url
        t = spec.table
        with engine.begin() as conn:
            existing = conn.execute(select(func.count()).select_from(t)).scalar_one()
            if existing and len(seen) < existing * 0.5:
                raise SchemaChanged(f"{spec.odata}: API returned {len(seen)} ids but we hold "
                                    f"{existing}; refusing to delete more than half")
            gone = [dict(r) for r in conn.execute(
                select(t).where(t.c.id.not_in(seen) if seen else true())).mappings()]
            if gone:
                ids = [g["id"] for g in gone]
                conn.execute(delete(t).where(t.c.id.in_(ids)))
                conn.execute(insert(change_event), [{
                    "entity_type": spec.table_name, "entity_id": g["id"],
                    "event_type": f"{spec.table_name}.deleted",
                    "before": {k: jsonable(v) for k, v in g.items() if k != "content_hash"},
                    "after": None,
                } for g in gone])
                run.deleted = len(gone)
                run.events += len(gone)
            conn.execute(update(sync_state).where(sync_state.c.entity == spec.odata)
                         .values(last_reconciled_at=func.now()))
        run.pass_completed = True
    except Exception as e:
        run.error = f"{type(e).__name__}: {e}"[:2000]
        raise
    finally:
        _finish_run(engine, run_id, run)
    return run
