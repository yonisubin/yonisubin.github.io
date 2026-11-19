"""Export the raw text of every searchable document (from a fully synced database) as the
corpus for the search relevance test, so CI measures relevance on real data.

    DATABASE_URL=... python -m scripts.export_search_corpus
"""
from __future__ import annotations

import gzip
import json
from collections import defaultdict
from pathlib import Path

from sqlalchemy import func, select

from app.db import get_engine
from app.entities import BY_NAME
from app.stages import BILL_STATUS, MK_POSITIONS

OUT = Path(__file__).resolve().parents[1] / "tests" / "fixtures" / "search_corpus.jsonl.gz"
T = {n: s.table for n, s in BY_NAME.items()}


def main() -> None:
    docs: list[dict] = []
    with get_engine().connect() as c:
        names = defaultdict(list)
        for bid, n in c.execute(select(T["KNS_BillName"].c.bill_id, T["KNS_BillName"].c.name_he)):
            names[bid].append(n)
        for r in c.execute(select(T["KNS_Bill"])).mappings():
            docs.append({"t": "bill", "id": r["id"], "title": r["name_he"],
                         "body": [*names[r["id"]], r["summary_he"]], "k": r["knesset_num"],
                         "stage": BILL_STATUS.get(r["status_id"], (None,))[0]})
        ptp = T["KNS_PersonToPosition"]
        term = dict(c.execute(select(ptp.c.person_id, func.max(ptp.c.knesset_num))
                              .where(ptp.c.position_id.in_(MK_POSITIONS))
                              .group_by(ptp.c.person_id)).all())
        for r in c.execute(select(T["KNS_Person"])).mappings():
            docs.append({"t": "person", "id": r["id"],
                         "title": f"{r['first_name_he'] or ''} {r['last_name_he'] or ''}".strip(),
                         "k": term.get(r["id"])})
        for name, t, kcol in (("KNS_Committee", "committee", "knesset_num"),
                              ("KNS_IsraelLaw", "law", "knesset_num"),
                              ("KNS_Query", "query", None)):
            for r in c.execute(select(T[name])).mappings():
                docs.append({"t": t, "id": r["id"], "title": r["name_he"],
                             "k": r[kcol] if kcol else None})
    with gzip.open(OUT, "wt", encoding="utf-8") as f:
        for d in docs:
            f.write(json.dumps(d, ensure_ascii=False, separators=(",", ":")) + "\n")
    print(f"{len(docs)} documents -> {OUT} ({OUT.stat().st_size / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
