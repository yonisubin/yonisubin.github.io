from __future__ import annotations

from fastapi.testclient import TestClient

from app.api import conn_dep
from app.config import Settings, get_settings
from app.main import app, client_dep, engine_dep
from tests.conftest import FakeOData, fixture_entities, load_day1, make_client


def test_internal_endpoints_require_the_token(engine, settings):
    app.dependency_overrides[get_settings] = lambda: settings
    app.dependency_overrides[engine_dep] = lambda: engine
    try:
        c = TestClient(app)
        assert c.post("/internal/sync").status_code == 401
        assert c.post("/internal/sync", headers={"X-Internal-Token": "wrong"}).status_code == 401
        app.dependency_overrides[get_settings] = lambda: Settings(
            database_url=settings.database_url, internal_token="")
        # no token configured: refuse everything
        assert c.post("/internal/sync", headers={"X-Internal-Token": ""}).status_code == 401
    finally:
        app.dependency_overrides.clear()


def test_sync_endpoint_runs_and_status_reports(engine, settings, monkeypatch):
    day1 = load_day1()
    monkeypatch.setattr("app.main.ENTITIES", fixture_entities(day1))
    monkeypatch.setattr("app.sync.ENTITIES", fixture_entities(day1))
    app.dependency_overrides[get_settings] = lambda: settings
    app.dependency_overrides[engine_dep] = lambda: engine
    app.dependency_overrides[client_dep] = lambda: make_client(FakeOData(day1))

    def conn():
        with engine.connect() as c:
            yield c

    app.dependency_overrides[conn_dep] = conn
    try:
        c = TestClient(app)
        r = c.post("/internal/sync", headers={"X-Internal-Token": "secret"})
        assert r.status_code == 200, r.text
        assert all(run["pass_completed"] for run in r.json()["runs"])
        assert r.json()["alerts"]["notifications_created"] == 0  # no subscribers yet
        status = c.get("/api/v1/status").json()
        assert all(e["data_up_to"] for e in status["entities"] if e["last_success"])
    finally:
        app.dependency_overrides.clear()
