"""Operations: structured logs, optional Sentry, and an email to the operator when the
mirror goes stale.

Two layers of "is it working?":
- inside the app, after each sync: if no sync has succeeded for an hour, email OPS_EMAIL
  (at most every 6 hours);
- outside the app, for when the cron stops firing altogether: point any free uptime
  monitor at GET /health/sync, which returns 503 when the mirror is stale.
"""
from __future__ import annotations

import json
import logging
import os
import time
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import Connection, Engine, delete, select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from .config import Settings
from .emailer import Email, Emailer
from .models import login_token, pipeline_cursor, sync_run
from .read import sync_status

ALERT_EVERY_SECONDS = 6 * 3600


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        out: dict[str, Any] = {"ts": datetime.fromtimestamp(record.created, UTC).isoformat(),
                               "level": record.levelname, "logger": record.name,
                               "msg": record.getMessage()}
        if record.exc_info:
            out["exc"] = self.formatException(record.exc_info)
        return json.dumps(out, ensure_ascii=False)


def setup_logging() -> None:
    handler = logging.StreamHandler()
    handler.setFormatter(JsonFormatter())
    root = logging.getLogger()
    root.handlers[:] = [handler]
    root.setLevel(os.environ.get("LOG_LEVEL", "INFO"))


def setup_sentry() -> bool:
    """Error tracking, only if SENTRY_DSN is set and sentry-sdk is installed (it is pure
    Python, so it runs on Wasmer: pip install 'knesset-tracker[sentry]')."""
    dsn = os.environ.get("SENTRY_DSN")
    if not dsn:
        return False
    try:
        import sentry_sdk  # type: ignore[import-not-found]
    except ImportError:
        logging.warning("SENTRY_DSN is set but sentry-sdk is not installed")
        return False
    sentry_sdk.init(dsn=dsn, traces_sample_rate=0.0, send_default_pii=False)
    return True


SYNC_RUN_KEEP_DAYS = 90


def prune(conn: Connection, now: datetime | None = None) -> dict[str, int]:
    """Delete logs that would otherwise grow forever: sync runs older than 90 days
    (~1,000 rows a day) and sign-in tokens that expired more than a day ago. Nightly."""
    now = now or datetime.now(UTC)
    runs = conn.execute(delete(sync_run).where(
        sync_run.c.started_at < now - timedelta(days=SYNC_RUN_KEEP_DAYS))).rowcount
    tokens = conn.execute(delete(login_token).where(
        login_token.c.expires_at < now - timedelta(days=1))).rowcount
    return {"sync_runs": runs, "login_tokens": tokens}


def maybe_alert_operator(engine: Engine, emailer: Emailer, settings: Settings,
                         now: datetime | None = None) -> bool:
    ops_email = os.environ.get("OPS_EMAIL")
    if not ops_email:
        return False
    now = now or datetime.now(UTC)
    with engine.begin() as conn:
        st = sync_status(conn, now)
        if st["healthy"]:
            return False
        last = conn.execute(select(pipeline_cursor.c.value)
                            .where(pipeline_cursor.c.name == "ops_alert_at")).scalar() or 0
        if time.time() - last < ALERT_EVERY_SECONDS:
            return False
        stmt = pg_insert(pipeline_cursor).values(name="ops_alert_at", value=int(time.time()))
        conn.execute(stmt.on_conflict_do_update(index_elements=["name"],
                                                set_={"value": stmt.excluded.value}))
    errors = [f"{e['entity']}: {e['last_error']}" for e in st["entities"] if e["last_error"]]
    body = (f"These tables have not synced in the last {st['stale_after_minutes']} minutes: "
            f"{', '.join(st['stale_tables']) or 'all'}.\n"
            f"Newest successful sync of any table: {st['last_successful_sync']}.\n\n"
            + ("Latest errors:\n" + "\n".join(errors[:20]) if errors else "No errors recorded.")
            + f"\n\nStatus: {settings.public_base_url.rstrip('/')}/en/status")
    emailer.send(Email(to=ops_email, subject="Knesset Tracker: sync is stale", text=body,
                       html=f"<pre>{body}</pre>"))
    return True
