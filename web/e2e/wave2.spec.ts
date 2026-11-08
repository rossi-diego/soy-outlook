import { expect, type Page, test } from "@playwright/test";

// Wave-2 UI contract (P21, P22, P13, P19, P10, P28): copy is rebuilt from the published JSON.

async function json(page: Page, f: string) {
  return (await page.request.get(`/data/${f}`)).json();
}
const pct = (v: number) => `${(v * 100).toFixed(0)}%`;

async function openSettings(page: Page) {
  const settings = page.getByTestId("settings");
  if (!(await settings.evaluate((el) => (el as HTMLDetailsElement).open))) await settings.locator("summary").click();
}

async function openAnalysts(page: Page) {
  await page.goto("/track-record/");
  await page.getByTestId("for-analysts").locator("summary").click();
  await expect(page.getByTestId("analyst-outlook")).toBeVisible({ timeout: 30_000 });
}

type Metric = { subset: string; split: string; model: string; h: number; mase: number; mde_mae: number; miss_lo80: number; miss_hi80: number };

test("today's outlook chart follows the unit and labels a FOB view (story chapter 4)", async ({ page }) => {
  await page.goto("/");
  const chart = page.getByTestId("outlook-chart");
  await expect(chart.locator("svg")).toBeVisible({ timeout: 30_000 });
  await expect(chart.locator("svg").getByText("today", { exact: false }).first()).toBeVisible();
  const caption = page.getByTestId("outlook-caption");
  await expect(caption).toContainText("CBOT soybeans in US dollars per tonne, CBOT only, excl. premium");
  await openSettings(page);
  await page.getByRole("radio", { name: "CBOT ¢/bu" }).click();
  await expect(caption).toContainText("CBOT soybeans, US cents per bushel");
  await expect(page.getByTestId("ticket-price")).toHaveText(/¢$/);
  // A typed premium makes USD/t the labelled FOB view.
  await page.getByRole("radio", { name: "CBOT USD/t" }).click();
  await page.getByLabel(/Paranaguá premium/).fill("80");
  await page.getByLabel(/Paranaguá premium/).press("Enter");
  await expect(caption).toContainText("Paranaguá FOB, US dollars per tonne");
  await expect(page.getByTestId("settings-state")).toHaveText("USD/t, with your premium");
  const meta = await json(page, "meta.json");
  if ([1, 3, 6].every((h) => meta.champion[String(h)] === "rw")) {
    await openAnalysts(page);
    await page.getByTestId("ranges-details").locator("summary").first().click();
    await expect(page.getByTestId("validation-start")).toHaveText(meta.splits.validation[0].slice(0, 4));
  }
});

test("track record: verdict, breach strip, rival copy, derived labels and the statisticians fold (P22, P28)", async ({ page }) => {
  const meta = await json(page, "meta.json");
  const track = await json(page, "track_record.json");
  const rows = (track.metrics as Metric[]).filter((r) => r.subset === "all");
  const get = (split: string, model: string, h: number) => rows.find((r) => r.split === split && r.model === model && r.h === h)!;
  await page.goto("/track-record/");

  const allRw = [1, 3, 6].every((h) => meta.champion[String(h)] === "rw");
  const verdict = page.getByTestId("verdict");
  if (allRw) {
    await expect(verdict).toContainText("No model beat no change at any horizon, Holm-adjusted");
    const mdes = [1, 3, 6].map((h) => Math.round(get("validation", "ridge", h).mde_mae * 100));
    const lo = Math.min(...mdes);
    const hi = Math.max(...mdes);
    await expect(verdict).toContainText(lo === hi ? `~${lo}%` : `${lo}–${hi}%`);
  }
  for (const h of [1, 3, 6]) {
    const rw = get("validation", "rw", h);
    const strip = page.getByTestId(`breach-${h}`);
    await expect(strip).toContainText(`${pct(rw.miss_lo80)} fell below`);
    await expect(strip).toContainText(`${pct(rw.miss_hi80)} rose above`);
    const best = ["drift", "arima", "ridge"].map((m) => get("validation", m, h)).sort((a, b) => a.mase - b.mase)[0];
    const d = (best.mase - 1) * 100;
    await expect(page.getByTestId(`rival-${h}`)).toContainText(`${Math.abs(d).toFixed(1)}% ${d > 0 ? "worse" : "better"}`);
  }
  await expect(page.getByTestId("calib-min")).toHaveText(String(meta.calib_min));
  await expect(page.getByText(/Average miss by horizon/)).toHaveCount(0);

  // The frozen FOB backtest went with the premium data (owner decision: no licensed source).
  await expect(page.getByTestId("fob-table")).toHaveCount(0);

  const fold = page.getByTestId("for-statisticians");
  await expect(fold.getByTestId("tests-table")).toHaveCount(0);
  await fold.locator("summary").click();
  await expect(fold.getByTestId("tests-table")).toBeVisible();
  const ar1 = get("validation", "arima", 1);
  const sign = ar1.mase > 1 ? "+" : "−";
  await expect(fold.getByTestId("mae-vs-arima-1")).toHaveText(`${sign}${Math.abs((ar1.mase - 1) * 100).toFixed(1)}%`);
  if ((track.tests as { cw_p_holm: number }[]).every((t) => t.cw_p_holm >= 0.9995)) {
    await expect(fold.getByText(/Holm column reads 1.000 everywhere/)).toBeVisible();
  }
  await expect(fold.getByTestId("calibration-table")).toBeVisible();
  await expect(fold.getByTestId("range-choice-table")).toContainText("(published)");
  await expect(fold.locator("abbr[title]").first()).toBeVisible();
});

