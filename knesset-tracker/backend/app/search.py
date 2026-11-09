"""Search: building `search_document` rows and querying them with pg_trgm.

Ranking = trigram word-similarity of the query against the title (body counts 60%),
plus boosts for a title that starts with the query, contains it, or a body that
contains it. Typos are tolerated by the similarity; prefixes (ה, ו, ב, ל...) by the
prefix-stripped variants in the index; niqqud, final letters and gershayim by
normalisation (app/hebrew.py) applied identically to documents and queries.
"""
from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterable
from datetime import datetime
from typing import Any

from sqlalchemy import Connection, delete, func, insert, select, text

from .entities import BY_NAME, EntitySpec, Row
from .hebrew import index_text, normalize
from .models import search_document
from .stages import BILL_STATUS, MK_POSITIONS

T = {name: spec.table for name, spec in BY_NAME.items()}
DOC_TYPES = ("bill", "law", "person", "committee", "query")

# which documents an entity's rows affect: entity -> (doc_type, column holding the doc id)
AFFECTS: dict[str, list[tuple[str, str]]] = {
    "KNS_Bill": [("bill", "id")],
    "KNS_BillName": [("bill", "bill_id")],
    "KNS_IsraelLaw": [("law", "id")],
    "KNS_Person": [("person", "id")],
    "KNS_PersonToPosition": [("person", "person_id")],
    "KNS_Committee": [("committee", "id")],
    "KNS_Query": [("query", "id")],
}


def affected(spec: EntitySpec, rows: Iterable[Row]) -> dict[str, set[int]]:
    out: dict[str, set[int]] = defaultdict(set)
    for doc_type, col in AFFECTS.get(spec.odata, []):
        out[doc_type].update(r[col] for r in rows if r.get(col) is not None)
    return out


def make_doc(doc_type: str, doc_id: int, title: str | None, body: Iterable[str | None] = (),
             **meta: Any) -> Row:
    """The one place a document's searchable text is built (also used by the relevance
    test, which indexes a corpus exported from the real data)."""
    return {"doc_type": doc_type, "doc_id": doc_id,
            "title_he": title.strip() if title else title,
            "title_norm": index_text(title), "body_norm": index_text(*body), **meta}


def _bill_docs(conn: Connection, ids: list[int]) -> list[Row]:
    bill, names = T["KNS_Bill"], T["KNS_BillName"]
    other_names: dict[int, list[str]] = defaultdict(list)
    for bid, name in conn.execute(select(names.c.bill_id, names.c.name_he)
                                  .where(names.c.bill_id.in_(ids))):
        other_names[bid].append(name or "")
    docs = []
    for r in conn.execute(select(bill).where(bill.c.id.in_(ids))).mappings():
        stage = BILL_STATUS.get(r["status_id"], (None, None))[0]
        docs.append(make_doc("bill", r["id"], r["name_he"],
                             [*other_names[r["id"]], r["summary_he"]],
                             knesset_num=r["knesset_num"], stage_key=stage,
                             committee_id=r["committee_id"], date=r["last_updated"]))
    return docs


def _person_docs(conn: Connection, ids: list[int]) -> list[Row]:
    person, ptp = T["KNS_Person"], T["KNS_PersonToPosition"]
    last_term = dict(conn.execute(
        select(ptp.c.person_id, func.max(ptp.c.knesset_num))
        .where(ptp.c.person_id.in_(ids), ptp.c.position_id.in_(MK_POSITIONS))
        .group_by(ptp.c.person_id)).all())
    docs = []
    for r in conn.execute(select(person).where(person.c.id.in_(ids))).mappings():
        name = " ".join(p for p in (r["first_name_he"], r["last_name_he"]) if p)
        docs.append(make_doc("person", r["id"], name, knesset_num=last_term.get(r["id"]),
                             person_id=r["id"]))
    return docs


def _simple_docs(doc_type: str, table: Any, ids: list[int], date_col: str | None,
                 knesset_col: str | None, conn: Connection, **extra_cols: str) -> list[Row]:
    docs = []
    for r in conn.execute(select(table).where(table.c.id.in_(ids))).mappings():
        docs.append(make_doc(doc_type, r["id"], r["name_he"],
                             knesset_num=r[knesset_col] if knesset_col else None,
                             date=r[date_col] if date_col else None,
                             **{k: r[v] for k, v in extra_cols.items()}))
    return docs


