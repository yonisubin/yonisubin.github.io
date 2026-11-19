"""Hand-written translations of the Knesset's coded values.

`KNS_Status.OrderTransition` is empty and several statuses share a description
(DATA_MEMO finding 5), so the stage model and its order are written here by hand.
Every English string in this file is the project's own translation and is labelled
as such in the UI; Hebrew values from the official data are shown as published.
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Stage:
    key: str
    order: int          # position on the bill journey; terminal stages share 90+
    he: str
    en: str
    next_he: str
    next_en: str


STAGES: dict[str, Stage] = {s.key: s for s in [
    Stage("tabled", 1, "הונחה על שולחן הכנסת", "Tabled",
          "השלב הבא: דיון והצבעה בקריאה טרומית במליאה.",
          "Next: a preliminary reading debate and vote in the plenum."),
    Stage("continuity", 2, "בקשה להחלת דין רציפות", "Continuity request",
          "הכנסת מחליטה אם להמשיך את הדיון בהצעה מהכנסת הקודמת.",
          "Next: the Knesset decides whether to continue this bill from the previous Knesset."),
    Stage("preliminary_reading", 3, "קריאה טרומית", "Preliminary reading",
          "השלב הבא: אם תאושר בקריאה טרומית, ועדת הכנסת תקבע איזו ועדה תכין אותה "
          "לקריאה ראשונה.",
          "Next: if approved in the preliminary reading, the House Committee decides which "
          "committee prepares it for the first reading."),
    Stage("committee_assignment", 4, "בוועדת הכנסת לקביעת הוועדה המטפלת",
          "Assigning a committee",
          "השלב הבא: הוועדה שנקבעה מכינה את ההצעה לקריאה ראשונה.",
          "Next: the assigned committee prepares the bill for its first reading."),
    Stage("committee_first", 5, "בוועדה: הכנה לקריאה ראשונה",
          "In committee: preparing for first reading",
          "השלב הבא: לאחר אישור בוועדה, ההצעה עולה לקריאה ראשונה במליאה.",
          "Next: once the committee approves it, the bill goes to the plenum for its "
          "first reading."),
    Stage("first_reading", 6, "קריאה ראשונה", "First reading",
          "השלב הבא: אם תאושר בקריאה ראשונה, ההצעה חוזרת לוועדה להכנה לקריאה שנייה "
          "ושלישית.",
          "Next: if approved in the first reading, the bill returns to committee to prepare "
          "for the second and third readings."),
    Stage("committee_second_third", 7, "בוועדה: הכנה לקריאה שנייה ושלישית",
          "In committee: preparing for second and third readings",
          "השלב הבא: לאחר אישור בוועדה, ההצעה עולה לקריאה שנייה ושלישית במליאה.",
          "Next: once the committee approves it, the bill goes to the plenum for its second "
          "and third readings."),
    Stage("second_third_reading", 8, "קריאה שנייה ושלישית", "Second and third readings",
          "השלב הבא: אם תאושר בקריאה שלישית, ההצעה הופכת לחוק ומתפרסמת ברשומות.",
          "Next: if approved in the third reading, the bill becomes law and is published "
          "in Reshumot, the official gazette."),
    Stage("passed", 9, "התקבלה כחוק", "Passed into law",
          "ההצעה התקבלה בקריאה שלישית. החוק נכנס לתוקף עם פרסומו ברשומות.",
          "The bill passed its third reading. The law takes effect when it is published in "
          "Reshumot."),
    Stage("pending_procedure", 90, "ממתינה להחלטה פרוצדורלית", "Procedural decision pending",
          "ממתינה להחלטה על מיזוג, פיצול או הסרה מסדר היום (ראו סטטוס).",
          "A decision on merging, splitting or removing the bill is pending (see status)."),
    Stage("merged", 91, "מוזגה עם הצעת חוק אחרת", "Merged into another bill",
          "ההצעה מוזגה עם הצעת חוק אחרת וממשיכה במסגרתה.",
          "This bill was merged with another bill and continues as part of it."),
    Stage("converted", 92, "הוסבה להצעה לסדר היום", "Converted to an agenda motion",
          "ההצעה הוסבה להצעה לסדר היום ואינה ממשיכה כהצעת חוק.",
          "This bill became a motion for the agenda and no longer advances as a bill."),
    Stage("stopped", 93, "נעצרה", "Stopped",
          "לא נקבעו שלבים נוספים. הצעה שנעצרה בסוף כהונת כנסת יכולה לעיתים להימשך בכנסת "
          "הבאה לפי דין רציפות.",
          "No further steps are scheduled. A bill stopped at the end of a Knesset term can "
          "sometimes be continued by the next Knesset under the continuity rule."),
]}

# (stage key, English status text). The Hebrew status text comes from KNS_Status.
BILL_STATUS: dict[int, tuple[str, str]] = {
    101: ("committee_first", "Preparing for first reading"),
    104: ("tabled", "Tabled for preliminary reading"),
    106: ("committee_assignment", "In the House Committee, which is choosing the handling "
                                  "committee"),
    108: ("committee_first", "Preparing for first reading"),
    109: ("committee_first", "Approved in committee for first reading"),
    110: ("continuity", "Request to apply continuity rejected in the plenum"),
    111: ("first_reading", "For plenum debate ahead of the first reading"),
    113: ("committee_second_third", "Preparing for second and third readings"),
    114: ("second_third_reading", "For plenum debate ahead of the second and third readings"),
    115: ("committee_second_third", "Returned to committee to prepare for the third reading"),
    117: ("second_third_reading", "For plenum debate ahead of the third reading"),
    118: ("passed", "Passed in the third reading"),
    120: ("continuity", "For plenum debate on applying continuity"),
    122: ("merged", "Merged with another bill"),
    124: ("converted", "Converted to a motion for the agenda"),
    126: ("pending_procedure", "Awaiting House Committee approval of a merger"),
    130: ("second_third_reading", "Tabled for the second and third readings"),
    131: ("second_third_reading", "Tabled for the third reading"),
    140: ("pending_procedure", "To be removed from the agenda at a committee's request"),
    141: ("first_reading", "Tabled for the first reading"),
    142: ("committee_assignment", "In the House Committee, which is choosing the handling "
                                  "committee"),
    143: ("pending_procedure", "To be removed from the agenda at a committee's request"),
    150: ("preliminary_reading", "In the plenum for the preliminary reading"),
    158: ("pending_procedure", "Awaiting plenum approval of a split"),
    161: ("pending_procedure", "Awaiting plenum approval of a split"),
    162: ("pending_procedure", "Awaiting plenum approval of a split"),
    165: ("pending_procedure", "Awaiting plenum approval of a split"),
    167: ("committee_first", "Approved in committee for first reading"),
    169: ("pending_procedure", "Awaiting House Committee approval of a merger"),
    175: ("continuity", "Committee debating whether to apply continuity"),
    176: ("continuity", "Request to apply continuity rejected in committee"),
    177: ("stopped", "Stopped"),
    178: ("committee_second_third", "Approved in committee for second and third readings"),
    179: ("committee_second_third", "Approved in committee for second and third readings"),
    181: ("continuity", "Notice of a request to apply continuity"),
    182: ("continuity", "In the House Committee, choosing a committee for the continuity "
                       "request"),
}

QUERY_STATUS = {6: "With the ministry", 8: "The minister declined to answer", 9: "Answered",
                12: "Answer date set"}
BILL_SUBTYPE = {53: "Government bill", 54: "Private member's bill", 55: "Committee bill"}
BILL_SUBTYPE_HE = {53: "ממשלתית", 54: "פרטית", 55: "ועדה"}  # as KNS_Bill.SubTypeDesc
COMMITTEE_TYPE = {70: "House Committee", 71: "Permanent committee", 72: "Special committee",
                  73: "Joint committee", 74: "Subcommittee"}
VOTE_RESULT = {6: "Present", 7: "For", 8: "Against", 9: "Abstained", 10: "Absent", 11: "Voted"}
VOTE_RESULT_HE = {6: "נוכח", 7: "בעד", 8: "נגד", 9: "נמנע", 10: "לא נכח", 11: "הצביע"}
BILL_NAME_STAGE = {5200: "At the preliminary reading", 5201: "At the first reading",
                   5202: "At the second and third readings", 5203: "At the third reading",
                   10062: "As passed", 10064: "Commonly known as", 5205: "Display name"}
DOCUMENT_GROUP = {
    1: "Bill for the preliminary reading", 2: "Bill for the first reading",
    3: "Bill for the first reading (revised)", 4: "Bill for the second and third readings",
    5: "Bill for the second and third readings: table of amendments",
    8: "Law: unofficial text", 9: "Law: as published in Reshumot",
    12: "Knesset Research and Information Center document", 17: "Government decision",
    46: "Bill for the second and third readings: re-tabled",
    51: "Bill for the preliminary reading (revised)", 57: "Reshumot: correction",
    59: "Background material", 122: "Regulatory impact assessment",
}
POSITION = {
    29: "Coalition chair", 30: "Coalition chair", 31: "Deputy prime minister",
    39: "Minister", 40: "Deputy minister", 41: "Committee chair", 42: "Committee member",
    43: "Member of Knesset", 45: "Prime minister", 48: "Faction chair",
    50: "Deputy prime minister", 51: "Acting prime minister", 54: "Faction member",
    57: "Minister", 59: "Deputy minister", 61: "Member of Knesset",
    65: "Deputy prime minister", 66: "Committee member", 67: "Substitute committee member",
    70: "Deputy speaker", 71: "Deputy speaker", 73: "Alternate prime minister",
    122: "Speaker of the Knesset", 123: "Speaker of the Knesset", 130: "Opposition leader",
    131: "Opposition leader", 663: "Committee observer", 285078: "Interim speaker",
    285079: "Deputy minister",
}
MK_POSITIONS = (43, 61)
FACTION_POSITIONS = (54,)
COMMITTEE_POSITIONS = (41, 42, 66, 67, 663)
GOVERNMENT_POSITIONS = (31, 39, 40, 45, 50, 51, 57, 59, 65, 73, 285079)
COMMITTEE_SESSION_CANCELLED = 193


def stage_for_status(status_id: int | None) -> Stage | None:
    info = BILL_STATUS.get(status_id) if status_id is not None else None
    return STAGES[info[0]] if info else None


def translated(he: str | None, en: str | None) -> dict[str, object]:
    """A bilingual value. `en_translated` marks English written by this project."""
    return {"he": he, "en": en, "en_translated": en is not None}
