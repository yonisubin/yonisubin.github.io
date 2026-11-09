import { expect, test } from "@playwright/test";

const BILL = 2196528; // recorded fixture: passed into law in January 2026

test("Hebrew is the default and is right-to-left", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/he$/);
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.locator("html")).toHaveAttribute("lang", "he");
});

test("bill page shows the stage, the next step and a dated timeline", async ({ page }) => {
  await page.goto(`/en/bills/${BILL}`);
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("עבודת נשים");
  await expect(page.locator(".stage-card .badge")).toHaveText(/Passed into law/);
  await expect(page.getByText("What happens next")).toBeVisible();
  expect(await page.locator(".timeline > li").count()).toBeGreaterThanOrEqual(10);
  expect(await page.locator(".timeline .tl-vote").count()).toBe(4);
  await expect(page.locator('[aria-current="step"]')).toHaveText(/Passed into law/);
  // Hebrew strings inside English text are isolated
  expect(await page.locator("h1 bdi[dir=rtl]").count()).toBe(1);
  // every timeline entry links to its official record
  const sources = page.locator(".timeline a.source");
  expect(await sources.count()).toBeGreaterThan(10);
  await expect(sources.first()).toHaveAttribute("href", /OdataV4\/ParliamentInfo\//);
});

test("the language toggle keeps the page", async ({ page }) => {
  await page.goto(`/he/bills/${BILL}`);
  await page.getByRole("link", { name: "English" }).click();
  await expect(page).toHaveURL(new RegExp(`/en/bills/${BILL}$`));
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
});

test("initiator link leads to an MK page with the standard sections", async ({ page }) => {
  await page.goto(`/en/bills/${BILL}`);
  await page.locator("#initiators a").first().click();
  await expect(page).toHaveURL(/\/en\/mks\/\d+$/);
  for (const id of ["factions", "committees", "bills", "queries", "votes"]) {
    await expect(page.locator(`#${id}`)).toBeVisible();
  }
});

test("bill list filters by stage through the URL", async ({ page }) => {
  await page.goto("/en/bills?knesset=all");
  await page.getByLabel("Stage").selectOption("passed");
  await expect(page).toHaveURL(/stage=passed/);
  await expect(page.locator(".list-item")).toHaveCount(1);
});

test("committee page lists sessions and links agenda items to bills", async ({ page }) => {
  await page.goto(`/he/bills/${BILL}`);
  await page.locator(".tl-committee_session a").first().click();
  await expect(page).toHaveURL(/\/he\/committees\/\d+/);
  await expect(page.locator("#past .sessions > li").first()).toBeVisible();
});

test("unknown pages and bills say so", async ({ page }) => {
  await page.goto("/en/bills/1");
  await expect(page.getByRole("alert")).toContainText("Page not found");
  await page.goto("/en/nowhere");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Page not found.");
});

test("no horizontal scrolling", async ({ page }) => {
  for (const path of [`/he/bills/${BILL}`, `/en/bills/${BILL}`, "/he/mks", "/en/committees"]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(overflow, path).toBe(false);
  }
});

test("search finds a bill despite niqqud and a prefix, and filters by type", async ({ page }) => {
  await page.goto("/he");
  await page.locator("#header-q").fill("לְחוֹק עבודת נשים");
  await page.locator("#header-q").press("Enter");
  await expect(page).toHaveURL(/\/he\/search\?q=/);
  const hit = page.locator(`a.item-title[href="/he/bills/${BILL}"]`);
  await expect(hit).toBeVisible();
  await page.getByLabel("סוג").selectOption("person");
  await expect(page).toHaveURL(/type=person/);
  await expect(hit).toHaveCount(0);
});

test("search tolerates a typo in an MK's name", async ({ page, request }) => {
  const bill = await (await request.get(`/api/v1/bills/${BILL}`)).json();
  const mk = bill.initiators[0];
  const name: string = mk.name.he;
  const typo = name.slice(0, -2) + name.slice(-1); // drop the second-to-last letter
  await page.goto(`/en/search?q=${encodeURIComponent(typo)}`);
  await expect(page.locator(`a.item-title[href="/en/mks/${mk.person_id}"]`)).toBeVisible();
});
