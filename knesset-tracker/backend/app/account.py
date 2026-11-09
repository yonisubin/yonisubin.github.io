"""Account API: magic-link login, follows (subscriptions), push registration,
notification feed, one-click unsubscribe, account deletion."""
from __future__ import annotations

import html
import re
from datetime import UTC, datetime, timedelta
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field
from sqlalchemy import Connection, delete, func, insert, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert

from .api import conn_dep
from .auth import (
    COOKIE,
    LOGIN_TOKEN_MINUTES,
    SESSION_SECONDS,
    current_user_id,
    hash_token,
    load_user,
    new_login_token,
    read_session,
    read_unsubscribe_token,
    require_csrf_header,
    session_cookie,
)
from .config import Settings, get_settings
from .describe import describe
from .emailer import Email, Emailer, make_emailer
from .entities import BY_NAME
from .hebrew import normalize
from .models import (
    app_user,
    change_event,
    login_token,
    notification,
    push_subscription,
    subscription,
)

router = APIRouter(prefix="/api/v1", tags=["account"], dependencies=[Depends(require_csrf_header)])
T = {name: spec.table for name, spec in BY_NAME.items()}
EMAIL_RE = re.compile(r"^[^@\s]{1,64}@[^@\s]{1,255}\.[^@\s]{2,}$")
LINKS_PER_HOUR = 5            # per address
LINKS_PER_HOUR_TOTAL = 30     # across all addresses: one script can't drain the email quota


def emailer_dep(settings: Settings = Depends(get_settings)) -> Emailer:
    return make_emailer(settings)


def tx_dep(conn: Connection = Depends(conn_dep)) -> Any:
    with conn.begin():
        yield conn


def safe_next(path: str | None) -> str | None:
    # only local paths: never an open redirect
    return path if path and path.startswith("/") and not path.startswith("//") else None


# ---------------------------------------------------------------- login

class LinkRequest(BaseModel):
    email: str = Field(max_length=320)
    locale: Literal["he", "en"] = "he"
    next: str | None = Field(None, max_length=300)


@router.post("/auth/request-link", status_code=202)
def request_link(body: LinkRequest, conn: Connection = Depends(tx_dep),
                 settings: Settings = Depends(get_settings),
                 emailer: Emailer = Depends(emailer_dep)) -> dict[str, str]:
    email = body.email.strip().lower()
    if not EMAIL_RE.match(email):
        raise HTTPException(422, "invalid email address")
    recent = conn.execute(select(func.count()).select_from(login_token).where(
        login_token.c.email == email,
        login_token.c.created_at > datetime.now(UTC) - timedelta(hours=1))).scalar_one()
    if recent >= LINKS_PER_HOUR:
        raise HTTPException(429, "too many login links requested; try again later")
    total = conn.execute(select(func.count()).select_from(login_token).where(
        login_token.c.created_at > datetime.now(UTC) - timedelta(hours=1))).scalar_one()
    if total >= LINKS_PER_HOUR_TOTAL:
        raise HTTPException(429, "the site is sending too many sign-in links right now; "
                                 "try again in an hour")
    token, token_hash = new_login_token()
    conn.execute(insert(login_token).values(
        token_hash=token_hash, email=email, locale=body.locale, next_path=safe_next(body.next),
        expires_at=datetime.now(UTC) + timedelta(minutes=LOGIN_TOKEN_MINUTES)))
    link = f"{settings.public_base_url.rstrip('/')}/{body.locale}/auth/verify#token={token}"
    if body.locale == "he":
        subject = "קישור כניסה למעקב הכנסת"
        text = (f"לכניסה למעקב הכנסת לחצו על הקישור (בתוקף {LOGIN_TOKEN_MINUTES} דקות, "
                f"לשימוש חד־פעמי):\n\n{link}\n\nאם לא ביקשתם להיכנס, אפשר להתעלם מההודעה.")
    else:
        subject = "Your Knesset Tracker sign-in link"
        text = (f"Sign in to Knesset Tracker with this link (valid for {LOGIN_TOKEN_MINUTES} "
                f"minutes, single use):\n\n{link}\n\nIf you didn't ask to sign in, ignore this.")
    dir_ = "rtl" if body.locale == "he" else "ltr"
    page = (f'<div dir="{dir_}" style="font-family:system-ui,Arial,sans-serif;font-size:15px">'
            f'<p>{html.escape(text.split(chr(10))[0])}</p>'
            f'<p><a href="{html.escape(link)}">{html.escape(link)}</a></p></div>')
    emailer.send(Email(to=email, subject=subject, text=text, html=page))
    # same answer whether or not the address has an account
    return {"status": "sent"}


