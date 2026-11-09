"""Seed a database from the recorded test fixtures (day 1, then the synthetic day 2),
so the site can be run and tested without touching the Knesset API: used by the
end-to-end tests and the Lighthouse check in CI.

    DATABASE_URL=postgresql+psycopg://... python -m scripts.seed_fixtures
"""
from __future__ import annotations

from app.config import Settings, get_settings
from app.db import get_engine
from app.models import metadata
from tests.conftest import BASE, FakeOData, apply_day2, fixture_entities, load_day1, make_client


def main() -> None:
    from app.sync import run_sync

    engine = get_engine()
    metadata.drop_all(engine)
    metadata.create_all(engine)
    settings = Settings(database_url=get_settings().database_url, odata_base_url=BASE,
                        time_budget_seconds=300, min_request_interval=0)
    day1 = load_day1()
    server = FakeOData(day1, page_size=100)
    run_sync(engine, make_client(server), settings, fixture_entities(day1))
    server.store, _expected = apply_day2(day1)
    runs = run_sync(engine, make_client(server), settings, fixture_entities(day1))
    print(f"seeded; day-2 events: {sum(r.events for r in runs)}")


if __name__ == "__main__":
    main()
