// Who is signed in, and what they follow, shared by every component.
import { useSyncExternalStore } from "react";
import { api, send, type Me, type Subscription, type TargetType } from "./api";

interface Session { status: "unknown" | "anonymous" | "signed-in"; me: Me | null; subs: Subscription[] }

let state: Session = { status: "unknown", me: null, subs: [] };
const listeners = new Set<() => void>();
const set = (next: Session) => { state = next; listeners.forEach((l) => l()); };

export async function refreshSession(): Promise<void> {
  try {
    const s = await api<{ me: Me | null; subscriptions: Subscription[] }>("/session");
    set(s.me ? { status: "signed-in", me: s.me, subs: s.subscriptions }
             : { status: "anonymous", me: null, subs: [] });
  } catch {
    set({ ...state, status: state.status === "unknown" ? "anonymous" : state.status });
  }
}

let started = false;
export function useSession(): Session {
  if (!started) { started = true; void refreshSession(); }
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => state);
}

export function findSub(type: TargetType, id: number | null, keyword?: string): Subscription | undefined {
  return state.subs.find((s) => s.target_type === type &&
    (type === "keyword" ? s.keyword?.trim() === keyword?.trim() : s.target_id === id));
}

export async function follow(type: TargetType, id: number | null, keyword?: string) {
  const sub = await send<Subscription>("POST", "/me/subscriptions",
    type === "keyword" ? { target_type: type, keyword } : { target_type: type, target_id: id });
  set({ ...state, subs: [sub, ...state.subs.filter((s) => s.id !== sub.id)] });
}

export async function unfollow(subId: number) {
  await send("DELETE", `/me/subscriptions/${subId}`);
  set({ ...state, subs: state.subs.filter((s) => s.id !== subId) });
}

export async function updateMe(patch: Partial<Pick<Me, "locale" | "digest_frequency" | "email_enabled">>) {
  // optimistic: the control reflects the choice at once, and rolls back if saving fails
  const before = state.me;
  if (before) set({ ...state, me: { ...before, ...patch } });
  try {
    set({ ...state, me: await send<Me>("PATCH", "/me", patch) });
  } catch (e) {
    set({ ...state, me: before });
    throw e;
  }
}

export async function signOut() {
  await send("POST", "/auth/logout");
  set({ status: "anonymous", me: null, subs: [] });
}

export function setMe(me: Me) { set({ ...state, status: "signed-in", me }); void refreshSession(); }
