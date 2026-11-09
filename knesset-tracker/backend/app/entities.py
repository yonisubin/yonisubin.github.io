"""The entity registry: which OData entities we mirror, how each maps to a domain
table, how it is scoped, and which change events it produces.

Each `Col` names its source field once; the domain `Table`, the transform and the
schema check (`required_fields`) are all derived from it.
"""
from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from sqlalchemy import (
    BigInteger,
    Boolean,
    Column,
    DateTime,
    Index,
    Integer,
    SmallInteger,
    Table,
    Text,
)
from sqlalchemy.types import TypeEngine

from .models import metadata

Row = dict[str, Any]


# ---------------------------------------------------------------- converters

def to_dt(v: Any) -> datetime | None:
    if v in (None, ""):
        return None
    return datetime.fromisoformat(v)


def to_text(v: Any) -> str | None:
    if v is None:
        return None
    s = str(v).strip()
    return s or None


def to_url(v: Any) -> str | None:
    # The API mixes separators: https://fs.knesset.gov.il/25\law\25_ls1_1.pdf
    s = to_text(v)
    return s.replace("\\", "/") if s else None


def ident(v: Any) -> Any:
    return v


def to_ref(v: Any) -> int | None:
    # The API writes -1 for "no committee" on most bills (found by the data-quality checks)
    return v if isinstance(v, int) and v > 0 else None


@dataclass(frozen=True)
class Col:
    source: str
    type: type[TypeEngine[Any]] | TypeEngine[Any]
    convert: Callable[[Any], Any] = ident
    index: bool = False


def I(src: str, index: bool = False) -> Col:  # noqa: E743 - short helpers keep specs readable
    return Col(src, Integer, ident, index)


def R(src: str, index: bool = False) -> Col:
    """A reference to another entity's id; placeholder values like -1 become NULL."""
    return Col(src, Integer, to_ref, index)


def T(src: str) -> Col:
    return Col(src, Text, to_text)


def D(src: str) -> Col:
    return Col(src, DateTime(timezone=True), to_dt)


def B(src: str) -> Col:
    return Col(src, Boolean, ident)


# ---------------------------------------------------------------- events

EventFn = Callable[[Row | None, Row], list[str]]


def default_events(name: str) -> EventFn:
    def fn(before: Row | None, after: Row) -> list[str]:
        return [f"{name}.new"] if before is None else [f"{name}.updated"]
    return fn


def bill_events(before: Row | None, after: Row) -> list[str]:
    if before is None:
        return ["bill.new"]
    if before.get("status_id") != after.get("status_id"):
        return ["bill.stage_changed"]
    return ["bill.updated"]


def committee_session_events(before: Row | None, after: Row) -> list[str]:
    if before is None:
        return ["committee_session.scheduled"]
    if before.get("status_id") != after.get("status_id"):
        return ["committee_session.status_changed"]
    if before.get("start_at") != after.get("start_at"):
        return ["committee_session.rescheduled"]
    return ["committee_session.updated"]


def person_position_events(before: Row | None, after: Row) -> list[str]:
    if after.get("faction_id") is not None and (
        before is None or before.get("faction_id") != after.get("faction_id")
    ):
        return ["mk.faction_changed"]
    return default_events("person_position")(before, after)


def query_events(before: Row | None, after: Row) -> list[str]:
    if before is None:
        return ["query.new"]
    if before.get("reply_at") is None and after.get("reply_at") is not None:
        return ["query.answered"]
    return ["query.updated"]


def vote_events(before: Row | None, after: Row) -> list[str]:
    return ["vote.recorded"] if before is None else ["vote.updated"]


# ---------------------------------------------------------------- spec

@dataclass
class EntitySpec:
    odata: str                    # OData entity set, e.g. KNS_Bill
    table_name: str               # domain table
    columns: dict[str, Col]       # domain column -> source field
    scope: Callable[[int], str | None] = lambda _min_k: None   # extra $filter, given MIN_KNESSET
    events: EventFn | None = None  # None = no change events (bulk/noisy tables)
    small: bool = False           # re-read completely by the nightly reconciliation
    indexes: tuple[tuple[str, ...], ...] = ()
    table: Table = field(init=False)

    def __post_init__(self) -> None:
        cols = [Column("id", Integer, primary_key=True, autoincrement=False)]
        cols += [Column(n, c.type, index=c.index) for n, c in self.columns.items()]
        # Hash of the source record (sync.content_hash); unchanged records stop there.
        cols.append(Column("content_hash", BigInteger, nullable=False))
        idx = [Index(None, *names) for names in self.indexes]
        self.table = Table(self.table_name, metadata, *cols, *idx)

    @property
    def required_fields(self) -> set[str]:
        return {"Id", "LastUpdatedDate", *(c.source for c in self.columns.values())} - {""}

    @property
    def volatile_columns(self) -> set[str]:
        """Columns copied from LastUpdatedDate: stored, but never a reason for an event
        (the timestamp cascades from parent records, see DATA_MEMO)."""
        return {n for n, c in self.columns.items() if c.source == "LastUpdatedDate"}

    def transform(self, raw: Row) -> Row:
        row: Row = {"id": int(raw["Id"])}
        for name, col in self.columns.items():
            row[name] = col.convert(raw.get(col.source))
        return row


