"""The data-quality layer: rule-based checks over the mirror (DATA_MEMO findings, turned
into code). Runs nightly with the reconciliation rather than after every 30-minute sync:
the checks scan whole tables, and running them 48 times a day would keep Neon awake for
little gain, since most of these problems come from old records that rarely change.

Each rule is one SQL query returning (entity_id, details). Findings are upserted into
`data_issue`; issues that no longer match are marked resolved.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

from sqlalchemy import Connection, func, select, text, update

from .models import data_issue
from .stages import BILL_STATUS, STAGES


@dataclass(frozen=True)
class Rule:
    key: str
    entity_type: str
    he: str          # notice shown on the affected page
    en: str
    sql: str         # returns entity_id, details (jsonb or NULL)


# stage order per status, as SQL, for the out-of-order check. Committee assignment and
# continuity have no fixed place (for government bills the House Committee assigns a
# committee *after* the first reading; for private bills, before), so they're left out:
# the first version flagged every such government bill.
_FLOATING = {"committee_assignment", "continuity"}
_ORDER = " ".join(f"WHEN {sid} THEN {STAGES[key].order}" for sid, (key, _) in BILL_STATUS.items()
                  if STAGES[key].order < 90 and key not in _FLOATING)
_STAGE_CASE = f"CASE pi.status_id {_ORDER} END"

RULES: list[Rule] = [
    Rule("initiator_missing_person", "bill",
         "אחד היוזמים הרשומים להצעה אינו מופיע ברשימת האנשים במידע הרשמי.",
         "One of this bill's listed initiators doesn't exist in the official list of people.",
         """SELECT bi.bill_id, jsonb_build_object('person_id', bi.person_id)
            FROM bill_initiator bi LEFT JOIN person p ON p.id = bi.person_id
            WHERE p.id IS NULL"""),
    Rule("bill_missing_committee", "bill",
         "במידע הרשמי מצוינת ועדה מטפלת שאינה קיימת ברשימת הוועדות.",
         "The official data names a handling committee that isn't in the list of committees.",
         """SELECT b.id, jsonb_build_object('committee_id', b.committee_id)
            FROM bill b LEFT JOIN committee c ON c.id = b.committee_id
            WHERE b.committee_id IS NOT NULL AND c.id IS NULL"""),
    Rule("bill_no_dated_steps", "bill",
         "למידע הרשמי אין תאריכים לשלבי הצעת החוק, ולכן ציר הזמן ריק.",
         "The official data has no dates for this bill's steps, so its timeline is empty.",
         """SELECT b.id, NULL::jsonb FROM bill b
            WHERE NOT EXISTS (SELECT 1 FROM plenum_session_item pi
                              WHERE pi.item_type_id = 2 AND pi.item_id = b.id)
              AND NOT EXISTS (SELECT 1 FROM committee_session_item ci
                              WHERE ci.item_type_id = 2 AND ci.item_id = b.id)
              AND NOT EXISTS (SELECT 1 FROM plenum_vote v WHERE v.item_id = b.id)"""),
    Rule("bill_stages_out_of_order", "bill",
         "בציר הזמן שלב מאוחר מתוארך לפני שלב מוקדם יותר. זה יכול להיות נכון (למשל כשהצעה "
         "חוזרת לשלב קודם) או טעות במידע הרשמי.",
         "On this timeline a later stage is dated before an earlier one. That can be correct "
         "(e.g. a bill sent back to an earlier stage) or an error in the official data.",
         f"""WITH s AS (
               SELECT pi.item_id AS bill_id, ps.start_at, {_STAGE_CASE} AS ord
               FROM plenum_session_item pi JOIN plenum_session ps ON ps.id = pi.session_id
               WHERE pi.item_type_id = 2)
             SELECT a.bill_id, jsonb_build_object('earlier_stage_date', min(a.start_at),
                                                  'later_stage_date', min(b.start_at))
             FROM s a JOIN s b ON a.bill_id = b.bill_id AND b.ord > a.ord + 1
                              AND b.start_at < a.start_at - interval '1 day'
             GROUP BY a.bill_id"""),
    Rule("session_ends_before_start", "committee_session",
         "שעת הסיום של הישיבה במידע הרשמי מוקדמת משעת ההתחלה.",
         "This session's official end time is before its start time.",
         """SELECT id, jsonb_build_object('start', start_at, 'finish', finish_at)
            FROM committee_session WHERE finish_at < start_at"""),
    Rule("vote_result_missing_person", "plenum_vote",
         "בתוצאות ההצבעה מופיע חבר כנסת שאינו ברשימת האנשים במידע הרשמי.",
         "This vote's results include an MK who isn't in the official list of people.",
         """SELECT r.vote_id, jsonb_agg(DISTINCT r.person_id)
            FROM plenum_vote_result r LEFT JOIN person p ON p.id = r.person_id
            WHERE p.id IS NULL GROUP BY r.vote_id"""),
    Rule("query_impossible_term", "parl_query",
         "מספר הכנסת הרשום לשאילתה אינו אפשרי (המידע הרשמי מתחיל בכנסת ה־19).",
         "This question's recorded Knesset term is impossible (the official data starts in "
         "the 19th Knesset).",
         """SELECT id, jsonb_build_object('knesset_num', knesset_num_raw)
            FROM parl_query WHERE knesset_num_raw < 16"""),
    Rule("person_duplicate_name", "person",
         "במידע הרשמי יש יותר מרשומה אחת של אדם בשם זה.",
         "The official data has more than one person record with this name.",
         """SELECT p.id, jsonb_build_object('same_name_ids', d.ids)
            FROM person p JOIN (
              SELECT first_name_he, last_name_he, jsonb_agg(id ORDER BY id) AS ids
              FROM person GROUP BY first_name_he, last_name_he HAVING count(*) > 1) d
            USING (first_name_he, last_name_he)"""),
    Rule("name_encoding", "bill",
         "בשם ההצעה במידע הרשמי יש תווים פגומים או רווחים כפולים.",
         "This bill's official name contains damaged characters or doubled spaces.",
         r"""SELECT id, jsonb_build_object('name', name_he) FROM bill
             WHERE name_he ~ '(�|Ã|×[\x80-\xbf]|\s{2,}|[\x01-\x08\x0b\x0c\x0e-\x1f])'"""),
    Rule("bill_stale_in_stage", "bill",
         "ההצעה לא התקדמה זמן רב בהרבה מהרגיל לשלב הזה.",
         "This bill has stayed in its stage much longer than is typical.",
         """WITH cur AS (SELECT max(knesset_num) AS k FROM knesset_period WHERE is_current),
              last_step AS (
               SELECT b.id, b.status_id, greatest(
                   (SELECT max(ps.start_at) FROM plenum_session_item pi
                    JOIN plenum_session ps ON ps.id = pi.session_id
                    WHERE pi.item_type_id = 2 AND pi.item_id = b.id),
                   (SELECT max(cs.start_at) FROM committee_session_item ci
                    JOIN committee_session cs ON cs.id = ci.session_id
                    WHERE ci.item_type_id = 2 AND ci.item_id = b.id)) AS at
               FROM bill b, cur WHERE b.knesset_num = cur.k AND b.status_id IN ({active})),
              p95 AS (SELECT status_id,
                        percentile_cont(0.95) WITHIN GROUP (ORDER BY now() - at) AS limit_age,
                        count(*) AS n
                      FROM last_step WHERE at IS NOT NULL GROUP BY status_id)
            SELECT l.id, jsonb_build_object('since', l.at, 'days', extract(day from now() - l.at))
            FROM last_step l JOIN p95 USING (status_id)
            WHERE p95.n >= 20 AND now() - l.at > p95.limit_age
              AND now() - l.at > interval '180 days'""".replace(
            "{active}", ",".join(str(s) for s, (k, _) in BILL_STATUS.items()
                                 if STAGES[k].order < 9))),
]
BY_KEY = {r.key: r for r in RULES}
# Committee membership is "as reported" (Hasadna #133), and absent MKs mostly have no vote
# row (DATA_MEMO finding 4): both are disclosed in the UI as general notes, not per record.


def run_checks(conn: Connection) -> dict[str, dict[str, int]]:
    """Run every rule; returns {rule: {found, new, resolved}}."""
    report = {}
    for rule in RULES:
        found = {int(r[0]): r[1] for r in conn.execute(text(rule.sql)) if r[0] is not None}
        open_rows = dict(conn.execute(
            select(data_issue.c.entity_id, data_issue.c.id).where(
                data_issue.c.rule == rule.key, data_issue.c.resolved_at.is_(None))).all())
        new = [eid for eid in found if eid not in open_rows]
        if new:
            conn.execute(data_issue.insert(), [
                {"rule": rule.key, "entity_type": rule.entity_type, "entity_id": eid,
                 "details": found[eid] if not isinstance(found[eid], str)
                 else json.loads(found[eid])} for eid in new])
        still = [open_rows[eid] for eid in found if eid in open_rows]
        if still:
            conn.execute(update(data_issue).where(data_issue.c.id.in_(still))
                         .values(last_seen=func.now()))
        gone = [iid for eid, iid in open_rows.items() if eid not in found]
        if gone:
            conn.execute(update(data_issue).where(data_issue.c.id.in_(gone))
                         .values(resolved_at=func.now()))
        report[rule.key] = {"found": len(found), "new": len(new), "resolved": len(gone)}
    return report


def issues_for(conn: Connection, entity_type: str, entity_id: int) -> list[dict[str, Any]]:
    """Notices for one page (bill, person, committee session...)."""
    rows = conn.execute(select(data_issue.c.rule, data_issue.c.details, data_issue.c.first_seen)
                        .where(data_issue.c.entity_type == entity_type,
                               data_issue.c.entity_id == entity_id,
                               data_issue.c.resolved_at.is_(None))).mappings()
    return [{"rule": r["rule"], "he": BY_KEY[r["rule"]].he, "en": BY_KEY[r["rule"]].en,
             "en_translated": True, "details": r["details"], "since": r["first_seen"]}
            for r in rows if r["rule"] in BY_KEY]


def summary(conn: Connection) -> list[dict[str, Any]]:
    counts: dict[str, int] = dict(conn.execute(select(data_issue.c.rule, func.count())
                               .where(data_issue.c.resolved_at.is_(None))
                               .group_by(data_issue.c.rule)).all())
    examples: dict[str, list[int]] = {}
    for rule in RULES:
        examples[rule.key] = list(conn.execute(
            select(data_issue.c.entity_id).where(data_issue.c.rule == rule.key,
                                                 data_issue.c.resolved_at.is_(None))
            .order_by(data_issue.c.entity_id.desc()).limit(5)).scalars())
    return [{"rule": r.key, "entity_type": r.entity_type, "open": counts.get(r.key, 0),
             "description": {"he": r.he, "en": r.en, "en_translated": True},
             "examples": examples[r.key]} for r in RULES]
