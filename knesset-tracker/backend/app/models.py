"""Database schema: pipeline tables live here; domain tables are generated from the
entity registry in `entities.py` so each column is declared exactly once.

Domain tables deliberately have no foreign keys between them: the source data has
referential gaps (an initiator pointing at a missing person, a bill without a committee),
and we mirror what the Knesset publishes, then report the gaps in the data-quality layer.
"""
from __future__ import annotations

from sqlalchemy import (
    BigInteger,
    Boolean,
    Column,
    DateTime,
    Index,
    Integer,
    MetaData,
    String,
    Table,
    Text,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB

metadata = MetaData(naming_convention={
    "ix": "ix_%(table_name)s_%(column_0_N_name)s",
    "uq": "uq_%(table_name)s_%(column_0_N_name)s",
    "pk": "pk_%(table_name)s",
})

# Per-entity progress. A "pass" is one walk through an OData query, page by page.
# The backfill is simply the first pass (no lower bound); later passes start at the
# high-water mark minus the overlap window. Saving pass_next_url after every page
# makes both resumable: a crash at page 4,000 restarts at page 4,000.
sync_state = Table(
    "sync_state", metadata,
    Column("entity", String(64), primary_key=True),
    Column("high_water_mark", DateTime(timezone=True)),
    Column("pass_next_url", Text),
    Column("pass_lower_bound", DateTime(timezone=True)),
    Column("pass_max_seen", DateTime(timezone=True)),
    Column("pass_started_at", DateTime(timezone=True)),
    Column("last_pass_completed_at", DateTime(timezone=True)),
    Column("last_reconciled_at", DateTime(timezone=True)),
)

# There is no raw_<entity> staging layer: Phase 0 measured raw JSONB at ~1.7 GB. Each domain
# table instead has a `content_hash` BIGINT column (see entities.py), 8 bytes per row.

# Records that failed to transform keep their raw payload here for debugging.
quarantine = Table(
    "quarantine", metadata,
    Column("entity", String(64), primary_key=True),
    Column("knesset_id", Integer, primary_key=True),
    Column("payload", JSONB, nullable=False),
    Column("error", Text, nullable=False),
    Column("quarantined_at", DateTime(timezone=True), nullable=False, server_default=func.now()),
)

change_event = Table(
    "change_event", metadata,
    Column("id", BigInteger, primary_key=True, autoincrement=True),
    Column("entity_type", String(64), nullable=False),
    Column("entity_id", Integer, nullable=False),
    Column("event_type", String(64), nullable=False),
    Column("before", JSONB),
    Column("after", JSONB),
    Column("source_updated_at", DateTime(timezone=True)),
    Column("detected_at", DateTime(timezone=True), nullable=False, server_default=func.now()),
    Index(None, "entity_type", "entity_id"),
    Index(None, "detected_at"),
)

sync_run = Table(
    "sync_run", metadata,
    Column("id", BigInteger, primary_key=True, autoincrement=True),
    Column("entity", String(64), nullable=False),
    Column("kind", String(16), nullable=False),  # incremental | reconcile
    Column("started_at", DateTime(timezone=True), nullable=False, server_default=func.now()),
    Column("finished_at", DateTime(timezone=True)),
    Column("pages", Integer, nullable=False, default=0),
    Column("fetched", Integer, nullable=False, default=0),
    Column("inserted", Integer, nullable=False, default=0),
    Column("changed", Integer, nullable=False, default=0),
    Column("unchanged", Integer, nullable=False, default=0),
    Column("deleted", Integer, nullable=False, default=0),
    Column("quarantined", Integer, nullable=False, default=0),
    Column("events", Integer, nullable=False, default=0),
    Column("pass_completed", Boolean, nullable=False, default=False),
    Column("error", Text),
    Index(None, "entity", "started_at"),
)

# One row per searchable thing (bill, law, MK/person, committee, parliamentary question),
# rebuilt in the same transaction as the domain change that affects it. Text columns
# hold app.hebrew.index_text() output and have GIN trigram indexes (pg_trgm).
search_document = Table(
    "search_document", metadata,
    Column("doc_type", String(16), primary_key=True),
    Column("doc_id", Integer, primary_key=True),
    Column("title_he", Text),
    Column("title_en", Text),
    Column("title_norm", Text, nullable=False),
    Column("body_norm", Text, nullable=False, server_default=""),
    Column("knesset_num", Integer),
    Column("stage_key", String(32)),
    Column("committee_id", Integer),
    Column("person_id", Integer),
    Column("date", DateTime(timezone=True)),
    Index("ix_search_document_title_trgm", "title_norm", postgresql_using="gin",
          postgresql_ops={"title_norm": "gin_trgm_ops"}),
    Index("ix_search_document_body_trgm", "body_norm", postgresql_using="gin",
          postgresql_ops={"body_norm": "gin_trgm_ops"}),
    # short names (people, committees, laws) get typo-tolerant matching on every query
    Index("ix_search_document_short_title_trgm", "title_norm", postgresql_using="gin",
          postgresql_ops={"title_norm": "gin_trgm_ops"},
          postgresql_where=text("doc_type IN ('person', 'committee', 'law')")),
    Index(None, "doc_type", "knesset_num"),
)
