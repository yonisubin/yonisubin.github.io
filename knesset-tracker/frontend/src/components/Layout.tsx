import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import type { Meta } from "../api";
import { dirOf, t } from "../i18n";
import { loadMeta } from "../useApi";
import { DateText, useLang } from "./ui";

export function Layout() {
  const lang = useLang();
  const { pathname, search } = useLocation();
  const [meta, setMeta] = useState<Meta | null>(null);
  useEffect(() => { loadMeta<Meta>().then(setMeta).catch(() => undefined); }, []);
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = dirOf(lang);
    document.title = t(lang, "siteName");
  }, [lang]);
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);

  const other = lang === "he" ? "en" : "he";
  const otherPath = pathname.replace(/^\/(he|en)/, `/${other}`) + search;
  const nav = (to: string, key: "bills" | "mks" | "committees") => (
    <NavLink to={`/${lang}${to}`}>{t(lang, key)}</NavLink>
  );

  return (
    <>
      <a className="skip" href="#main">{t(lang, "skip")}</a>
      <header className="site-header">
        <div className="wrap header-row">
          <Link to={`/${lang}`} className="brand">{t(lang, "siteName")}</Link>
          <nav aria-label={t(lang, "home")} className="main-nav">
            {nav("/bills", "bills")}
            {nav("/mks", "mks")}
            {nav("/committees", "committees")}
          </nav>
          <Link to={otherPath} className="lang-toggle" lang={other} hrefLang={other}>
            {t(lang, "otherLang")}
          </Link>
        </div>
      </header>
      <main id="main" className="wrap">
        <Outlet context={meta} />
      </main>
      <footer className="site-footer">
        <div className="wrap">
          <p>{t(lang, "footerData")}</p>
          {lang === "en" && <p>{t(lang, "translatedNote")}</p>}
          <p>
            {meta?.last_sync && <>{t(lang, "lastSync")}: <DateText iso={meta.last_sync} withTime /> · </>}
            <a href="/docs">{t(lang, "apiDocs")}</a>
          </p>
        </div>
      </footer>
    </>
  );
}
