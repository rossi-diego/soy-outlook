import { expect, type Page, test } from "@playwright/test";

// Copy-vs-data contract: every number in the labels below is rebuilt here from the published JSON,
// so a hard-coded "8 in 10" or a stale hit rate cannot ship.

const pct = (v: number) => `${(v * 100).toFixed(0)}%`;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

test("FOB headline is an explicit sum with the stale, illustrative default premium", async ({ page }) => {
  const meta = await json(page, "meta.json");
  const outlook = await json(page, "outlook.json");
  const d = outlook.premium_now_default;
  await page.goto("/");
  const headline = page.getByTestId("headline");
  await expect(headline).toContainText(`assumed premium ${signed0(d.median)}¢/bu`);
  await expect(headline).toContainText(new RegExp(`median ${esc(d.years)}; data end`));
  await expect(headline).toContainText("= FOB");
  await expect(headline.getByText("stale", { exact: true })).toHaveCount(meta.premium_source.stale ? 1 : 0);
  await expect(headline.getByText("illustrative", { exact: true })).toHaveCount(d.illustrative ? 1 : 0);
  await expect(headline).toContainText("CBOT price risk only; premium and BRL held fixed");
  // The slider thumb sits on the headline premium.
  await expect(page.getByLabel(/Paranaguá premium/)).toHaveValue(String(d.median));
  // Every card: the bridge line, the CBOT-only label and the premium p10-p90 in USD/t.
  await expect(page.getByText(/^FOB = CBOT \+ your premium/)).toHaveCount(outlook.horizons.length);
  for (const h of outlook.horizons) {
    const toUsdT = (v: number) => (v / 100) * meta.consts.bu_per_t;
    await expect(page.getByTestId(`horizon-${h.h}`).getByTestId("premium-band")).toContainText(
      `${signed0(toUsdT(h.premium_reference.p10))} / ${signed0(toUsdT(h.premium_reference.p90))} USD/t`,
    );
    await expect(page.getByTestId(`horizon-${h.h}`).getByTestId("premium-band")).toContainText(
      `${signed0(toUsdT(h.premium_reference.median))} USD/t (${h.premium_reference.note})`,
    );
  }
  // Entering a quote replaces "assumed" and drops the stale and illustrative badges; CBOT units drop the FOB rows.
  await page.getByLabel(/Paranaguá premium/).fill("120");
  await expect(headline).toContainText("your premium +120¢/bu");
  await expect(headline.getByText("illustrative", { exact: true })).toHaveCount(0);
  await page.getByRole("radio", { name: "CBOT ¢/bu" }).click();
  await expect(page.getByText("CBOT price risk only; premium and BRL held fixed")).toHaveCount(0);
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
