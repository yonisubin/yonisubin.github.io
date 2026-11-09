import { useState } from "react";
import { useLocation } from "react-router-dom";
import type { TargetType } from "../api";
import { t, type Key } from "../i18n";
import { findSub, follow, unfollow, useSession } from "../session";
import { L, useLang } from "./ui";

/** Follow / Following toggle. Signed-out visitors get a link to sign in and come back. */
export function FollowButton({ type, id, keyword }: { type: TargetType; id?: number; keyword?: string }) {
  const lang = useLang();
  const session = useSession();
  const { pathname, search } = useLocation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (session.status === "unknown") return null;
  if (session.status === "anonymous") {
    const next = encodeURIComponent(pathname + search);
    return <L to={`/login?next=${next}`} className="button follow">{t(lang, "signInToFollow")}</L>;
  }
  const sub = findSub(type, id ?? null, keyword);
  const label = sub ? t(lang, "following")
    : type === "keyword" ? t(lang, "followSearch", { q: keyword ?? "" })
    : t(lang, `follow_${type}` as Key);
  return (
    <span className="follow-wrap">
      <button className={`follow${sub ? " is-following" : ""}`} aria-pressed={!!sub} disabled={busy}
              title={t(lang, "followHint")}
              onClick={async () => {
                setBusy(true); setError(null);
                try { if (sub) await unfollow(sub.id); else await follow(type, id ?? null, keyword); }
                catch (e) { setError((e as Error).message); }
                finally { setBusy(false); }
              }}>
        {label}
      </button>
      {error && <span role="alert" className="small notice">{error}</span>}
    </span>
  );
}
