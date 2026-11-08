import { test } from "@playwright/test";

// README screenshots: SHOTS_DIR=../docs/screenshots npx playwright test shots --project=desktop
// Desktop at 1280 px, plus phone captures at 390 px (P27) in both themes.
const DIR = process.env.SHOTS_DIR ?? "shots";

const PAGES = [
  ["outlook", "/"],
  ["wasde", "/wasde/"],
  ["track-record", "/track-record/"],
] as const;

for (const [name, url] of PAGES) {
  for (const theme of ["light", "dark"] as const) {
    test(`${name} ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.addInitScript((t) => localStorage.setItem("wasde-theme", t), theme);
      await page.goto(url);
      await page.waitForTimeout(1200);
      await page.screenshot({ path: `${DIR}/${name}-${theme}.png`, fullPage: true });
    });

    test(`${name} ${theme} 390px`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.addInitScript((t) => localStorage.setItem("wasde-theme", t), theme);
      await page.goto(url);
      await page.waitForTimeout(1200);
      // The first two screens: what a phone visitor sees before scrolling far.
      await page.screenshot({ path: `${DIR}/${name}-mobile-${theme}.png`, clip: { x: 0, y: 0, width: 390, height: 1688 } });
    });
  }
}
