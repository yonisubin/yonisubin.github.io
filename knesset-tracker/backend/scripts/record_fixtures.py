"""Capture a small, real slice of the API as test fixtures (tests/fixtures/day1).

The integration tests replay these through a fake OData server. The "day 2" changes
are applied on top in tests/conftest.py, so the tests know exactly which events to
expect. Re-run this to refresh the slice; the tests pick records by role, not by id.
"""
from __future__ import annotations

import json
from pathlib import Path

from app.config import get_settings
from app.odata import ODataClient, build_url

OUT = Path(__file__).resolve().parents[1] / "tests" / "fixtures" / "day1"


def main() -> None:
    c = ODataClient(get_settings().odata_base_url)
    base = c.base_url

    def fetch(entity: str, *filters: str, orderby: str | None = None, top: int | None = None):
        url = build_url(base, entity, filters=list(filters), orderby=orderby)
        rows = []
        while url:
            page = c.get_page(url)
            rows += page.rows
            url = page.next_url
            if top and len(rows) >= top:
                return rows[:top]
        return rows

    data: dict[str, list] = {}
    data["KNS_Status"] = fetch("KNS_Status")
    data["KNS_Faction"] = fetch("KNS_Faction", "KnessetNum eq 25")
    data["KNS_Committee"] = fetch("KNS_Committee", "KnessetNum eq 25")
    passed = fetch("KNS_Bill", "Id eq 2196528")
    # bills still in the pipeline (preparing for first reading), newest first
    open_bills = fetch("KNS_Bill", "KnessetNum eq 25", "StatusID eq 108",
                       orderby="LastUpdatedDate desc", top=4)
    data["KNS_Bill"] = passed + open_bills
    ids = [b["Id"] for b in data["KNS_Bill"]]
    any_id = " or ".join(f"BillID eq {i}" for i in ids)
    data["KNS_BillInitiator"] = fetch("KNS_BillInitiator", any_id)
    data["KNS_PlmSessionItem"] = fetch(
        "KNS_PlmSessionItem", " or ".join(f"ItemID eq {i}" for i in ids))
    data["KNS_CmtSessionItem"] = fetch(
        "KNS_CmtSessionItem", " or ".join(f"ItemID eq {i}" for i in ids))
    data["KNS_PlenumVote"] = fetch("KNS_PlenumVote", "ItemID eq 2196528")
    data["KNS_PlenumVoteResult"] = [r for v in data["KNS_PlenumVote"]
                                    for r in fetch("KNS_PlenumVoteResult", f"VoteID eq {v['Id']}")]

    def by_ids(entity: str, ids_: set[int]) -> list:
        ids_l = sorted(ids_)
        return [r for i in range(0, len(ids_l), 15) for r in fetch(
            entity, " or ".join(f"Id eq {x}" for x in ids_l[i:i + 15]))]

    # the sessions those agenda items belong to, so the timeline has dates
    data["KNS_PlenumSession"] = by_ids(
        "KNS_PlenumSession", {r["PlenumSessionID"] for r in data["KNS_PlmSessionItem"]})
    latest = fetch("KNS_CommitteeSession", "KnessetNum eq 25", orderby="Id desc", top=10)
    referenced = by_ids("KNS_CommitteeSession",
                        {r["CommitteeSessionID"] for r in data["KNS_CmtSessionItem"]})
    data["KNS_CommitteeSession"] = list({r["Id"]: r for r in latest + referenced}.values())
    people = sorted({r["PersonID"] for r in data["KNS_BillInitiator"]} |
                    {r["MkId"] for r in data["KNS_PlenumVoteResult"]})
    # the server rejects filters with more than 100 nodes, so ask in chunks
    data["KNS_Person"] = [r for i in range(0, len(people), 15) for r in fetch(
        "KNS_Person", " or ".join(f"Id eq {p}" for p in people[i:i + 15]))]
    data["KNS_PersonToPosition"] = fetch("KNS_PersonToPosition", f"PersonID eq {people[0]}",
                                         "KnessetNum eq 25")
    data["KNS_Query"] = fetch("KNS_Query", "KnessetNum eq 25", "ReplyMinisterDate eq null",
                              orderby="Id desc", top=5)
    OUT.mkdir(parents=True, exist_ok=True)
    for entity, rows in data.items():
        (OUT / f"{entity}.json").write_text(json.dumps(rows, ensure_ascii=False, indent=1) + "\n")
        print(f"{entity}: {len(rows)}")
    c.close()


if __name__ == "__main__":
    main()
