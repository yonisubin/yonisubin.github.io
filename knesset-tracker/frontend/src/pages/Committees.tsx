import { useOutletContext, useSearchParams } from "react-router-dom";
import type { CommitteeSummary, Meta } from "../api";
import { He, L, Loader, Tr, useLang } from "../components/ui";
import { ordinalKnesset, t } from "../i18n";
import { useApi } from "../useApi";

export function CommitteesPage() {
  const lang = useLang();
  const meta = useOutletContext<Meta | null>();
  const [params, setParams] = useSearchParams();
  const knesset = params.get("knesset") ?? (meta ? String(meta.current_knesset) : "");
  const state = useApi<{ knesset: number; items: CommitteeSummary[] }>(meta ? `/committees?knesset=${knesset}` : null);
  return (
    <>
      <h1>{t(lang, "committees")}</h1>
      {meta && (
        <form className="filters" onSubmit={(e) => e.preventDefault()}>
          <label>{t(lang, "knesset")}
            <select value={knesset} onChange={(e) => setParams({ knesset: e.target.value })}>
              {meta.knesset_terms.map((k) => <option key={k} value={k}>{ordinalKnesset(lang, k)}</option>)}
            </select>
          </label>
        </form>
      )}
      <Loader state={state}>
        {(d) => {
          const groups = new Map<number, CommitteeSummary[]>();
          d.items.forEach((c) => groups.set(c.type.id, [...(groups.get(c.type.id) ?? []), c]));
          return [...groups.values()].map((items) => (
            <section key={items[0].type.id} className="card" aria-label={items[0].type.he ?? ""}>
              <h2><Tr value={items[0].type} /></h2>
              <ul className="list compact">
                {items.map((c) => (
                  <li key={c.id}>
                    <L to={`/committees/${c.id}`}><He text={c.name} /></L>{" "}
                    <span className="muted small">{t(lang, "sessions", { n: c.sessions })}</span>
                  </li>
                ))}
              </ul>
            </section>
          ));
        }}
      </Loader>
    </>
  );
}
