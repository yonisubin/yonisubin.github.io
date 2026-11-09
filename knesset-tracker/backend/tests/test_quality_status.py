"""Phase 5: data-quality checks, the status page data, the health check and the
operator alert."""
from __future__ import annotations

from datetime import UTC, datetime, timedelta

from fastapi.testclient import TestClient
from sqlalchemy import insert, select, update

from app.api import conn_dep
from app.emailer import ConsoleEmailer
from app.entities import BY_NAME
from app.main import app, engine_dep
from app.models import data_issue, sync_run
from app.ops import maybe_alert_operator
from app.quality import issues_for, run_checks
from app.read import sync_status
from app.sync import run_sync
from tests.conftest import FakeOData, fixture_entities, load_day1, make_client

T = {n: s.table for n, s in BY_NAME.items()}
BILL = 2196528


def seed(engine, settings):
    day1 = load_day1()
    run_sync(engine, make_client(FakeOData(day1)), settings, fixture_entities(day1))


def test_checks_find_problems_and_resolve_them(engine, settings):
    seed(engine, settings)
    with engine.begin() as c:
        cs = T["KNS_CommitteeSession"]
        first = c.execute(select(cs.c.id).limit(1)).scalar()
        c.execute(update(cs).where(cs.c.id == first).values(
            start_at=datetime(2026, 1, 2, tzinfo=UTC), finish_at=datetime(2026, 1, 1, tzinfo=UTC)))
        c.execute(update(T["KNS_Bill"]).where(T["KNS_Bill"].c.id == BILL)
                  .values(name_he="חוק  עם רווח כפול"))
        c.execute(insert(T["KNS_BillInitiator"]).values(id=999_999, bill_id=BILL, person_id=1,
                                                       is_initiator=True, ordinal=9,
                                                       content_hash=0))
        report = run_checks(c)
    assert report["session_ends_before_start"]["found"] == 1
    assert report["name_encoding"]["found"] == 1
    assert report["initiator_missing_person"]["found"] == 1
    with engine.connect() as c:
        rules = {i["rule"] for i in issues_for(c, "bill", BILL)}
    assert {"name_encoding", "initiator_missing_person"} <= rules

    # running again changes nothing; fixing the data resolves the issue
    with engine.begin() as c:
        assert run_checks(c)["name_encoding"]["new"] == 0
        c.execute(update(T["KNS_Bill"]).where(T["KNS_Bill"].c.id == BILL).values(name_he="חוק"))
        assert run_checks(c)["name_encoding"]["resolved"] == 1
        resolved = c.execute(select(data_issue.c.resolved_at).where(
            data_issue.c.rule == "name_encoding")).scalar_one()
    assert resolved is not None


def test_bill_page_and_summary_show_notices(engine, settings):
    seed(engine, settings)
    with engine.begin() as c:
        c.execute(insert(T["KNS_BillInitiator"]).values(id=999_999, bill_id=BILL, person_id=1,
                                                       is_initiator=True, ordinal=9,
                                                       content_hash=0))
        run_checks(c)

    def conn():
        with engine.connect() as c:
            yield c

    app.dependency_overrides[conn_dep] = conn
    try:
        client = TestClient(app)
        bill = client.get(f"/api/v1/bills/{BILL}").json()
        assert bill["data_issues"][0]["en"].startswith("One of this bill's listed initiators")
        summary = {r["rule"]: r for r in client.get("/api/v1/data-quality").json()}
        assert summary["initiator_missing_person"]["open"] == 1
        assert summary["initiator_missing_person"]["examples"] == [BILL]
    finally:
        app.dependency_overrides.clear()


def test_status_and_health_check(engine, settings):
    now = datetime.now(UTC)
    with engine.connect() as c:
        assert sync_status(c, now)["healthy"] is False  # nothing has ever synced
    seed(engine, settings)
    with engine.connect() as c:
        st = sync_status(c, now + timedelta(minutes=1))
    assert st["healthy"] is True
    bill = next(e for e in st["entities"] if e["entity"] == "KNS_Bill")
    assert bill["last_success"] and bill["last_error"] is None
    app.dependency_overrides[engine_dep] = lambda: engine
    try:
        client = TestClient(app)
        assert client.get("/health/sync").status_code == 200
        with engine.begin() as c:  # pretend the last success was two hours ago
            c.execute(update(sync_run).values(finished_at=now - timedelta(hours=2)))
        r = client.get("/health/sync")
        assert r.status_code == 503 and r.json()["healthy"] is False
    finally:
        app.dependency_overrides.clear()


def test_operator_is_emailed_once_when_stale(engine, settings, monkeypatch):
    monkeypatch.setenv("OPS_EMAIL", "ops@example.com")
    seed(engine, settings)
    mail = ConsoleEmailer()
    assert maybe_alert_operator(engine, mail, settings) is False  # fresh: no alert
    with engine.begin() as c:
        c.execute(update(sync_run).values(finished_at=datetime.now(UTC) - timedelta(hours=2)))
    assert maybe_alert_operator(engine, mail, settings) is True
    assert maybe_alert_operator(engine, mail, settings) is False  # not again for 6 hours
    assert [m.to for m in mail.outbox] == ["ops@example.com"]
    assert "No sync has succeeded since" in mail.outbox[0].text
