"""Test helpers: a fake OData server that replays recorded fixtures, and a fresh
Postgres schema per test (set TEST_DATABASE_URL; integration tests skip without it)."""
from __future__ import annotations

import copy
import json
import os
import re
from collections.abc import Iterator
from datetime import datetime
from pathlib import Path
from typing import Any

import httpx
import pytest
from sqlalchemy import Engine, create_engine, text

import app.entities  # noqa: F401 - registers domain tables
from app.config import Settings
from app.entities import ENTITIES, EntitySpec
from app.models import metadata
from app.odata import ODataClient

FIXTURES = Path(__file__).parent / "fixtures"
BASE = "https://odata.test/ParliamentInfo/"
DAY2_STAMP = "2026-11-10T10:00:00+02:00"
TEST_DB = os.environ.get("TEST_DATABASE_URL",
                         "postgresql+psycopg://postgres@localhost/knesset_test")

Store = dict[str, dict[int, dict[str, Any]]]


def load_day1() -> Store:
    return {p.stem: {r["Id"]: r for r in json.loads(p.read_text())}
            for p in sorted((FIXTURES / "day1").glob("*.json"))}


def fixture_entities(store: Store) -> list[EntitySpec]:
    return [e for e in ENTITIES if e.odata in store]


def apply_day2(day1: Store) -> tuple[Store, set[tuple[str, int, str]]]:
    """Synthetic but realistic changes on top of the real day-1 records.
    Returns the new store and the exact set of events the sync must produce."""
    s = copy.deepcopy(day1)
    expected: set[tuple[str, int, str]] = set()

    def touch(row: dict[str, Any], **changes: Any) -> dict[str, Any]:
        row.update(changes, LastUpdatedDate=DAY2_STAMP)
        return row

    open_bills = [b for b in s["KNS_Bill"].values() if b["StatusID"] == 108]
    # 1. a bill moves on: approved in committee for first reading
    touch(open_bills[0], StatusID=109)
    expected.add(("bill", open_bills[0]["Id"], "bill.stage_changed"))
    # 2. a new bill is tabled
    new_bill = touch(copy.deepcopy(open_bills[1]), Id=9_999_001, Name="הצעת חוק בדיקה, 2026",
                     StatusID=104)
    s["KNS_Bill"][new_bill["Id"]] = new_bill
    expected.add(("bill", new_bill["Id"], "bill.new"))
    # 3. a committee session is scheduled
    session = copy.deepcopy(next(iter(s["KNS_CommitteeSession"].values())))
    touch(session, Id=9_999_002, StartDate="2026-11-12T10:00:00+02:00")
    s["KNS_CommitteeSession"][session["Id"]] = session
    expected.add(("committee_session", session["Id"], "committee_session.scheduled"))
    # 4. an MK moves to another faction
    pos = copy.deepcopy(next(r for r in s["KNS_PersonToPosition"].values() if r["FactionID"]))
    other = next(f for f in s["KNS_Faction"].values() if f["Id"] != pos["FactionID"])
    touch(pos, Id=9_999_003, FactionID=other["Id"], FactionName=other["Name"],
          StartDate=DAY2_STAMP, FinishDate=None)
    s["KNS_PersonToPosition"][pos["Id"]] = pos
    expected.add(("person_position", pos["Id"], "mk.faction_changed"))
    # 5. a minister answers a parliamentary question
    q = next(iter(s["KNS_Query"].values()))
    touch(q, ReplyMinisterDate="2026-11-09T00:00:00+02:00")
    expected.add(("parl_query", q["Id"], "query.answered"))
    # 6. noise that must NOT produce events:
    #    a cascade that only bumps LastUpdatedDate, and a change in an unmapped field
    touch(next(iter(s["KNS_PlmSessionItem"].values())))
    touch(open_bills[2], PublicationSeriesFirstCallDesc="שונה")
    return s, expected


class FakeOData:
    """Implements just enough OData: LastUpdatedDate gt filter, ordering, $skip paging."""

    def __init__(self, store: Store, page_size: int = 3) -> None:
        self.store = store
        self.page_size = page_size
        self.requests: list[str] = []
        self.fail_next = 0  # respond with an empty 200 (server-side timeout) this many times

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(str(request.url))
        if self.fail_next:
            self.fail_next -= 1
            return httpx.Response(200, content=b"")
        entity = request.url.path.rstrip("/").split("/")[-1]
        if entity not in self.store:
            return httpx.Response(404, json={"error": "no such entity"})
        params = request.url.params
        rows = list(self.store[entity].values())
        m = re.search(r"LastUpdatedDate gt (\S+?)\)?(?:\s|$)", params.get("$filter", ""))
        if m:
            bound = datetime.fromisoformat(m.group(1).replace("Z", "+00:00"))
            rows = [r for r in rows if datetime.fromisoformat(r["LastUpdatedDate"]) > bound]
        if "LastUpdatedDate" in params.get("$orderby", ""):
            rows.sort(key=lambda r: (datetime.fromisoformat(r["LastUpdatedDate"]), r["Id"]))
        else:
            rows.sort(key=lambda r: r["Id"])
        skip = int(params.get("$skip", 0))
        page = rows[skip: skip + self.page_size]
        body: dict[str, Any] = {"value": page}
        if skip + self.page_size < len(rows):
            body["@odata.nextLink"] = str(request.url.copy_set_param("$skip",
                                                                    skip + self.page_size))
        return httpx.Response(200, json=body)


def make_client(server: FakeOData) -> ODataClient:
    return ODataClient(BASE, transport=httpx.MockTransport(server), min_interval=0,
                       backoff_base=0, sleep=lambda _s: None)


@pytest.fixture
def settings() -> Settings:
    return Settings(database_url=TEST_DB, odata_base_url=BASE, internal_token="secret",
                    time_budget_seconds=60, min_request_interval=0)


@pytest.fixture
def engine() -> Iterator[Engine]:
    eng = create_engine(TEST_DB)
    try:
        with eng.connect() as conn:
            conn.execute(text("SELECT 1"))
    except Exception as e:  # noqa: BLE001
        pytest.skip(f"no test database at {TEST_DB}: {e}")
    metadata.drop_all(eng)
    metadata.create_all(eng)
    yield eng
    eng.dispose()
