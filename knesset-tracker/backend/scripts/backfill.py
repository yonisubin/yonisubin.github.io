"""One-off backfill, run from your own machine against the Neon connection string.

It uses the same resumable pass as the cron sync, with no time budget, so a crash or
Ctrl-C at page 4,000 continues from page 4,000 on the next run.

    DATABASE_URL=postgresql+psycopg://... python -m scripts.backfill [KNS_Bill ...]
"""
from __future__ import annotations

import argparse
import logging
import math
import time

from app.config import get_settings
from app.db import get_engine
from app.entities import BY_NAME, ENTITIES
from app.odata import ODataClient
from app.sync import sync_entity


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("entities", nargs="*", help="OData entity names (default: all)")
    p.add_argument("--chunk-seconds", type=float, default=300,
                   help="log a progress line (and a sync_run row) this often")
    args = p.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
    logging.getLogger("httpx").setLevel(logging.WARNING)
    settings = get_settings()
    engine = get_engine()
    client = ODataClient(settings.odata_base_url, min_interval=settings.min_request_interval)
    specs = [BY_NAME[n] for n in args.entities] if args.entities else ENTITIES
    try:
        for spec in specs:
            t0, total = time.monotonic(), 0
            while True:
                run = sync_entity(engine, client, spec, settings,
                                  deadline=time.monotonic() + (args.chunk_seconds or math.inf))
                total += run.fetched
                logging.info("%s: %d rows so far (%d new, %d changed), %.0fs, %d requests",
                             spec.odata, total, run.inserted, run.changed,
                             time.monotonic() - t0, client.requests)
                if run.pass_completed:
                    break
    finally:
        client.close()


if __name__ == "__main__":
    main()
