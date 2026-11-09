import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { send, type Me } from "../api";
import { L, useLang } from "../components/ui";
import { t } from "../i18n";
import { setMe } from "../session";

/** The magic link lands here with #token=...; the fragment never reaches the server logs. */
export function VerifyPage() {
  const lang = useLang();
  const navigate = useNavigate();
  const [failed, setFailed] = useState(false);
  const once = useRef(false);
  useEffect(() => {
    if (once.current) return;
    once.current = true;
    const token = new URLSearchParams(window.location.hash.slice(1)).get("token");
    history.replaceState(null, "", window.location.pathname); // drop the token from the URL
    if (!token) { setFailed(true); return; }
    send<{ user: Me; next: string | null }>("POST", "/auth/verify", { token })
      .then(({ user, next }) => { setMe(user); navigate(next ?? `/${lang}/account`, { replace: true }); })
      .catch(() => setFailed(true));
  }, [lang, navigate]);
  return (
    <div className="card narrow">
      {failed ? (
        <><p role="alert">{t(lang, "verifyFailed")}</p><p><L to="/login">{t(lang, "tryAgain")}</L></p></>
      ) : <p role="status">{t(lang, "verifying")}</p>}
    </div>
  );
}
