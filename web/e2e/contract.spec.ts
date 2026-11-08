import { expect, type Page, test } from "@playwright/test";

// Copy-vs-data contract: every number in the labels below is rebuilt here from the published JSON,
// so a hard-coded "8 in 10" or a stale hit rate cannot ship.

const pct = (v: number) => `${(v * 100).toFixed(0)}%`;
const signed0 = (v: number) => (v > 0 ? `+${Math.round(v)}` : v < 0 ? `−${Math.round(Math.abs(v))}` : "0");

type Split = { years: string; cover80: number; cover95: number; n: number } | null;
type Cov = { nominal: { "80": number; "95": number }; validation: Split; holdout: Split; warn80: boolean; warn95: boolean };

function held(cov: Cov, key: "cover80" | "cover95") {
  const parts = [cov.validation, cov.holdout].filter((s) => s !== null).map((s) => `${pct(s![key])} in ${s!.years}`);
  return `held ${parts.join(", ")}`;
}

async function json(page: Page, f: string) {
  return (await page.request.get(`/data/${f}`)).json();
}

test("range labels carry the published hit rates, never a fixed '8 in 10'", async ({ page }) => {
  const outlook = await json(page, "outlook.json");
  await page.goto("/");
  await expect(page.getByText(/8 in 10/)).toHaveCount(0);
  for (const h of outlook.horizons as { h: number; coverage: Cov }[]) {
    const card = page.getByTestId(`horizon-${h.h}`);
    const label80 = `${pct(h.coverage.nominal["80"])} range (${held(h.coverage, "cover80")})`;
    await expect(card.getByTestId("label80")).toContainText(label80);
    await expect(card.getByTestId("held95")).toHaveText(held(h.coverage, "cover95"));
    await expect(card.getByText("below 80%")).toHaveCount(h.coverage.warn80 ? 1 : 0);
    await expect(card.getByText("below 95%")).toHaveCount(h.coverage.warn95 ? 1 : 0);
  }
  const h3 = (outlook.horizons as { h: number; coverage: Cov }[]).find((h) => h.h === 3)!;
  await expect(page.getByTestId("hero-range-label")).toHaveText(
    `${pct(h3.coverage.nominal["80"])} range (${held(h3.coverage, "cover80")})`,
  );
});

test("no premium is shipped: CBOT-only units until the user types a premium, which is remembered", async ({ page }) => {
  const meta = await json(page, "meta.json");
  const outlook = await json(page, "outlook.json");
  const track = await json(page, "track_record.json");
  const manifest = await json(page, "run_manifest.json");
  // The contract carries no premium data at all (owner decision: no licensed source).
  for (const doc of [meta, outlook, track, manifest.inputs])
    expect(Object.keys(doc).filter((k) => /premium|fob/i.test(k))).toEqual([]);
  for (const h of outlook.horizons) expect(Object.keys(h).filter((k) => /premium/i.test(k))).toEqual([]);
  expect((await page.request.get("/paranagua_premium_monthly.csv")).status()).toBe(404);
  expect((await page.request.get("/data/paranagua_premium_monthly.csv")).status()).toBe(404);

  await page.goto("/");
  const headline = page.getByTestId("headline");
  const toUsdT = (cBu: number) => Math.round((cBu / 100) * meta.consts.bu_per_t).toLocaleString("en-US");
  // Default (English): USD/t is CBOT only, labelled, with no FOB anywhere and an empty premium field.
  await expect(page.getByRole("radio", { name: "CBOT USD/t" })).toBeChecked();
  await expect(page.getByRole("radio", { name: "FOB USD/t" })).toHaveCount(0);
  await expect(headline).toContainText(`= $${toUsdT(outlook.last.c_bu)}/t`);
  await expect(headline).toContainText("(CBOT only, excl. premium)");
  await expect(headline).not.toContainText("FOB");
  const input = page.getByLabel(/Paranaguá premium/);
  await expect(input).toHaveValue("");
  await expect(page.getByTestId("premium-help")).toContainText(
    "Enter your broker's Paranaguá premium in ¢/bu vs the named CBOT contract",
  );
  for (const h of outlook.horizons) {
    const card = page.getByTestId(`horizon-${h.h}`);
    await expect(card.getByTestId("basis-label")).toHaveText("CBOT only, excl. premium");
    await expect(card.getByTestId("premium-row")).toHaveCount(0);
  }
  await expect(page.getByText(/^FOB = CBOT \+ your premium/)).toHaveCount(0);
  await expect(page.getByText("About the premium")).toHaveCount(0);
  await expect(page.getByText(/assumed premium|historical median/i)).toHaveCount(0);
  await expect(page.getByText("stale", { exact: true })).toHaveCount(0);
  // No FOB chart view without a premium; the decision panel and stress replay still render.
  await expect(page.getByTestId("hero-chart").getByRole("radio", { name: "FOB shift" })).toHaveCount(0);
  await expect(page.getByTestId("decision-footnote")).toBeVisible();
  await expect(page.getByTestId("stress-replay")).toBeVisible();

  // A bad value is rejected inline; a typed premium turns USD/t into FOB, with the sum shown.
  await input.fill("abc");
  await input.press("Enter");
  await expect(page.getByTestId("premium-help")).toContainText("Enter a premium between");
  await input.fill("+80");
  await input.press("Enter");
  await expect(page.getByRole("radio", { name: "FOB USD/t" })).toBeChecked();
  await expect(headline).toContainText("your premium +80¢/bu");
  await expect(headline).toContainText(`= FOB $${toUsdT(outlook.last.c_bu + 80)}/t`);
  await expect(headline).toContainText("CBOT price risk only; your premium held fixed");
  await expect(page.getByText(/^FOB = CBOT \+ your premium/)).toHaveCount(outlook.horizons.length);
  await expect(page.getByTestId("horizon-1").getByTestId("premium-row")).toContainText("+80¢/bu");
  await expect(page.getByTestId("hero-chart").getByRole("radio", { name: "FOB shift" })).toBeVisible();

  // Remembered per viewer across a reload; Clear goes back to CBOT only and forgets it.
  await page.reload();
  await expect(page.getByLabel(/Paranaguá premium/)).toHaveValue("80");
  await expect(headline).toContainText("your premium +80¢/bu");
  await page.getByRole("button", { name: "Clear" }).click();
  await expect(headline).toContainText("(CBOT only, excl. premium)");
  await page.reload();
  await expect(page.getByLabel(/Paranaguá premium/)).toHaveValue("");
  // CBOT ¢/bu drops the premium field and every FOB row.
  await page.getByRole("radio", { name: "CBOT ¢/bu" }).click();
  await expect(page.getByLabel(/Paranaguá premium/)).toHaveCount(0);
});

