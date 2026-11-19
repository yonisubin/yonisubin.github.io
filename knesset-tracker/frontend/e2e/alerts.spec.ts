import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test, type APIRequestContext } from "@playwright/test";

// The Phase 4 "done when" test: sign in by email, follow a bill, inject a change through
// the real sync + alert path, and receive the alert email. Needs Mailpit (MAILPIT_URL) and
// the app running with EMAIL_BACKEND=smtp pointed at it; CI provides both.
const MAILPIT = process.env.MAILPIT_URL;
const PYTHON = process.env.PYTHON ?? "python";
const BACKEND = path.resolve(process.cwd(), "../backend"); // playwright runs from frontend/

interface MailSummary { ID: string; Subject: string; To: { Address: string }[] }

async function waitForMail(request: APIRequestContext, to: string, match: (m: { subject: string; text: string }) => boolean) {
  for (let i = 0; i < 40; i++) {
    const list = await (await request.get(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`)).json();
    for (const m of (list.messages ?? []) as MailSummary[]) {
      const full = await (await request.get(`${MAILPIT}/api/v1/message/${m.ID}`)).json();
      if (match({ subject: full.Subject, text: full.Text })) return { id: m.ID, subject: full.Subject as string, text: full.Text as string };
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`no matching email to ${to}`);
}

test("follow a bill, a change happens, the alert email arrives", async ({ page, request }, info) => {
  test.skip(!MAILPIT, "set MAILPIT_URL to run the email end-to-end test");
  test.skip(info.project.name !== "desktop", "runs once");
  const email = `e2e-${Date.now()}@example.com`;

  // a bill that is still in committee, preparing for the first reading
  const open = await (await request.get("/api/v1/bills?stage=committee_first&knesset=25")).json();
  const bill = open.items[0];
  expect(bill).toBeTruthy();

  // 1. sign in with a magic link
  await page.goto("/en/login");
  await page.getByLabel("Email address").fill(email);
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await expect(page.getByRole("status")).toContainText(email);
  const login = await waitForMail(request, email, (m) => m.subject.includes("sign-in link"));
  const link = login.text.match(/https?:\/\/\S+#token=[\w-]+/)![0];
  await page.goto(link);
  await expect(page).toHaveURL(/\/en\/account$/);
  await expect(page.getByRole("heading", { name: "My account" })).toBeVisible();

  // 2. instant alerts, then follow the bill
  await page.getByLabel("Instantly (within ~30 minutes)").check();
  await expect(page.getByRole("status")).toHaveText("Saved");
  await page.goto(`/en/bills/${bill.id}`);
  await page.getByRole("button", { name: "Follow" }).click();
  await expect(page.getByRole("button", { name: "Following ✓" })).toBeVisible();

  // 3. the bill changes stage; the sync detects it and sends alerts
  const out = execFileSync(PYTHON, ["-m", "scripts.inject_change", String(bill.id)],
                           { cwd: BACKEND, env: process.env, encoding: "utf8" });
  expect(out).toContain("'events': 1"); // earlier runs' users may follow it too

  // 4. the alert says exactly what changed and can be unsubscribed in one click
  const alert = await waitForMail(request, email, (m) => m.text.includes(`/en/bills/${bill.id}`));
  expect(alert.text).toMatch(/moved to: (Approved in committee for first reading|Preparing for first reading)/);
  const headers = await (await request.get(`${MAILPIT}/api/v1/message/${alert.id}/headers`)).json();
  expect(headers["List-Unsubscribe-Post"]?.[0]).toBe("List-Unsubscribe=One-Click");

  // 5. the alert also shows on the account page
  await page.goto("/en/account");
  await expect(page.locator("#alerts .list-item").first()).toContainText("moved to:");
});