def term_scope(path: str = "KnessetNum") -> Callable[[int], str]:
    return lambda min_k: f"{path} ge {min_k}"


# Order matters only for readability of the first backfill: reference data first.
ENTITIES: list[EntitySpec] = [
    EntitySpec("KNS_Status", "status", {
        "desc_he": T("Desc"), "type_id": I("TypeID"), "type_desc_he": T("TypeDesc"),
        "is_active": B("IsActive"),
    }, small=True),
    EntitySpec("KNS_KnessetDates", "knesset_period", {
        "knesset_num": I("KnessetNum"), "name_he": T("Name"), "assembly": I("Assembly"),
        "plenum": I("Plenum"), "plenum_start": D("PlenumStart"),
        "plenum_finish": D("PlenumFinish"), "is_current": B("IsCurrent"),
    }, small=True),
    EntitySpec("KNS_Position", "position", {
        "desc_he": T("Description"), "gender_id": I("GenderID"),
    }, small=True),
    EntitySpec("KNS_GovMinistry", "ministry", {
        "name_he": T("Name"), "is_active": B("IsActive"),
    }, small=True),
    EntitySpec("KNS_Person", "person", {
        "first_name_he": T("FirstName"), "last_name_he": T("LastName"),
        "gender_id": I("GenderID"), "gender_desc_he": T("GenderDesc"),
        "is_current": B("IsCurrent"), "last_updated": D("LastUpdatedDate"),
    }, events=default_events("person"), small=True),
    EntitySpec("KNS_Faction", "faction", {
        "name_he": T("Name"), "knesset_num": I("KnessetNum", index=True),
        "start_date": D("StartDate"), "finish_date": D("FinishDate"),
        "is_current": B("IsCurrent"),
    }, events=default_events("faction"), small=True),
    EntitySpec("KNS_Committee", "committee", {
        "name_he": T("Name"), "knesset_num": I("KnessetNum", index=True),
        "type_id": I("CommitteeTypeID"), "type_desc_he": T("CommitteeTypeDesc"),
        "category_id": I("CategoryID"), "category_desc_he": T("CategoryDesc"),
        "parent_committee_id": I("ParentCommitteeID"), "email": T("Email"),
        "start_date": D("StartDate"), "finish_date": D("FinishDate"),
        "is_current": B("IsCurrent"),
    }, events=default_events("committee"), small=True),
    EntitySpec("KNS_IsraelLaw", "law", {
        "knesset_num": I("KnessetNum"), "name_he": T("Name"), "is_basic_law": B("IsBasicLaw"),
        "is_budget_law": B("IsBudgetLaw"), "publication_date": D("PublicationDate"),
        "latest_publication_date": D("LatestPublicationDate"),
        "validity_desc_he": T("LawValidityDesc"), "validity_start": D("ValidityStartDate"),
        "validity_finish": D("ValidityFinishDate"),
    }, events=default_events("law"), small=True),
    EntitySpec("KNS_PersonToPosition", "person_position", {
        "person_id": I("PersonID", index=True), "position_id": I("PositionID"),
        "knesset_num": I("KnessetNum"), "faction_id": I("FactionID"),
        "faction_name_he": T("FactionName"), "committee_id": I("CommitteeID", index=True),
        "committee_name_he": T("CommitteeName"), "ministry_id": I("GovMinistryID"),
        "ministry_name_he": T("GovMinistryName"), "duty_desc_he": T("DutyDesc"),
        "government_num": I("GovernmentNum"), "start_date": D("StartDate"),
        "finish_date": D("FinishDate"), "is_current": B("IsCurrent"),
    }, scope=term_scope(), events=person_position_events),
    EntitySpec("KNS_Bill", "bill", {
        "knesset_num": I("KnessetNum", index=True), "name_he": T("Name"),
        "type_id": I("TypeID"), "sub_type_id": I("SubTypeID"),
        "sub_type_desc_he": T("SubTypeDesc"), "private_number": I("PrivateNumber"),
        "number": I("Number"), "committee_id": R("CommitteeID", index=True),
        "status_id": I("StatusID", index=True),
        "postponement_reason_he": T("PostponementReasonDesc"),
        "publication_date": D("PublicationDate"),
        "publication_series_he": T("PublicationSeriesDesc"),
        "magazine_number": T("MagazineNumber"), "page_number": T("PageNumber"),
        "is_continuation": B("IsContinuationBill"), "summary_he": T("SummaryLaw"),
        "last_updated": D("LastUpdatedDate"),
    }, scope=term_scope(), events=bill_events),
    EntitySpec("KNS_BillInitiator", "bill_initiator", {
        "bill_id": I("BillID", index=True), "person_id": I("PersonID", index=True),
        "is_initiator": B("IsInitiator"), "ordinal": I("Ordinal"),
    }, scope=term_scope("KNS_Bill/KnessetNum"), events=default_events("bill_initiator")),
    EntitySpec("KNS_BillName", "bill_name", {
        "bill_id": I("BillID", index=True), "name_he": T("Name"),
        "stage_type_id": I("NameHistoryTypeID"), "stage_desc_he": T("NameHistoryTypeDesc"),
    }, scope=term_scope("KNS_Bill/KnessetNum")),
    EntitySpec("KNS_DocumentBill", "bill_document", {
        "bill_id": I("BillID", index=True), "group_type_id": I("GroupTypeID"),
        "group_type_desc_he": T("GroupTypeDesc"), "format": T("ApplicationDesc"),
        "url": Col("FilePath", Text, to_url),
    }, scope=term_scope("KNS_Bill/KnessetNum"), events=default_events("bill_document")),
    EntitySpec("KNS_CommitteeSession", "committee_session", {
        "committee_id": I("CommitteeID", index=True), "knesset_num": I("KnessetNum"),
        "number": I("Number"), "type_desc_he": T("TypeDesc"), "status_id": I("StatusID"),
        "status_desc_he": T("StatusDesc"), "location": T("Location"),
        "session_url": Col("SessionUrl", Text, to_url),
        "broadcast_url": Col("BroadcastUrl", Text, to_url),
        "start_at": D("StartDate"), "finish_at": D("FinishDate"), "note": T("Note"),
    }, scope=term_scope(), events=committee_session_events, indexes=(("start_at",),)),
    EntitySpec("KNS_CmtSessionItem", "committee_session_item", {
        "session_id": I("CommitteeSessionID", index=True), "item_id": I("ItemID"),
        "item_type_id": I("ItemTypeID"), "ordinal": I("Ordinal"), "status_id": I("StatusID"),
        "name_he": T("Name"),
    }, scope=term_scope("KNS_CommitteeSession/KnessetNum"),
       indexes=(("item_type_id", "item_id"),)),
    EntitySpec("KNS_PlenumSession", "plenum_session", {
        "knesset_num": I("KnessetNum"), "number": I("Number"), "name_he": T("Name"),
        "start_at": D("StartDate"), "finish_at": D("FinishDate"),
        "is_special": B("IsSpecialMeeting"),
    }, scope=term_scope()),
    EntitySpec("KNS_PlmSessionItem", "plenum_session_item", {
        "session_id": I("PlenumSessionID", index=True), "item_id": I("ItemID"),
        "item_type_id": I("ItemTypeID"), "ordinal": Col("Ordinal", Integer),
        "status_id": I("StatusID"), "name_he": T("Name"), "is_discussion": I("IsDiscussion"),
    }, scope=term_scope("KNS_PlenumSession/KnessetNum"),
       indexes=(("item_type_id", "item_id"),)),
    EntitySpec("KNS_PlenumVote", "plenum_vote", {
        "session_id": I("SessionID", index=True), "item_id": I("ItemID", index=True),
        "voted_at": D("VoteDateTime"), "ordinal": I("Ordinal"),
        "method_desc_he": T("VoteMethodDesc"), "status_desc_he": T("VoteStatusDesc"),
        "title_he": T("VoteTitle"), "subject_he": T("VoteSubject"),
        "is_no_confidence": B("IsNoConfidenceInGov"),
        "for_option_desc_he": T("ForOptionDesc"),
        "against_option_desc_he": T("AgainstOptionDesc"),
    }, scope=term_scope("KNS_PlenumSession/KnessetNum"), events=vote_events),
    # ~50-60 rows per vote: kept narrow (Phase 0 measured 96 B/row typed) and silent.
    EntitySpec("KNS_PlenumVoteResult", "plenum_vote_result", {
        "vote_id": I("VoteID", index=True), "person_id": I("MkId"),
        "result_code": Col("ResultCode", SmallInteger),
    }, scope=term_scope("Vote/KNS_PlenumSession/KnessetNum"),
       indexes=(("person_id", "vote_id"),)),
    # KnessetNum is unreliable on questions (DATA_MEMO finding 1), so mirror them all.
    EntitySpec("KNS_Query", "parl_query", {
        "knesset_num_raw": I("KnessetNum"), "number": I("Number"), "name_he": T("Name"),
        "type_desc_he": T("TypeDesc"), "status_id": I("StatusID"),
        "person_id": I("PersonID", index=True), "ministry_id": I("GovMinistryID"),
        "submitted_at": D("SubmitDate"), "reply_at": D("ReplyMinisterDate"),
        "reply_planned_at": D("ReplyDatePlanned"),
    }, events=query_events),
    EntitySpec("KNS_Agenda", "agenda", {
        "knesset_num": I("KnessetNum"), "number": I("Number"), "name_he": T("Name"),
        "sub_type_desc_he": T("SubTypeDesc"), "status_id": I("StatusID"),
        "initiator_person_id": I("InitiatorPersonID", index=True),
        "committee_id": I("CommitteeID"), "classification_desc_he": T("ClassificationDesc"),
        "gov_recommendation_desc_he": T("GovRecommendationDesc"),
    }, scope=term_scope(), events=default_events("agenda")),
]

BY_NAME: dict[str, EntitySpec] = {e.odata: e for e in ENTITIES}
