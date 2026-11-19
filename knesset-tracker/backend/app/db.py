from __future__ import annotations

from functools import lru_cache

from sqlalchemy import Engine, create_engine

from .config import get_settings


@lru_cache
def get_engine(url: str | None = None) -> Engine:
    # pool_pre_ping: Neon scales to zero and drops idle connections.
    return create_engine(url or get_settings().database_url, pool_pre_ping=True)

