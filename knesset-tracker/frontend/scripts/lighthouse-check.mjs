// Runs Lighthouse (mobile emulation, the default) on key pages in both locales and fails
// if performance or accessibility drops below the project's targets.
// Usage: BASE_URL=http://localhost:8000 CHROME_PATH=... node scripts/lighthouse-check.mjs
import lighthouse from "lighthouse";
import * as chromeLauncher from "chrome-launcher";

const BASE = process.env.BASE_URL ?? "http://localhost:8000";
const MIN = { performance: 90, accessibility: 90 };
const PAGES = ["/he", "/en", "/he/bills", "/en/bills", "/he/bills/2196528", "/en/bills/2196528",
  "/he/committees", "/en/committees"];

const chrome = await chromeLauncher.launch({ chromeFlags: ["--headless=new", "--no-sandbox"] });
let failed = false;
try {
  for (const path of PAGES) {
    const { lhr } = await lighthouse(`${BASE}${path}`, {
      port: chrome.port, output: "json", logLevel: "error",
      onlyCategories: ["performance", "accessibility", "best-practices", "seo"],
    });
    const scores = Object.fromEntries(Object.entries(lhr.categories).map(([k, v]) => [k, Math.round(v.score * 100)]));
    const bad = Object.entries(MIN).filter(([k, min]) => scores[k] < min);
    console.log(`${bad.length ? "FAIL" : "ok  "} ${path.padEnd(22)} ${JSON.stringify(scores)}`);
    if (bad.length) failed = true;
  }
} finally {
  await chrome.kill();
}
process.exit(failed ? 1 : 0);
