"""HTTP entry points. Wasmer cron jobs call the /internal/* endpoints; there are no
long-running workers."""
from __future__ import annotations

import hmac
import logging
from dataclasses import asdict
from html import escape
from typing import Annotated, Any

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.responses import HTMLResponse, JSONResponse
from sqlalchemy import Engine, select, text

from .config import Settings, get_settings
from .db import get_engine
from .entities import BY_NAME, ENTITIES
from .models import sync_run, sync_state
from .odata import ODataClient
from .sync import reconcile_entity, run_sync

logging.basicConfig(level=logging.INFO, format='{"level":"%(levelname)s","msg":"%(message)s"}')
app = FastAPI(title="Knesset Tracker", version="0.1.0")


def engine_dep() -> Engine:
    return get_engine()


def client_dep() -> ODataClient:
    s = get_settings()
    return ODataClient(s.odata_base_url, min_interval=s.min_request_interval)


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
                  settings: Settings = Depends(get_settings)) -> JSONResponse:
    runs: list[Any] = []
    try:
        runs = run_sync(engine, client, settings)
        status = 200
    except Exception as e:  # noqa: BLE001 - recorded in sync_run; 500 makes the cron log it
        logging.exception("sync failed")
        runs.append({"error": f"{type(e).__name__}: {e}"})
        status = 500
    finally:
        client.close()
    return JSONResponse([asdict(r) if not isinstance(r, dict) else r for r in runs],
                        status_code=status)


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
