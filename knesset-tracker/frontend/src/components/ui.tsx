import { type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import type { Bi, PersonName, Stage, Text } from "../api";
import { formatDate, formatHebrewDate, isLang, t, type Key, type Lang } from "../i18n";
import type { State } from "../useApi";

export function useLang(): Lang {
  const { lang } = useParams();
  return isLang(lang) ? lang : "he";
}

/** Localised link: <L to="/bills/1"> becomes /he/bills/1 or /en/bills/1. */
export function L({ to, children, className }: { to: string; children: ReactNode; className?: string }) {
  const lang = useLang();
  return <Link to={`/${lang}${to}`} className={className}>{children}</Link>;
}

/** Official Hebrew text. In the English UI it is isolated so it can't scramble the
 *  surrounding left-to-right text (the bidi algorithm would otherwise reorder it). */
export function He({ text, fallback = "–" }: { text: Text | string | null | undefined; fallback?: string }) {
  const lang = useLang();
  const value = typeof text === "string" ? text : text?.he;
  if (!value) return <>{fallback}</>;
  return lang === "he" ? <>{value}</> : <bdi lang="he" dir="rtl">{value}</bdi>;
}

export function Name({ name }: { name: PersonName | Text }) {
  return <He text={name.he} />;
}

/** A bilingual value: English where we have it, marked if this project translated it. */
export function Tr({ value }: { value: Bi | null | undefined }) {
  const lang = useLang();
  if (!value) return <>–</>;
  if (lang === "en" && value.en) {
    return value.en_translated
      ? <span className="translated" title={t(lang, "translatedMark")}>
          {value.en}<span className="visually-hidden"> ({t(lang, "translatedMark")})</span>
        </span>
      : <>{value.en}</>;
  }
  return <He text={value.he ?? value.en} />;
}

export function DateText({ iso, withTime = false, hebrew = false }: { iso: string | null | undefined; withTime?: boolean; hebrew?: boolean }) {
  const lang = useLang();
  if (!iso) return <>–</>;
  return (
    <time dateTime={iso}>
      {formatDate(iso, lang, withTime)}
      {hebrew && <span className="hebrew-date"> · {formatHebrewDate(iso, lang)}</span>}
    </time>
  );
}

export function SourceLink({ href }: { href: string }) {
  const lang = useLang();
  return (
    <a className="source" href={href} target="_blank" rel="noopener noreferrer" title={t(lang, "sourceTitle")}>
      {t(lang, "source")}
    </a>
  );
}

export function StageBadge({ stage }: { stage: Stage | null }) {
  if (!stage) return null;
  const kind = stage.key === "passed" ? "passed" : stage.order >= 90 ? "ended" : "active";
  return <span className={`badge badge-${kind}`}><Tr value={stage.name} /></span>;
}

export function Section({ title, children, id }: { title: string; children: ReactNode; id?: string }) {
  const hid = id ? `${id}-h` : undefined;
  return (
    <section className="card" aria-labelledby={hid} id={id}>
      <h2 id={hid}>{title}</h2>
      {children}
    </section>
  );
}

export function Loader<T>({ state, children }: { state: State<T> & { reload: () => void }; children: (data: T) => ReactNode }) {
  const lang = useLang();
  if (state.status === "loading") return <p className="muted" role="status">{t(lang, "loading")}</p>;
  if (state.status === "error") {
    const notFound = "status" in state.error && (state.error as { status: number }).status === 404;
    return (
      <div className="card" role="alert">
        <p>{t(lang, notFound ? "notFound" : "error")}</p>
        {!notFound && <button onClick={state.reload}>{t(lang, "retry")}</button>}
      </div>
    );
  }
  return <>{children(state.data)}</>;
}

export function Pagination({ page, pages, onPage }: { page: number; pages: number; onPage: (p: number) => void }) {
  const lang = useLang();
  if (pages <= 1) return null;
  return (
    <nav className="pagination" aria-label={t(lang, "pageOf", { p: page, n: pages })}>
      <button disabled={page <= 1} onClick={() => onPage(page - 1)}>{t(lang, "prev")}</button>
      <span>{t(lang, "pageOf", { p: page, n: pages })}</span>
      <button disabled={page >= pages} onClick={() => onPage(page + 1)}>{t(lang, "next")}</button>
    </nav>
  );
}

export function T({ k, vars }: { k: Key; vars?: Record<string, string | number> }) {
  return <>{t(useLang(), k, vars)}</>;
}

export function Period({ start, finish }: { start: string | null; finish: string | null }) {
  const lang = useLang();
  return <><DateText iso={start} /> – {finish ? <DateText iso={finish} /> : t(lang, "present")}</>;
}

/** Problems the data-quality checks found in this record, disclosed, never hidden. */
export function DataNotices({ issues }: { issues: { he: string; en: string; en_translated: boolean; rule: string }[] }) {
  const lang = useLang();
  if (!issues.length) return null;
  return (
    <aside className="notice data-notice" aria-label={t(lang, "noticeTitle")}>
      <strong>{t(lang, "noticeTitle")}:</strong>
      <ul>{issues.map((i) => <li key={i.rule}><Tr value={i} /></li>)}</ul>
      <L to="/data-quality" className="small">{t(lang, "dataQuality")} ›</L>
    </aside>
  );
}
