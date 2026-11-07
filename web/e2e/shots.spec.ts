import { test } from "@playwright/test";

// README screenshots: SHOTS_DIR=../docs/screenshots npx playwright test shots --project=desktop
const DIR = process.env.SHOTS_DIR ?? "shots";

for (const [name, url] of [
  ["outlook", "/"],
  ["wasde", "/wasde/"],
  ["track-record", "/track-record/"],
] as const) {
  for (const theme of ["light", "dark"] as const) {
    test(`${name} ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.addInitScript((t) => localStorage.setItem("wasde-theme", t), theme);
      await page.goto(url);
      await page.waitForTimeout(1200);
      await page.screenshot({ path: `${DIR}/${name}-${theme}.png`, fullPage: true });
    });
  }
}
