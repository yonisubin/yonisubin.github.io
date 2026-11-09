"""HTTP entry points. Wasmer cron jobs call the /internal/* endpoints; there are no
long-running workers."""
from __future__ import annotations

import hmac
import logging
import os
from dataclasses import asdict
from html import escape
from pathlib import Path
from typing import Annotated, Any

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import Engine, select, text

from .account import emailer_dep
from .account import public as account_public_router
from .account import router as account_router
from .alerts import run_alerts, run_digest
from .api import router as api_router
from .config import Settings, get_settings
from .db import get_engine
from .emailer import Emailer
from .entities import BY_NAME, ENTITIES
from .models import sync_run, sync_state
from .odata import ODataClient
from .push import Pusher
from .sync import reconcile_entity, run_sync

logging.basicConfig(level=logging.INFO, format='{"level":"%(levelname)s","msg":"%(message)s"}')
app = FastAPI(title="Knesset Tracker", version="0.2.0",
              description="Public read API over a mirror of the Knesset's open data.")
app.add_middleware(GZipMiddleware, minimum_size=1000)
app.include_router(api_router)
app.include_router(account_router)
app.include_router(account_public_router)


def engine_dep() -> Engine:
    return get_engine()


def client_dep() -> ODataClient:
    s = get_settings()
    return ODataClient(s.odata_base_url, min_interval=s.min_request_interval)


def pusher_dep(settings: Settings = Depends(get_settings)) -> Pusher:
    return Pusher(settings.vapid_private_key, settings.vapid_public_key, settings.vapid_subject)


SYNC_LOCK = 724_001  # pg advisory lock id: one sync (and alert run) at a time


def require_internal(x_internal_token: Annotated[str | None, Header()] = None,
                     settings: Settings = Depends(get_settings)) -> None:
    # Refuse everything when no token is configured, rather than leaving the door open.
    if not settings.internal_token or not hmac.compare_digest(
            x_internal_token or "", settings.internal_token):
        raise HTTPException(status_code=401, detail="bad or missing X-Internal-Token")


@app.get("/health")
def health(engine: Engine = Depends(engine_dep)) -> dict[str, str]:
    with engine.connect() as conn:
        conn.execute(text("SELECT 1"))
    return {"status": "ok"}


@app.post("/internal/sync", dependencies=[Depends(require_internal)])
def internal_sync(engine: Engine = Depends(engine_dep), client: ODataClient = Depends(client_dep),
                  settings: Settings = Depends(get_settings),
                  emailer: Emailer = Depends(emailer_dep),
                  pusher: Pusher = Depends(pusher_dep)) -> JSONResponse:
    """Sync, then fan out and send instant alerts: one database wake-up per cycle."""
    runs: list[Any] = []
    alerts: dict[str, Any] = {}
    status = 200
    with engine.connect() as lock_conn:
        if not lock_conn.execute(text("SELECT pg_try_advisory_lock(:k)"),
                                 {"k": SYNC_LOCK}).scalar():
            client.close()
            return JSONResponse({"error": "another sync is running"}, status_code=409)
        try:
            try:
                runs = run_sync(engine, client, settings)
            except Exception as e:  # noqa: BLE001 - recorded in sync_run; 500 for the cron log
                logging.exception("sync failed")
                runs.append({"error": f"{type(e).__name__}: {e}"})
                status = 500
            # alerts run even after a sync error: events from the pages that did commit
            try:
                alerts = run_alerts(engine, emailer, pusher, settings)
            except Exception as e:  # noqa: BLE001
                logging.exception("alerts failed")
                alerts = {"error": f"{type(e).__name__}: {e}"}
                status = 500
        finally:
            client.close()
            lock_conn.execute(text("SELECT pg_advisory_unlock(:k)"), {"k": SYNC_LOCK})
            lock_conn.commit()
    return JSONResponse({"runs": [asdict(r) if not isinstance(r, dict) else r for r in runs],
                         "alerts": alerts}, status_code=status)


@app.post("/internal/digest", dependencies=[Depends(require_internal)])
def internal_digest(engine: Engine = Depends(engine_dep),
                    settings: Settings = Depends(get_settings),
                    emailer: Emailer = Depends(emailer_dep)) -> JSONResponse:
    """Daily cron: daily digests every day, weekly digests on Sundays."""
    out = run_digest(engine, emailer, settings)
    return JSONResponse(out, status_code=500 if out["failures"] else 200)


