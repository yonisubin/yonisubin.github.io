import { useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { send, type AlertItem, type Me } from "../api";
import { DateText, He, L, Loader, Section, useLang } from "../components/ui";
import { t, type Key } from "../i18n";
import { disablePush, enablePush, pushSupported } from "../push";
import { refreshSession, signOut, unfollow, updateMe, useSession } from "../session";
import { useApi } from "../useApi";

const FREQS = ["instant", "daily", "weekly"] as const;
const PAGE: Record<string, string> = { bill: "/bills/", mk: "/mks/", committee: "/committees/" };

export function AccountPage() {
  const lang = useLang();
  const session = useSession();
  const navigate = useNavigate();
  const alerts = useApi<AlertItem[]>(session.status === "signed-in" ? "/me/notifications?limit=20" : null);
  const [msg, setMsg] = useState<string | null>(null);
  const [pushOnHere, setPushOnHere] = useState(false);
  useEffect(() => {
    if (!pushSupported()) return;
    navigator.serviceWorker.getRegistration("/sw.js")
      .then((r) => r?.pushManager.getSubscription()).then((s) => setPushOnHere(!!s)).catch(() => undefined);
  }, []);

  if (session.status === "unknown") return <p className="muted" role="status">{t(lang, "loading")}</p>;
  if (session.status === "anonymous" || !session.me) return <Navigate to={`/${lang}/login?next=/${lang}/account`} replace />;
  const me: Me = session.me;
  const run = async (f: () => Promise<unknown>) => {
    setMsg(null);
    try { await f(); setMsg(t(lang, "saved")); } catch (e) { setMsg((e as Error).message); }
  };

  return (
    <div className="stack">
      <header className="page-head">
        <h1>{t(lang, "account")}</h1>
        <p className="item-meta"><bdi dir="ltr">{me.email}</bdi></p>
        {msg && <p role="status" className="notice small">{msg}</p>}
      </header>

      <Section title={t(lang, "myFollows")} id="follows">
        {session.subs.length === 0 ? <p className="muted">{t(lang, "noFollows")}</p> : (
          <ul className="list compact">
            {session.subs.map((s) => (
              <li key={s.id} className="follow-row">
                <span className="kind">{t(lang, `kindLabel_${s.target_type}` as Key)}</span>{" "}
                {s.target_type === "keyword" ? <strong><He text={s.keyword} /></strong>
                  : <L to={`${PAGE[s.target_type]}${s.target_id}`}><He text={s.title} /></L>}{" "}
                <button className="link-button" onClick={() => run(() => unfollow(s.id))}>{t(lang, "unfollow")}</button>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={t(lang, "emailsSection")} id="email">
        <label className="check">
          <input type="checkbox" checked={me.email_enabled}
                 onChange={(e) => run(() => updateMe({ email_enabled: e.target.checked }))} />
          {t(lang, "emailOn")}
        </label>
        <fieldset className="radios" disabled={!me.email_enabled}>
          <legend>{t(lang, "frequency")}</legend>
          {FREQS.map((f) => (
            <label key={f}>
              <input type="radio" name="freq" value={f} checked={me.digest_frequency === f}
                     onChange={() => run(() => updateMe({ digest_frequency: f }))} />
              {t(lang, `freq_${f}` as Key)}
            </label>
          ))}
        </fieldset>
        <label className="field">{t(lang, "language")}
          <select value={me.locale} onChange={(e) => run(() => updateMe({ locale: e.target.value as "he" | "en" }))}>
            <option value="he">עברית</option><option value="en">English</option>
          </select>
        </label>
      </Section>

      <Section title={t(lang, "pushSection")} id="push">
        <p className="muted small">{t(lang, "pushDevices", { n: me.push_devices })}</p>
        {!pushSupported() ? <p className="muted">{t(lang, "pushUnsupported")}</p> : pushOnHere
          ? <button onClick={() => run(async () => { await disablePush(); setPushOnHere(false); await refreshSession(); })}>{t(lang, "pushOff")}</button>
          : <button onClick={() => run(async () => { await enablePush(); setPushOnHere(true); await refreshSession(); })}>{t(lang, "pushOn")}</button>}
      </Section>

      <Section title={t(lang, "recentAlerts")} id="alerts">
        <Loader state={alerts}>
          {(items) => items.length === 0 ? <p className="muted">{t(lang, "noAlerts")}</p> : (
            <ul className="list">
              {items.map((a) => (
                <li key={a.event_id} className="list-item">
                  <a href={a.path} className="item-title">{lang === "he" ? a.text.he : a.text.en}</a>
                  <div className="item-meta"><DateText iso={a.detected_at} withTime /></div>
                </li>
              ))}
            </ul>
          )}
        </Loader>
      </Section>

      <section className="card danger-zone" aria-label={t(lang, "deleteAccount")}>
        <button onClick={() => run(async () => { await signOut(); navigate(`/${lang}`); })}>{t(lang, "signOut")}</button>{" "}
        <button className="danger" onClick={() => {
          if (confirm(t(lang, "deleteConfirm"))) void run(async () => { await send("DELETE", "/me"); await refreshSession(); navigate(`/${lang}`); });
        }}>{t(lang, "deleteAccount")}</button>
      </section>
    </div>
  );
}
