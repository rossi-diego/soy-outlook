import { expect, test } from "@playwright/test";

// P27 mobile pass at 390 px: no sideways scrolling, stacked tables, 260 px charts, short
// segmented labels. Each route's screenshot is attached to the test report as evidence.
const ROUTES = ["/", "/wasde/", "/track-record/", "/methodology/"];

test.use({ viewport: { width: 390, height: 844 } });

for (const route of ROUTES)
  for (const [theme, loc] of [
    ["light", "en"],
    ["dark", "en"],
    ["light", "pt-BR"],
  ] as const)
    test(`390 px ${theme} ${loc}: ${route} fits the screen`, async ({ page }, info) => {
      await page.addInitScript(
        ([t, l]) => {
          localStorage.setItem("wasde-theme", t);
          localStorage.setItem("soy-locale", l);
        },
        [theme, loc],
      );
      await page.goto(route);
      await page.waitForTimeout(600);
      // Every fold open (data tables, statistician notes, stress replay): none may widen the page.
      for (let i = 0; i < (await page.locator("details").count()); i++) {
        const d = page.locator("details").nth(i);
        if (!(await d.evaluate((el) => (el as HTMLDetailsElement).open))) await d.locator("summary").first().click();
      }
      await page.waitForTimeout(600);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(0);
      for (const chart of await page.locator('[data-chart="ready"]').all()) {
        expect(Math.round((await chart.boundingBox())!.height)).toBeLessThanOrEqual(260);
      }
      await info.attach(`${route} ${theme} 390px`, {
        body: await page.screenshot({ fullPage: true }),
        contentType: "image/png",
      });
    });

test("390 px: WASDE and tests tables stack into labelled rows", async ({ page }) => {
  await page.goto("/wasde/");
  const table = page.getByTestId("wasde-lines");
  await expect(table.locator("thead")).toHaveCSS("position", "absolute");
  const cell = table.locator("tbody tr").first().locator("td").nth(3);
  await expect(cell).toHaveCSS("display", "flex");
  expect(await cell.evaluate((el) => getComputedStyle(el, "::before").content)).toContain("Change");
  // The table itself never scrolls sideways.
  expect(await table.evaluate((el) => el.scrollWidth - el.parentElement!.clientWidth)).toBeLessThanOrEqual(0);

  await page.goto("/track-record/");
  await page.getByTestId("for-statisticians").locator("summary").click();
  const tests = page.getByTestId("tests-table");
  await expect(tests.locator("tbody tr").first().locator("td").nth(2)).toHaveCSS("display", "flex");
  expect(await tests.evaluate((el) => el.scrollWidth - el.parentElement!.clientWidth)).toBeLessThanOrEqual(0);
});

test("390 px: segmented controls use short labels and keep their full names", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("settings").locator("summary").click();
  const usd = page.getByRole("radio", { name: "CBOT USD/t" });
  await expect(usd).toBeChecked();
  const label = usd.locator("xpath=..");
  expect((await label.innerText()).trim()).toBe("USD/t");
});

test("390 px: the range ladder and the story charts fit the column", async ({ page }) => {
  await page.goto("/");
  const ladder = page.getByTestId("ladder");
  const box = (await ladder.boundingBox())!;
  for (const el of await ladder.locator(".lo, .hi").all()) {
    const b = (await el.boundingBox())!;
    expect(b.x).toBeGreaterThanOrEqual(box.x - 1);
    expect(b.x + b.width).toBeLessThanOrEqual(box.x + box.width + 1);
  }
  for (const id of ["history-chart", "backtest-chart", "outlook-chart", "move-chart"]) {
    const fig = page.getByTestId(id);
    await expect(fig.locator("svg")).toBeVisible();
    expect((await fig.locator("svg").boundingBox())!.width).toBeLessThanOrEqual(390);
  }
});
