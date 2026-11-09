import { useOutletContext, useSearchParams } from "react-router-dom";
import { query, type Meta, type SearchHit, type SearchResult } from "../api";
import { FollowButton } from "../components/FollowButton";
import { DateText, He, L, Loader, Pagination, SourceLink, Tr, useLang } from "../components/ui";
import { ordinalKnesset, t, type Key } from "../i18n";
import { useApi } from "../useApi";

const KINDS = ["bill", "law", "person", "committee", "query"] as const;

export function SearchPage() {
  const lang = useLang();
  const meta = useOutletContext<Meta | null>();
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const type = params.get("type") ?? "";
  const knesset = params.get("knesset") ?? "";
  const stage = params.get("stage") ?? "";
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  const page = Number(params.get("page") ?? 1);
  const state = useApi<SearchResult>(q.trim() ? `/search${query({ q, type, knesset, stage, from, to, page })}` : null);

  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    if (key !== "page") next.delete("page");
    if (key === "type" && value !== "bill") next.delete("stage");
    setParams(next);
  };
  const label = (b: { he: string | null; en: string | null }) => (lang === "en" ? b.en : b.he) ?? b.he ?? "";

  return (
    <>
      <h1>{t(lang, "search")}</h1>
      <form role="search" className="search-form" onSubmit={(e) => {
        e.preventDefault();
        set("q", String(new FormData(e.currentTarget).get("q") ?? "").trim());
      }}>
        <label className="visually-hidden" htmlFor="q">{t(lang, "search")}</label>
        <input id="q" name="q" type="search" dir="auto" defaultValue={q} key={q}
               placeholder={t(lang, "searchPlaceholder")} autoFocus={!q} />
        <button type="submit">{t(lang, "search")}</button>
      </form>
      <p className="muted small">{t(lang, "searchHint")}</p>
      {q.trim().length >= 3 && <p><FollowButton type="keyword" keyword={q.trim()} /></p>}
      <div className="filters">
        <label>{t(lang, "type")}
          <select value={type} onChange={(e) => set("type", e.target.value)}>
            <option value="">{t(lang, "allKinds")}</option>
            {KINDS.map((k) => <option key={k} value={k}>{t(lang, `kind_${k}` as Key)}</option>)}
          </select>
        </label>
        {meta && (
          <label>{t(lang, "knesset")}
            <select value={knesset} onChange={(e) => set("knesset", e.target.value)}>
              <option value="">{t(lang, "allTerms")}</option>
              {meta.knesset_terms.map((k) => <option key={k} value={k}>{ordinalKnesset(lang, k)}</option>)}
            </select>
          </label>
        )}
        {meta && type === "bill" && (
          <label>{t(lang, "stage")}
            <select value={stage} onChange={(e) => set("stage", e.target.value)}>
              <option value="">{t(lang, "allStages")}</option>
              {meta.stages.map((s) => <option key={s.key} value={s.key}>{label(s.name)}</option>)}
            </select>
          </label>
        )}
        <label>{t(lang, "from")}<input type="date" value={from} onChange={(e) => set("from", e.target.value)} /></label>
        <label>{t(lang, "to")}<input type="date" value={to} onChange={(e) => set("to", e.target.value)} /></label>
      </div>
      {q.trim() && (
        <Loader state={state}>
          {(d) => d.items.length === 0 ? <p className="muted" role="status">{t(lang, "noResults")}</p> : (
            <>
              <ul className="list" aria-live="polite">
                {d.items.map((h) => <Hit key={`${h.type}:${h.id}`} h={h} meta={meta} />)}
              </ul>
              <Pagination page={d.page} pages={d.has_more ? d.page + 1 : d.page} onPage={(p) => set("page", String(p))} />
            </>
          )}
        </Loader>
      )}
    </>
  );
}

function Hit({ h, meta }: { h: SearchHit; meta: Meta | null }) {
  const lang = useLang();
  const page = { bill: `/bills/${h.id}`, person: `/mks/${h.id}`, committee: `/committees/${h.id}` }[h.type as string];
  const stage = meta?.stages.find((s) => s.key === h.stage);
  return (
    <li className="list-item">
      <span className="kind">{t(lang, `kind_${h.type}` as Key)}</span>{" "}
      {page ? <L to={page} className="item-title"><He text={h.title} /></L>
            : <a href={h.source} className="item-title" target="_blank" rel="noopener noreferrer"><He text={h.title} /></a>}
      <div className="item-meta">
        {stage && <span><Tr value={stage.name} /></span>}
        {h.knesset ? <span>{t(lang, "knesset")} {h.knesset}</span> : null}
        {h.date && <DateText iso={h.date} />}
        {page && <SourceLink href={h.source} />}
      </div>
    </li>
  );
}
