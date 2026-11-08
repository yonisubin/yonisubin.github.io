"""Integration tests: run the real sync engine against recorded API responses."""
from __future__ import annotations

import time
from collections import Counter
from datetime import datetime

import pytest
from sqlalchemy import func, select

from app.entities import BY_NAME
from app.models import change_event, quarantine, sync_run, sync_state
from app.sync import SchemaChanged, reconcile_entity, run_sync, sync_entity
from tests.conftest import FakeOData, apply_day2, fixture_entities, load_day1, make_client


def count(engine, table) -> int:
    with engine.connect() as c:
        return c.execute(select(func.count()).select_from(table)).scalar_one()


def events(engine) -> set[tuple[str, int, str]]:
    with engine.connect() as c:
        return {(r.entity_type, r.entity_id, r.event_type)
                for r in c.execute(select(change_event))}


def test_day1_backfill_then_day2_produces_exact_events(engine, settings):
    day1 = load_day1()
    specs = fixture_entities(day1)
    server = FakeOData(day1)

    runs = run_sync(engine, make_client(server), settings, specs)
    assert all(r.pass_completed and r.error is None for r in runs)
    for spec in specs:  # every record mirrored
        assert count(engine, spec.table) == len(day1[spec.odata]), spec.odata
    assert count(engine, change_event) == 0  # the backfill is silent
    with engine.connect() as c:  # the mark is the newest server timestamp, not our clock
        hwm = c.execute(select(sync_state.c.high_water_mark)
                        .where(sync_state.c.entity == "KNS_Bill")).scalar_one()
    assert hwm == max(datetime.fromisoformat(b["LastUpdatedDate"])
                      for b in day1["KNS_Bill"].values())

    # Re-running with no changes is a no-op (idempotent, overlap window is cheap).
    runs = run_sync(engine, make_client(server), settings, specs)
    assert sum(r.inserted + r.changed for r in runs) == 0
    assert count(engine, change_event) == 0

    day2, expected = apply_day2(day1)
    server.store = day2
    runs = run_sync(engine, make_client(server), settings, specs)
    assert events(engine) == expected
    # the LastUpdatedDate-only cascade and the unmapped-field change were fetched but ignored
    by = {r.entity: r for r in runs}
    assert by["KNS_PlmSessionItem"].fetched >= 1 and by["KNS_PlmSessionItem"].changed == 0
    assert by["KNS_Bill"].changed == 1 and by["KNS_Bill"].inserted == 1

    # A second day-2 run finds nothing new: the hashes of the ignored rows were stored too.
    runs = run_sync(engine, make_client(server), settings, specs)
    assert sum(r.inserted + r.changed + r.events for r in runs) == 0
    assert all(r.unchanged == r.fetched for r in runs)

    with engine.connect() as c:
        ev = c.execute(select(change_event).where(
            change_event.c.event_type == "bill.stage_changed")).one()
        assert ev.before == {"status_id": 108} and ev.after == {"status_id": 109}
        hwm = c.execute(select(sync_state.c.high_water_mark)
                        .where(sync_state.c.entity == "KNS_Bill")).scalar_one()
        assert hwm.isoformat() == "2026-11-10T08:00:00+00:00"


def test_interrupted_pass_resumes_from_checkpoint(engine, settings):
    day1 = load_day1()
    spec = BY_NAME["KNS_Committee"]  # 90 rows -> 30 pages of 3
    server = FakeOData(day1)
    client = make_client(server)

    # A deadline that has already passed after the first page.
    run = sync_entity(engine, client, spec, settings, deadline=time.monotonic() + 0.0)
    assert run.pages == 0 and not run.pass_completed
    run = sync_entity(engine, client, spec, settings, deadline=time.monotonic() + 60)
    assert run.pass_completed

    # Now crash in the middle: the network dies after 5 pages.
    with engine.begin() as c:
        c.execute(sync_state.delete())
        c.execute(spec.table.delete())
    server2 = FakeOData(day1)
    calls = {"n": 0}

    def flaky(req):
        calls["n"] += 1
        if calls["n"] > 5:
            raise ConnectionError("network died")
        return server2(req)

    client2 = make_client(flaky)  # type: ignore[arg-type]
    with pytest.raises(ConnectionError):
        sync_entity(engine, client2, spec, settings, deadline=time.monotonic() + 60)
    assert count(engine, spec.table) == 15  # 5 committed pages
    with engine.connect() as c:
        st = c.execute(select(sync_state).where(sync_state.c.entity == spec.odata)).one()
        assert st.pass_next_url.endswith("skip=15") and st.high_water_mark is None
        assert c.execute(select(sync_run.c.error).order_by(sync_run.c.id.desc())
                         ).first()[0].startswith("ConnectionError")

    run = sync_entity(engine, make_client(server2), spec, settings,
                      deadline=time.monotonic() + 60)
    assert run.pass_completed and run.pages == 25  # pages 6..30 only
    assert count(engine, spec.table) == 90


def test_schema_change_stops_the_run_without_writing(engine, settings):
    day1 = load_day1()
    for row in day1["KNS_Status"].values():
        del row["TypeDesc"]
    with pytest.raises(SchemaChanged):
        run_sync(engine, make_client(FakeOData(day1)), settings, [BY_NAME["KNS_Status"]])
    assert count(engine, BY_NAME["KNS_Status"].table) == 0
    with engine.connect() as c:
        assert "SchemaChanged" in c.execute(select(sync_run.c.error)).scalar_one()


def test_bad_record_is_quarantined_and_the_rest_continue(engine, settings):
    day1 = load_day1()
    bad = next(iter(day1["KNS_Bill"].values()))
    bad["PublicationDate"] = "not a date"
    runs = run_sync(engine, make_client(FakeOData(day1)), settings, [BY_NAME["KNS_Bill"]])
    assert runs[0].quarantined == 1
    assert count(engine, BY_NAME["KNS_Bill"].table) == len(day1["KNS_Bill"]) - 1
    with engine.connect() as c:
        q = c.execute(select(quarantine)).one()
        assert q.knesset_id == bad["Id"] and q.payload["PublicationDate"] == "not a date"


def test_empty_200_from_server_is_retried(engine, settings):
    day1 = load_day1()
    server = FakeOData(day1)
    server.fail_next = 2
    runs = run_sync(engine, make_client(server), settings, [BY_NAME["KNS_Faction"]])
    assert runs[0].pass_completed and runs[0].fetched == len(day1["KNS_Faction"])


def test_reconcile_detects_deletions_and_refuses_mass_deletes(engine, settings):
    day1 = load_day1()
    spec = BY_NAME["KNS_Committee"]
    run_sync(engine, make_client(FakeOData(day1)), settings, [spec])
    gone = next(iter(day1["KNS_Committee"]))
    del day1["KNS_Committee"][gone]
    run = reconcile_entity(engine, make_client(FakeOData(day1)), spec, settings)
    assert run.deleted == 1
    assert events(engine) == {("committee", gone, "committee.deleted")}

    day1["KNS_Committee"] = dict(list(day1["KNS_Committee"].items())[:10])
    with pytest.raises(SchemaChanged, match="refusing"):
        reconcile_entity(engine, make_client(FakeOData(day1)), spec, settings)
    assert count(engine, spec.table) == 89


def test_runs_are_logged(engine, settings):
    day1 = load_day1()
    run_sync(engine, make_client(FakeOData(day1)), settings, fixture_entities(day1))
    with engine.connect() as c:
        rows = c.execute(select(sync_run.c.entity, sync_run.c.fetched)).all()
    assert Counter(e for e, _ in rows) == Counter(s.odata for s in fixture_entities(day1))
