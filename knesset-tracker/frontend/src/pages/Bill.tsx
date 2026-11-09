import { useOutletContext, useParams } from "react-router-dom";
import type { Bill, Meta, TimelineEvent } from "../api";
import { Journey } from "../components/Journey";
import { DateText, He, L, Loader, Name, Section, SourceLink, StageBadge, Tr, useLang } from "../components/ui";
import { t, type Lang } from "../i18n";
import { useApi } from "../useApi";

export function BillPage() {
  const { id } = useParams();
  const lang = useLang();
  const meta = useOutletContext<Meta | null>();
  const state = useApi<Bill>(`/bills/${id}`);
  return (
    <Loader state={state}>
      {(b) => (
        <article className="stack">
          <header className="page-head">
            <h1><He text={b.name} /></h1>
            <p className="item-meta">
              <Tr value={b.type} />
              <span>{t(lang, "knesset")} {b.knesset}</span>
              {b.number && <span>{t(lang, "billNo")} {b.number}</span>}
              {b.committee && <span>{t(lang, "committee")}: <L to={`/committees/${b.committee.id}`}><He text={b.committee.name} /></L></span>}
              <SourceLink href={b.source} />
            </p>
          </header>

          <section className="card stage-card" aria-labelledby="stage-h">
            <h2 id="stage-h">{t(lang, "currentStage")}</h2>
            <p className="stage-line"><StageBadge stage={b.stage} /> {b.status && <span className="muted"><Tr value={b.status} /></span>}</p>
            {meta && <Journey stages={meta.stages} current={b.stage} privateBill={b.type.id === 54} />}
            {b.stage && <p><strong>{t(lang, "whatNext")}:</strong> <Tr value={b.stage.next} /></p>}
            {b.publication && (
              <p>{t(lang, "publication")}: <DateText iso={b.publication.date} hebrew />{" "}
                {b.publication.magazine && <span className="muted">(<He text={b.publication.series} /> {b.publication.magazine}, {b.publication.page})</span>}
              </p>
            )}
          </section>

          <Section title={t(lang, "timeline")} id="timeline">
            {b.data_notice && <p className="notice"><Tr value={b.data_notice} /></p>}
            <ol className="timeline">
              {b.timeline.map((e, i) => <TimelineItem key={i} e={e} lang={lang} />)}
            </ol>
            <p className="muted small"><Tr value={b.timeline_note} /></p>
          </Section>

          {b.initiators.length > 0 && (
            <Section title={t(lang, "initiators")} id="initiators">
              <ul className="chips">
                {b.initiators.map((i) => (
                  <li key={i.person_id}>
                    <L to={`/mks/${i.person_id}`}><Name name={i.name} /></L>
                    {!i.is_initiator && <span className="muted small"> ({t(lang, "joinedInitiators")})</span>}
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {b.summary.he && (
            <Section title={t(lang, "summary")} id="summary">
              <p className="prose"><He text={b.summary} /></p>
            </Section>
          )}

          {b.names.length > 0 && (
            <Section title={t(lang, "names")} id="names">
              <dl className="pairs">
                {b.names.map((n, i) => (
                  <div key={i}><dt><Tr value={n.stage} /></dt><dd><He text={n.name} /></dd></div>
                ))}
              </dl>
            </Section>
          )}

          {b.documents.length > 0 && (
            <Section title={t(lang, "documents")} id="documents">
              <ul className="docs">
                {b.documents.map((d) => (
                  <li key={d.url}>
                    <a href={d.url} target="_blank" rel="noopener noreferrer"><Tr value={d.type} /></a>
                    {d.format && <span className="muted small"> {d.format}</span>}
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </article>
      )}
    </Loader>
  );
}

function TimelineItem({ e, lang }: { e: TimelineEvent; lang: Lang }) {
  return (
    <li className={`tl tl-${e.kind}${e.kind === "committee_session" && e.cancelled ? " tl-cancelled" : ""}`}>
      <div className="tl-date"><DateText iso={e.date} hebrew /></div>
      <div className="tl-body">
        <strong>{t(lang, `ev_${e.kind}`)}</strong>
        {e.kind === "plenum_agenda" && <> · <Tr value={e.status} /></>}
        {e.kind === "status_change" && <> · <Tr value={e.status} /></>}
        {e.kind === "committee_session" && (
          <>
            {" · "}<L to={`/committees/${e.committee.id}`}><He text={e.committee.name} /></L>
            {e.stage && <> · <Tr value={e.stage.name} /></>}
            {e.cancelled && <> · <em>{t(lang, "cancelled")}</em></>}
            {e.session_url && <> · <a href={e.session_url} target="_blank" rel="noopener noreferrer">{t(lang, "sessionPage")}</a></>}
          </>
        )}
        {e.kind === "vote" && (
          <>
            <div><He text={e.title} />{e.subject.he && <> · <He text={e.subject} /></>}</div>
            {e.recorded && <div className="muted small">{t(lang, "recorded", { f: e.recorded.for, a: e.recorded.against, x: e.recorded.abstained })}</div>}
          </>
        )}
        {"source" in e && <> <SourceLink href={e.source} /></>}
      </div>
    </li>
  );
}
