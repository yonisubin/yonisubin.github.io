"""Alerts: match change events to subscriptions (fan-out), then deliver.

Runs at the end of every sync invocation, so Neon wakes once per cycle. The guarantees:

- **No duplicate notifications.** Each (channel, user, event) has a unique dedupe_key;
  inserts use ON CONFLICT DO NOTHING, and the fan-out cursor advances in the same
  transaction as the inserts. A crash simply repeats work that can't double up.
- **No duplicate emails.** Rows are claimed into a batch (status 'sending', batch_id set)
  before sending; the batch_id is the provider's idempotency key. A batch whose send
  crashed is retried with the same batch_id, so Resend delivers it once. (With SMTP a
  crash between send and commit can repeat one email: at-least-once.)
- **Nothing lost.** A failed send returns the rows to 'pending' (up to 5 attempts).
- **Only new events.** A subscription matches events detected after it was created.
"""
from __future__ import annotations

import html
import logging
import uuid
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import Connection, Engine, case, delete, func, select, tuple_, update
from sqlalchemy.dialects.postgresql import insert as pg_insert

from .auth import unsubscribe_token
from .config import Settings
from .describe import NOTIFY, Described, describe
from .emailer import Email, Emailer
from .entities import BY_NAME
from .hebrew import index_text
from .models import (
    app_user,
    change_event,
    notification,
    pipeline_cursor,
    push_subscription,
    search_document,
    subscription,
)
from .push import Gone, Pusher

log = logging.getLogger("knesset.alerts")
T = {name: spec.table for name, spec in BY_NAME.items()}
CURSOR = "alerts_fanout"
MAX_ATTEMPTS = 5
STALE_AFTER = timedelta(minutes=10)
KEYWORD_EVENTS = {"bill.new", "bill.stage_changed", "committee_session.scheduled",
                  "committee_session_item.new", "query.new",
                  "query.answered", "law.new"}


# ---------------------------------------------------------------- matching

def _row(conn: Connection, entity: str, id_: int) -> dict[str, Any]:
    t = T[entity]
    r = conn.execute(select(t).where(t.c.id == id_)).mappings().first()
    return dict(r) if r else {}


def targets(conn: Connection, ev: dict[str, Any]) -> set[tuple[str, int]]:
    """What a follower could be following for this event to concern them."""
    et, eid = ev["event_type"], ev["entity_id"]
    out: set[tuple[str, int]] = set()
    if et.startswith("bill."):
        out.add(("bill", eid))
    elif et == "bill_document.new":
        if bid := _row(conn, "KNS_DocumentBill", eid).get("bill_id"):
            out.add(("bill", bid))
    elif et == "bill_initiator.new":
        r = _row(conn, "KNS_BillInitiator", eid)
        out |= {("bill", r["bill_id"]), ("mk", r["person_id"])} if r else set()
    elif et.startswith("vote."):
        if item := _row(conn, "KNS_PlenumVote", eid).get("item_id"):
            out.add(("bill", item))
    elif et.startswith("committee_session."):
        if cid := _row(conn, "KNS_CommitteeSession", eid).get("committee_id"):
            out.add(("committee", cid))
    elif et == "mk.faction_changed" or et.startswith("person_position."):
        if pid := _row(conn, "KNS_PersonToPosition", eid).get("person_id"):
            out.add(("mk", pid))
    elif et.startswith("query.") and (pid := _row(conn, "KNS_Query", eid).get("person_id")):
        out.add(("mk", pid))
    return out


