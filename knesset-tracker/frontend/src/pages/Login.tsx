import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { send } from "../api";
import { useLang } from "../components/ui";
import { t } from "../i18n";

export function LoginPage() {
  const lang = useLang();
  const [params] = useSearchParams();
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="card narrow">
      <h1>{t(lang, "loginTitle")}</h1>
      <p>{t(lang, "loginIntro")}</p>
      {sentTo ? <p role="status" className="notice">{t(lang, "linkSent", { email: sentTo })}</p> : (
        <form onSubmit={async (e) => {
          e.preventDefault();
          const email = String(new FormData(e.currentTarget).get("email") ?? "").trim();
          setBusy(true); setError(null);
          try {
            await send("POST", "/auth/request-link", { email, locale: lang, next: params.get("next") });
            setSentTo(email);
          } catch (err) { setError((err as Error).message); }
          finally { setBusy(false); }
        }}>
          <label className="field">{t(lang, "email")}
            <input name="email" type="email" required autoComplete="email" dir="ltr" />
          </label>
          <button type="submit" disabled={busy}>{t(lang, "sendLink")}</button>
          {error && <p role="alert" className="notice">{error}</p>}
        </form>
      )}
    </div>
  );
}
