"""Read side: queries behind the public JSON API (English field names).

Every object carries a `source` link to its official record, so each fact on the
site can be traced back to the Knesset's own data.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import Connection, and_, func, or_, select, true

from .config import get_settings
from .entities import BY_NAME
from .models import change_event, sync_run, sync_state
from .quality import issues_for
from .stages import (
    BILL_NAME_STAGE,
    BILL_STATUS,
    BILL_SUBTYPE,
    BILL_SUBTYPE_HE,
    COMMITTEE_POSITIONS,
    COMMITTEE_SESSION_CANCELLED,
    COMMITTEE_TYPE,
    DOCUMENT_GROUP,
    FACTION_POSITIONS,
    GOVERNMENT_POSITIONS,
    MK_POSITIONS,
    POSITION,
    QUERY_STATUS,
    STAGES,
    VOTE_RESULT,
    VOTE_RESULT_HE,
    Stage,
    stage_for_status,
    translated,
)

T = {name: spec.table for name, spec in BY_NAME.items()}
bill, bill_init, bill_name, bill_doc = (T["KNS_Bill"], T["KNS_BillInitiator"],
                                        T["KNS_BillName"], T["KNS_DocumentBill"])
person, ptp, faction = T["KNS_Person"], T["KNS_PersonToPosition"], T["KNS_Faction"]
committee, csession, citem = (T["KNS_Committee"], T["KNS_CommitteeSession"],
                              T["KNS_CmtSessionItem"])
psession, pitem = T["KNS_PlenumSession"], T["KNS_PlmSessionItem"]
vote, vote_result, query = T["KNS_PlenumVote"], T["KNS_PlenumVoteResult"], T["KNS_Query"]
status, period, ministry = T["KNS_Status"], T["KNS_KnessetDates"], T["KNS_GovMinistry"]

ITEM_TYPE_BILL = 2


def source(entity: str, id_: int) -> str:
    base = get_settings().odata_base_url.rstrip("/")
    return f"{base}/{entity}?$filter=Id%20eq%20{id_}"


def stage_json(stage: Stage | None) -> dict[str, Any] | None:
    if stage is None:
        return None
    return {"key": stage.key, "order": stage.order, "name": translated(stage.he, stage.en),
            "next": translated(stage.next_he, stage.next_en)}


def status_json(status_id: int | None, desc_he: str | None) -> dict[str, Any] | None:
    if status_id is None:
        return None
    en = BILL_STATUS.get(status_id, (None, None))[1]
    return {"id": status_id, **translated(desc_he, en)}


def person_name(r: Any, prefix: str = "") -> dict[str, Any]:
    first, last = r[f"{prefix}first_name_he"], r[f"{prefix}last_name_he"]
    return {"he": " ".join(p for p in (first, last) if p) or None,
            "first_he": first, "last_he": last}


def page_params(page: int, per_page: int) -> tuple[int, int]:
    per_page = max(1, min(per_page, 100))
    return per_page, (max(page, 1) - 1) * per_page


def paged(items: list[Any], total: int, page: int, per_page: int) -> dict[str, Any]:
    return {"items": items, "page": max(page, 1), "per_page": per_page, "total": total,
            "pages": (total + per_page - 1) // per_page}


# ---------------------------------------------------------------- meta

def meta(conn: Connection) -> dict[str, Any]:
    current = conn.execute(select(period.c.knesset_num).where(period.c.is_current)
                           .order_by(period.c.id.desc()).limit(1)).scalar()
    terms = [r[0] for r in conn.execute(
        select(bill.c.knesset_num).distinct().order_by(bill.c.knesset_num.desc()))]
    last_sync = conn.execute(select(func.max(sync_state.c.last_pass_completed_at))).scalar()
    terms = [t for t in terms if t is not None]
    return {
        # fall back to the newest term we hold if no period is marked current
        "current_knesset": current or (terms[0] if terms else None), "knesset_terms": terms,
        "last_sync": last_sync,
        "stages": [stage_json(s) for s in sorted(STAGES.values(), key=lambda s: s.order)],
        "bill_types": [{"id": k, **translated(BILL_SUBTYPE_HE[k], v)}
                       for k, v in BILL_SUBTYPE.items()],
    }


# ---------------------------------------------------------------- bills

def _bill_row(r: Any) -> dict[str, Any]:
    return {
        "id": r["id"], "knesset": r["knesset_num"], "name": {"he": r["name_he"]},
        "type": {"id": r["sub_type_id"], **translated(r["sub_type_desc_he"],
                                                      BILL_SUBTYPE.get(r["sub_type_id"]))},
        "status": status_json(r["status_id"], r["status_desc_he"]),
        "stage": stage_json(stage_for_status(r["status_id"])),
        "committee": ({"id": r["committee_id"], "name": {"he": r["committee_name_he"]}}
                      if r["committee_id"] else None),
        "last_updated": r["last_updated"],
        "source": source("KNS_Bill", r["id"]),
    }


def _bill_select() -> Any:
    return (select(bill, status.c.desc_he.label("status_desc_he"),
                   committee.c.name_he.label("committee_name_he"))
            .select_from(bill.outerjoin(status, status.c.id == bill.c.status_id)
                         .outerjoin(committee, committee.c.id == bill.c.committee_id)))


def list_bills(conn: Connection, *, knesset: int | None = None, stage: str | None = None,
               committee_id: int | None = None, initiator: int | None = None,
               bill_type: int | None = None, page: int = 1, per_page: int = 20
               ) -> dict[str, Any]:
    conds = []
    if knesset:
        conds.append(bill.c.knesset_num == knesset)
    if stage:
        ids = [sid for sid, (key, _en) in BILL_STATUS.items() if key == stage]
        conds.append(bill.c.status_id.in_(ids))
    if committee_id:
        conds.append(bill.c.committee_id == committee_id)
    if bill_type:
        conds.append(bill.c.sub_type_id == bill_type)
    if initiator:
        conds.append(bill.c.id.in_(select(bill_init.c.bill_id)
                                   .where(bill_init.c.person_id == initiator)))
    where = and_(true(), *conds)
    per_page, offset = page_params(page, per_page)
    total = conn.execute(select(func.count()).select_from(bill).where(where)).scalar_one()
    rows = conn.execute(_bill_select().where(where)
                        .order_by(bill.c.last_updated.desc().nulls_last(), bill.c.id.desc())
                        .limit(per_page).offset(offset)).mappings()
    return paged([_bill_row(r) for r in rows], total, page, per_page)


def bill_timeline(conn: Connection, bill_id: int) -> list[dict[str, Any]]:
    """Reconstruct a bill's journey from dated records (DATA_MEMO: KNS_Bill has no history).

    - plenum agenda items: the bill's status at each plenum session;
    - committee agenda items: each committee session that discussed it;
    - plenum votes on the bill;
    - status changes our own sync detected (going forward from the first sync).
    """
    events: list[dict[str, Any]] = []
    for r in conn.execute(
            select(pitem.c.id, pitem.c.status_id, psession.c.id.label("session_id"),
                   psession.c.start_at, status.c.desc_he)
            .select_from(pitem.join(psession, psession.c.id == pitem.c.session_id)
                         .outerjoin(status, status.c.id == pitem.c.status_id))
            .where(pitem.c.item_type_id == ITEM_TYPE_BILL, pitem.c.item_id == bill_id)
    ).mappings():
        events.append({
            "kind": "plenum_agenda", "date": r["start_at"],
            "stage": stage_json(stage_for_status(r["status_id"])),
            "status": status_json(r["status_id"], r["desc_he"]),
            "session_id": r["session_id"],
            "source": source("KNS_PlmSessionItem", r["id"]),
        })
    for r in conn.execute(
            select(citem.c.id, citem.c.status_id, csession.c.id.label("session_id"),
                   csession.c.start_at, csession.c.status_id.label("session_status"),
                   csession.c.session_url, committee.c.id.label("committee_id"),
                   committee.c.name_he.label("committee_name_he"))
            .select_from(citem.join(csession, csession.c.id == citem.c.session_id)
                         .outerjoin(committee, committee.c.id == csession.c.committee_id))
            .where(citem.c.item_type_id == ITEM_TYPE_BILL, citem.c.item_id == bill_id)
    ).mappings():
        events.append({
            "kind": "committee_session", "date": r["start_at"],
            "stage": stage_json(stage_for_status(r["status_id"])),
            "committee": {"id": r["committee_id"], "name": {"he": r["committee_name_he"]}},
            "cancelled": r["session_status"] == COMMITTEE_SESSION_CANCELLED,
            "session_id": r["session_id"], "session_url": r["session_url"],
            "source": source("KNS_CmtSessionItem", r["id"]),
        })
    for r in conn.execute(select(vote).where(vote.c.item_id == bill_id)).mappings():
        events.append({"kind": "vote", "date": r["voted_at"], **_vote_json(conn, r)})
    for r in conn.execute(
            select(change_event).where(change_event.c.entity_type == "bill",
                                       change_event.c.entity_id == bill_id,
                                       change_event.c.event_type == "bill.stage_changed")
    ).mappings():
        new = (r["after"] or {}).get("status_id")
        events.append({
            "kind": "status_change", "date": r["source_updated_at"] or r["detected_at"],
            "detected_at": r["detected_at"],
            "stage": stage_json(stage_for_status(new)),
            "status": status_json(new, conn.execute(
                select(status.c.desc_he).where(status.c.id == new)).scalar()),
        })
    events.sort(key=lambda e: (e["date"] is None, e["date"] or datetime.min))
    return events


def _vote_json(conn: Connection, r: Any) -> dict[str, Any]:
    counts: dict[Any, Any] = dict(conn.execute(
        select(vote_result.c.result_code, func.count()).where(vote_result.c.vote_id == r["id"])
        .group_by(vote_result.c.result_code)).all())
    return {
        "id": r["id"], "title": {"he": r["title_he"]}, "subject": {"he": r["subject_he"]},
        "session_id": r["session_id"],
        # Only MKs with a recorded vote appear in the data (DATA_MEMO finding 4).
        "recorded": {"for": counts.get(7, 0), "against": counts.get(8, 0),
                     "abstained": counts.get(9, 0)} if counts else None,
        "source": source("KNS_PlenumVote", r["id"]),
    }


def get_bill(conn: Connection, bill_id: int) -> dict[str, Any] | None:
    r = conn.execute(_bill_select().where(bill.c.id == bill_id)).mappings().first()
    if r is None:
        return None
    out = _bill_row(r)
    out |= {
        "number": r["number"], "private_number": r["private_number"],
        "summary": {"he": r["summary_he"]},
        "postponement_reason": {"he": r["postponement_reason_he"]},
        "publication": ({"date": r["publication_date"],
                         "series": {"he": r["publication_series_he"]},
                         "magazine": r["magazine_number"], "page": r["page_number"]}
                        if r["publication_date"] else None),
    }
    out["initiators"] = [{
        "person_id": i["person_id"], "name": person_name(i), "is_initiator": i["is_initiator"],
        "ordinal": i["ordinal"],
    } for i in conn.execute(
        select(bill_init, person.c.first_name_he, person.c.last_name_he)
        .select_from(bill_init.outerjoin(person, person.c.id == bill_init.c.person_id))
        .where(bill_init.c.bill_id == bill_id)
        .order_by(bill_init.c.is_initiator.desc(), bill_init.c.ordinal, bill_init.c.id)
    ).mappings()]
    out["names"] = [{
        "name": {"he": n["name_he"]},
        "stage": translated(n["stage_desc_he"], BILL_NAME_STAGE.get(n["stage_type_id"])),
    } for n in conn.execute(select(bill_name).where(bill_name.c.bill_id == bill_id)
                            .order_by(bill_name.c.id)).mappings()]
    seen: set[str] = set()
    docs = []
    for d in conn.execute(select(bill_doc).where(bill_doc.c.bill_id == bill_id)
                          .order_by(bill_doc.c.id)).mappings():
        if d["url"] in seen:  # the API repeats documents (DATA_MEMO finding 6)
            continue
        seen.add(d["url"])
        docs.append({"type": translated(d["group_type_desc_he"],
                                        DOCUMENT_GROUP.get(d["group_type_id"])),
                     "format": d["format"], "url": d["url"]})
    out["documents"] = docs
    out["timeline"] = bill_timeline(conn, bill_id)
    out["data_issues"] = issues_for(conn, "bill", bill_id)
    out["timeline_note"] = translated(
        "ציר הזמן משוחזר מסדרי היום של המליאה והוועדות, מהצבעות ומשינויי סטטוס שזיהינו. "
        "תאריכים שאינם מופיעים במידע הרשמי אינם מוצגים.",
        "This timeline is reconstructed from plenum and committee agendas, votes, and status "
        "changes we detected. Steps without a date in the official data are not shown.")
    if not out["timeline"]:
        out["data_notice"] = translated(
            "לא נמצאו במידע הרשמי תאריכים לשלבי הצעת החוק.",
            "The official data has no dated steps for this bill.")
    return out


# ---------------------------------------------------------------- MKs

def list_mks(conn: Connection, knesset: int) -> list[dict[str, Any]]:
    members = conn.execute(
        select(person.c.id, person.c.first_name_he, person.c.last_name_he,
               func.bool_or(ptp.c.is_current).label("is_current"))
        .select_from(ptp.join(person, person.c.id == ptp.c.person_id))
        .where(ptp.c.knesset_num == knesset, ptp.c.position_id.in_(MK_POSITIONS))
        .group_by(person.c.id)
    ).mappings().all()
    factions: dict[int, list[dict[str, Any]]] = {}
    for f in conn.execute(
            select(ptp.c.person_id, ptp.c.faction_id, ptp.c.faction_name_he, ptp.c.start_date,
                   ptp.c.finish_date)
            .where(ptp.c.knesset_num == knesset, ptp.c.position_id.in_(FACTION_POSITIONS))
            .order_by(ptp.c.start_date)).mappings():
        factions.setdefault(f["person_id"], []).append(
            {"id": f["faction_id"], "name": {"he": f["faction_name_he"]},
             "start": f["start_date"], "finish": f["finish_date"]})
    out = [{"id": m["id"], "name": person_name(m), "is_current": m["is_current"],
            "factions": factions.get(m["id"], []), "source": source("KNS_Person", m["id"])}
           for m in members]
    # The same order for every MK: alphabetical by Hebrew surname, then first name.
    out.sort(key=lambda m: (m["name"]["last_he"] or "", m["name"]["first_he"] or ""))
    return out


def get_mk(conn: Connection, person_id: int) -> dict[str, Any] | None:
    p = conn.execute(select(person).where(person.c.id == person_id)).mappings().first()
    if p is None:
        return None
    positions = conn.execute(select(ptp).where(ptp.c.person_id == person_id)
                             .order_by(ptp.c.start_date.desc().nulls_last())).mappings().all()

    def pos(r: Any) -> dict[str, Any]:
        return {"position": translated(None, POSITION.get(r["position_id"])) |
                {"id": r["position_id"]},
                "knesset": r["knesset_num"], "start": r["start_date"],
                "finish": r["finish_date"], "is_current": r["is_current"],
                "duty": {"he": r["duty_desc_he"]}, "source": source("KNS_PersonToPosition",
                                                                    r["id"])}

    bills = conn.execute(
        _bill_select().where(bill.c.id.in_(
            select(bill_init.c.bill_id).where(bill_init.c.person_id == person_id,
                                              bill_init.c.is_initiator)))
        .order_by(bill.c.last_updated.desc().nulls_last(), bill.c.id.desc())).mappings().all()
    outcomes: dict[str, int] = {}
    for b in bills:
        st = stage_for_status(b["status_id"])
        outcomes[st.key if st else "unknown"] = outcomes.get(st.key if st else "unknown", 0) + 1

    queries = conn.execute(
        select(query, ministry.c.name_he.label("ministry_name_he"))
        .select_from(query.outerjoin(ministry, ministry.c.id == query.c.ministry_id))
        .where(query.c.person_id == person_id)
        .order_by(query.c.submitted_at.desc().nulls_last(), query.c.id.desc())
        .limit(50)).mappings().all()
    query_total = conn.execute(select(func.count()).select_from(query)
                               .where(query.c.person_id == person_id)).scalar_one()

    votes = conn.execute(
        select(vote_result.c.result_code, vote.c.id, vote.c.voted_at, vote.c.title_he,
               bill.c.id.label("bill_id"))
        .select_from(vote_result.join(vote, vote.c.id == vote_result.c.vote_id)
                     .outerjoin(bill, bill.c.id == vote.c.item_id))
        .where(vote_result.c.person_id == person_id)
        .order_by(vote.c.voted_at.desc()).limit(50)).mappings().all()

    return {
        "data_issues": issues_for(conn, "person", person_id),
        "id": p["id"], "name": person_name(p), "gender": {"he": p["gender_desc_he"]},
        "is_current": p["is_current"], "source": source("KNS_Person", p["id"]),
        "factions": [pos(r) | {"faction": {"id": r["faction_id"],
                                           "name": {"he": r["faction_name_he"]}}}
                     for r in positions if r["position_id"] in FACTION_POSITIONS],
        "committees": [pos(r) | {"committee": {"id": r["committee_id"],
                                               "name": {"he": r["committee_name_he"]}}}
                       for r in positions if r["position_id"] in COMMITTEE_POSITIONS],
        "government": [pos(r) | {"ministry": {"id": r["ministry_id"],
                                              "name": {"he": r["ministry_name_he"]}}}
                       for r in positions if r["position_id"] in GOVERNMENT_POSITIONS],
        "memberships": [pos(r) for r in positions if r["position_id"] in MK_POSITIONS],
        "bills": {"total": len(bills), "by_stage": outcomes,
                  "items": [_bill_row(b) for b in bills[:20]]},
        "queries": {"total": query_total, "items": [{
            "id": q["id"], "name": {"he": q["name_he"]}, "type": {"he": q["type_desc_he"]},
            "status": {"id": q["status_id"], **translated(None, QUERY_STATUS.get(q["status_id"]))},
            "ministry": {"id": q["ministry_id"], "name": {"he": q["ministry_name_he"]}},
            "submitted_at": q["submitted_at"], "reply_at": q["reply_at"],
            "source": source("KNS_Query", q["id"]),
        } for q in queries]},
        "votes": {"note": translated(
            "מוצגות רק הצבעות שנרשמו. היעדר רשומה אינו מעיד על היעדרות.",
            "Only recorded votes are shown. A missing record does not mean the MK was absent."),
            "items": [{
                "vote_id": v["id"], "date": v["voted_at"], "title": {"he": v["title_he"]},
                "bill_id": v["bill_id"],  # None when the vote was not on a mirrored bill
                "result": {"code": v["result_code"],
                           **translated(VOTE_RESULT_HE.get(v["result_code"]),
                                        VOTE_RESULT.get(v["result_code"]))},
                "source": source("KNS_PlenumVote", v["id"]),
            } for v in votes]},
    }


# ---------------------------------------------------------------- committees

def list_committees(conn: Connection, knesset: int) -> list[dict[str, Any]]:
    counts: dict[Any, Any] = dict(conn.execute(
        select(csession.c.committee_id, func.count()).where(csession.c.knesset_num == knesset)
        .group_by(csession.c.committee_id)).all())
    rows = conn.execute(select(committee).where(committee.c.knesset_num == knesset)
                        .order_by(committee.c.type_id, committee.c.name_he)).mappings()
    return [{
        "id": c["id"], "name": {"he": c["name_he"]},
        "type": {"id": c["type_id"], **translated(c["type_desc_he"],
                                                  COMMITTEE_TYPE.get(c["type_id"]))},
        "parent_id": c["parent_committee_id"], "is_current": c["is_current"],
        "sessions": counts.get(c["id"], 0), "source": source("KNS_Committee", c["id"]),
    } for c in rows]


def _sessions(conn: Connection, where: Any, order: Any, limit: int, offset: int
              ) -> list[dict[str, Any]]:
    rows = conn.execute(select(csession).where(where).order_by(order)
                        .limit(limit).offset(offset)).mappings().all()
    items: dict[int, list[dict[str, Any]]] = {}
    if rows:
        for i in conn.execute(
                select(citem, bill.c.status_id.label("bill_status_id"))
                .select_from(citem.outerjoin(bill, and_(citem.c.item_type_id == ITEM_TYPE_BILL,
                                                        bill.c.id == citem.c.item_id)))
                .where(citem.c.session_id.in_([r["id"] for r in rows]))
                .order_by(citem.c.ordinal)).mappings():
            items.setdefault(i["session_id"], []).append({
                "name": {"he": i["name_he"]}, "item_type_id": i["item_type_id"],
                "bill_id": i["item_id"] if i["item_type_id"] == ITEM_TYPE_BILL and
                i["bill_status_id"] is not None else None,
            })
    return [{
        "id": r["id"], "number": r["number"], "start": r["start_at"], "finish": r["finish_at"],
        "type": {"he": r["type_desc_he"]}, "location": r["location"],
        "cancelled": r["status_id"] == COMMITTEE_SESSION_CANCELLED,
        "session_url": r["session_url"], "broadcast_url": r["broadcast_url"],
        "items": items.get(r["id"], []), "source": source("KNS_CommitteeSession", r["id"]),
    } for r in rows]


def get_committee(conn: Connection, committee_id: int, *, now: datetime,
                  page: int = 1, per_page: int = 20) -> dict[str, Any] | None:
    c = conn.execute(select(committee).where(committee.c.id == committee_id)).mappings().first()
    if c is None:
        return None
    per_page, offset = page_params(page, per_page)
    is_this = csession.c.committee_id == committee_id
    past_total = conn.execute(select(func.count()).select_from(csession)
                              .where(is_this, csession.c.start_at < now)).scalar_one()
    members = conn.execute(
        select(ptp.c.person_id, ptp.c.position_id, ptp.c.start_date, ptp.c.finish_date,
               ptp.c.is_current, person.c.first_name_he, person.c.last_name_he)
        .select_from(ptp.join(person, person.c.id == ptp.c.person_id))
        .where(ptp.c.committee_id == committee_id,
               ptp.c.position_id.in_(COMMITTEE_POSITIONS))
        .order_by(person.c.last_name_he, person.c.first_name_he)).mappings().all()
    return {
        "id": c["id"], "name": {"he": c["name_he"]}, "knesset": c["knesset_num"],
        "type": {"id": c["type_id"], **translated(c["type_desc_he"],
                                                  COMMITTEE_TYPE.get(c["type_id"]))},
        "email": c["email"], "is_current": c["is_current"],
        "parent_id": c["parent_committee_id"], "source": source("KNS_Committee", c["id"]),
        "members": [{
            "person_id": m["person_id"], "name": person_name(m),
            "role": {"id": m["position_id"], **translated(None, POSITION.get(m["position_id"]))},
            "start": m["start_date"], "finish": m["finish_date"], "is_current": m["is_current"],
        } for m in members],
        "upcoming": _sessions(conn, and_(is_this, csession.c.start_at >= now),
                              csession.c.start_at.asc(), 50, 0),
        "past": paged(_sessions(conn, and_(is_this, csession.c.start_at < now),
                                csession.c.start_at.desc(), per_page, offset),
                      past_total, page, per_page),
        "calendar_note": translated(
            "הכנסת מפרסמת ישיבות ועדה ימים ספורים מראש, כך שהרשימה הקרובה קצרה.",
            "The Knesset publishes committee sessions only a few days ahead, so the upcoming "
            "list is short."),
    }


def recent_changes(conn: Connection, limit: int = 20) -> list[dict[str, Any]]:
    rows = conn.execute(
        select(change_event).where(or_(change_event.c.event_type == "bill.stage_changed",
                                       change_event.c.event_type == "bill.new"))
        .order_by(change_event.c.detected_at.desc()).limit(limit)).mappings().all()
    names = dict(conn.execute(select(bill.c.id, bill.c.name_he).where(
        bill.c.id.in_([r["entity_id"] for r in rows]))).all()) if rows else {}
    return [{"bill_id": r["entity_id"], "bill_name": {"he": names.get(r["entity_id"])},
             "event_type": r["event_type"], "detected_at": r["detected_at"],
             "stage": stage_json(stage_for_status((r["after"] or {}).get("status_id")))}
            for r in rows]


# ---------------------------------------------------------------- status

STALE_AFTER_MINUTES = 60


def sync_status(conn: Connection, now: datetime) -> dict[str, Any]:
    """Public status: freshness per entity, from the sync's own logs."""
    last_ok: dict[str, datetime] = dict(conn.execute(
        select(sync_run.c.entity, func.max(sync_run.c.finished_at))
        .where(sync_run.c.error.is_(None), sync_run.c.finished_at.is_not(None))
        .group_by(sync_run.c.entity)).all())
    last_err = {r["entity"]: r for r in conn.execute(
        select(sync_run.c.entity, sync_run.c.started_at, sync_run.c.error)
        .where(sync_run.c.error.is_not(None)).order_by(sync_run.c.id.desc()).limit(200)
    ).mappings()}
    states = {r["entity"]: r for r in conn.execute(select(sync_state)).mappings()}
    entities: list[dict[str, Any]] = []
    for name, spec in BY_NAME.items():
        st = states.get(name)
        ok = last_ok.get(name)
        err = last_err.get(name)
        entities.append({
            "entity": name, "table": spec.table_name, "last_success": ok,
            "data_up_to": st["high_water_mark"] if st else None,
            "last_reconciled": st["last_reconciled_at"] if st else None,
            # an error only counts if it is newer than the last success
            "last_error": err["error"] if err and (ok is None or err["started_at"] > ok) else None,
        })
    oks = [v for v in last_ok.values() if v is not None]
    newest = max(oks) if oks else None
    healthy = newest is not None and (now - newest).total_seconds() < STALE_AFTER_MINUTES * 60
    return {"healthy": healthy, "last_successful_sync": newest,
            "stale_after_minutes": STALE_AFTER_MINUTES, "checked_at": now, "entities": entities}