def keyword_text(conn: Connection, ev: dict[str, Any]) -> str:
    """The normalised text a keyword follow is matched against."""
    et, eid = ev["event_type"], ev["entity_id"]
    if et not in KEYWORD_EVENTS:
        return ""
    if et == "committee_session_item.new":  # an agenda item published after its session
        item = conn.execute(select(T["KNS_CmtSessionItem"].c.name_he)
                            .where(T["KNS_CmtSessionItem"].c.id == eid)).scalar()
        return index_text(item)
    if et.startswith("committee_session."):
        items = T["KNS_CmtSessionItem"]
        names = conn.execute(select(items.c.name_he).where(items.c.session_id == eid)).scalars()
        return index_text(*names)
    doc_type = {"bill": "bill", "query": "query", "law": "law"}[et.split(".")[0]]
    r = conn.execute(select(search_document.c.title_norm, search_document.c.body_norm).where(
        search_document.c.doc_type == doc_type, search_document.c.doc_id == eid)).first()
    return f"{r[0]} {r[1]}" if r else ""


def fan_out(conn: Connection, batch: int = 1000) -> int:
    """Turn new change events into notification rows. Returns how many were created."""
    cursor = conn.execute(select(pipeline_cursor.c.value).where(pipeline_cursor.c.name == CURSOR)
                          ).scalar() or 0
    events = [dict(r) for r in conn.execute(
        select(change_event).where(change_event.c.id > cursor)
        .order_by(change_event.c.id).limit(batch)).mappings()]
    if not events:
        return 0
    keyword_subs = [dict(r) for r in conn.execute(
        select(subscription).where(subscription.c.target_type == "keyword")).mappings()]
    push_users = set(conn.execute(select(push_subscription.c.user_id).distinct()).scalars())
    email_users = set(conn.execute(select(app_user.c.id).where(app_user.c.email_enabled)).scalars())

    rows: list[dict[str, Any]] = []
    for ev in events:
        if ev["event_type"] not in NOTIFY:
            continue
        matches: dict[int, int] = {}  # user -> first matching subscription
        keys = targets(conn, ev)
        if keys:
            for sub in conn.execute(select(subscription).where(
                    tuple_(subscription.c.target_type, subscription.c.target_id).in_(list(keys)),
                    subscription.c.created_at <= ev["detected_at"])).mappings():
                matches.setdefault(sub["user_id"], sub["id"])
        if keyword_subs and (text := keyword_text(conn, ev)):
            for s in keyword_subs:
                if s["created_at"] <= ev["detected_at"] and s["keyword_norm"] in text:
                    matches.setdefault(s["user_id"], s["id"])
        for user_id, sub_id in matches.items():
            for channel in ("email", "push"):
                if (channel == "email" and user_id in email_users) or (
                        channel == "push" and user_id in push_users):
                    rows.append({"user_id": user_id, "change_event_id": ev["id"],
                                 "subscription_id": sub_id, "channel": channel,
                                 "dedupe_key": f"{channel}:{user_id}:{ev['id']}"})
    created = 0
    if rows:
        created = len(conn.execute(pg_insert(notification).values(rows)
                                   .on_conflict_do_nothing(index_elements=["dedupe_key"])
                                   .returning(notification.c.id)).all())
    stmt = pg_insert(pipeline_cursor).values(name=CURSOR, value=events[-1]["id"])
    conn.execute(stmt.on_conflict_do_update(index_elements=["name"],
                                            set_={"value": stmt.excluded.value}))
    return created


def fan_out_all(engine: Engine) -> int:
    total = 0
    while True:
        with engine.begin() as conn:
            before = conn.execute(select(pipeline_cursor.c.value)
                                  .where(pipeline_cursor.c.name == CURSOR)).scalar()
            total += fan_out(conn)
            after = conn.execute(select(pipeline_cursor.c.value)
                                 .where(pipeline_cursor.c.name == CURSOR)).scalar()
        if after == before:
            return total


# ---------------------------------------------------------------- delivery

@dataclass
class DeliveryStats:
    emails_sent: int = 0
    notifications_sent: int = 0
    failures: int = 0
    pushes_sent: int = 0
    skipped: int = 0
    errors: list[str] = field(default_factory=list)


