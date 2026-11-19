"""Search relevance on real data.

The corpus (tests/fixtures/search_corpus.jsonl.gz) is the raw text of all 63k searchable
documents, exported from a full mirror by scripts/export_search_corpus.py and indexed here
with the current normalisation. Each case names the result a user obviously wants; ids
were looked up by exact name in the data, not copied from the engine's output.
"""
from __future__ import annotations

import gzip
import json
import time
from collections.abc import Iterator
from pathlib import Path

import pytest
from sqlalchemy import Engine, create_engine, insert, text

from app.models import metadata, search_document
from app.search import make_doc, search
from tests.conftest import TEST_DB

CORPUS = Path(__file__).parent / "fixtures" / "search_corpus.jsonl.gz"

# (query, acceptable ids as "type:id", must appear within top N, what it exercises)
CASES = [
    ("בנימין נתניהו", {"person:965"}, 1, "exact name"),
    ("נתנייהו", {"person:965"}, 3, "typo: extra letter"),
    ("בנימין נתנהו", {"person:965"}, 1, "typo: missing letter"),
    ("ששון גואתה", {"person:30879"}, 1, "typo: wrong letter (ט/ת)"),
    ("אלינור ימין", {"person:134"}, 1, "exact name"),
    ("יאיר לפיד", {"person:23594"}, 1, "exact name, namesake exists"),
    ("מירב מיכאלי", {"person:23565"}, 1, "spelling variant (מרב/מירב)"),
    ("גלעד קריב", {"person:30807"}, 1, "exact name, namesake surname"),
    ("סמוטריץ", {"person:30055"}, 1, "no geresh (סמוטריץ')"),
    ("אימן עודה", {"person:30066"}, 1, "spelling variant (איימן/אימן)"),
    ("ועדת הכספים", {"committee:4186"}, 1, "committee, current term first"),
    ("ועדת החוץ והביטחון", {"committee:4190"}, 1, "committee, current term first"),
    ("ועדת החינוך", {"committee:4192"}, 1, "partial committee name"),
    ("ועדת הכנסת", {"committee:4194"}, 1, "exact committee name"),
    ("ועדת העבודה והרווחה", {"committee:4196"}, 1, "exact committee name"),
    ("הוועדה לקידום מעמד האשה", {"committee:4200"}, 1, "spelling variant (אשה/אישה)"),
    ("חוק יסוד: הכנסת", {"law:2000037"}, 1, "basic law, punctuation differs"),
    ("כבוד האדם וחירותו", {"law:2000046"}, 1, "partial law name"),
    ("חוק עבודת נשים", {"law:2001135"}, 1, "law above its amendments"),
    ("חוק השבות", {"law:2000587"}, 1, "exact law name"),
    ("חוק חופש המידע", {"law:2000657"}, 1, "exact law name"),
    ("הגנת הצרכן", {"law:2000237"}, 3, "partial law name"),
    ("לחוק השבות", {"law:2000587"}, 3, "prefix ל"),
    ("חוֹק הַשְּׁבוּת", {"law:2000587"}, 1, "niqqud"),
    ("דמי לידה לבן הזוג בלידה שקטה", {"bill:2192800", "bill:2197992", "bill:2203816"}, 1,
     "long phrase; three identically named bills"),
    ("בחמישה שבועות נוספים", {"bill:2196528"}, 1, "words only in a bill summary"),
    ('חוק האקלים התשפ״ו', {"bill:2242558"}, 1, "gershayim and year"),
    ("השוואת תשלומים לחיילים בודדים", {f"bill:{i}" for i in (
        2085773, 2085889, 2156309, 2156558, 2158091, 2167830, 2200006)}, 1,
     "one of several identical bills"),
    ("מיסוי סיגריות אלקטרוניות", {"query:2161366"}, 1, "parliamentary question"),
    ("נשים עבודת חוק", {"law:2001135"}, 5, "words out of order"),
]


@pytest.fixture(scope="module")
def corpus_engine() -> Iterator[Engine]:
    eng = create_engine(TEST_DB)
    try:
        with eng.connect() as c:
            c.execute(text("SELECT 1"))
    except Exception as e:  # noqa: BLE001
        pytest.skip(f"no test database: {e}")
    with eng.begin() as c:
        c.execute(text("CREATE EXTENSION IF NOT EXISTS pg_trgm"))
    metadata.drop_all(eng)
    metadata.create_all(eng)
    with gzip.open(CORPUS, "rt", encoding="utf-8") as f:
        docs = [json.loads(line) for line in f]
    rows = [make_doc(d["t"], d["id"], d["title"], d.get("body") or (),
                     knesset_num=d.get("k"), stage_key=d.get("stage")) for d in docs]
    with eng.begin() as c:
        for i in range(0, len(rows), 5000):
            c.execute(insert(search_document), [r for r in rows[i:i + 5000] if r["title_norm"]])
    # as autovacuum would in production (sets the visibility map for index scans)
    with eng.connect().execution_options(isolation_level="AUTOCOMMIT") as c:
        c.execute(text("VACUUM ANALYZE search_document"))
    yield eng
    eng.dispose()


def test_relevance_set(corpus_engine):
    for q, *_ in CASES:  # warm the cache once: measure steady-state latency
        with corpus_engine.begin() as c:
            search(c, q, limit=10)
    failures, ranks, timings = [], [], []
    for q, want, top, what in CASES:
        with corpus_engine.begin() as c:
            t0 = time.perf_counter()
            res = search(c, q, limit=10)
            timings.append(time.perf_counter() - t0)
        got = [f"{i['type']}:{i['id']}" for i in res["items"]]
        rank = next((n for n, g in enumerate(got, 1) if g in want), None)
        ranks.append(rank)
        if rank is None or rank > top:
            failures.append(f"{q!r} ({what}): wanted {sorted(want)[:2]} in top {top}, "
                            f"rank {rank}; got {got[:3]}")
    mrr = sum(1 / r for r in ranks if r) / len(CASES)
    timings.sort()
    p95 = timings[int(len(timings) * 0.95) - 1]
    print(f"\nrelevance: {len(CASES) - len(failures)}/{len(CASES)} pass, MRR {mrr:.3f}, "
          f"p50 {timings[len(timings) // 2] * 1000:.0f} ms, p95 {p95 * 1000:.0f} ms")
    assert len(CASES) == 30
    assert not failures, "\n".join(failures)
    assert p95 < 0.1, f"p95 {p95 * 1000:.0f} ms exceeds the 100 ms target"


def test_filters(corpus_engine):
    with corpus_engine.begin() as c:
        laws = search(c, "חוק השבות", doc_type="law")["items"]
        assert laws and all(i["type"] == "law" for i in laws)
        k25 = search(c, "ועדת העבודה והרווחה", knesset=25)["items"]
        assert k25 and all(i["knesset"] == 25 for i in k25)
        passed = search(c, "חוק", doc_type="bill", stage="passed")["items"]
        assert passed and all(i["stage"] == "passed" for i in passed)
        assert search(c, "א")["items"] == []  # too short to search
