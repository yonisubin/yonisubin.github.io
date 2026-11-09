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
    CheckConstraint,
    Column,
    DateTime,
    ForeignKey,
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


# ---------------------------------------------------------------- app tables (Phase 4)
# Accounts, follows and notifications. These are the only tables that need backups:
# the Knesset data can always be rebuilt from the API.

app_user = Table(
    "app_user", metadata,
    Column("id", BigInteger, primary_key=True, autoincrement=True),
    Column("email", String(320), nullable=False, unique=True),
    Column("locale", String(2), nullable=False, server_default="he"),
    # instant | daily | weekly. Push notifications are always instant.
    Column("digest_frequency", String(8), nullable=False, server_default="daily"),
    Column("email_enabled", Boolean, nullable=False, server_default=text("true")),
    Column("created_at", DateTime(timezone=True), nullable=False, server_default=func.now()),
    Column("last_login_at", DateTime(timezone=True)),
)

# Magic links. Only a SHA-256 of the token is stored; tokens are single-use, 20 minutes.
login_token = Table(
    "login_token", metadata,
    Column("token_hash", String(64), primary_key=True),
    Column("email", String(320), nullable=False, index=True),
    Column("locale", String(2), nullable=False),
    Column("next_path", String(300)),
    Column("created_at", DateTime(timezone=True), nullable=False, server_default=func.now()),
    Column("expires_at", DateTime(timezone=True), nullable=False),
    Column("used_at", DateTime(timezone=True)),
)

subscription = Table(
    "subscription", metadata,
    Column("id", BigInteger, primary_key=True, autoincrement=True),
    Column("user_id", BigInteger, ForeignKey("app_user.id", ondelete="CASCADE"),
           nullable=False, index=True),
    Column("target_type", String(16), nullable=False),  # bill | mk | committee | keyword
    Column("target_id", Integer),
    Column("keyword", Text),
    Column("keyword_norm", Text),
    Column("created_at", DateTime(timezone=True), nullable=False, server_default=func.now()),
    CheckConstraint("(target_type = 'keyword') = (keyword_norm IS NOT NULL AND target_id IS NULL)",
                    name="ck_subscription_target_or_keyword"),
    Index("uq_subscription_target", "user_id", "target_type", "target_id", unique=True,
          postgresql_where=text("target_id IS NOT NULL")),
    Index("uq_subscription_keyword", "user_id", "keyword_norm", unique=True,
          postgresql_where=text("keyword_norm IS NOT NULL")),
    Index(None, "target_type", "target_id"),
)

# One row per user, per event, per channel. dedupe_key is unique, so a retried fan-out
# can never create a second notification. batch_id groups the rows sent in one email and
# is the provider's idempotency key, so a retried send can't deliver twice either.
notification = Table(
    "notification", metadata,
    Column("id", BigInteger, primary_key=True, autoincrement=True),
    Column("user_id", BigInteger, ForeignKey("app_user.id", ondelete="CASCADE"),
           nullable=False),
    Column("change_event_id", BigInteger, ForeignKey("change_event.id"), nullable=False),
    Column("subscription_id", BigInteger, ForeignKey("subscription.id", ondelete="SET NULL")),
    Column("channel", String(8), nullable=False),  # email | push
    Column("status", String(8), nullable=False, server_default="pending"),
    # pending -> sending -> sent; failures go back to pending until attempts run out
    Column("dedupe_key", String(100), nullable=False, unique=True),
    Column("batch_id", String(36)),
    Column("attempts", Integer, nullable=False, server_default="0"),
    Column("last_error", Text),
    Column("created_at", DateTime(timezone=True), nullable=False, server_default=func.now()),
    Column("claimed_at", DateTime(timezone=True)),
    Column("sent_at", DateTime(timezone=True)),
    Index(None, "status", "channel"),
    Index(None, "user_id", "created_at"),
    Index(None, "batch_id"),
)

push_subscription = Table(
    "push_subscription", metadata,
    Column("id", BigInteger, primary_key=True, autoincrement=True),
    Column("user_id", BigInteger, ForeignKey("app_user.id", ondelete="CASCADE"),
           nullable=False, index=True),
    Column("endpoint", Text, nullable=False, unique=True),
    Column("p256dh", Text, nullable=False),
    Column("auth", Text, nullable=False),
    Column("created_at", DateTime(timezone=True), nullable=False, server_default=func.now()),
)

# Small key/value table for pipeline cursors (e.g. the last change_event fanned out).
pipeline_cursor = Table(
    "pipeline_cursor", metadata,
    Column("name", String(64), primary_key=True),
    Column("value", BigInteger, nullable=False),
)

# Phase 5: the data-quality layer. One row per problem found in the official data;
# rows that stop matching are marked resolved, not deleted, so history is kept.
data_issue = Table(
    "data_issue", metadata,
    Column("id", BigInteger, primary_key=True, autoincrement=True),
    Column("rule", String(48), nullable=False),
    Column("entity_type", String(32), nullable=False),
    Column("entity_id", Integer, nullable=False),
    Column("details", JSONB),
    Column("first_seen", DateTime(timezone=True), nullable=False, server_default=func.now()),
    Column("last_seen", DateTime(timezone=True), nullable=False, server_default=func.now()),
    Column("resolved_at", DateTime(timezone=True)),
    Index("uq_data_issue_open", "rule", "entity_type", "entity_id", unique=True,
          postgresql_where=text("resolved_at IS NULL")),
    Index(None, "entity_type", "entity_id"),
)
