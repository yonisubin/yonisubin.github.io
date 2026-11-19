import { useCallback, useEffect, useState } from "react";
import { api } from "./api";

export type State<T> =
  | { status: "loading" }
  | { status: "error"; error: Error }
  | { status: "ok"; data: T };

export function useApi<T>(path: string | null): State<T> & { reload: () => void } {
  const [state, setState] = useState<State<T>>({ status: "loading" });
  const [n, setN] = useState(0);
  useEffect(() => {
    if (path === null) return;
    const ctrl = new AbortController();
    setState({ status: "loading" });
    api<T>(path, ctrl.signal)
      .then((data) => setState({ status: "ok", data }))
      .catch((error: Error) => { if (!ctrl.signal.aborted) setState({ status: "error", error }); });
    return () => ctrl.abort();
  }, [path, n]);
  const reload = useCallback(() => setN((x) => x + 1), []);
  return { ...state, reload };
}

// Cached once per page load: terms, stages, last sync.
let metaPromise: Promise<unknown> | null = null;
export function loadMeta<T>(): Promise<T> {
  metaPromise ??= api<T>("/meta");
  return metaPromise as Promise<T>;
}
