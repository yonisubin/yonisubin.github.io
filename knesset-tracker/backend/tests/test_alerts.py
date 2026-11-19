"""Alerts end to end at the engine level: subscriptions -> day-2 changes -> notifications
-> emails, plus the failure modes (retries, crashes, duplicates)."""
from __future__ import annotations

from datetime import UTC, datetime, timedelta

import httpx
import pytest
from sqlalchemy import func, insert, select, update

from app.alerts import deliver_email, fan_out_all, run_alerts, run_digest
from app.emailer import ConsoleEmailer, Email, EmailError
from app.hebrew import normalize
from app.models import app_user, notification, push_subscription, subscription
from app.push import Pusher, generate_vapid_keys
from app.sync import run_sync
from tests.conftest import FakeOData, apply_day2, fixture_entities, load_day1, make_client

NO_PUSH = Pusher("", "", "mailto:x@test")


def setup_world(engine, settings, *, frequency="instant"):
    """Backfill day 1, create users following things, then apply day 2."""
    day1 = load_day1()
    server = FakeOData(day1)
    specs = fixture_entities(day1)
    run_sync(engine, make_client(server), settings, specs)
    day2, expected = apply_day2(day1)
    moved_bill = next(e for t, e, k in expected if k == "bill.stage_changed")
    answered_query = next(e for t, e, k in expected if k == "query.answered")
    asker = day2["KNS_Query"][answered_query]["PersonID"]
    with engine.begin() as c:
        alice = c.execute(insert(app_user).values(email="alice@test", locale="en",
                                                  digest_frequency=frequency)
                          .returning(app_user.c.id)).scalar_one()
        bob = c.execute(insert(app_user).values(email="bob@test", locale="he",
                                                digest_frequency=frequency)
                        .returning(app_user.c.id)).scalar_one()
        past = datetime.now(UTC) - timedelta(minutes=5)
        none = {"target_id": None, "keyword": None, "keyword_norm": None, "created_at": past}
        c.execute(insert(subscription), [
            none | {"user_id": alice, "target_type": "bill", "target_id": moved_bill},
            none | {"user_id": alice, "target_type": "mk", "target_id": asker},
            # bob follows a keyword that the brand-new day-2 bill contains
            none | {"user_id": bob, "target_type": "keyword", "keyword": "בדיקה",
                    "keyword_norm": normalize("בדיקה")},
        ])
    server.store = day2
    run_sync(engine, make_client(server), settings, specs)
    return {"alice": alice, "bob": bob, "bill": moved_bill, "query": answered_query}


def count(engine, *where):
    with engine.connect() as c:
        return c.execute(select(func.count()).select_from(notification).where(*where)).scalar_one()


def test_followers_get_one_clear_email_each(engine, settings):
    w = setup_world(engine, settings)
    mail = ConsoleEmailer()
    out = run_alerts(engine, mail, NO_PUSH, settings)
    assert out["notifications_created"] == 3  # alice: bill + question; bob: keyword
    assert sorted(m.to for m in mail.outbox) == ["alice@test", "bob@test"]
    alice = next(m for m in mail.outbox if m.to == "alice@test")
    assert "moved to: Approved in committee for first reading" in alice.text
    assert "parliamentary question was answered on 9 Nov 2026" in alice.text
    assert f"https://tracker.test/en/bills/{w['bill']}" in alice.text
    assert alice.headers["List-Unsubscribe-Post"] == "List-Unsubscribe=One-Click"
    bob = next(m for m in mail.outbox if m.to == "bob@test")
    assert bob.subject.startswith("הצעת חוק חדשה: הצעת חוק בדיקה")
    assert 'dir="rtl"' in bob.html

    # running again finds nothing new: no duplicate notifications, no duplicate emails
    out = run_alerts(engine, mail, NO_PUSH, settings)
    assert out["notifications_created"] == 0 and len(mail.outbox) == 2
    assert count(engine, notification.c.status == "sent") == 3


def test_subscriptions_dont_match_older_events(engine, settings):
    w = setup_world(engine, settings)
    with engine.begin() as c:  # alice's follows are "created" after the events
        c.execute(update(subscription).where(subscription.c.user_id == w["alice"])
                  .values(created_at=datetime.now(UTC) + timedelta(minutes=1)))
    run_alerts(engine, ConsoleEmailer(), NO_PUSH, settings)
    assert count(engine, notification.c.user_id == w["alice"]) == 0


def test_failed_send_is_retried_and_delivered_once(engine, settings):
    setup_world(engine, settings)

    class Flaky(ConsoleEmailer):
        fail = True

        def send(self, email: Email) -> None:
            if self.fail:
                raise EmailError("provider down")
            super().send(email)

    mail = Flaky()
    out = run_alerts(engine, mail, NO_PUSH, settings)
    assert out["email_failures"] == 2 and mail.outbox == []
    assert count(engine, notification.c.status == "pending", notification.c.attempts == 1) == 3
    mail.fail = False
    run_alerts(engine, mail, NO_PUSH, settings)
    assert len(mail.outbox) == 2
    assert count(engine, notification.c.status == "sent") == 3