def rebuild(conn: Connection, doc_type: str, ids: Iterable[int]) -> int:
    """Recompute the documents for these ids (deleting those whose source is gone)."""
    id_list = sorted(set(ids))
    if not id_list:
        return 0
    if doc_type == "bill":
        docs = _bill_docs(conn, id_list)
    elif doc_type == "person":
        docs = _person_docs(conn, id_list)
    elif doc_type == "law":
        docs = _simple_docs("law", T["KNS_IsraelLaw"], id_list, "publication_date",
                            "knesset_num", conn)
    elif doc_type == "committee":
        docs = _simple_docs("committee", T["KNS_Committee"], id_list, None, "knesset_num",
                            conn, committee_id="id")
    elif doc_type == "query":
        # KnessetNum is unreliable on questions (DATA_MEMO finding 1): not stored
        docs = _simple_docs("query", T["KNS_Query"], id_list, "submitted_at", None, conn,
                            person_id="person_id")
    else:
        raise ValueError(doc_type)
    conn.execute(delete(search_document).where(search_document.c.doc_type == doc_type,
                                               search_document.c.doc_id.in_(id_list)))
    docs = [d for d in docs if d["title_norm"]]
    if docs:
        conn.execute(insert(search_document), docs)
    return len(docs)


def reindex_rows(conn: Connection, spec: EntitySpec, rows: Iterable[Row]) -> None:
    for doc_type, ids in affected(spec, rows).items():
        rebuild(conn, doc_type, ids)


def rebuild_all(conn: Connection, batch: int = 2000) -> dict[str, int]:
    sources = {"bill": T["KNS_Bill"], "law": T["KNS_IsraelLaw"], "person": T["KNS_Person"],
               "committee": T["KNS_Committee"], "query": T["KNS_Query"]}
    counts = {}
    for doc_type, table in sources.items():
        ids = [r[0] for r in conn.execute(select(table.c.id))]
        counts[doc_type] = sum(rebuild(conn, doc_type, ids[i:i + batch])
                               for i in range(0, len(ids), batch))
    return counts


# ---------------------------------------------------------------- querying

# Candidates come from a UNION of index-backed lookups (an OR of them makes Postgres
# scan the whole table); only the candidates are scored. Typo tolerance (<%, word
# similarity) applies to titles. Long text (bill summaries, earlier names) matches on
# the normalised phrase: a trigram-indexed LIKE, fast even for common words like "חוק".
# Fuzzy matching is the expensive part (it rechecks every trigram hit, and common words
# like "חוק" hit thousands of long titles). Short names (people, committees, laws: ~6k
# documents, with their own partial index) are always matched fuzzily, since that's where
# typos and spelling variants matter. Everything else is matched fuzzily only as a
# fallback, when exact matching can't fill the requested page, using strict word
# similarity. Measured on the full corpus: p95 well under the 100 ms target.
SEARCH_SQL = """
WITH cand AS (
  SELECT doc_type, doc_id FROM search_document WHERE title_norm LIKE :q_like
  {fuzzy}
  UNION SELECT doc_type, doc_id FROM search_document WHERE body_norm LIKE :q_like
)
SELECT d.*, s.score
FROM cand JOIN search_document d USING (doc_type, doc_id),
LATERAL (SELECT word_similarity(:q, d.title_norm) AS ws) w,
LATERAL (SELECT
    w.ws
  + CASE WHEN d.title_norm = :q THEN 0.6
         WHEN d.title_norm LIKE :q_prefix THEN 0.5
         WHEN d.title_norm LIKE :q_like THEN 0.3 ELSE 0 END
  + CASE WHEN d.title_norm LIKE :q_like OR w.ws >= 0.8 THEN 0  -- title already matched
         WHEN d.body_norm LIKE :q_like THEN 0.45
         WHEN {body_all_d} THEN 0.35 ELSE 0 END
  -- the principal law above the bills that amend it; for committees and MKs, whose
  -- names repeat across terms, the current term first
  + CASE d.doc_type WHEN 'law' THEN 0.15
                    WHEN 'committee' THEN 0.01 * coalesce(d.knesset_num, 0)
                    WHEN 'person' THEN 0.005 * coalesce(d.knesset_num, 0) ELSE 0 END
  - length(d.title_norm) / 20000.0
  AS score) s
WHERE TRUE {filters}
ORDER BY s.score DESC, d.knesset_num DESC NULLS LAST, d.doc_id DESC
LIMIT :limit OFFSET :offset
"""


