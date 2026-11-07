import { expect, test } from "@playwright/test";

test("outlook shows three horizons and switches units", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Brazilian export soybeans");
  await expect(page.getByRole("heading", { name: /In 1 month/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: /In 6 months/ })).toBeVisible();
  await expect(page.locator('[role="img"] svg').first()).toBeVisible({ timeout: 30_000 });
  await page.getByRole("radio", { name: "FOB R$/sack" }).click();
  await expect(page.getByLabel("BRL per USD")).toBeVisible();
  await expect(page.getByText(/R\$ [\d,.]+\/sc/).first()).toBeVisible();
});

test("wasde what-if responds to a revision", async ({ page }) => {
  await page.goto("/wasde/");
  await expect(page.getByRole("heading", { name: /What-if/ })).toBeVisible();
  const slider = page.getByLabel("US soybean stocks-to-use");
  await slider.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByText(/Expected CBOT move on release day/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Reset" })).toBeVisible();
});

test("track record and methodology render", async ({ page }) => {
  await page.goto("/track-record/");
  await expect(page.getByRole("heading", { name: /beat .no change./ })).toBeVisible();
  await expect(page.locator('[role="img"] svg').nth(1)).toBeVisible({ timeout: 30_000 });
  await page.goto("/methodology/");
  await expect(page.getByRole("heading", { name: "What changed from the first version" })).toBeVisible();
});

test("data files are published", async ({ page }) => {
  for (const f of ["meta.json", "outlook.json", "track_record.json", "wasde.json", "backtest.csv"]) {
    expect((await page.request.get(`/data/${f}`)).status(), f).toBe(200);
  }
});

test("pages never scroll horizontally", async ({ page }) => {
  for (const url of ["/", "/wasde/", "/track-record/", "/methodology/"]) {
    await page.goto(url);
    await page.waitForTimeout(500);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, url).toBeLessThanOrEqual(0);
  }
});