def test_gives_up_after_five_attempts(engine, settings):
    setup_world(engine, settings)

    class Down(ConsoleEmailer):
        def send(self, email: Email) -> None:
            raise EmailError("still down")

    for _ in range(6):
        run_alerts(engine, Down(), NO_PUSH, settings)
    assert count(engine, notification.c.status == "failed") == 3


def test_crash_after_send_does_not_email_twice(engine, settings):
    """The process dies after the provider accepted the email but before we recorded it.
    The batch is retried with the same idempotency key, which the provider deduplicates."""
    setup_world(engine, settings)
    mail = ConsoleEmailer()
    original = mail.send

    def send_then_crash(email: Email) -> None:
        original(email)
        raise SystemExit("killed")  # not an Exception: escapes like a real crash

    mail.send = send_then_crash  # type: ignore[method-assign]
    with pytest.raises(SystemExit):
        run_alerts(engine, mail, NO_PUSH, settings)
    assert len(mail.outbox) == 1
    assert count(engine, notification.c.status == "sending") == 3  # all claimed, none recorded
    mail.send = original  # type: ignore[method-assign]

    # Not yet stale: nothing is resent.
    deliver_email(engine, mail, settings, {"instant"})
    assert len(mail.outbox) == 1
    # Ten minutes later the stale batches are retried with their original batch ids.
    later = datetime.now(UTC) + timedelta(minutes=11)
    stats = deliver_email(engine, mail, settings, {"instant"}, now=later)
    assert stats.emails_sent == 2  # both batches "sent" again...
    assert sorted(m.to for m in mail.outbox) == ["alice@test", "bob@test"]  # ...delivered once
    assert count(engine, notification.c.status == "sent") == 3


def test_digest_users_wait_for_the_digest(engine, settings):
    setup_world(engine, settings, frequency="daily")
    mail = ConsoleEmailer()
    run_alerts(engine, mail, NO_PUSH, settings)
    assert mail.outbox == [] and count(engine, notification.c.status == "pending") == 3
    out = run_digest(engine, mail, settings, now=datetime(2026, 11, 10, 6, tzinfo=UTC))  # Tue
    assert out["frequencies"] == ["daily"] and len(mail.outbox) == 2


def test_weekly_digest_only_on_sundays(engine, settings):
    setup_world(engine, settings, frequency="weekly")
    mail = ConsoleEmailer()
    run_digest(engine, mail, settings, now=datetime(2026, 11, 10, 6, tzinfo=UTC))  # Tuesday
    assert mail.outbox == []
    run_digest(engine, mail, settings, now=datetime(2026, 11, 15, 6, tzinfo=UTC))  # Sunday
    assert len(mail.outbox) == 2


def test_unsubscribed_users_get_no_email(engine, settings):
    w = setup_world(engine, settings)
    with engine.begin() as c:
        c.execute(update(app_user).where(app_user.c.id == w["alice"]).values(email_enabled=False))
    mail = ConsoleEmailer()
    run_alerts(engine, mail, NO_PUSH, settings)
    assert [m.to for m in mail.outbox] == ["bob@test"]


def test_push_tickles_each_device_once_and_drops_dead_ones(engine, settings):
    w = setup_world(engine, settings)
    with engine.begin() as c:
        c.execute(insert(push_subscription), [
            {"user_id": w["alice"], "endpoint": "https://push.test/alive", "p256dh": "x",
             "auth": "y"},
            {"user_id": w["alice"], "endpoint": "https://push.test/gone", "p256dh": "x",
             "auth": "y"}])
    hits: list[httpx.Request] = []

    def push_service(req: httpx.Request) -> httpx.Response:
        hits.append(req)
        return httpx.Response(410 if req.url.path == "/gone" else 201)

    private, public = generate_vapid_keys()
    pusher = Pusher(private, public, "mailto:a@test", transport=httpx.MockTransport(push_service))
    out = run_alerts(engine, ConsoleEmailer(), pusher, settings)
    assert out["pushes_sent"] == 1 and len(hits) == 2
    assert hits[0].headers["authorization"].startswith("vapid t=")
    assert hits[0].content == b""  # no payload: the service worker fetches the text
    with engine.connect() as c:
        assert c.execute(select(push_subscription.c.endpoint)).scalars().all() == [
            "https://push.test/alive"]


def test_fan_out_is_idempotent_even_if_the_cursor_is_lost(engine, settings):
    setup_world(engine, settings)
    assert fan_out_all(engine) == 3
    with engine.begin() as c:
        c.execute(update(notification).values(status="pending"))
        from app.models import pipeline_cursor
        c.execute(pipeline_cursor.delete())  # as if the cursor write never happened
    assert fan_out_all(engine) == 0  # dedupe keys stop any second notification