class VerifyRequest(BaseModel):
    token: str = Field(min_length=10, max_length=200)


@router.post("/auth/verify")
def verify(body: VerifyRequest, response: Response, conn: Connection = Depends(tx_dep),
           settings: Settings = Depends(get_settings)) -> dict[str, Any]:
    row = conn.execute(select(login_token).where(login_token.c.token_hash == hash_token(body.token))
                       .with_for_update()).mappings().first()
    if row is None or row["used_at"] is not None or row["expires_at"] < datetime.now(UTC):
        raise HTTPException(400, "this sign-in link is invalid, expired or already used")
    conn.execute(update(login_token).where(login_token.c.token_hash == row["token_hash"])
                 .values(used_at=func.now()))
    stmt = pg_insert(app_user).values(email=row["email"], locale=row["locale"],
                                      last_login_at=func.now())
    user_id = conn.execute(stmt.on_conflict_do_update(
        index_elements=["email"], set_={"last_login_at": func.now()}).returning(app_user.c.id)
    ).scalar_one()
    response.set_cookie(COOKIE, session_cookie(settings, user_id), max_age=SESSION_SECONDS,
                        httponly=True, samesite="lax", secure=settings.cookie_secure, path="/")
    return {"user": _me(conn, user_id), "next": row["next_path"]}


@router.post("/auth/logout", status_code=204)
def logout(response: Response) -> Response:
    response.delete_cookie(COOKIE, path="/")
    response.status_code = 204
    return response


# ---------------------------------------------------------------- me

def _me(conn: Connection, user_id: int) -> dict[str, Any]:
    u = load_user(conn, user_id)
    pushes = conn.execute(select(func.count()).select_from(push_subscription)
                          .where(push_subscription.c.user_id == user_id)).scalar_one()
    return {"id": u["id"], "email": u["email"], "locale": u["locale"],
            "digest_frequency": u["digest_frequency"], "email_enabled": u["email_enabled"],
            "push_devices": pushes, "created_at": u["created_at"]}


@router.get("/session")
def session(request: Request, conn: Connection = Depends(conn_dep),
            settings: Settings = Depends(get_settings)) -> dict[str, Any]:
    """Who is signed in (200 either way, so anonymous visits don't log errors), with their
    follows: what the frontend needs on every page, in one request."""
    if not settings.secret_key:
        return {"me": None, "subscriptions": []}
    uid = read_session(settings, request.cookies.get(COOKIE))
    if uid is None or conn.execute(
            select(app_user.c.id).where(app_user.c.id == uid)).first() is None:
        return {"me": None, "subscriptions": []}
    rows = conn.execute(select(subscription).where(subscription.c.user_id == uid)
                        .order_by(subscription.c.created_at.desc())).mappings()
    return {"me": _me(conn, uid), "subscriptions": [_sub_json(conn, s) for s in rows]}


@router.get("/me")
def me(user_id: int = Depends(current_user_id), conn: Connection = Depends(conn_dep)
       ) -> dict[str, Any]:
    return _me(conn, user_id)


class MeUpdate(BaseModel):
    locale: Literal["he", "en"] | None = None
    digest_frequency: Literal["instant", "daily", "weekly"] | None = None
    email_enabled: bool | None = None


@router.patch("/me")
def update_me(body: MeUpdate, user_id: int = Depends(current_user_id),
              conn: Connection = Depends(tx_dep)) -> dict[str, Any]:
    values = body.model_dump(exclude_none=True)
    if values:
        conn.execute(update(app_user).where(app_user.c.id == user_id).values(**values))
    return _me(conn, user_id)


@router.delete("/me", status_code=204)
def delete_me(response: Response, user_id: int = Depends(current_user_id),
              conn: Connection = Depends(tx_dep)) -> Response:
    """Delete the account: follows, notifications and push devices go with it (cascade)."""
    email = load_user(conn, user_id)["email"]
    conn.execute(delete(app_user).where(app_user.c.id == user_id))
    conn.execute(delete(login_token).where(login_token.c.email == email))
    response.delete_cookie(COOKIE, path="/")
    response.status_code = 204
    return response


