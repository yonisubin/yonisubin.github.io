"""Phase 0: measure Postgres storage per row for each entity.

Loads `PAGES` pages (100 rows each) of every entity into a JSONB table keyed on Id
(the shape of our raw_* staging tables), measures pg_total_relation_size, and
extrapolates to the full count and to Knesset 25 only.

Usage: DATABASE_URL=postgresql://... python phase0/measure_size.py phase0/out
"""
from __future__ import annotations

import json
import os
import sys
import urllib.request
from pathlib import Path

import psycopg

BASE = "https://knesset.gov.il/OdataV4/ParliamentInfo/"
PAGES = 10


def fetch(url: str) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": "knesset-tracker-explore/0.1"})
    with urllib.request.urlopen(req, timeout=90) as r:
        return json.load(r)


def main() -> None:
    out = Path(sys.argv[1] if len(sys.argv) > 1 else "phase0/out")
    entities = json.loads((out / "entities.json").read_text())
    report = []
    with psycopg.connect(os.environ["DATABASE_URL"], autocommit=True) as db:
        for ent in entities:
            name, count = ent["entity"], ent.get("count")
            if not count:
                continue
            tbl = "m_" + name.lower()
            db.execute(f"DROP TABLE IF EXISTS {tbl}")
            db.execute(f"CREATE TABLE {tbl} (id int PRIMARY KEY, payload jsonb NOT NULL)")
            url, rows = BASE + name, 0
            # sample from the newest records (closest to what we will keep)
            url += "?$orderby=Id%20desc"
            for _ in range(PAGES):
                page = fetch(url)
                with db.cursor() as cur:
                    cur.executemany(
                        f"INSERT INTO {tbl} VALUES (%s, %s) ON CONFLICT DO NOTHING",
                        [(r["Id"], json.dumps(r, ensure_ascii=False)) for r in page["value"]])
                rows += len(page["value"])
                url = page.get("@odata.nextLink")
                if not url:
                    break
            db.execute(f"VACUUM ANALYZE {tbl}")
            size = db.execute(f"SELECT pg_total_relation_size('{tbl}')").fetchone()[0]
            per_row = size / max(rows, 1)
            k25 = (ent.get("count_by_knesset") or {}).get("25")
            report.append({
                "entity": name, "count": count, "sampled": rows,
                "bytes_per_row": round(per_row),
                "est_total_mb": round(per_row * count / 1e6, 1),
                "est_k25_mb": round(per_row * k25 / 1e6, 1) if k25 is not None else None,
            })
            print(f"{name:32} {count:>9} rows  {per_row:6.0f} B/row  "
                  f"~{per_row * count / 1e6:7.1f} MB total")
    (out / "sizes.json").write_text(json.dumps(report, indent=1))
    print("TOTAL MB (raw jsonb, all terms):", round(sum(r["est_total_mb"] for r in report), 1))


if __name__ == "__main__":
    main()
