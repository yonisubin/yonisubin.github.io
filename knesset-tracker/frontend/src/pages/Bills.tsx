import { useOutletContext, useSearchParams } from "react-router-dom";
import { query, type BillSummary, type Meta, type Paged } from "../api";
import { BillList } from "../components/BillList";
import { Loader, Pagination, useLang } from "../components/ui";
import { ordinalKnesset, t } from "../i18n";
import { useApi } from "../useApi";

export function BillsPage() {
  const lang = useLang();
  const meta = useOutletContext<Meta | null>();
  const [params, setParams] = useSearchParams();
  const initiator = params.get("initiator") ?? "";
  // default: the current term, or all terms when listing one MK's bills
  const knesset = params.get("knesset") ?? (initiator ? "all" : meta ? String(meta.current_knesset) : "");
  const stage = params.get("stage") ?? "";
  const type = params.get("type") ?? "";
  const page = Number(params.get("page") ?? 1);
  const state = useApi<Paged<BillSummary>>(
    meta ? `/bills${query({ knesset: knesset === "all" ? "" : knesset, stage, type, initiator, page })}` : null);

  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    if (key !== "page") next.delete("page");
    setParams(next);
  };
  const label = (b: { he: string | null; en: string | null }) => (lang === "en" ? b.en : b.he) ?? b.he ?? "";

  return (
    <>
      <h1>{t(lang, "bills")}</h1>
      {meta && (
        <form className="filters" onSubmit={(e) => e.preventDefault()}>
          <label>{t(lang, "knesset")}
            <select value={knesset} onChange={(e) => set("knesset", e.target.value)}>
              <option value="all">{t(lang, "allTerms")}</option>
              {meta.knesset_terms.map((k) => <option key={k} value={k}>{ordinalKnesset(lang, k)}</option>)}
            </select>
          </label>
          <label>{t(lang, "stage")}
            <select value={stage} onChange={(e) => set("stage", e.target.value)}>
              <option value="">{t(lang, "allStages")}</option>
              {meta.stages.map((s) => <option key={s.key} value={s.key}>{label(s.name)}</option>)}
            </select>
          </label>
          <label>{t(lang, "type")}
            <select value={type} onChange={(e) => set("type", e.target.value)}>
              <option value="">{t(lang, "allTypes")}</option>
              {meta.bill_types.map((b) => <option key={b.id} value={b.id}>{label(b)}</option>)}
            </select>
          </label>
        </form>
      )}
      <Loader state={state}>
        {(data) => (
          <>
            <p className="muted" role="status">{t(lang, "results", { n: data.total.toLocaleString(lang) })}</p>
            <BillList bills={data.items} />
            <Pagination page={data.page} pages={data.pages} onPage={(p) => set("page", String(p))} />
          </>
        )}
      </Loader>
    </>
  );
}
