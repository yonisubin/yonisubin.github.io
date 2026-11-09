import type { QualityRule, StatusData } from "../api";
import { DateText, L, Loader, Section, Tr, useLang } from "../components/ui";
import { t } from "../i18n";
import { useApi } from "../useApi";

export function StatusPage() {
  const lang = useLang();
  const state = useApi<StatusData>("/status");
  return (
    <>
      <h1>{t(lang, "statusTitle")}</h1>
      <p className="muted">{t(lang, "statusIntro")}</p>
      <Loader state={state}>
        {(s) => (
          <>
            <p className={s.healthy ? "status-ok" : "status-bad"} role="status">
              <strong>{s.healthy ? `✓ ${t(lang, "statusOk")}` : `⚠ ${t(lang, "statusStale")}`}</strong>
              {s.last_successful_sync && <span className="muted"> {t(lang, "lastSync")}: <DateText iso={s.last_successful_sync} withTime /></span>}
              {s.stale_tables.length > 0 && <span className="small"><br />{t(lang, "staleTables")}: <span dir="ltr">{s.stale_tables.join(", ")}</span></span>}
            </p>
            <div className="table-wrap">
              <table className="data">
                <thead><tr><th>{t(lang, "entity")}</th><th>{t(lang, "lastSuccess")}</th><th>{t(lang, "dataUpTo")}</th><th>{t(lang, "lastErrorCol")}</th></tr></thead>
                <tbody>
                  {s.entities.map((e) => (
                    <tr key={e.entity}>
                      <td><span dir="ltr">{e.entity}</span></td>
                      <td><DateText iso={e.last_success} withTime /></td>
                      <td><DateText iso={e.data_up_to} withTime /></td>
                      <td>{e.last_error ? <span className="status-bad small" dir="ltr">{e.last_error.slice(0, 120)}</span> : "–"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Loader>
    </>
  );
}

const PAGE: Record<string, string> = { bill: "/bills/", person: "/mks/" };

export function DataQualityPage() {
  const lang = useLang();
  const state = useApi<QualityRule[]>("/data-quality");
  return (
    <>
      <h1>{t(lang, "dataQuality")}</h1>
      <p className="muted">{t(lang, "dataQualityIntro")}</p>
      <Loader state={state}>
        {(rules) => (
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>{t(lang, "noticeTitle")}</th><th>{t(lang, "openIssues")}</th><th>{t(lang, "examples")}</th></tr></thead>
              <tbody>
                {rules.map((r) => (
                  <tr key={r.rule}>
                    <td><Tr value={r.description} /><div className="ident" dir="ltr">{r.rule}</div></td>
                    <td>{r.open.toLocaleString(lang)}</td>
                    <td>{r.examples.map((id, i) => <span key={id}>{i > 0 && ", "}
                      {PAGE[r.entity_type] ? <L to={`${PAGE[r.entity_type]}${id}`}>{id}</L> : id}</span>)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Loader>
    </>
  );
}

export function ApiPage() {
  const lang = useLang();
  const he = lang === "he";
  return (
    <div className="stack">
      <h1>{t(lang, "apiTitle")}</h1>
      <p>{he
        ? "כל המידע באתר זמין כ־JSON דרך ממשק REST פתוח, בלי מפתח: שמות שדות באנגלית, עימוד, וקישור לרשומה הרשמית בכל אובייקט. התיעוד המלא (OpenAPI) נמצא בדף /docs."
        : "Everything on the site is available as JSON through an open REST API, no key needed: English field names, pagination, and a link to the official record on every object. Full OpenAPI documentation is at /docs."}</p>
      <p><a className="button" href="/docs">OpenAPI / Swagger</a></p>
      <Section title={he ? "דוגמאות" : "Examples"}>
        <pre>{`GET /api/v1/bills?knesset=25&stage=passed&page=1&per_page=20
GET /api/v1/bills/2196528          # timeline, initiators, documents
GET /api/v1/mks?knesset=25
GET /api/v1/committees/4196        # sessions and agenda items
GET /api/v1/committees/4196/calendar.ics
GET /api/v1/search?q=חיילים בודדים&type=bill
GET /api/v1/status                 # freshness per table
GET /api/v1/data-quality           # known problems in the source data`}</pre>
      </Section>
      <Section title={he ? "כללים" : "Conventions"}>
        <ul>
          <li>{he ? "טקסט רשמי בעברית תחת he; תרגום של האתר תחת en, מסומן en_translated." : "Official text in Hebrew under he; this site's translations under en, flagged en_translated."}</li>
          <li>{he ? "תאריכים בפורמט ISO 8601 (UTC)." : "Dates are ISO 8601 (UTC)."}</li>
          <li>{he ? "התשובות ניתנות לשמירה במטמון (1–10 דקות). האתר רץ על שכבות חינמיות: נא להשתמש בעדינות." : "Responses are cacheable (1–10 minutes). The site runs on free tiers: please be gentle."}</li>
          <li>{he ? "מקור המידע: המידע הפתוח של הכנסת. ראו גם " : "Data source: the Knesset's open data. See also "}<L to="/data-quality">{t(lang, "dataQuality")}</L>.</li>
        </ul>
      </Section>
    </div>
  );
}
