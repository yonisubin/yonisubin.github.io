"""Turn change events into plain sentences, in Hebrew and English, for alerts.

Each alert says exactly what changed: "Bill X passed its third reading on 3 Nov 2026".
Official names stay in Hebrew in both languages (the data has no English names).
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import Connection, select

from .entities import BY_NAME
from .stages import BILL_STATUS, DOCUMENT_GROUP, stage_for_status

T = {name: spec.table for name, spec in BY_NAME.items()}
IL = ZoneInfo("Asia/Jerusalem")
HE_MONTHS = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר",
             "אוקטובר", "נובמבר", "דצמבר"]

# Events worth telling people about. Others (e.g. a corrected summary) are recorded but
# don't notify, to keep alerts meaningful.
NOTIFY = {
    "bill.new", "bill.stage_changed", "bill_document.new", "bill_initiator.new", "vote.recorded",
    "committee_session.scheduled", "committee_session.rescheduled",
    "committee_session.status_changed", "mk.faction_changed", "query.new", "query.answered",
    "law.new",
}


@dataclass
class Described:
    he: str
    en: str
    path: str  # site path without the locale, e.g. /bills/123


def fmt_date(d: datetime | str | None, lang: str, with_time: bool = False) -> str:
    if d is None:
        return ""
    if isinstance(d, str):
        d = datetime.fromisoformat(d)
    d = d.astimezone(IL)
    t = f" {d:%H:%M}" if with_time else ""
    if lang == "he":
        return f"{d.day} ב{HE_MONTHS[d.month - 1]} {d.year}{t}"
    return f"{d.day} {d:%b} {d.year}{t}"


def _name(conn: Connection, entity: str, id_: Any, col: str = "name_he") -> str:
    if id_ is None:
        return ""
    t = T[entity]
    return conn.execute(select(t.c[col]).where(t.c.id == id_)).scalar() or ""


def _person(conn: Connection, id_: Any) -> str:
    t = T["KNS_Person"]
    r = conn.execute(select(t.c.first_name_he, t.c.last_name_he).where(t.c.id == id_)).first()
    return " ".join(p for p in (r or ()) if p) or f"#{id_}"


def _row(conn: Connection, entity: str, id_: int) -> dict[str, Any]:
    t = T[entity]
    r = conn.execute(select(t).where(t.c.id == id_)).mappings().first()
    return dict(r) if r else {}


def describe(conn: Connection, ev: dict[str, Any]) -> Described:
    et, eid = ev["event_type"], ev["entity_id"]
    after = ev.get("after") or {}
    when = ev.get("source_updated_at") or ev.get("detected_at")

    if et in ("bill.new", "bill.stage_changed"):
        bill = _row(conn, "KNS_Bill", eid)
        name = bill.get("name_he") or f"#{eid}"
        status_id = bill.get("status_id")
        status_he = _name(conn, "KNS_Status", status_id, "desc_he")
        status_en = BILL_STATUS[status_id][1] if status_id in BILL_STATUS else status_he
        if et == "bill.new":
            return Described(f"הצעת חוק חדשה: {name} ({status_he})",
                             f"New bill: {name} ({status_en})", f"/bills/{eid}")
        stage = stage_for_status(status_id)
        if stage and stage.key == "passed":
            return Described(f"{name} התקבלה בקריאה שלישית ב־{fmt_date(when, 'he')}",
                             f"{name} passed its third reading on {fmt_date(when, 'en')}",
                             f"/bills/{eid}")
        return Described(
            f"{name}: {status_he} ({fmt_date(when, 'he')})",
            f"{name} moved to: {status_en} ({stage.en if stage else ''}, {fmt_date(when, 'en')})"
            .replace(" (, ", " ("), f"/bills/{eid}")

    if et == "bill_document.new":
        doc = _row(conn, "KNS_DocumentBill", eid)
        bill_name = _name(conn, "KNS_Bill", doc.get("bill_id"))
        return Described(
            f"{bill_name}: מסמך חדש: {doc.get('group_type_desc_he') or ''}",
            f"{bill_name}: new document: "
            f"{DOCUMENT_GROUP.get(doc.get('group_type_id') or 0, doc.get('group_type_desc_he'))}",
            f"/bills/{doc.get('bill_id')}")

    if et == "bill_initiator.new":
        r = _row(conn, "KNS_BillInitiator", eid)
        bill_name = _name(conn, "KNS_Bill", r.get("bill_id"))
        who = _person(conn, r.get("person_id"))
        return Described(f"{who} יזם/ה את {bill_name}" if r.get("is_initiator")
                         else f"{who} הצטרף/ה ליוזמי {bill_name}",
                         f"{who} {'initiated' if r.get('is_initiator') else 'joined'}: {bill_name}",
                         f"/bills/{r.get('bill_id')}")

    if et == "vote.recorded":
        v = _row(conn, "KNS_PlenumVote", eid)
        title = v.get("title_he") or ""
        return Described(f"הצבעה במליאה ({fmt_date(v.get('voted_at'), 'he')}): {title}",
                         f"Plenum vote on {fmt_date(v.get('voted_at'), 'en')}: {title}",
                         f"/bills/{v.get('item_id')}")

    if et.startswith("committee_session."):
        s = _row(conn, "KNS_CommitteeSession", eid)
        cname = _name(conn, "KNS_Committee", s.get("committee_id"))
        start_he = fmt_date(s.get("start_at"), "he", True)
        start_en = fmt_date(s.get("start_at"), "en", True)
        path = f"/committees/{s.get('committee_id')}"
        if et == "committee_session.scheduled":
            return Described(f"{cname}: נקבעה ישיבה ל־{start_he}",
                             f"{cname}: session scheduled for {start_en}", path)
        if et == "committee_session.rescheduled":
            return Described(f"{cname}: הישיבה הועברה ל־{start_he}",
                             f"{cname}: session moved to {start_en}", path)
        cancelled = s.get("status_desc_he") == "מבוטלת"
        return Described(f"{cname}: הישיבה של {start_he} {'בוטלה' if cancelled else 'עודכנה'}",
                         f"{cname}: the session on {start_en} was "
                         f"{'cancelled' if cancelled else 'updated'}", path)

    if et == "mk.faction_changed":
        p = _row(conn, "KNS_PersonToPosition", eid)
        who = _person(conn, p.get("person_id"))
        return Described(f"{who}: חבר/ה בסיעת {p.get('faction_name_he')} "
                         f"מ־{fmt_date(p.get('start_date'), 'he')}",
                         f"{who}: member of the faction {p.get('faction_name_he')} from "
                         f"{fmt_date(p.get('start_date'), 'en')}", f"/mks/{p.get('person_id')}")

    if et in ("query.new", "query.answered"):
        q = _row(conn, "KNS_Query", eid)
        who = _person(conn, q.get("person_id"))
        if et == "query.new":
            return Described(f"{who} הגיש/ה שאילתה: {q.get('name_he')}",
                             f"{who} submitted a parliamentary question: {q.get('name_he')}",
                             f"/mks/{q.get('person_id')}")
        return Described(f"השאילתה של {who} נענתה ({fmt_date(after.get('reply_at'), 'he')}): "
                         f"{q.get('name_he')}",
                         f"{who}'s parliamentary question was answered on "
                         f"{fmt_date(after.get('reply_at'), 'en')}: {q.get('name_he')}",
                         f"/mks/{q.get('person_id')}")

    if et == "law.new":
        name = _name(conn, "KNS_IsraelLaw", eid)
        return Described(f"חוק חדש: {name}", f"New law: {name}", "/search?q=" + name)

    return Described(et, et, "/")