def _claim_email_batches(conn: Connection, frequencies: set[str], now: datetime
                         ) -> dict[str, list[dict[str, Any]]]:
    """Claim pending (or stale 'sending') email notifications, grouped into batches."""
    # users who turned email off: their pending email notifications are skipped
    conn.execute(update(notification).where(
        notification.c.channel == "email", notification.c.status == "pending",
        notification.c.user_id.in_(select(app_user.c.id).where(~app_user.c.email_enabled))
    ).values(status="skipped"))
    rows = conn.execute(
        select(notification.c.id, notification.c.user_id, notification.c.batch_id,
               notification.c.change_event_id)
        .select_from(notification.join(app_user, app_user.c.id == notification.c.user_id))
        .where(notification.c.channel == "email", app_user.c.email_enabled,
               app_user.c.digest_frequency.in_(frequencies),
               ((notification.c.status == "pending") & (notification.c.attempts < MAX_ATTEMPTS))
               | ((notification.c.status == "sending")
                  & (notification.c.claimed_at < now - STALE_AFTER)))
        .order_by(notification.c.id)
        .with_for_update(of=notification, skip_locked=True)).mappings().all()
    batches: dict[str, list[dict[str, Any]]] = defaultdict(list)
    new_ids: dict[int, str] = {}
    for r in rows:
        # a batch that crashed keeps its id (same idempotency key on retry)
        bid = r["batch_id"] or new_ids.setdefault(r["user_id"], str(uuid.uuid4()))
        batches[bid].append(dict(r))
    for bid, items in batches.items():  # one UPDATE per batch, not per notification
        conn.execute(update(notification).where(notification.c.id.in_([i["id"] for i in items]))
                     .values(status="sending", batch_id=bid, claimed_at=now,
                             attempts=notification.c.attempts + 1))
    return batches


def build_email(conn: Connection, settings: Settings, user: dict[str, Any],
                items: list[Described], batch_id: str) -> Email:
    lang = user["locale"] if user["locale"] in ("he", "en") else "he"
    base = settings.public_base_url.rstrip("/")
    unsub = f"{base}/api/v1/unsubscribe?token={unsubscribe_token(settings, user['id'])}"
    manage = f"{base}/{lang}/account"
    n = len(items)
    if lang == "he":
        subject = items[0].he if n == 1 else f"מעקב הכנסת: {n} עדכונים"
        intro = "עדכונים על מה שאת/ה עוקב/ת אחריו:"
        footer = ("קיבלת את ההודעה כי בחרת לעקוב באתר מעקב הכנסת. "
                  f"לניהול המעקבים: {manage} · להפסקת כל המיילים: {unsub}")
    else:
        subject = items[0].en if n == 1 else f"Knesset Tracker: {n} updates"
        intro = "Updates on what you follow:"
        footer = ("You get this because you follow items on Knesset Tracker. "
                  f"Manage what you follow: {manage} · Stop all emails: {unsub}")
    subject = subject if len(subject) <= 120 else subject[:117] + "…"
    lines = [(d.he if lang == "he" else d.en, f"{base}/{lang}{d.path}") for d in items]
    text = intro + "\n\n" + "\n".join(f"• {t}\n  {u}" for t, u in lines) + "\n\n— \n" + footer
    dir_ = "rtl" if lang == "he" else "ltr"
    lis = "".join(f'<li style="margin-bottom:8px"><a href="{html.escape(u)}">{html.escape(t)}</a>'
                  "</li>" for t, u in lines)
    body = (f'<div dir="{dir_}" lang="{lang}" style="font-family:system-ui,Arial,sans-serif;'
            f'font-size:15px;line-height:1.5"><p>{html.escape(intro)}</p><ul>{lis}</ul>'
            f'<hr><p style="color:#555;font-size:13px">{html.escape(footer)}</p></div>')
    return Email(to=user["email"], subject=subject, text=text, html=body,
                 idempotency_key=batch_id, headers={
                     # RFC 8058 one-click unsubscribe
                     "List-Unsubscribe": f"<{unsub}>",
                     "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
                 })


