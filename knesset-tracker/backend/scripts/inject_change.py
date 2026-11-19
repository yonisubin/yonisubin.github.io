"""Test helper for the end-to-end alert test: change one bill's status in the fixture
"API" and run the real sync + alert path, as the 30-minute cron would.

    DATABASE_URL=... EMAIL_BACKEND=smtp ... python -m scripts.inject_change <bill_id>

The bill moves to status 109 (approved in committee for first reading), or back to 108 if
it is already there, so every run produces exactly one change.
"""
from __future__ import annotations

import sys
from datetime import UTC, datetime, timedelta

from sqlalchemy import select

from app.alerts import run_alerts
from app.config import Settings, get_settings
from app.db import get_engine
from app.emailer import make_emailer
from app.entities import BY_NAME
from app.models import sync_state
from app.push import Pusher
from app.sync import run_sync
from tests.conftest import BASE, FakeOData, apply_day2, fixture_entities, load_day1, make_client


def main(bill_id: int) -> None:
    s = get_settings()
    engine = get_engine()
    bill = BY_NAME["KNS_Bill"].table
    with engine.connect() as c:
        current = c.execute(select(bill.c.status_id).where(bill.c.id == bill_id)).scalar_one()
        hwm = c.execute(select(sync_state.c.high_water_mark)
                        .where(sync_state.c.entity == "KNS_Bill")).scalar()
    store, _ = apply_day2(load_day1())
    row = store["KNS_Bill"][bill_id]
    row["StatusID"] = 108 if current == 109 else 109
    # the fixtures' synthetic "day 2" is dated in the future, so stamp the change after
    # the high-water mark: otherwise the incremental sync (rightly) wouldn't look at it
    stamp = max(datetime.now(UTC), (hwm or datetime.now(UTC)) + timedelta(minutes=1))
    row["LastUpdatedDate"] = stamp.isoformat()
    sync_settings = Settings(database_url=s.database_url, odata_base_url=BASE,
                             time_budget_seconds=120, min_request_interval=0)
    runs = run_sync(engine, make_client(FakeOData(store, page_size=100)), sync_settings,
                    fixture_entities(store))
    out = run_alerts(engine, make_emailer(s), Pusher("", "", s.vapid_subject), s)
    print({"events": sum(r.events for r in runs), **out})


if __name__ == "__main__":
    main(int(sys.argv[1]))