test("past-forecast chart reports misses and roll windows from the data (P4, P10)", async ({ page }) => {
  const track = await json(page, "track_record.json");
  await page.goto("/track-record/");
  const rows = track.paths["3"].rw as { actual: number | null; q10: number | null; q90: number | null; roll_cross: boolean }[];
  const scored = rows.filter((r) => r.actual !== null && r.q10 !== null);
  const miss = scored.filter((r) => r.actual! < r.q10! || r.actual! > r.q90!).length;
  // rounding to 0.1 USD/t can move a boundary case; allow one either way
  const text = (await page.getByTestId("miss-count").textContent()) ?? "";
  const [shown, of] = text.match(/\d+/g)!.map(Number);
  expect(of).toBe(scored.length);
  expect(Math.abs(shown - miss)).toBeLessThanOrEqual(1);
  await expect(page.getByTestId("roll-share")).toContainText(`${rows.filter((r) => r.roll_cross).length} of ${rows.length}`);
});

test("stress replay is folded, labelled and lists the pre-registered episodes (P19)", async ({ page }) => {
  const outlook = await json(page, "outlook.json");
  await openAnalysts(page);
  const panel = page.getByTestId("stress-replay");
  await expect(panel.locator("summary")).toContainText("illustrative scenarios, not probabilities");
  await panel.locator("summary").click();
  const h3 = outlook.stress.horizons.find((x: { h: number }) => x.h === 3);
  const table = panel.getByTestId("stress-table");
  await expect(table.locator("tbody tr")).toHaveCount(h3.episodes.length);
  await expect(table).toContainText(h3.episodes[0].name);
  await panel.getByRole("radio", { name: "1 month" }).click();
  await expect(table.getByRole("columnheader", { name: "1-month move" })).toBeVisible();
});

test("FX is typed as text, checked on blur, with an inline error outside 3-9 (P28)", async ({ page }) => {
  await page.goto("/");
  await openSettings(page);
  await page.getByRole("radio", { name: "CBOT R$/sack" }).click();
  const fx = page.getByLabel("BRL per USD");
  await fx.fill("12");
  await fx.blur();
  await expect(page.getByTestId("fx-error")).toContainText("between 3 and 9");
  await fx.fill("5,8");
  await expect(page.getByTestId("fx-error")).toBeVisible(); // still typing: nothing applied yet
  await fx.blur();
  await expect(page.getByTestId("fx-error")).toHaveCount(0);
  await expect(fx).toHaveValue("5.80");
  await expect(page.getByTestId("headline")).toContainText("at 5.80 BRL/USD");
});

test("what-if: realistic sliders, typical revision, Load latest and Clear (P13)", async ({ page }) => {
  const wasde = await json(page, "wasde.json");
  await page.goto("/wasde/");
  const items = wasde.reaction.items as { feature: string; unit: string; latest_rev: number | null; median_abs_rev: number }[];
  const soy = items.find((it) => it.feature === "rev_us_soy_stu")!;
  const slider = page.getByLabel("US soybean stocks-to-use");
  expect(Number(await slider.getAttribute("max"))).toBeLessThanOrEqual(3);
  await expect(page.getByTestId("slider-rev_us_soy_stu").getByTestId("typical-rev")).toContainText(
    `Typical revision ±${soy.median_abs_rev.toFixed(2)} pp`,
  );
  const before = await page.getByTestId("pi80").textContent();
  await page.getByRole("button", { name: /Load latest/ }).click();
  for (const it of items) {
    if (it.latest_rev === null) continue;
    expect(Number(await page.locator(`#${it.feature}`).inputValue())).toBeCloseTo(it.latest_rev, 2);
  }
  await expect(page.getByTestId("loaded-note")).toBeVisible();
  if (items.some((it) => (it.latest_rev ?? 0) !== 0)) await expect(page.getByTestId("pi80")).not.toHaveText(before ?? "");
  await page.getByRole("button", { name: "Clear" }).click();
  await expect(page.getByTestId("pi80")).toHaveText(before ?? "");
});

test("charts load after the page, behind a fixed-height skeleton (P28)", async ({ page }) => {
  await page.route(/_next\/static\/chunks\/.*\.js$/, async (route) => {
    const res = await route.fetch();
    const body = await res.text();
    // The ECharts chunk: minification may drop the literal "zrender", so match either name.
    if (/zrender|echarts/.test(body)) await new Promise((r) => setTimeout(r, 1500));
    await route.fulfill({ response: res, body });
  });
  // The home page draws plain SVG; the ECharts pages are the track record and the WASDE page.
  await page.goto("/track-record/");
  const box = page.locator('main [data-chart="loading"]').first();
  await expect(box).toBeVisible();
  // The skeleton holds the chart's own height: 340 px from sm up, capped at 260 px on phones (P27).
  const phone = (page.viewportSize()?.width ?? 1280) < 640;
  const h = (await box.boundingBox())!.height;
  if (phone) expect(h).toBeCloseTo(260, 0);
  else expect(h).toBeGreaterThan(300);
  const ready = page.locator('main [data-chart="ready"]').first();
  await expect(ready.locator("svg")).toBeVisible({ timeout: 30_000 });
  expect(Math.round((await ready.boundingBox())!.height)).toBe(phone ? 260 : 340);
});

test("the home page loads no ECharts at all (story charts are SVG)", async ({ page }) => {
  const chunks: string[] = [];
  page.on("response", async (r) => {
    if (/_next\/static\/chunks\/.*\.js$/.test(r.url())) chunks.push(await r.text().catch(() => ""));
  });
  await page.goto("/");
  await expect(page.getByTestId("outlook-chart").locator("svg")).toBeVisible({ timeout: 30_000 });
  expect(chunks.some((b) => /zrender/.test(b))).toBe(false);
});
