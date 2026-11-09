import { useOutletContext, useSearchParams } from "react-router-dom";
import type { Meta, MkSummary } from "../api";
import { He, L, Loader, Name, useLang } from "../components/ui";
import { ordinalKnesset, t } from "../i18n";
import { useApi } from "../useApi";

export function MksPage() {
  const lang = useLang();
  const meta = useOutletContext<Meta | null>();
  const [params, setParams] = useSearchParams();
  const knesset = params.get("knesset") ?? (meta ? String(meta.current_knesset) : "");
  const state = useApi<{ knesset: number; items: MkSummary[] }>(meta ? `/mks?knesset=${knesset}` : null);
  return (
    <>
      <h1>{t(lang, "mks")}</h1>
      {meta && (
        <form className="filters" onSubmit={(e) => e.preventDefault()}>
          <label>{t(lang, "knesset")}
            <select value={knesset} onChange={(e) => setParams({ knesset: e.target.value })}>
              {meta.knesset_terms.map((k) => <option key={k} value={k}>{ordinalKnesset(lang, k)}</option>)}
            </select>
          </label>
        </form>
      )}
      <p className="muted small">{t(lang, "mkListNote")}</p>
      <Loader state={state}>
        {(d) => (
          <>
            <p className="muted" role="status">{t(lang, "results", { n: d.items.length })}</p>
            <ul className="grid">
              {d.items.map((m) => (
                <li key={m.id} className="card mini">
                  <L to={`/mks/${m.id}`} className="item-title"><Name name={m.name} /></L>
                  <div className="muted small">
                    {m.factions.length ? m.factions.map((f, i) => <span key={i}>{i > 0 && " → "}<He text={f.name} /></span>) : "–"}
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </Loader>
    </>
  );
}
