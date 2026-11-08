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


def get_settings() -> Settings:
    return Settings()
