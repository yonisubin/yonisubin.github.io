import { useOutletContext, useParams } from "react-router-dom";
import type { Meta, Mk } from "../api";
import { BillList } from "../components/BillList";
import { FollowButton } from "../components/FollowButton";
import { DateText, He, L, Loader, Name, Period, Section, SourceLink, Tr, useLang } from "../components/ui";
import { t } from "../i18n";
import { useApi } from "../useApi";

export function MkPage() {
  const { id } = useParams();
  const lang = useLang();
  const meta = useOutletContext<Meta | null>();
  const state = useApi<Mk>(`/mks/${id}`);
  return (
    <Loader state={state}>
      {(m) => {
        const stageName = (key: string) => meta?.stages.find((s) => s.key === key)?.name;
        return (
          <article className="stack">
            <header className="page-head">
              <h1><Name name={m.name} /></h1>
              <p className="item-meta">
                {[...new Set(m.memberships.map((x) => x.knesset))].sort((a, b) => b - a)
                  .map((k) => <span key={k}>{t(lang, "knesset")} {k}</span>)}
                <SourceLink href={m.source} />
              </p>
              <FollowButton type="mk" id={m.id} />
            </header>

            <Section title={t(lang, "factions")} id="factions">
              {m.factions.length === 0 ? <p className="muted">{t(lang, "none")}</p> : (
                <ul className="list compact">
                  {m.factions.map((f, i) => (
                    <li key={i}><He text={f.faction.name} /> <span className="muted small">({t(lang, "knesset")} {f.knesset}, <Period start={f.start} finish={f.finish} />)</span></li>
                  ))}
                </ul>
              )}
            </Section>

            {m.government.length > 0 && (
              <Section title={t(lang, "government")} id="government">
                <ul className="list compact">
                  {m.government.map((g, i) => (
                    <li key={i}><Tr value={g.position} />{g.ministry.name.he && <>, <He text={g.ministry.name} /></>} <span className="muted small">(<Period start={g.start} finish={g.finish} />)</span></li>
                  ))}
                </ul>
              </Section>
            )}

            <Section title={t(lang, "committeeRoles")} id="committees">
              {m.committees.length === 0 ? <p className="muted">{t(lang, "none")}</p> : (
                <ul className="list compact">
                  {m.committees.map((c, i) => (
                    <li key={i}>
                      <L to={`/committees/${c.committee.id}`}><He text={c.committee.name} /></L>
                      {" · "}<Tr value={c.position} /> <span className="muted small">(<Period start={c.start} finish={c.finish} />)</span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <Section title={`${t(lang, "billsInitiated")} (${m.bills.total})`} id="bills">
              {m.bills.total > 0 && (
                <dl className="pairs inline">
                  {Object.entries(m.bills.by_stage).sort((a, b) =>
                    (meta?.stages.find((s) => s.key === a[0])?.order ?? 99) - (meta?.stages.find((s) => s.key === b[0])?.order ?? 99))
                    .map(([k, n]) => <div key={k}><dt><Tr value={stageName(k)} /></dt><dd>{n}</dd></div>)}
                </dl>
              )}
              <BillList bills={m.bills.items} />
              {m.bills.total > m.bills.items.length && (
                <p><L to={`/bills?initiator=${m.id}`}>{t(lang, "showingFirst", { n: m.bills.items.length, t: m.bills.total })}</L></p>
              )}
            </Section>

            <Section title={`${t(lang, "queries")} (${m.queries.total})`} id="queries">
              {m.queries.items.length === 0 ? <p className="muted">{t(lang, "none")}</p> : (
                <ul className="list">
                  {m.queries.items.map((q) => (
                    <li key={q.id} className="list-item">
                      <span className="item-title"><He text={q.name} /></span>
                      <div className="item-meta">
                        <Tr value={q.status} />
                        {q.ministry.name.he && <span>{t(lang, "ministry")}: <He text={q.ministry.name} /></span>}
                        {q.submitted_at && <span>{t(lang, "submitted")}: <DateText iso={q.submitted_at} /></span>}
                        {q.reply_at && <span>{t(lang, "answered")}: <DateText iso={q.reply_at} /></span>}
                        <SourceLink href={q.source} />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <Section title={t(lang, "votes")} id="votes">
              <p className="muted small"><Tr value={m.votes.note} /></p>
              {m.votes.items.length === 0 ? <p className="muted">{t(lang, "none")}</p> : (
                <ul className="list compact">
                  {m.votes.items.map((v) => (
                    <li key={v.vote_id}>
                      <DateText iso={v.date} /> · <strong><Tr value={v.result} /></strong> · {v.bill_id ? <L to={`/bills/${v.bill_id}`}><He text={v.title} /></L> : <He text={v.title} />} <SourceLink href={v.source} />
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          </article>
        );
      }}
    </Loader>
  );
}