@app.post("/internal/reconcile", dependencies=[Depends(require_internal)])
def internal_reconcile(engine: Engine = Depends(engine_dep),
                       client: ODataClient = Depends(client_dep),
                       settings: Settings = Depends(get_settings)) -> JSONResponse:
    with engine.connect() as conn:
        synced = {r.entity for r in conn.execute(
            select(sync_state.c.entity).where(sync_state.c.high_water_mark.is_not(None)))}
    out, status = [], 200
    try:
        for spec in ENTITIES:
            if spec.small and spec.odata in synced:
                out.append(asdict(reconcile_entity(engine, client, spec, settings)))
    except Exception as e:  # noqa: BLE001
        logging.exception("reconcile failed")
        out.append({"error": f"{type(e).__name__}: {e}"})
        status = 500
    finally:
        client.close()
    return JSONResponse(out, status_code=status)


def _status_rows(engine: Engine) -> list[dict[str, Any]]:
    with engine.connect() as conn:
        states = {r["entity"]: dict(r) for r in conn.execute(select(sync_state)).mappings()}
        last: dict[str, dict[str, Any]] = {}
        for r in conn.execute(select(sync_run).order_by(sync_run.c.id.desc()).limit(500)
                              ).mappings():
            last.setdefault(r["entity"], dict(r))
    rows = []
    for spec in ENTITIES:
        st, lr = states.get(spec.odata, {}), last.get(spec.odata, {})
        rows.append({
            "entity": spec.odata, "table": spec.table_name,
            "high_water_mark": st.get("high_water_mark"),
            "pass_in_progress": bool(st.get("pass_next_url")),
            "last_pass_completed_at": st.get("last_pass_completed_at"),
            "last_run_at": lr.get("started_at"), "last_run_fetched": lr.get("fetched"),
            "last_run_changed": lr.get("changed"), "last_run_events": lr.get("events"),
            "last_error": lr.get("error"),
        })
    return rows


@app.get("/admin/sync-status")
def sync_status(engine: Engine = Depends(engine_dep)) -> list[dict[str, Any]]:
    return _status_rows(engine)


@app.get("/admin", response_class=HTMLResponse)
def admin_page(engine: Engine = Depends(engine_dep)) -> str:
    rows = _status_rows(engine)
    cols = list(rows[0]) if rows else []
    body = "".join(
        "<tr>" + "".join(f"<td>{escape(str(r[c]) if r[c] is not None else '–')}</td>"
                         for c in cols) + "</tr>" for r in rows)
    head = "".join(f"<th>{escape(c)}</th>" for c in cols)
    return (
        "<!doctype html><meta charset=utf-8><title>Sync status</title>"
        "<style>body{font:14px system-ui;margin:1rem}table{border-collapse:collapse}"
        "td,th{border:1px solid #ccc;padding:.25rem .5rem;text-align:start}</style>"
        f"<h1>Sync status</h1><table><tr>{head}</tr>{body}</table>")


assert set(BY_NAME) == {e.odata for e in ENTITIES}

# The built React app (frontend/dist), served from the same Wasmer app. Any path that
# is not an API route or a static file gets index.html, so /he/bills/123 works on reload.
# Locally the build sits in ../frontend/dist; the deploy copies it into backend/static.
_here = Path(__file__).resolve()
FRONTEND = Path(os.environ.get("FRONTEND_DIST") or next(
    (p for p in (_here.parents[1] / "static", _here.parents[2] / "frontend" / "dist")
     if (p / "index.html").exists()), _here.parents[1] / "static"))
if (FRONTEND / "index.html").exists():
    class ImmutableAssets(StaticFiles):
        # Vite puts a content hash in every asset file name, so they can be cached forever.
        def file_response(self, *args: Any, **kwargs: Any) -> Any:
            resp = super().file_response(*args, **kwargs)
            resp.headers["Cache-Control"] = "public, max-age=31536000, immutable"
            return resp

    app.mount("/assets", ImmutableAssets(directory=FRONTEND / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str) -> FileResponse:
        if path.startswith(("api/", "internal/", "admin")):
            raise HTTPException(status_code=404)
        file = (FRONTEND / path).resolve()
        if path and file.is_file() and FRONTEND.resolve() in file.parents:
            # the service worker must be revalidated, or updates never reach browsers
            headers = {"Cache-Control": "no-cache"} if path == "sw.js" else None
            return FileResponse(file, headers=headers)
        return FileResponse(FRONTEND / "index.html",
                            headers={"Cache-Control": "no-cache"})
