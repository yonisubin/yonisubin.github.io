import { useOutletContext } from "react-router-dom";
import type { BillSummary, Change, Meta, Paged } from "../api";
import { BillList } from "../components/BillList";
import { DateText, He, L, Loader, Section, StageBadge, useLang } from "../components/ui";
import { ordinalKnesset, t } from "../i18n";
import { useApi } from "../useApi";

export function HomePage() {
  const lang = useLang();
  const meta = useOutletContext<Meta | null>();
  const changes = useApi<Change[]>("/changes?limit=10");
  const recent = useApi<Paged<BillSummary>>(meta ? `/bills?knesset=${meta.current_knesset}&per_page=8` : null);
  return (
    <div className="stack">
      <section className="hero">
        <h1>{t(lang, "siteName")}</h1>
        <p className="lead">{t(lang, "tagline")}</p>
        <p className="muted">{meta ? ordinalKnesset(lang, meta.current_knesset) : "\u00a0"}</p>
        <p className="hero-links">
          <L to="/bills" className="button">{t(lang, "bills")}</L>
          <L to="/mks" className="button">{t(lang, "mks")}</L>
          <L to="/committees" className="button">{t(lang, "committees")}</L>
        </p>
      </section>
      <Section title={t(lang, "recentChanges")} id="changes">
        <Loader state={changes}>
          {(items) => items.length === 0 ? <p className="muted">{t(lang, "noChanges")}</p> : (
            <ul className="list">
              {items.map((c, i) => (
                <li key={i} className="list-item">
                  <L to={`/bills/${c.bill_id}`} className="item-title"><He text={c.bill_name} /></L>
                  <div className="item-meta">
                    {c.event_type === "bill.new" ? <span className="badge badge-active">{t(lang, "newBill")}</span> : <StageBadge stage={c.stage} />}
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
        <p><L to="/bills">{t(lang, "allBills")} ›</L></p>
      </Section>
    </div>
  );
}
