"""Regression tests for the ponytail audit findings (numbers match the audit)."""
from __future__ import annotations

import re
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, insert, select, update

from app.account import emailer_dep
from app.alerts import fan_out_all
from app.api import conn_dep
from app.config import Settings, get_settings
from app.describe import describe
from app.emailer import ConsoleEmailer, EmailError, make_emailer
from app.entities import BY_NAME
from app.hebrew import normalize
from app.main import app
from app.models import app_user, login_token, notification, subscription, sync_run
from app.odata import ODataError
from app.ops import prune
from app.read import sync_status
from app.sync import run_sync
from tests.conftest import FakeOData, fixture_entities, load_day1, make_client

H = {"X-Requested-With": "knesset-tracker"}


def test_1_a_failing_table_does_not_stop_the_others(engine, settings):
    day1 = load_day1()
    del day1["KNS_Status"]  # the API answers 404 for this table
    specs = [BY_NAME["KNS_Status"], BY_NAME["KNS_Faction"], BY_NAME["KNS_Committee"]]
    with pytest.raises(ODataError):  # the run still reports the failure...
        run_sync(engine, make_client(FakeOData(day1)), settings, specs)
    with engine.connect() as c:  # ...but the tables after it were synced
        assert c.execute(select(func.count()).select_from(BY_NAME["KNS_Committee"].table)
                         ).scalar_one() == len(day1["KNS_Committee"])
        errors = dict(c.execute(select(sync_run.c.entity, sync_run.c.error)).all())
    assert errors["KNS_Status"].startswith("ODataError") and errors["KNS_Committee"] is None


def test_2_one_stale_table_makes_the_mirror_unhealthy(engine, settings):
    day1 = load_day1()
    run_sync(engine, make_client(FakeOData(day1)), settings, fixture_entities(day1))
    now = datetime.now(UTC)
    with engine.connect() as c:
        assert sync_status(c, now)["healthy"] is True
    with engine.begin() as c:  # only bills stopped syncing, two hours ago
        c.execute(update(sync_run).where(sync_run.c.entity == "KNS_Bill")
                  .values(finished_at=now - timedelta(hours=2)))
        # a successful nightly reconcile must not count as a sync
        c.execute(insert(sync_run).values(entity="KNS_Bill", kind="reconcile",
                                          started_at=now, finished_at=now))
    with engine.connect() as c:
        st = sync_status(c, now)
    assert st["healthy"] is False and st["stale_tables"] == ["KNS_Bill"]


def test_3_status_shows_the_newest_error(engine, settings):
    day1 = load_day1()
    run_sync(engine, make_client(FakeOData(day1)), settings, [BY_NAME["KNS_Faction"]])
    later = datetime.now(UTC) + timedelta(minutes=5)
    with engine.begin() as c:
        c.execute(insert(sync_run), [
            {"entity": "KNS_Faction", "kind": "incremental", "started_at": later,
             "error": "old error"},
            {"entity": "KNS_Faction", "kind": "incremental",
             "started_at": later + timedelta(minutes=30), "error": "new error"}])
    with engine.connect() as c:
        faction = next(e for e in sync_status(c, later + timedelta(minutes=31))["entities"]
                       if e["entity"] == "KNS_Faction")
    assert faction["last_error"] == "new error"


def test_4_sign_in_emails_are_capped_across_all_addresses(engine, settings):
    mail = ConsoleEmailer()

    def conn():
        with engine.connect() as c:
            yield c

    app.dependency_overrides.update({conn_dep: conn, get_settings: lambda: settings,
                                     emailer_dep: lambda: mail})
    try:
        client = TestClient(app, base_url="https://tracker.test")
        for i in range(30):
            r = client.post("/api/v1/auth/request-link", json={"email": f"u{i}@example.com"},
                            headers=H)
            assert r.status_code == 202
        r = client.post("/api/v1/auth/request-link", json={"email": "u99@example.com"},
                        headers=H)
        assert r.status_code == 429 and len(mail.outbox) == 30
    finally:
        app.dependency_overrides.clear()


