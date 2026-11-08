import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

// P27 accessibility gate: zero serious or critical axe violations (WCAG 2.x A/AA rules) on every
// route, in both themes and both locales, with every fold opened so their content is checked too.
const ROUTES = ["/", "/wasde/", "/track-record/", "/methodology/"];
const THEMES = ["light", "dark"] as const;
const LOCALES = ["en", "pt-BR"] as const;

async function openEverything(page: Page) {
  // Open every <details> (folds and chart data tables), including folds that a lazily loaded fold
  // brings with it ("For analysts" on /track-record/), and wait for lazy content and charts.
  for (let pass = 0; pass < 4; pass++) {
    const closed = page.locator("details:not([open])");
    const n = await closed.count();
    if (n === 0) break;
    for (let i = 0; i < n; i++) await closed.first().locator("summary").first().click();
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 30_000 });
    await page.waitForTimeout(300);
  }
  const charts = page.locator('[data-chart="loading"]');
  await expect(charts).toHaveCount(0, { timeout: 30_000 });
}

for (const route of ROUTES)
  for (const theme of THEMES)
    for (const loc of LOCALES)
      test(`axe: ${route} ${theme} ${loc}`, async ({ page }) => {
        await page.addInitScript(
          ([t, l]) => {
            localStorage.setItem("wasde-theme", t);
            localStorage.setItem("soy-locale", l);
          },
          [theme, loc],
        );
        await page.goto(route);
        await expect(page.locator("html")).toHaveAttribute("lang", loc);
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        await openEverything(page);
        const res = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
        const bad = res.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
        const report = bad.map((v) => `${v.id} (${v.impact}): ${v.nodes.length} nodes, e.g. ${v.nodes[0]?.target.join(" ")}`);
        expect(report, report.join("\n")).toEqual([]);
      });
