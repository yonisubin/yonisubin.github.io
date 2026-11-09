import type { BillSummary } from "../api";
import { t } from "../i18n";
import { DateText, He, L, StageBadge, Tr, useLang } from "./ui";

export function BillList({ bills }: { bills: BillSummary[] }) {
  const lang = useLang();
  if (!bills.length) return <p className="muted">{t(lang, "noBills")}</p>;
  return (
    <ul className="list">
      {bills.map((b) => (
        <li key={b.id} className="list-item">
          <L to={`/bills/${b.id}`} className="item-title"><He text={b.name} /></L>
          <div className="item-meta">
            <StageBadge stage={b.stage} />
            <span><Tr value={b.type} /></span>
            {b.committee && <span><He text={b.committee.name} /></span>}
            <span>{t(lang, "knesset")} {b.knesset}</span>
            {b.last_updated && <span>{t(lang, "lastUpdated")}: <DateText iso={b.last_updated} /></span>}
          </div>
        </li>
      ))}
    </ul>
  );
}
