"""Rebuild the whole search index from the domain tables (after the migration that adds
it, or after changing app/hebrew.py). Normally the sync keeps it up to date.

    DATABASE_URL=... python -m scripts.rebuild_search
"""
from __future__ import annotations

import time

from app.db import get_engine
from app.search import rebuild_all

if __name__ == "__main__":
    t0 = time.monotonic()
    with get_engine().begin() as conn:
        counts = rebuild_all(conn)
    print(counts, f"{time.monotonic() - t0:.1f}s")