# ---------------------------------------------------------------- follows

class Follow(BaseModel):
    target_type: Literal["bill", "mk", "committee", "keyword"]
    target_id: int | None = None
    keyword: str | None = Field(None, max_length=100)


TARGET_TABLE = {"bill": "KNS_Bill", "mk": "KNS_Person", "committee": "KNS_Committee"}


def _target_title(conn: Connection, s: Any) -> str | None:
    if s["target_type"] == "keyword":
        return s["keyword"]
    if s["target_type"] == "mk":
        p = T["KNS_Person"]
        r = conn.execute(select(p.c.first_name_he, p.c.last_name_he)
                         .where(p.c.id == s["target_id"])).first()
        return " ".join(x for x in (r or ()) if x) or None
    t = T[TARGET_TABLE[s["target_type"]]]
    return conn.execute(select(t.c.name_he).where(t.c.id == s["target_id"])).scalar()


def _sub_json(conn: Connection, s: Any) -> dict[str, Any]:
    return {"id": s["id"], "target_type": s["target_type"], "target_id": s["target_id"],
            "keyword": s["keyword"], "title": {"he": _target_title(conn, s)},
            "created_at": s["created_at"]}


@router.get("/me/subscriptions")
def list_subscriptions(user_id: int = Depends(current_user_id),
                       conn: Connection = Depends(conn_dep)) -> list[dict[str, Any]]:
    rows = conn.execute(select(subscription).where(subscription.c.user_id == user_id)
                        .order_by(subscription.c.created_at.desc())).mappings()
    return [_sub_json(conn, s) for s in rows]


@router.post("/me/subscriptions", status_code=201)
def follow(body: Follow, user_id: int = Depends(current_user_id),
           conn: Connection = Depends(tx_dep)) -> dict[str, Any]:
    load_user(conn, user_id)
    if body.target_type == "keyword":
        kw = (body.keyword or "").strip()
        norm = normalize(kw)
        if len(norm) < 3:
            raise HTTPException(422, "keyword must be at least 3 characters")
        values: dict[str, Any] = {"keyword": kw, "keyword_norm": norm, "target_id": None}
        conflict: dict[str, Any] = {"index_elements": ["user_id", "keyword_norm"],
                                    "index_where": subscription.c.keyword_norm.is_not(None)}
    else:
        if body.target_id is None:
            raise HTTPException(422, "target_id is required")
        t = T[TARGET_TABLE[body.target_type]]
        if conn.execute(select(t.c.id).where(t.c.id == body.target_id)).first() is None:
            raise HTTPException(404, f"no such {body.target_type}")
        values = {"target_id": body.target_id}
        conflict = {"index_elements": ["user_id", "target_type", "target_id"],
                    "index_where": subscription.c.target_id.is_not(None)}
    stmt = pg_insert(subscription).values(user_id=user_id, target_type=body.target_type, **values)
    conn.execute(stmt.on_conflict_do_nothing(**conflict))  # following twice is a no-op
    where = [subscription.c.user_id == user_id, subscription.c.target_type == body.target_type]
    where.append(subscription.c.keyword_norm == values["keyword_norm"]
                 if body.target_type == "keyword" else subscription.c.target_id == body.target_id)
    s = conn.execute(select(subscription).where(*where)).mappings().one()
    return _sub_json(conn, s)


@router.delete("/me/subscriptions/{sub_id}", status_code=204)
def unfollow(sub_id: int, user_id: int = Depends(current_user_id),
             conn: Connection = Depends(tx_dep)) -> Response:
    conn.execute(delete(subscription).where(subscription.c.id == sub_id,
                                            subscription.c.user_id == user_id))
    return Response(status_code=204)


# ---------------------------------------------------------------- notifications & push

