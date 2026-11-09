"""Accounts: magic links, sessions, follows, push registration, unsubscribe."""
from __future__ import annotations

import re
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from app.account import emailer_dep
from app.api import conn_dep
from app.auth import read_session, session_cookie, unsubscribe_token
from app.config import get_settings
from app.emailer import ConsoleEmailer
from app.main import app
from app.sync import run_sync
from tests.conftest import FakeOData, fixture_entities, load_day1, make_client

H = {"X-Requested-With": "knesset-tracker"}
BILL = 2196528


@pytest.fixture
def ctx(engine, settings) -> Iterator[tuple[TestClient, ConsoleEmailer]]:
    day1 = load_day1()
    run_sync(engine, make_client(FakeOData(day1)), settings, fixture_entities(day1))
    mail = ConsoleEmailer()

    def conn():
        with engine.connect() as c:
            yield c

    app.dependency_overrides[conn_dep] = conn
    app.dependency_overrides[get_settings] = lambda: settings
    app.dependency_overrides[emailer_dep] = lambda: mail
    yield TestClient(app, base_url="https://tracker.test"), mail
    app.dependency_overrides.clear()


def login(client: TestClient, mail: ConsoleEmailer, email="user@example.com", locale="en") -> str:
    r = client.post("/api/v1/auth/request-link", json={"email": email, "locale": locale}, headers=H)
    assert r.status_code == 202
    token = re.search(r"#token=([\w-]+)", mail.outbox[-1].text).group(1)
    r = client.post("/api/v1/auth/verify", json={"token": token}, headers=H)
    assert r.status_code == 200, r.text
    return token


def test_magic_link_signs_in_once(ctx):
    client, mail = ctx
    assert client.get("/api/v1/session").json() == {"me": None, "subscriptions": []}
    token = login(client, mail)
    assert client.get("/api/v1/session").json()["me"]["email"] == "user@example.com"
    assert mail.outbox[-1].subject == "Your Knesset Tracker sign-in link"
    assert "https://tracker.test/en/auth/verify#token=" in mail.outbox[-1].text
    me = client.get("/api/v1/me").json()
    assert me["email"] == "user@example.com" and me["digest_frequency"] == "daily"
    # the link is single use
    assert client.post("/api/v1/auth/verify", json={"token": token}, headers=H).status_code == 400
    client.post("/api/v1/auth/logout", headers=H)
    assert client.get("/api/v1/me").status_code == 401


def test_link_requests_are_validated_and_rate_limited(ctx):
    client, _ = ctx
    bad = client.post("/api/v1/auth/request-link", json={"email": "nope"}, headers=H)
    assert bad.status_code == 422
    for _ in range(5):
        assert client.post("/api/v1/auth/request-link", json={"email": "a@example.com"},
                           headers=H).status_code == 202
    assert client.post("/api/v1/auth/request-link", json={"email": "a@example.com"},
                       headers=H).status_code == 429


def test_state_changes_need_the_csrf_header(ctx):
    client, mail = ctx
    login(client, mail)
    r = client.post("/api/v1/me/subscriptions", json={"target_type": "bill", "target_id": BILL})
    assert r.status_code == 403


def test_follow_unfollow_and_settings(ctx):
    client, mail = ctx
    login(client, mail)
    r = client.post("/api/v1/me/subscriptions", json={"target_type": "bill", "target_id": BILL},
                    headers=H)
    assert r.status_code == 201 and "עבודת נשים" in r.json()["title"]["he"]
    again = client.post("/api/v1/me/subscriptions",
                        json={"target_type": "bill", "target_id": BILL}, headers=H)
    assert again.json()["id"] == r.json()["id"]  # following twice is a no-op
    kw = client.post("/api/v1/me/subscriptions",
                     json={"target_type": "keyword", "keyword": "חיילים בודדים"}, headers=H)
    assert kw.status_code == 201
    assert client.post("/api/v1/me/subscriptions", json={"target_type": "keyword", "keyword": "א"},
                       headers=H).status_code == 422
    assert client.post("/api/v1/me/subscriptions", json={"target_type": "bill", "target_id": 1},
                       headers=H).status_code == 404
    assert len(client.get("/api/v1/me/subscriptions").json()) == 2
    client.delete(f"/api/v1/me/subscriptions/{r.json()['id']}", headers=H)
    assert len(client.get("/api/v1/me/subscriptions").json()) == 1
    me = client.patch("/api/v1/me", json={"digest_frequency": "instant", "locale": "he"},
                      headers=H).json()
    assert me["digest_frequency"] == "instant" and me["locale"] == "he"
    assert client.patch("/api/v1/me", json={"digest_frequency": "hourly"},
                        headers=H).status_code == 422


def test_push_registration_and_account_deletion(ctx):
    client, mail = ctx
    login(client, mail)
    reg = {"endpoint": "https://push.test/abc", "keys": {"p256dh": "k", "auth": "a"}}
    assert client.post("/api/v1/me/push", json=reg, headers=H).json()["push_devices"] == 1
    assert client.post("/api/v1/me/push", json={**reg, "endpoint": "http://insecure"},
                       headers=H).status_code == 422
    client.post("/api/v1/me/subscriptions", json={"target_type": "mk", "target_id": 30879},
                headers=H)
    assert client.delete("/api/v1/me", headers=H).status_code == 204
    assert client.get("/api/v1/me").status_code == 401


def test_one_click_unsubscribe(ctx, settings):
    client, mail = ctx
    login(client, mail)
    uid = client.get("/api/v1/me").json()["id"]
    token = unsubscribe_token(settings, uid)
    # RFC 8058: the mail client POSTs, with no cookie and no CSRF header
    fresh = TestClient(app, base_url="https://tracker.test")
    assert fresh.post(f"/api/v1/unsubscribe?token={token}").status_code == 200
    assert client.get("/api/v1/me").json()["email_enabled"] is False
    assert fresh.post("/api/v1/unsubscribe?token=1.forged").status_code == 400
    page = fresh.get(f"/api/v1/unsubscribe?token={token}")
    assert page.status_code == 200 and "unsubscribed" in page.text


def test_session_cookie_is_signed_and_expires(settings):
    c = session_cookie(settings, 7, now=1_000_000)
    assert read_session(settings, c, now=1_000_001) == 7
    assert read_session(settings, c, now=1_000_000 + 31 * 24 * 3600) is None
    uid, exp, sig = c.split(".")
    assert read_session(settings, f"8.{exp}.{sig}", now=1_000_001) is None
    assert read_session(settings, "garbage", now=1) is None
