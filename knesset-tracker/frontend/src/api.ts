// Types mirror backend/app/read.py. Hebrew values as published; `en` where available.

export interface Text { he: string | null }
export interface Bi { he: string | null; en: string | null; en_translated?: boolean }
export interface Stage { key: string; order: number; name: Bi; next: Bi }
export interface Status extends Bi { id: number }
export interface Ref { id: number; name: Text }
export interface PersonName { he: string | null; first_he: string | null; last_he: string | null }
export interface Paged<T> { items: T[]; page: number; per_page: number; total: number; pages: number }

export interface Meta {
  current_knesset: number; knesset_terms: number[]; last_sync: string | null;
  stages: Stage[]; bill_types: (Bi & { id: number })[];
}

export interface BillSummary {
  id: number; knesset: number; name: Text; type: Bi & { id: number };
  status: Status | null; stage: Stage | null; committee: Ref | null;
  last_updated: string | null; source: string;
}

export interface Vote {
  id: number; title: Text; subject: Text; session_id: number; source: string;
  recorded: { for: number; against: number; abstained: number } | null;
}

export type TimelineEvent =
  | { kind: "plenum_agenda"; date: string | null; stage: Stage | null; status: Status | null; session_id: number; source: string }
  | { kind: "committee_session"; date: string | null; stage: Stage | null; committee: Ref; cancelled: boolean; session_id: number; session_url: string | null; source: string }
  | ({ kind: "vote"; date: string | null } & Vote)
  | { kind: "status_change"; date: string | null; detected_at: string; stage: Stage | null; status: Status | null };

export interface Bill extends BillSummary {
  number: number | null; private_number: number | null; summary: Text;
  postponement_reason: Text;
  publication: { date: string; series: Text; magazine: string | null; page: string | null } | null;
  initiators: { person_id: number; name: PersonName; is_initiator: boolean; ordinal: number | null }[];
  names: { name: Text; stage: Bi }[];
  documents: { type: Bi; format: string | null; url: string }[];
  timeline: TimelineEvent[]; timeline_note: Bi; data_notice?: Bi; data_issues: DataIssue[];
}

export interface MkSummary {
  id: number; name: PersonName; is_current: boolean; source: string;
  factions: { id: number; name: Text; start: string | null; finish: string | null }[];
}

interface Position {
  position: Bi & { id: number }; knesset: number; start: string | null; finish: string | null;
  is_current: boolean; duty: Text; source: string;
}

export interface Mk {
  data_issues: DataIssue[];
  id: number; name: PersonName; is_current: boolean; source: string;
  factions: (Position & { faction: Ref })[];
  committees: (Position & { committee: Ref })[];
  government: (Position & { ministry: Ref })[];
  memberships: Position[];
  bills: { total: number; by_stage: Record<string, number>; items: BillSummary[] };
  queries: { total: number; items: {
    id: number; name: Text; type: Text; status: Bi & { id: number }; ministry: Ref;
    submitted_at: string | null; reply_at: string | null; source: string }[] };
  votes: { note: Bi; items: { vote_id: number; date: string; title: Text; bill_id: number | null;
    result: Bi & { code: number }; source: string }[] };
}

export interface CommitteeSummary {
  id: number; name: Text; type: Bi & { id: number }; parent_id: number | null;
  is_current: boolean; sessions: number; source: string;
}

export interface Session {
  id: number; number: number | null; start: string | null; finish: string | null;
  type: Text; location: string | null; cancelled: boolean; session_url: string | null;
  broadcast_url: string | null; source: string;
  items: { name: Text; item_type_id: number; bill_id: number | null }[];
}

export interface Committee {
  id: number; name: Text; knesset: number; type: Bi & { id: number }; email: string | null;
  is_current: boolean; parent_id: number | null; source: string;
  members: { person_id: number; name: PersonName; role: Bi & { id: number };
    start: string | null; finish: string | null; is_current: boolean }[];
  upcoming: Session[]; past: Paged<Session>; calendar_note: Bi;
}

export interface Change {
  bill_id: number; bill_name: Text; event_type: string; detected_at: string; stage: Stage | null;
}

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function api<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`/api/v1${path}`, { signal, headers: { Accept: "application/json" } });
  if (!res.ok) throw new ApiError(res.status, `${res.status} for ${path}`);
  return res.json() as Promise<T>;
}

export function query(params: Record<string, string | number | null | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== null && v !== undefined && v !== "") q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : "";
}

export interface SearchHit {
  type: "bill" | "law" | "person" | "committee" | "query"; id: number; title: Text;
  knesset: number | null; stage: string | null; date: string | null; score: number; source: string;
}
export interface SearchResult { query: string; page: number; per_page: number; has_more: boolean; items: SearchHit[] }

// ---- accounts (Phase 4). Mutations send X-Requested-With (the API's CSRF check).
export interface Me {
  id: number; email: string; locale: "he" | "en"; digest_frequency: "instant" | "daily" | "weekly";
  email_enabled: boolean; push_devices: number; created_at: string;
}
export type TargetType = "bill" | "mk" | "committee" | "keyword";
export interface Subscription {
  id: number; target_type: TargetType; target_id: number | null; keyword: string | null;
  title: Text; created_at: string;
}
export interface AlertItem {
  event_id: number; event_type: string; text: { he: string; en: string }; path: string;
  detected_at: string; notified_at: string;
}

export async function send<T>(method: "POST" | "PATCH" | "DELETE", path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/v1${path}`, {
    method, credentials: "same-origin",
    headers: { "Content-Type": "application/json", "X-Requested-With": "knesset-tracker", Accept: "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    let detail = `${res.status}`;
    try { detail = (await res.json()).detail ?? detail; } catch { /* not JSON */ }
    throw new ApiError(res.status, typeof detail === "string" ? detail : JSON.stringify(detail));
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export interface DataIssue { rule: string; he: string; en: string; en_translated: boolean; details: unknown; since: string }
export interface StatusData {
  healthy: boolean; last_successful_sync: string | null; stale_tables: string[]; stale_after_minutes: number; checked_at: string;
  entities: { entity: string; table: string; last_success: string | null; data_up_to: string | null;
    last_reconciled: string | null; last_error: string | null }[];
}
export interface QualityRule {
  rule: string; entity_type: string; open: number; description: Bi; examples: number[];
}