def _like(s: str) -> str:
    return s.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def search(conn: Connection, q: str, *, doc_type: str | None = None,
           knesset: int | None = None, stage: str | None = None,
           committee_id: int | None = None, initiator: int | None = None,
           date_from: datetime | None = None, date_to: datetime | None = None,
           limit: int = 20, offset: int = 0, threshold: float = 0.45) -> dict[str, Any]:
    qn = normalize(q)
    if len(qn) < 2:
        return {"query": q, "normalized": qn, "items": [], "total": None}
    words = [w for w in qn.split() if len(w) >= 2][:6] or [qn]
    params: dict[str, Any] = {"q": qn, "q_like": f"%{_like(qn)}%", "q_prefix": f"{_like(qn)}%",
                              "limit": limit, "offset": offset}
    for i, w in enumerate(words):
        params[f"w{i}"] = f"%{_like(w)}%"
    body_all = " AND ".join(f"body_norm LIKE :w{i}" for i in range(len(words)))
    filters: list[str] = []
    if doc_type:
        filters.append("d.doc_type = :doc_type")
        params["doc_type"] = doc_type
    if knesset:
        filters.append("d.knesset_num = :knesset")
        params["knesset"] = knesset
    if stage:
        filters.append("d.stage_key = :stage")
        params["stage"] = stage
    if committee_id:
        filters.append("d.committee_id = :committee_id")
        params["committee_id"] = committee_id
    if initiator:
        filters.append("d.doc_type = 'bill' AND d.doc_id IN (SELECT bill_id FROM bill_initiator "
                       "WHERE person_id = :initiator)")
        params["initiator"] = initiator
    if date_from:
        filters.append("d.date >= :date_from")
        params["date_from"] = date_from
    if date_to:
        filters.append("d.date <= :date_to")
        params["date_to"] = date_to
    where = "".join(f" AND {f}" for f in filters)
    exact = conn.execute(text(
        "SELECT count(*) FROM (SELECT 1 FROM search_document d WHERE (d.title_norm LIKE :q_like "
        f"OR d.body_norm LIKE :q_like) {where} LIMIT :need) x"),
        params | {"need": offset + limit}).scalar_one()
    fuzzy = ("UNION SELECT doc_type, doc_id FROM search_document WHERE doc_type IN "
             "('person', 'committee', 'law') AND :q <% title_norm")
    if exact < offset + limit:
        # strict word similarity (<<%) has its own threshold (0.7, set below): whole-word
        # matches in long titles. At 0.7 it finds nearly what 0.6 does with a tenth
        # of the rechecks (measured: 50 ms -> 5 ms for a three-word query).
        fuzzy += " UNION SELECT doc_type, doc_id FROM search_document WHERE :q <<% title_norm"
    else:
        threshold = max(threshold, 0.6)  # exact matches fill the page: only close variants
    sql = text(SEARCH_SQL.replace("{fuzzy}", fuzzy)
               .replace("{body_all_d}", body_all.replace("body_norm", "d.body_norm"))
               .replace("{filters}", where))
    # typo tolerance: lower than pg_trgm's default 0.6, scoped to this transaction
    conn.execute(text("SELECT set_config('pg_trgm.word_similarity_threshold', :t, true), "
                      "set_config('pg_trgm.strict_word_similarity_threshold', '0.7', true)"),
                 {"t": str(threshold)})
    rows = conn.execute(sql, params).mappings().all()
    return {"query": q, "normalized": qn, "items": [
        {"type": r["doc_type"], "id": r["doc_id"], "title": {"he": r["title_he"]},
         "knesset": r["knesset_num"], "stage": r["stage_key"], "date": r["date"],
         "score": round(float(r["score"]), 3)} for r in rows]}
