import { expect, type Page, test } from "@playwright/test";

// The stale banner depends on when the page is viewed, so every test pins the browser clock relative to
// the published meta.json; the expectations are rebuilt from the same file.

type Freshness = { as_of_close: string; next_wasde: string | null; stale_after_bdays: number; degraded: boolean };

async function freshness(page: Page): Promise<Freshness> {
  return (await (await page.request.get("/data/meta.json")).json()).freshness;
}

/** `days` weekdays after an ISO date, at 15:00 Chicago (21:00 UTC is 15:00 CST / 16:00 CDT). */
function weekdaysAfter(iso: string, days: number): Date {
  const d = new Date(`${iso}T21:00:00Z`);
  let left = days;
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) left -= 1;
  }
  return d;
}

test("no banner while the close is fresh and the next WASDE is still ahead", async ({ page }) => {
  const f = await freshness(page);
  test.skip(f.degraded, "published data is degraded: the banner is expected");
  const now = weekdaysAfter(f.as_of_close, 1);
  test.skip(f.next_wasde !== null && now >= new Date(`${f.next_wasde}T17:00:00Z`), "next WASDE is a day away");
  await page.clock.setFixedTime(now);
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByTestId("stale-banner")).toHaveCount(0);
});

test("banner explains an old close and a WASDE that has been released since", async ({ page }) => {
  const f = await freshness(page);
  await page.clock.setFixedTime(weekdaysAfter(f.as_of_close, f.stale_after_bdays + 1));
  await page.goto("/");
  const banner = page.getByTestId("stale-banner");
  await expect(banner).toBeVisible();
  await expect(banner).toContainText("may be out of date");
  await expect(banner.locator('[data-reason="close"]')).toContainText(`${f.stale_after_bdays + 1} business days ago`);
  if (f.next_wasde) await expect(banner.locator('[data-reason="wasde"]')).toBeVisible();
  // Every route carries the banner (it lives in the layout).
  await page.goto("/track-record/");
  await expect(page.getByTestId("stale-banner")).toBeVisible();
});

test("a released WASDE alone triggers the banner, the close age does not", async ({ page }) => {
  const f = await freshness(page);
  test.skip(!f.next_wasde, "no next WASDE date published");
  const now = new Date(`${f.next_wasde}T18:00:00Z`);
  const ageOk = weekdaysAfter(f.as_of_close, f.stale_after_bdays) >= now;
  test.skip(!ageOk, "the close would also be stale on the WASDE day");
  await page.clock.setFixedTime(now);
  await page.goto("/");
  const banner = page.getByTestId("stale-banner");
  await expect(banner.locator('[data-reason="wasde"]')).toBeVisible();
  await expect(banner.locator('[data-reason="close"]')).toHaveCount(0);
});

test("the as-of close is visible at every width", async ({ page }) => {
  const meta = await (await page.request.get("/data/meta.json")).json();
  await page.goto("/");
  const asOf = page.getByTestId("as-of");
  await expect(asOf).toBeVisible();
  const label = new Date(`${meta.as_of_close}T12:00:00Z`).toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
  await expect(asOf).toContainText(label);
});

test("published-vs-outcome follows the archive index", async ({ page }) => {
  const index = await (await page.request.get("/data/archive/index.json")).json();
  const meta = await (await page.request.get("/data/meta.json")).json();
  expect((await page.request.get(`/data/archive/${meta.as_of_close}.json`)).status()).toBe(200);
  await page.goto("/track-record/");
  const section = page.getByTestId("published-vs-outcome");
  await expect(section).toBeVisible();
  const total = index.entries.reduce((n: number, e: { horizons: unknown[] }) => n + e.horizons.length, 0);
  await expect(page.getByTestId("archive-summary")).toContainText(
    `${index.n_outlooks} ${index.n_outlooks === 1 ? "outlook" : "outlooks"} archived`,
  );
  await expect(page.getByTestId("archive-summary")).toContainText(`${index.n_resolved} of ${total} forecasts resolved`);
  await expect(section.locator("tbody tr")).toHaveCount(total);
  await expect(section.locator('tbody tr[data-status="pending"]')).toHaveCount(total - index.n_resolved);
});
