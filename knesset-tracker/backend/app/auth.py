"""Accounts without passwords: magic links and signed session cookies.

- A login link carries a random token; only its SHA-256 is stored. Single use, 20 minutes.
  The token travels in the URL fragment (#token=...), so it never reaches server logs.
- The session is a cookie "uid.expiry.hmac", HttpOnly, SameSite=Lax, Secure in production.
- State-changing API calls must send X-Requested-With, which a cross-site form can't set
  (a custom header forces a CORS preflight that we never approve).
"""
from __future__ import annotations

import hashlib
import hmac
import secrets
import time
from typing import Any

from fastapi import Depends, HTTPException, Request
from sqlalchemy import Connection, select

from .config import Settings, get_settings
from .models import app_user

COOKIE = "kt_session"
SESSION_SECONDS = 30 * 24 * 3600
LOGIN_TOKEN_MINUTES = 20
CSRF_HEADER = "x-requested-with"


def _secret(settings: Settings) -> bytes:
    if not settings.secret_key:
        raise HTTPException(503, "accounts are not configured (SECRET_KEY is unset)")
    return settings.secret_key.encode()


def sign(settings: Settings, purpose: str, value: str) -> str:
    return hmac.new(_secret(settings), f"{purpose}:{value}".encode(), hashlib.sha256).hexdigest()


def new_login_token() -> tuple[str, str]:
    token = secrets.token_urlsafe(32)
    return token, hash_token(token)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def session_cookie(settings: Settings, user_id: int, now: float | None = None) -> str:
    exp = int((now or time.time()) + SESSION_SECONDS)
    return f"{user_id}.{exp}.{sign(settings, 'session', f'{user_id}.{exp}')}"


def read_session(settings: Settings, cookie: str | None, now: float | None = None) -> int | None:
    try:
        uid, exp, sig = (cookie or "").split(".")
        if int(exp) < (now or time.time()):
            return None
        if not hmac.compare_digest(sig, sign(settings, "session", f"{uid}.{exp}")):
            return None
        return int(uid)
    except ValueError:
        return None


def unsubscribe_token(settings: Settings, user_id: int) -> str:
    return f"{user_id}.{sign(settings, 'unsubscribe', str(user_id))}"


def read_unsubscribe_token(settings: Settings, token: str) -> int | None:
    try:
        uid, sig = token.split(".")
        return int(uid) if hmac.compare_digest(sig, sign(settings, "unsubscribe", uid)) else None
    except ValueError:
        return None


def require_csrf_header(request: Request) -> None:
    unsafe = request.method in ("POST", "PUT", "PATCH", "DELETE")
    if unsafe and not request.headers.get(CSRF_HEADER):
        raise HTTPException(403, "missing X-Requested-With header")


def current_user_id(request: Request, settings: Settings = Depends(get_settings)) -> int:
    uid = read_session(settings, request.cookies.get(COOKIE))
    if uid is None:
        raise HTTPException(401, "not signed in")
    return uid


def load_user(conn: Connection, user_id: int) -> dict[str, Any]:
    u = conn.execute(select(app_user).where(app_user.c.id == user_id)).mappings().first()
    if u is None:
        raise HTTPException(401, "account no longer exists")
    return dict(u)
