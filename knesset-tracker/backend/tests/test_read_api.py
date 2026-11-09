"""The public read API, against the recorded fixtures plus the synthetic day 2."""
from __future__ import annotations

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from app.api import conn_dep
from app.main import app
from app.stages import BILL_STATUS, STAGES
from app.sync import run_sync
from tests.conftest import FakeOData, apply_day2, fixture_entities, load_day1, make_client

PASSED_BILL = 2196528  # the real bill recorded in the fixtures (passed in Jan 2026)


@pytest.fixture
def client(engine, settings) -> Iterator[TestClient]:
    day1 = load_day1()
    server = FakeOData(day1)
    run_sync(engine, make_client(server), settings, fixture_entities(day1))
    server.store, _ = apply_day2(day1)
    run_sync(engine, make_client(server), settings, fixture_entities(day1))

    def conn():
        with engine.connect() as c:
            yield c

    app.dependency_overrides[conn_dep] = conn
    yield TestClient(app)
    app.dependency_overrides.clear()


def test_every_bill_status_has_a_stage_and_translation():
    day1 = load_day1()
    bill_statuses = {s["Id"] for s in day1["KNS_Status"].values() if s["TypeID"] == 2}
    assert bill_statuses <= set(BILL_STATUS), bill_statuses - set(BILL_STATUS)
    for key, en in BILL_STATUS.values():
        assert key in STAGES and en


def test_bill_page_reconstructs_the_timeline(client):
    b = client.get(f"/api/v1/bills/{PASSED_BILL}").json()
    assert b["stage"]["key"] == "passed"
    assert b["status"] == {"id": 118, "he": "התקבלה בקריאה שלישית",
                           "en": "Passed in the third reading", "en_translated": True}
    kinds = [e["kind"] for e in b["timeline"]]
    assert kinds.count("vote") == 4
    dates = [e["date"] for e in b["timeline"]]
    assert dates == sorted(dates)
    stages = [e["stage"]["key"] for e in b["timeline"] if e["kind"] == "plenum_agenda"]
    # tabled -> preliminary -> first reading -> second/third, in that order
    order = [STAGES[s].order for s in stages]
    assert order == sorted(order) and stages[0] == "tabled"
    assert b["initiators"] and all(i["name"]["he"] for i in b["initiators"])
    assert b["source"].endswith(f"KNS_Bill?$filter=Id%20eq%20{PASSED_BILL}")
    urls = [d["url"] for d in b["documents"]]
    assert len(urls) == len(set(urls)) and all("\\" not in u for u in urls)


def test_detected_status_change_appears_on_the_timeline(client):
    changes = client.get("/api/v1/changes").json()
    staged = [c for c in changes if c["event_type"] == "bill.stage_changed"]
    assert len(staged) == 1
    b = client.get(f"/api/v1/bills/{staged[0]['bill_id']}").json()
    assert b["timeline"][-1]["kind"] == "status_change"
    assert b["timeline"][-1]["status"]["id"] == 109


def test_bill_list_filters_and_paginates(client):
    all_ = client.get("/api/v1/bills?per_page=2").json()
    assert all_["total"] == 6 and len(all_["items"]) == 2 and all_["pages"] == 3
    passed = client.get("/api/v1/bills?stage=passed").json()
    assert [b["id"] for b in passed["items"]] == [PASSED_BILL]
    assert client.get("/api/v1/bills?stage=nonsense").status_code == 422
    initiator = client.get(f"/api/v1/bills/{PASSED_BILL}").json()["initiators"][0]["person_id"]
    mine = client.get(f"/api/v1/bills?initiator={initiator}").json()
    assert PASSED_BILL in [b["id"] for b in mine["items"]]


def test_mk_page_has_the_same_sections_for_everyone(client):
    initiators = client.get(f"/api/v1/bills/{PASSED_BILL}").json()["initiators"]
    keys = None
    for i in initiators[:5]:
        mk = client.get(f"/api/v1/mks/{i['person_id']}").json()
        assert keys is None or set(mk) == keys  # equal treatment: same fields for every MK
        keys = set(mk)
        assert mk["votes"]["note"]["en"].startswith("Only recorded votes")
    assert client.get("/api/v1/mks/1").status_code == 404


def test_committee_page_and_calendar(client):
    committee_id = client.get(f"/api/v1/bills/{PASSED_BILL}").json()["committee"]["id"]
    c = client.get(f"/api/v1/committees/{committee_id}").json()
    assert c["name"]["he"]
    ics = client.get(f"/api/v1/committees/{committee_id}/calendar.ics")
    assert ics.status_code == 200 and ics.headers["content-type"].startswith("text/calendar")
    assert ics.text.startswith("BEGIN:VCALENDAR\r\n") and ics.text.endswith("END:VCALENDAR\r\n")
    assert all(len(line.encode()) <= 75 for line in ics.text.split("\r\n"))


def test_meta_lists_stages_in_order(client):
    m = client.get("/api/v1/meta").json()
    assert [s["order"] for s in m["stages"]] == sorted(s["order"] for s in m["stages"])
    assert m["current_knesset"] == 25  # no period is marked current in the fixtures: newest term
