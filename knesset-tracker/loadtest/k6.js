// Load test for the page-speed targets: bill and MK pages p95 < 300 ms server time,
// search p95 < 100 ms. Run against the deployed site (be gentle: it's on free tiers):
//
//   k6 run -e BASE_URL=https://your-app.wasmer.app loadtest/k6.js
//
// Ids are picked from the API itself, so the script works on any data.
import http from "k6/http";
import { check } from "k6";

const BASE = __ENV.BASE_URL || "http://localhost:8000";

export const options = {
  scenarios: {
    browse: { executor: "constant-arrival-rate", rate: 10, timeUnit: "1s", duration: "1m",
              preAllocatedVUs: 20, exec: "browse" },
    search: { executor: "constant-arrival-rate", rate: 5, timeUnit: "1s", duration: "1m",
              preAllocatedVUs: 10, exec: "search" },
  },
  thresholds: {
    "http_req_duration{kind:bill}": ["p(95)<300"],
    "http_req_duration{kind:mk}": ["p(95)<300"],
    "http_req_duration{kind:search}": ["p(95)<100"],
    http_req_failed: ["rate<0.01"],
  },
};

export function setup() {
  const bills = http.get(`${BASE}/api/v1/bills?per_page=100`).json("items").map((b) => b.id);
  const mks = http.get(`${BASE}/api/v1/mks`).json("items").map((m) => m.id);
  return { bills, mks };
}

const pick = (a) => a[Math.floor(Math.random() * a.length)];
const QUERIES = ["חוק עבודת נשים", "חיילים בודדים", "ועדת הכספים", "דמי לידה", "נתניהו",
  "חוק יסוד", "מיסוי", "תחבורה ציבורית", "לחוק השבות", "ועדת החינוך"];

export function browse(data) {
  const r1 = http.get(`${BASE}/api/v1/bills/${pick(data.bills)}`, { tags: { kind: "bill" } });
  check(r1, { "bill 200": (r) => r.status === 200 });
  const r2 = http.get(`${BASE}/api/v1/mks/${pick(data.mks)}`, { tags: { kind: "mk" } });
  check(r2, { "mk 200": (r) => r.status === 200 });
}

export function search() {
  const r = http.get(`${BASE}/api/v1/search?q=${encodeURIComponent(pick(QUERIES))}`,
                     { tags: { kind: "search" } });
  check(r, { "search 200": (r) => r.status === 200 });
}
