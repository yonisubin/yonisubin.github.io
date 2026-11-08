"""Phase 0 exploration: list every entity in the Knesset OData v4 API, count rows
(total and per Knesset term where possible), pull samples, and estimate size.

Usage:  python phase0/explore.py [outdir]
Writes: outdir/entities.json, outdir/samples/<entity>.json
Uses only the standard library so it runs anywhere.
"""
from __future__ import annotations

import concurrent.futures as cf
import json
import sys
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

BASE = "https://knesset.gov.il/OdataV4/ParliamentInfo/"
EDM = "{http://docs.oasis-open.org/odata/ns/edm}"
UA = {"User-Agent": "knesset-tracker-explore/0.1"}


def get(url: str, retries: int = 4) -> bytes:
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=90) as r:
                return r.read()
        except Exception:
            if attempt == retries - 1:
                raise
            time.sleep(2 ** attempt)
    raise RuntimeError("unreachable")


def q(entity: str, **params: str) -> dict:
    qs = urllib.parse.urlencode({f"${k}": v for k, v in params.items()}, safe="$,")
    return json.loads(get(f"{BASE}{entity}?{qs}"))


def metadata() -> dict[str, dict]:
    root = ET.fromstring(get(BASE + "$metadata"))
    types = {}
    for et in root.iter(EDM + "EntityType"):
        types[et.get("Name")] = {
            "props": {p.get("Name"): p.get("Type") for p in et.findall(EDM + "Property")},
            "nav": [n.get("Name") for n in et.findall(EDM + "NavigationProperty")],
        }
    sets = {}
    for es in root.iter(EDM + "EntitySet"):
        sets[es.get("Name")] = types.get(es.get("EntityType").split(".")[-1], {})
    return sets


def profile(name: str, meta: dict, outdir: Path) -> dict:
    info: dict = {"entity": name, "fields": meta.get("props", {})}
    try:
        page = q(name, top="50", count="true")
    except Exception as e:  # noqa: BLE001
        info["error"] = str(e)[:200]
        return info
    rows = page.get("value", [])
    info["count"] = page.get("@odata.count")
    info["has_next_link"] = "@odata.nextLink" in page
    if rows:
        info["avg_row_json_bytes"] = round(
            sum(len(json.dumps(r, ensure_ascii=False).encode()) for r in rows) / len(rows))
    props = meta.get("props", {})
    if "LastUpdatedDate" in props:
        try:
            latest = q(name, top="1", orderby="LastUpdatedDate desc", select="LastUpdatedDate")
            oldest = q(name, top="1", orderby="LastUpdatedDate asc", select="LastUpdatedDate")
            info["last_updated_range"] = [
                (oldest["value"] or [{}])[0].get("LastUpdatedDate"),
                (latest["value"] or [{}])[0].get("LastUpdatedDate")]
        except Exception as e:  # noqa: BLE001
            info["last_updated_error"] = str(e)[:200]
    if "KnessetNum" in props:
        per = {}
        for k in range(16, 26):
            try:
                per[k] = q(name, top="0", count="true",
                           filter=f"KnessetNum eq {k}")["@odata.count"]
            except Exception:  # noqa: BLE001
                per[k] = None
        info["count_by_knesset"] = per
    (outdir / "samples").mkdir(parents=True, exist_ok=True)
    (outdir / "samples" / f"{name}.json").write_text(
        json.dumps(rows[:5], ensure_ascii=False, indent=1))
    return info


def main() -> None:
    outdir = Path(sys.argv[1] if len(sys.argv) > 1 else "phase0/out")
    outdir.mkdir(parents=True, exist_ok=True)
    meta = metadata()
    with cf.ThreadPoolExecutor(4) as ex:  # be polite
        results = list(ex.map(lambda n: profile(n, meta[n], outdir), sorted(meta)))
    (outdir / "entities.json").write_text(json.dumps(results, ensure_ascii=False, indent=1))
    for r in results:
        est = (r.get("count") or 0) * r.get("avg_row_json_bytes", 0) / 1e6
        print(f"{r['entity']:32} {str(r.get('count')):>9}  ~{est:7.1f} MB json"
              f"  {r.get('error', '')}")


if __name__ == "__main__":
    main()
