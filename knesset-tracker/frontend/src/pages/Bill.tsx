import { useOutletContext, useParams } from "react-router-dom";
import type { Bill, Meta, TimelineEvent } from "../api";
import { FollowButton } from "../components/FollowButton";
import { Journey } from "../components/Journey";
import { DataNotices, DateText, He, L, Loader, Name, SourceLink, Tr, useLang } from "../components/ui";
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
              <SourceLink href={b.source} />
            </p>
            <div><FollowButton type="bill" id={b.id} /></div>
          </header>

          <DataNotices issues={b.data_issues} />

          <section className="stage-card" aria-labelledby="stage-h">
            <h2 id="stage-h">{t(lang, "currentStage")}</h2>
            <p className={`stage-now${b.stage?.key === "passed" ? " is-passed" : ""}`}>
              <span className={`badge badge-${b.stage?.key === "passed" ? "passed" : (b.stage?.order ?? 0) >= 90 ? "ended" : "active"}`}>
                <Tr value={b.stage?.name} />
              </span>
            </p>
            {b.status && <p className="stage-line muted"><Tr value={b.status} /></p>}
            {meta && <Journey stages={meta.stages} current={b.stage} privateBill={b.type.id === 54} />}
            {b.stage && <p className="next-step"><strong>{t(lang, "whatNext")}:</strong> <Tr value={b.stage.next} /></p>}
            {b.publication && (
              <p className="next-step">
                {t(lang, "publication")}: <DateText iso={b.publication.date} hebrew />
                {b.publication.magazine && <span className="muted">. <He text={b.publication.series} /> {b.publication.magazine}, {t(lang, "pageAbbr")} {b.publication.page}</span>}
              </p>
            )}
          </section>

          <div className="record">
            <div className="stack">
              {b.summary.he && (
                <section aria-labelledby="summary-h" id="summary">
                  <h2 id="summary-h">{t(lang, "summary")}</h2>
                  <p className="official"><He text={b.summary} /></p>
                </section>
              )}
              <section aria-labelledby="timeline-h" id="timeline">
                <h2 id="timeline-h">{t(lang, "timeline")}</h2>
                {b.data_notice && <p className="notice"><Tr value={b.data_notice} /></p>}
                <ol className="timeline">
                  {b.timeline.map((e, i) => <TimelineItem key={i} e={e} lang={lang} />)}
                </ol>
                <p className="muted small prose"><Tr value={b.timeline_note} /></p>
              </section>
            </div>

            <aside className="record-aside">
              {b.initiators.length > 0 && (
                <section aria-labelledby="initiators-h" id="initiators">
                  <h2 id="initiators-h">{t(lang, "initiators")}</h2>
                  <ul className="chips">
                    {b.initiators.map((i) => (
                      <li key={i.person_id}>
                        <L to={`/mks/${i.person_id}`}><Name name={i.name} /></L>
                        {!i.is_initiator && <span className="muted small"> ({t(lang, "joinedInitiators")})</span>}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {b.committee && (
                <section aria-labelledby="committee-h">
                  <h2 id="committee-h">{t(lang, "committee")}</h2>
                  <L to={`/committees/${b.committee.id}`}><He text={b.committee.name} /></L>
                </section>
              )}
              {b.names.length > 0 && (
                <section aria-labelledby="names-h" id="names">
                  <h2 id="names-h">{t(lang, "names")}</h2>
                  <dl className="pairs">
                    {b.names.map((n, i) => (
                      <div key={i}><dt><Tr value={n.stage} /></dt><dd><He text={n.name} /></dd></div>
                    ))}
                  </dl>
                </section>
              )}
              {b.documents.length > 0 && (
                <section aria-labelledby="documents-h" id="documents">
                  <h2 id="documents-h">{t(lang, "documents")}</h2>
                  <ul className="docs">
                    {b.documents.map((d) => (
                      <li key={d.url}>
                        <a href={d.url} target="_blank" rel="noopener noreferrer"><Tr value={d.type} /></a>
                        {d.format && <span className="muted small"> ({d.format})</span>}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </aside>
          </div>
        </article>
      )}
    </Loader>
  );
}

/** One dated step: what happened on the first line, the details below it, then links. */
function TimelineItem({ e, lang }: { e: TimelineEvent; lang: Lang }) {
  return (
    <li className={`tl tl-${e.kind}${e.kind === "committee_session" && e.cancelled ? " tl-cancelled" : ""}`}>
      <div className="tl-date"><DateText iso={e.date} hebrew /></div>
      <div className="tl-body">
        <div className="tl-title">{t(lang, `ev_${e.kind}`)}</div>
        {(e.kind === "plenum_agenda" || e.kind === "status_change") && (
          <div className="tl-detail"><Tr value={e.status} /></div>
        )}
        {e.kind === "committee_session" && (
          <div className="tl-detail run">
            <L to={`/committees/${e.committee.id}`}><He text={e.committee.name} /></L>
            {e.stage && <span className="muted"><Tr value={e.stage.name} /></span>}
            {e.cancelled && <em>{t(lang, "cancelled")}</em>}
          </div>
        )}
        {e.kind === "vote" && (
          <>
            <div className="tl-detail"><He text={e.title} />{e.subject.he && <span className="muted">, <He text={e.subject} /></span>}</div>
            {e.recorded && <div className="muted small">{t(lang, "recorded", { f: e.recorded.for, a: e.recorded.against, x: e.recorded.abstained })}</div>}
          </>
        )}
        <div className="tl-links run">
          {e.kind === "committee_session" && e.session_url && (
            <a href={e.session_url} target="_blank" rel="noopener noreferrer">{t(lang, "sessionPage")}</a>
          )}
          {"source" in e && <SourceLink href={e.source} />}
        </div>
      </div>
    </li>
  );
}
