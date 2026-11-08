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
      await page.screenshot({ path: `${DIR}/${name}-mobile-${theme}.png`, fullPage: true, clip: { x: 0, y: 0, width: 390, height: 1688 } });
    });
  }
}

// pt-BR captures of the Outlook page (P20): R$/saca by default, Brazilian number and date formats.
// The README shows the desktop page in light and the phone page in dark.
for (const [theme, width] of [["light", 1280], ["dark", 390]] as const) {
  test(`outlook pt-BR ${theme} ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.addInitScript((t) => {
      localStorage.setItem("wasde-theme", t);
      localStorage.setItem("soy-locale", "pt-BR");
    }, theme);
    await page.goto("/");
    await page.waitForTimeout(1200);
    if (width === 390) {
      await page.screenshot({ path: `${DIR}/outlook-pt-mobile-${theme}.png`, fullPage: true, clip: { x: 0, y: 0, width: 390, height: 1688 } });
    } else {
      await page.screenshot({ path: `${DIR}/outlook-pt-${theme}.png`, fullPage: true });
    }
  });
}
