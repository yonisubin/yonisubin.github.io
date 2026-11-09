"""Public read API, v1. Paginated JSON with English field names; Hebrew values are
returned as published, English ones are flagged when the project translated them."""
from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import Connection, Engine

from . import read
from .db import get_engine
from .stages import STAGES

router = APIRouter(prefix="/api/v1", tags=["read"])


def conn_dep(engine: Engine = Depends(lambda: get_engine())) -> Any:
    with engine.connect() as conn:
        yield conn


def cache(response: Response, seconds: int = 300) -> None:
    # Data changes at most every 30 minutes (the sync interval).
    response.headers["Cache-Control"] = f"public, max-age={seconds}"


@router.get("/meta")
def meta(response: Response, conn: Connection = Depends(conn_dep)) -> dict[str, Any]:
    cache(response, 60)
    return read.meta(conn)


@router.get("/bills")
def bills(response: Response, conn: Connection = Depends(conn_dep),
          knesset: int | None = None,
          stage: str | None = Query(None, description="stage key, see /meta"),
          committee: int | None = None, initiator: int | None = None,
          type: int | None = Query(None, description="53 government, 54 private, 55 committee"),
          page: int = Query(1, ge=1), per_page: int = Query(20, ge=1, le=100)
          ) -> dict[str, Any]:
    if stage and stage not in STAGES:
        raise HTTPException(422, f"unknown stage {stage!r}")
    cache(response)
    return read.list_bills(conn, knesset=knesset, stage=stage, committee_id=committee,
                           initiator=initiator, bill_type=type, page=page, per_page=per_page)


@router.get("/bills/{bill_id}")
def bill(bill_id: int, response: Response, conn: Connection = Depends(conn_dep)
         ) -> dict[str, Any]:
    out = read.get_bill(conn, bill_id)
    if out is None:
        raise HTTPException(404, "no such bill")
    cache(response)
    return out


@router.get("/mks")
def mks(response: Response, conn: Connection = Depends(conn_dep), knesset: int | None = None
        ) -> dict[str, Any]:
    k = knesset or read.meta(conn)["current_knesset"]
    cache(response)
    return {"knesset": k, "items": read.list_mks(conn, k)}


@router.get("/mks/{person_id}")
def mk(person_id: int, response: Response, conn: Connection = Depends(conn_dep)
       ) -> dict[str, Any]:
    out = read.get_mk(conn, person_id)
    if out is None:
        raise HTTPException(404, "no such person")
    cache(response)
    return out


@router.get("/committees")
def committees(response: Response, conn: Connection = Depends(conn_dep),
               knesset: int | None = None) -> dict[str, Any]:
    k = knesset or read.meta(conn)["current_knesset"]
    cache(response)
    return {"knesset": k, "items": read.list_committees(conn, k)}


@router.get("/committees/{committee_id}")
def committee(committee_id: int, response: Response, conn: Connection = Depends(conn_dep),
              page: int = Query(1, ge=1), per_page: int = Query(20, ge=1, le=100)
              ) -> dict[str, Any]:
    out = read.get_committee(conn, committee_id, now=datetime.now(UTC), page=page,
                             per_page=per_page)
    if out is None:
        raise HTTPException(404, "no such committee")
    cache(response)
    return out


@router.get("/changes")
def changes(response: Response, conn: Connection = Depends(conn_dep),
            limit: int = Query(20, ge=1, le=100)) -> list[dict[str, Any]]:
    cache(response, 60)
    return read.recent_changes(conn, limit)


def _ics_escape(s: str) -> str:
    return (s.replace("\\", "\\\\").replace(";", "\;").replace(",", "\\,")
            .replace("\r\n", "\\n").replace("\n", "\\n"))


def _ics_fold(line: str) -> str:
    # RFC 5545: lines longer than 75 octets are folded; never split a UTF-8 character.
    out: list[str] = []
    cur = ""
    for ch in line:
        if len((cur + ch).encode()) > (75 if not out else 74):
            out.append(cur)
            cur = ""
        cur += ch
    out.append(cur)
    return "\r\n ".join(out)


@router.get("/committees/{committee_id}/calendar.ics", response_class=Response)
def committee_calendar(committee_id: int, conn: Connection = Depends(conn_dep)) -> Response:
    """Subscribable iCal feed of a committee's sessions (last 90 days and all upcoming)."""
    now = datetime.now(UTC)
    c = read.get_committee(conn, committee_id, now=now, per_page=100)
    if c is None:
        raise HTTPException(404, "no such committee")
    sessions = c["upcoming"] + [s for s in c["past"]["items"]
                                if s["start"] and (now - s["start"]).days <= 90]
    stamp = now.strftime("%Y%m%dT%H%M%SZ")
    lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Knesset Tracker//HE",
             "CALSCALE:GREGORIAN", f"X-WR-CALNAME:{_ics_escape(c['name']['he'] or '')}"]
    for s in sessions:
        if not s["start"]:
            continue
        start = s["start"].astimezone(UTC)
        end = (s["finish"] or s["start"]).astimezone(UTC)
        if end <= start:
            end = start + timedelta(hours=2)  # the API often has no finish time
        agenda = "\n".join(i["name"]["he"] or "" for i in s["items"])
        lines += [
            "BEGIN:VEVENT", f"UID:committee-session-{s['id']}@knesset-tracker",
            f"DTSTAMP:{stamp}", f"DTSTART:{start:%Y%m%dT%H%M%SZ}", f"DTEND:{end:%Y%m%dT%H%M%SZ}",
            f"SUMMARY:{_ics_escape(c['name']['he'] or '')}",
            f"DESCRIPTION:{_ics_escape(agenda)}",
            *( [f"LOCATION:{_ics_escape(s['location'])}"] if s["location"] else []),
            *( [f"URL:{s['session_url']}"] if s["session_url"] else []),
            f"STATUS:{'CANCELLED' if s['cancelled'] else 'CONFIRMED'}", "END:VEVENT",
        ]
    lines.append("END:VCALENDAR")
    body = "\r\n".join(_ics_fold(line) for line in lines) + "\r\n"
    return Response(body, media_type="text/calendar; charset=utf-8",
                    headers={"Cache-Control": "public, max-age=900"})