test("a throwing localStorage still lets the user enter a premium", async ({ page }) => {
  await page.addInitScript(() => {
    const boom = () => {
      throw new Error("storage disabled");
    };
    Storage.prototype.getItem = boom;
    Storage.prototype.setItem = boom;
    Storage.prototype.removeItem = boom;
  });
  await page.goto("/");
  const input = page.getByLabel(/Paranaguá premium/);
  await expect(input).toHaveValue("");
  await input.fill("50");
  await input.press("Enter");
  await expect(page.getByTestId("headline")).toContainText("your premium +50¢/bu");
  await page.getByRole("button", { name: "Clear" }).click();
  await expect(page.getByTestId("headline")).toContainText("(CBOT only, excl. premium)");
});

test("what-if shows an 80% prediction interval from the published covariance", async ({ page }) => {
  const wasde = await json(page, "wasde.json");
  const r = wasde.reaction;
  await page.goto("/wasde/");
  // With no surprise entered, the interval is the residual noise alone: ±1.2816 × resid sd.
  const half = (1.2815515655446004 * r.resid_sd_usd_t).toFixed(1);
  const pi = page.getByTestId("pi80");
  await expect(pi).toContainText(`−${half} to +${half} USD/t`);
  await expect(pi).toContainText("direction unclear");
  const flagged = r.items.filter((it: { weak: boolean; wrong_sign: boolean }) => it.weak || it.wrong_sign).length;
  await expect(page.locator('[data-flagged="true"]')).toHaveCount(flagged);
  await expect(page.getByText("unexpected sign", { exact: true })).toHaveCount(
    r.items.filter((it: { wrong_sign: boolean }) => it.wrong_sign).length,
  );
  await expect(page.getByText("Historical average reaction on release day")).toBeVisible();
});

test("sharing metadata, icons, robots and sitemap are published", async ({ page }) => {
  for (const f of ["/robots.txt", "/sitemap.xml", "/favicon.ico", "/og.png", "/icon.svg", "/apple-icon.png"]) {
    expect((await page.request.get(f)).status(), f).toBe(200);
  }
  await page.goto("/wasde/");
  await expect(page).toHaveTitle("This WASDE · Soy Outlook");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /\/wasde\/$/);
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", /\/og\.png$/);
  await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute("content", "summary_large_image");
  const footer = page.getByRole("contentinfo");
  await expect(footer.getByText(/Built by/)).toBeVisible();
  await expect(footer.getByRole("link", { name: "LinkedIn" })).toHaveAttribute("href", /linkedin\.com/);
  await expect(footer.getByRole("link", { name: "GitHub" })).toHaveAttribute("href", /github\.com/);
});

test("theme control is labelled and cycles", async ({ page }) => {
  await page.goto("/");
  const btn = page.getByRole("button", { name: /^Theme: Auto/ });
  await expect(btn).toBeVisible();
  await btn.click();
  await expect(page.getByRole("button", { name: /^Theme: Light/ })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});

test("cards carry the hit-rate CI, the hedge contract and the roll flag from the JSON (P4, P10)", async ({ page }) => {
  const outlook = await json(page, "outlook.json");
  await page.goto("/");
  for (const h of outlook.horizons) {
    const card = page.getByTestId(`horizon-${h.h}`);
    const v = h.coverage.validation;
    await expect(card.getByTestId("ci80")).toHaveText(
      `${v.years}: likely ${pct(v.ci80[0])}–${pct(v.ci80[1])}, about ${Math.round(v.n_eff80)} independent outcomes`,
    );
    await expect(card.getByTestId("ci95")).toHaveText(`likely ${pct(v.ci95[0])}–${pct(v.ci95[1])}`);
    const contract = card.getByTestId("contract");
    await expect(contract).toContainText(h.contract.reference.code);
    await expect(contract.getByText("crosses a roll")).toHaveCount(h.contract.crosses_roll ? 1 : 0);
  }
});

test("track record states the minimum detectable effect from the JSON (P4)", async ({ page }) => {
  const meta = await json(page, "meta.json");
  const track = await json(page, "track_record.json");
  await page.goto("/track-record/");
  for (const h of [1, 3, 6]) {
    const row = track.metrics.find(
      (r: { subset: string; split: string; model: string; h: number }) =>
        r.subset === "all" && r.split === "validation" && r.model === "ridge" && r.h === h,
    );
    const verdict = meta.champion[String(h)] === "rw" ? "none was found." : "passed.";
    await expect(page.getByTestId(`mde-${h}`)).toContainText(`~${(row.mde_mae * 100).toFixed(0)}% lower error`);
    await expect(page.getByTestId(`mde-${h}`)).toContainText(verdict);
  }
});