def test_5_keyword_matches_an_agenda_item_published_after_its_session(engine, settings):
    day1 = load_day1()
    server = FakeOData(day1)
    specs = fixture_entities(day1)
    run_sync(engine, make_client(server), settings, specs)
    with engine.begin() as c:
        uid = c.execute(insert(app_user).values(email="k@example.com", locale="en",
                                                digest_frequency="instant")
                        .returning(app_user.c.id)).scalar_one()
        c.execute(insert(subscription).values(
            user_id=uid, target_type="keyword", keyword="חיילים בודדים",
            keyword_norm=normalize("חיילים בודדים"),
            created_at=datetime.now(UTC) - timedelta(minutes=5)))
    # the next day the committee adds an agenda item to a session it published before
    session = next(iter(day1["KNS_CommitteeSession"].values()))
    day1["KNS_CmtSessionItem"][8_888_001] = {
        "Id": 8_888_001, "ItemID": 1, "CommitteeSessionID": session["Id"], "Ordinal": 9,
        "StatusID": 1001, "Name": "תקציב הסיוע לחיילים בודדים", "ItemTypeID": 1,
        "LastUpdatedDate": "2026-11-11T09:00:00+02:00"}
    run_sync(engine, make_client(server), settings, specs)
    assert fan_out_all(engine) >= 1
    with engine.connect() as c:
        n = c.execute(select(notification).where(notification.c.user_id == uid)).first()
        assert n is not None
        from app.models import change_event
        ev = dict(c.execute(select(change_event)
                            .where(change_event.c.id == n.change_event_id)).mappings().one())
        assert ev["event_type"] == "committee_session_item.new"
        assert "תקציב הסיוע לחיילים בודדים" in describe(c, ev).en


def test_6_an_https_site_refuses_to_run_without_an_email_backend():
    with pytest.raises(EmailError, match="EMAIL_BACKEND is not set"):
        make_emailer(Settings(public_base_url="https://knesset-tracker.example", email_backend=""))
    assert isinstance(make_emailer(Settings(public_base_url="https://x.example",
                                            email_backend="console")), ConsoleEmailer)
    assert isinstance(make_emailer(Settings(public_base_url="http://localhost:8000",
                                            email_backend="")), ConsoleEmailer)
    with pytest.raises(EmailError, match="unknown"):
        make_emailer(Settings(email_backend="sendgrid"))


def test_7_old_logs_are_pruned(engine):
    now = datetime.now(UTC)
    with engine.begin() as c:
        c.execute(insert(sync_run), [
            {"entity": "KNS_Bill", "kind": "incremental", "started_at": now - timedelta(days=91)},
            {"entity": "KNS_Bill", "kind": "incremental", "started_at": now - timedelta(days=1)}])
        c.execute(insert(login_token), [
            {"token_hash": "a" * 64, "email": "a@example.com", "locale": "he",
             "expires_at": now - timedelta(days=2)},
            {"token_hash": "b" * 64, "email": "b@example.com", "locale": "he",
             "expires_at": now + timedelta(minutes=10)}])
        assert prune(c, now) == {"sync_runs": 1, "login_tokens": 1}
        assert c.execute(select(func.count()).select_from(sync_run)).scalar_one() == 1
        assert c.execute(select(func.count()).select_from(login_token)).scalar_one() == 1


def test_8_new_law_links_are_url_encoded(engine, settings):
    day1 = load_day1()
    law = BY_NAME["KNS_IsraelLaw"].table
    with engine.begin() as c:
        c.execute(insert(law).values(id=777, name_he='חוק "בדיקה", התשפ"ו', content_hash=0))
        d = describe(c, {"event_type": "law.new", "entity_id": 777})
    assert re.fullmatch(r"/search\?q=[A-Za-z0-9%._~-]+", d.path), d.path
    assert day1  # fixtures loaded (keeps the signature uniform with the other tests)
