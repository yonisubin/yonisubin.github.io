import { useNavigate, useOutletContext } from "react-router-dom";
import type { Bill, BillSummary, Change, Meta, Paged } from "../api";
import { BillList } from "../components/BillList";
import { Journey } from "../components/Journey";
import { DateText, He, L, Loader, Section, Tr, useLang } from "../components/ui";
import { t } from "../i18n";
import { useApi } from "../useApi";

export function HomePage() {
  const lang = useLang();
  const navigate = useNavigate();
  const meta = useOutletContext<Meta | null>();
  const changes = useApi<Change[]>("/changes?limit=10");
  const recent = useApi<Paged<BillSummary>>(meta ? `/bills?knesset=${meta.current_knesset}&per_page=8` : null);
  // the hero shows the latest bill that moved stage; before any movement is detected,
  // the most recently updated bill
  const moved = changes.status === "ok" ? changes.data.find((c) => c.event_type === "bill.stage_changed") : undefined;
  const featuredId = moved?.bill_id ?? (recent.status === "ok" ? recent.data.items[0]?.id : undefined);
  const featured = useApi<Bill>(featuredId ? `/bills/${featuredId}` : null);

  return (
    <div className="stack">
      <section className="hero" aria-labelledby="hero-h">
        <h1 id="hero-h">{t(lang, "heroTitle")}</h1>
        <p className="lead">{t(lang, "heroLead")}</p>
        <form role="search" className="hero-search" onSubmit={(e) => {
          e.preventDefault();
          const q = String(new FormData(e.currentTarget).get("q") ?? "").trim();
          if (q) navigate(`/${lang}/search?q=${encodeURIComponent(q)}`);
        }}>
          <label className="visually-hidden" htmlFor="hero-q">{t(lang, "search")}</label>
          <input id="hero-q" name="q" type="search" dir="auto" placeholder={t(lang, "searchPlaceholder")} />
          <button type="submit">{t(lang, "search")}</button>
        </form>
      </section>

      {/* rendered from the start, at its final size, so nothing below it jumps (CLS) */}
      <section className="movement" aria-labelledby="movement-h" aria-busy={featured.status !== "ok"}>
        <p className="movement-label" id="movement-h">{t(lang, moved ? "latestMovement" : "recentlyUpdatedOne")}</p>
        {featuredId && (
          <Loader state={featured}>
            {(b) => (
              <>
                <L to={`/bills/${b.id}`} className="item-title"><He text={b.name} /></L>
                <p className="item-meta">
                  {b.status && <Tr value={b.status} />}
                  {(moved?.detected_at ?? b.last_updated) && <DateText iso={moved?.detected_at ?? b.last_updated} />}
                </p>
                {meta && <Journey stages={meta.stages} current={b.stage} privateBill={b.type.id === 54} compact />}
              </>
            )}
          </Loader>
        )}
      </section>

      <Section title={t(lang, "recentChanges")} id="changes">
        <Loader state={changes}>
          {(items) => items.length === 0 ? <p className="muted">{t(lang, "noChanges")}</p> : (
            <ul className="list">
              {items.map((c, i) => (
                <li key={i} className="list-item">
                  <L to={`/bills/${c.bill_id}`} className="item-title"><He text={c.bill_name} /></L>
                  <div className="item-meta">
                    {c.event_type === "bill.new" ? <span className="badge badge-active">{t(lang, "newBill")}</span>
                      : c.stage && <span className={`badge badge-${c.stage.key === "passed" ? "passed" : c.stage.order >= 90 ? "ended" : "active"}`}><Tr value={c.stage.name} /></span>}
                    <DateText iso={c.detected_at} withTime />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Loader>
      </Section>

      <Section title={t(lang, "recentlyUpdated")} id="recent">
        <Loader state={recent}>{(d) => <BillList bills={d.items} />}</Loader>
        <p><L to="/bills">{t(lang, "allBills")}</L></p>
      </Section>
    </div>
  );
}
