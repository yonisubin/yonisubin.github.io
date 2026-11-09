import { useParams, useSearchParams } from "react-router-dom";
import type { Committee, Session } from "../api";
import { FollowButton } from "../components/FollowButton";
import { DateText, He, L, Loader, Name, Pagination, Period, Section, SourceLink, Tr, useLang } from "../components/ui";
import { t } from "../i18n";
import { useApi } from "../useApi";

export function CommitteePage() {
  const { id } = useParams();
  const lang = useLang();
  const [params, setParams] = useSearchParams();
  const page = Number(params.get("page") ?? 1);
  const state = useApi<Committee>(`/committees/${id}?page=${page}`);
  return (
    <Loader state={state}>
      {(c) => (
        <article className="stack">
          <header className="page-head">
            <h1><He text={c.name} /></h1>
            <p className="item-meta">
              <Tr value={c.type} />
              <span>{t(lang, "knesset")} {c.knesset}</span>
              <a href={`/api/v1/committees/${c.id}/calendar.ics`}>iCal</a>
              <SourceLink href={c.source} />
            </p>
            <FollowButton type="committee" id={c.id} />
          </header>

          <Section title={t(lang, "upcoming")} id="upcoming">
            <p className="muted small"><Tr value={c.calendar_note} /></p>
            {c.upcoming.length === 0 ? <p className="muted">{t(lang, "noUpcoming")}</p> : <Sessions sessions={c.upcoming} />}
          </Section>

          <Section title={`${t(lang, "past")} (${c.past.total})`} id="past">
            <Sessions sessions={c.past.items} />
            <Pagination page={c.past.page} pages={c.past.pages} onPage={(p) => setParams({ page: String(p) })} />
          </Section>

          <Section title={`${t(lang, "members")} (${c.members.length})`} id="members">
            {c.members.length === 0 ? <p className="muted">{t(lang, "none")}</p> : (
              <ul className="list compact">
                {c.members.map((m, i) => (
                  <li key={i}>
                    <L to={`/mks/${m.person_id}`}><Name name={m.name} /></L>
                    {" · "}<Tr value={m.role} /> <span className="muted small">(<Period start={m.start} finish={m.finish} />)</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </article>
      )}
    </Loader>
  );
}

function Sessions({ sessions }: { sessions: Session[] }) {
  const lang = useLang();
  return (
    <ol className="sessions">
      {sessions.map((s) => (
        <li key={s.id} className={s.cancelled ? "tl-cancelled" : undefined}>
          <div className="session-head">
            <strong><DateText iso={s.start} withTime hebrew /></strong>
            {s.cancelled && <em> · {t(lang, "cancelled")}</em>}
            {s.location && <span className="muted"> · <He text={s.location} /></span>}
            {s.session_url && <> · <a href={s.session_url} target="_blank" rel="noopener noreferrer">{t(lang, "sessionPage")}</a></>}
            {" "}<SourceLink href={s.source} />
          </div>
          {s.items.length > 0 && (
            <ul className="agenda" aria-label={t(lang, "agenda")}>
              {s.items.map((it, i) => (
                <li key={i}>{it.bill_id ? <L to={`/bills/${it.bill_id}`}><He text={it.name} /></L> : <He text={it.name} />}</li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ol>
  );
}
