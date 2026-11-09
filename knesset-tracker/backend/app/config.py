"""Runtime configuration, read from environment variables."""
from __future__ import annotations

import os
from dataclasses import dataclass, field


def _env(name: str, default: str) -> str:
    return os.environ.get(name, default)


@dataclass(frozen=True)
class Settings:
    database_url: str = field(
        default_factory=lambda: _env(
            "DATABASE_URL", "postgresql+psycopg://postgres@localhost/knesset"))
    odata_base_url: str = field(
        default_factory=lambda: _env(
            "ODATA_BASE_URL", "https://knesset.gov.il/OdataV4/ParliamentInfo/"))
    # Secret shared with the Wasmer cron job; sent as the X-Internal-Token header.
    internal_token: str = field(default_factory=lambda: _env("INTERNAL_TOKEN", ""))
    # Lowest Knesset term mirrored for term-scoped entities (see phase0/DATA_MEMO.md).
    min_knesset: int = field(default_factory=lambda: int(_env("MIN_KNESSET", "23")))
    # Re-read this many seconds before the high-water mark to catch late writes.
    overlap_seconds: int = field(default_factory=lambda: int(_env("SYNC_OVERLAP_SECONDS", "3600")))
    # Stop starting new pages after this many seconds (about 80% of the cron timeout).
    time_budget_seconds: float = field(
        default_factory=lambda: float(_env("SYNC_TIME_BUDGET_SECONDS", "240")))
    # Politeness: minimum gap between requests to the Knesset API.
    min_request_interval: float = field(
        default_factory=lambda: float(_env("ODATA_MIN_REQUEST_INTERVAL", "0.25")))
    # ---- Phase 4: accounts and alerts
    # Signs session cookies and unsubscribe links. Required in production.
    secret_key: str = field(default_factory=lambda: _env("SECRET_KEY", ""))
    public_base_url: str = field(
        default_factory=lambda: _env("PUBLIC_BASE_URL", "http://localhost:8000"))
    # console (log only) | smtp (Mailpit locally, Brevo) | resend (HTTP API, idempotent)
    email_backend: str = field(default_factory=lambda: _env("EMAIL_BACKEND", "console"))
    email_from: str = field(
        default_factory=lambda: _env("EMAIL_FROM", "Knesset Tracker <alerts@localhost>"))
    smtp_host: str = field(default_factory=lambda: _env("SMTP_HOST", "localhost"))
    smtp_port: int = field(default_factory=lambda: int(_env("SMTP_PORT", "1025")))
    smtp_user: str = field(default_factory=lambda: _env("SMTP_USER", ""))
    smtp_password: str = field(default_factory=lambda: _env("SMTP_PASSWORD", ""))
    smtp_starttls: bool = field(default_factory=lambda: _env("SMTP_STARTTLS", "0") == "1")
    resend_api_key: str = field(default_factory=lambda: _env("RESEND_API_KEY", ""))
    # Web Push (VAPID). Generate with: python -m scripts.vapid_keys
    vapid_private_key: str = field(default_factory=lambda: _env("VAPID_PRIVATE_KEY", ""))
    vapid_public_key: str = field(default_factory=lambda: _env("VAPID_PUBLIC_KEY", ""))
    vapid_subject: str = field(
        default_factory=lambda: _env("VAPID_SUBJECT", "mailto:alerts@localhost"))
    # Marks the session cookie Secure (on everywhere except plain-http local dev).
    cookie_secure: bool = field(
        default_factory=lambda: _env("COOKIE_SECURE", "1") == "1")


def get_settings() -> Settings:
    return Settings()
