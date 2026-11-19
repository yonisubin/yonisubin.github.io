from __future__ import annotations

from datetime import UTC, datetime

import httpx
import pytest

from app.entities import BY_NAME, bill_events, committee_session_events, query_events, to_url
from app.odata import ODataClient, ODataError, build_url, odata_datetime
from app.sync import SchemaChanged, check_schema, content_hash


def test_hash_ignores_last_updated_date_and_key_order():
    a = {"Id": 1, "Name": "x", "LastUpdatedDate": "2026-01-01T00:00:00+02:00"}
    b = {"LastUpdatedDate": "2026-02-02T00:00:00+02:00", "Name": "x", "Id": 1}
    assert content_hash(a) == content_hash(b)
    assert content_hash(a) != content_hash({**a, "Name": "y"})


def test_bill_transform_normalises_values():
    raw = {"Id": 5, "KnessetNum": 25, "Name": "  הצעת חוק  ", "StatusID": 118,
           "PublicationDate": "2026-01-07T15:38:00+02:00", "SummaryLaw": "",
           "LastUpdatedDate": "2026-11-03T08:43:38.87+02:00"}
    row = BY_NAME["KNS_Bill"].transform(raw)
    assert row["id"] == 5 and row["name_he"] == "הצעת חוק"
    assert row["summary_he"] is None  # empty strings become NULL
    assert row["publication_date"] == datetime(2026, 1, 7, 13, 38, tzinfo=UTC)
    assert row["committee_id"] is None  # absent fields become NULL
    assert BY_NAME["KNS_Bill"].transform({**raw, "CommitteeID": -1})["committee_id"] is None


def test_document_urls_use_forward_slashes():
    assert to_url(r"https://fs.knesset.gov.il/25\law\25_ls1_1.pdf") == \
        "https://fs.knesset.gov.il/25/law/25_ls1_1.pdf"


def test_event_classification():
    assert bill_events(None, {"status_id": 104}) == ["bill.new"]
    assert bill_events({"status_id": 108}, {"status_id": 109}) == ["bill.stage_changed"]
    assert bill_events({"status_id": 108, "name_he": "a"},
                       {"status_id": 108, "name_he": "b"}) == ["bill.updated"]
    assert committee_session_events(None, {}) == ["committee_session.scheduled"]
    assert committee_session_events({"status_id": 1, "start_at": 1},
                                    {"status_id": 1, "start_at": 2}) == \
        ["committee_session.rescheduled"]
    assert query_events({"reply_at": None}, {"reply_at": "x"}) == ["query.answered"]


def test_schema_check_rejects_missing_fields():
    rows = [{"Id": 1, "Desc": "x", "TypeID": 1, "TypeDesc": "y", "IsActive": True,
             "LastUpdatedDate": None}]
    check_schema(BY_NAME["KNS_Status"], rows)
    del rows[0]["TypeDesc"]
    with pytest.raises(SchemaChanged, match="TypeDesc"):
        check_schema(BY_NAME["KNS_Status"], rows)


def test_build_url_encodes_spaces_and_combines_filters():
    url = build_url("https://x/P/", "KNS_Bill", filters=["KnessetNum ge 23",
                    f"LastUpdatedDate gt {odata_datetime(datetime(2026, 1, 1, tzinfo=UTC))}"],
                    orderby="LastUpdatedDate asc,Id asc")
    assert url == ("https://x/P/KNS_Bill?$filter=(KnessetNum%20ge%2023)%20and%20"
                   "(LastUpdatedDate%20gt%202026-01-01T00:00:00Z)"
                   "&$orderby=LastUpdatedDate%20asc,Id%20asc")


def _client(handler) -> ODataClient:
    return ODataClient("https://x/", transport=httpx.MockTransport(handler), min_interval=0,
                       backoff_base=0, sleep=lambda _s: None, max_retries=3)


def test_client_retries_empty_200_then_succeeds():
    calls = []

    def handler(req):
        calls.append(req)
        if len(calls) < 3:
            return httpx.Response(200, content=b"")  # what a server-side timeout looks like
        return httpx.Response(200, json={"value": [{"Id": 1}]})

    assert _client(handler).get_page("https://x/E").rows == [{"Id": 1}]
    assert len(calls) == 3


def test_client_gives_up_and_does_not_retry_client_errors():
    with pytest.raises(ODataError, match="giving up"):
        _client(lambda r: httpx.Response(503)).get_page("https://x/E")
    calls = []

    def not_found(req):
        calls.append(req)
        return httpx.Response(404)

    with pytest.raises(ODataError, match="404"):
        _client(not_found).get_page("https://x/E")
    assert len(calls) == 1