@router.get("/me/notifications")
def my_notifications(user_id: int = Depends(current_user_id), conn: Connection = Depends(conn_dep),
                     limit: int = 20) -> list[dict[str, Any]]:
    """Latest alerts (one per event). The service worker shows these after a push."""
    user = load_user(conn, user_id)
    rows = conn.execute(
        select(change_event, func.min(notification.c.created_at).label("notified_at"))
        .select_from(notification.join(change_event,
                                       change_event.c.id == notification.c.change_event_id))
        .where(notification.c.user_id == user_id)
        .group_by(change_event.c.id).order_by(change_event.c.id.desc())
        .limit(max(1, min(limit, 50)))).mappings().all()
    out = []
    for r in rows:
        d = describe(conn, dict(r))
        out.append({"event_id": r["id"], "event_type": r["event_type"],
                    "text": {"he": d.he, "en": d.en}, "path": f"/{user['locale']}{d.path}",
                    "detected_at": r["detected_at"], "notified_at": r["notified_at"]})
    return out


@router.get("/push/public-key")
def push_public_key(settings: Settings = Depends(get_settings)) -> dict[str, str | None]:
    return {"public_key": settings.vapid_public_key or None}


class PushKeys(BaseModel):
    p256dh: str = Field(max_length=200)
    auth: str = Field(max_length=100)


class PushRegistration(BaseModel):
    endpoint: str = Field(max_length=1000, pattern=r"^https://")
    keys: PushKeys


@router.post("/me/push", status_code=201)
def register_push(body: PushRegistration, user_id: int = Depends(current_user_id),
                  conn: Connection = Depends(tx_dep)) -> dict[str, Any]:
    stmt = pg_insert(push_subscription).values(user_id=user_id, endpoint=body.endpoint,
                                               p256dh=body.keys.p256dh, auth=body.keys.auth)
    conn.execute(stmt.on_conflict_do_update(index_elements=["endpoint"], set_={
        "user_id": user_id, "p256dh": stmt.excluded.p256dh, "auth": stmt.excluded.auth}))
    return _me(conn, user_id)


class PushRemoval(BaseModel):
    endpoint: str = Field(max_length=1000)


@router.delete("/me/push", status_code=204)
def unregister_push(body: PushRemoval, user_id: int = Depends(current_user_id),
                    conn: Connection = Depends(tx_dep)) -> Response:
    conn.execute(delete(push_subscription).where(push_subscription.c.user_id == user_id,
                                                 push_subscription.c.endpoint == body.endpoint))
    return Response(status_code=204)


# ---------------------------------------------------------------- unsubscribe
# Mail clients POST here without our CSRF header (RFC 8058 one-click), so this router
# has no CSRF dependency; the signed token is the authorisation.

public = APIRouter(prefix="/api/v1", tags=["account"])


def _unsubscribe(conn: Connection, settings: Settings, token: str) -> int:
    uid = read_unsubscribe_token(settings, token)
    if uid is None:
        raise HTTPException(400, "invalid unsubscribe link")
    conn.execute(update(app_user).where(app_user.c.id == uid).values(email_enabled=False))
    return uid


@public.post("/unsubscribe")
def unsubscribe_one_click(token: str, conn: Connection = Depends(tx_dep),
                          settings: Settings = Depends(get_settings)) -> dict[str, str]:
    _unsubscribe(conn, settings, token)
    return {"status": "unsubscribed"}


@public.get("/unsubscribe", response_class=HTMLResponse)
def unsubscribe_page(token: str, request: Request, conn: Connection = Depends(tx_dep),
                     settings: Settings = Depends(get_settings)) -> str:
    """A person clicking the link in an email. Done in one click, with a way back."""
    uid = _unsubscribe(conn, settings, token)
    lang = conn.execute(select(app_user.c.locale).where(app_user.c.id == uid)).scalar() or "he"
    msg = ("הוסרת מרשימת התפוצה. לא יישלחו אליך עוד מיילים." if lang == "he"
           else "You're unsubscribed. We won't email you again.")
    back = ("אפשר להפעיל מחדש בכל עת בדף החשבון." if lang == "he"
            else "You can turn emails back on at any time on your account page.")
    dir_ = "rtl" if lang == "he" else "ltr"
    return (f'<!doctype html><html lang="{lang}" dir="{dir_}"><meta charset="utf-8">'
            '<meta name="viewport" content="width=device-width,initial-scale=1">'
            f"<title>{html.escape(msg)}</title><body style=\"font:16px system-ui;margin:2rem\">"
            f"<h1>{html.escape(msg)}</h1><p><a href=\"/{lang}/account\">{html.escape(back)}</a>"
            "</p></body></html>")