def deliver_email(engine: Engine, emailer: Emailer, settings: Settings,
                  frequencies: set[str], now: datetime | None = None) -> DeliveryStats:
    now = now or datetime.now(UTC)
    stats = DeliveryStats()
    with engine.begin() as conn:
        batches = _claim_email_batches(conn, frequencies, now)
    for batch_id, rows in batches.items():
        ids = [r["id"] for r in rows]
        with engine.connect() as conn:
            user = dict(conn.execute(select(app_user).where(app_user.c.id == rows[0]["user_id"])
                                     ).mappings().one())
            evs = [dict(e) for e in conn.execute(
                select(change_event).where(change_event.c.id.in_(
                    [r["change_event_id"] for r in rows])).order_by(change_event.c.id)).mappings()]
            email = build_email(conn, settings, user, [describe(conn, e) for e in evs], batch_id)
        try:
            emailer.send(email)
        except Exception as e:  # noqa: BLE001 - any failure: back to pending, retry later
            stats.failures += 1
            stats.errors.append(f"{type(e).__name__}: {e}")
            with engine.begin() as conn:
                conn.execute(update(notification).where(notification.c.id.in_(ids)).values(
                    status=case((notification.c.attempts >= MAX_ATTEMPTS, "failed"),
                                else_="pending"),
                    last_error=str(e)[:1000]))
            continue
        with engine.begin() as conn:
            conn.execute(update(notification).where(notification.c.id.in_(ids))
                         .values(status="sent", sent_at=func.now(), last_error=None))
        stats.emails_sent += 1
        stats.notifications_sent += len(ids)
    return stats


def deliver_push(engine: Engine, pusher: Pusher) -> DeliveryStats:
    stats = DeliveryStats()
    with engine.begin() as conn:
        pending = conn.execute(select(notification.c.id, notification.c.user_id).where(
            notification.c.channel == "push", notification.c.status == "pending")
            .with_for_update(skip_locked=True)).mappings().all()
        if not pending:
            return stats
        ids = [p["id"] for p in pending]
        if not pusher.enabled:
            conn.execute(update(notification).where(notification.c.id.in_(ids))
                         .values(status="skipped"))
            stats.skipped = len(ids)
            return stats
        users = {p["user_id"] for p in pending}
        endpoints = conn.execute(select(push_subscription.c.id, push_subscription.c.endpoint)
                                 .where(push_subscription.c.user_id.in_(users))).all()
        # one tickle per device per run, however many notifications are waiting
        for sub_id, endpoint in endpoints:
            try:
                pusher.tickle(endpoint)
                stats.pushes_sent += 1
            except Gone:
                conn.execute(delete(push_subscription).where(push_subscription.c.id == sub_id))
            except Exception as e:  # noqa: BLE001
                stats.failures += 1
                stats.errors.append(str(e))
        conn.execute(update(notification).where(notification.c.id.in_(ids))
                     .values(status="sent", sent_at=func.now(), attempts=1))
    return stats


def run_alerts(engine: Engine, emailer: Emailer, pusher: Pusher, settings: Settings
               ) -> dict[str, Any]:
    """Fan out new events, then send instant emails and pushes. Called after each sync."""
    created = fan_out_all(engine)
    email = deliver_email(engine, emailer, settings, {"instant"})
    push = deliver_push(engine, pusher)
    return {"notifications_created": created, "emails_sent": email.emails_sent,
            "email_failures": email.failures, "pushes_sent": push.pushes_sent,
            "errors": email.errors + push.errors}


def run_digest(engine: Engine, emailer: Emailer, settings: Settings, now: datetime | None = None
               ) -> dict[str, Any]:
    """Daily digest every day; weekly digest on Sundays (the start of the Israeli week)."""
    now = now or datetime.now(UTC)
    sunday = now.astimezone(ZoneInfo("Asia/Jerusalem")).weekday() == 6
    freqs = {"daily"} | ({"weekly"} if sunday else set())
    fan_out_all(engine)
    stats = deliver_email(engine, emailer, settings, freqs, now)
    return {"frequencies": sorted(freqs), "emails_sent": stats.emails_sent,
            "failures": stats.failures, "errors": stats.errors}

