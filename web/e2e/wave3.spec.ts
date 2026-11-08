import { expect, type Page, test } from "@playwright/test";

import { adverse, moneyAmount, pnlVsToday } from "../lib/decision";
import { moveHitText } from "../lib/format";

// Wave-3 UI contract (P18 decision panel and risk framing, P14 release-day move band).

async function json(page: Page, f: string) {
  return (await page.request.get(`/data/${f}`)).json();
}

type H = {
  h: number;
  q025: number;
  q100: number;
  q900: number;
  q975: number;
  tail_obs_95: number;
  grid: { levels: number[]; c_bu: number[] };
  coverage: { warn80: boolean; tail_warn_lo80: boolean; tail_warn_hi80: boolean };
};

test("hero and description frame the page as price-risk ranges for budgeting and hedging (P18)", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Price-risk ranges");
  await expect(page.getByTestId("hero-framing")).toContainText("budgeting and hedging");
  await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", /budgeting and hedging/);
  await expect(page.getByText(/where could .* trade/i)).toHaveCount(0);
});

test("decision panel: downside vs selling today follows the published quantiles (P18)", async ({ page }) => {
  const meta = await json(page, "meta.json");
  const outlook = await json(page, "outlook.json");
  const p0: number = outlook.last.c_bu;
  const base = { side: "producer" as const, tonnes: 1000, hedge: 0, currency: "usd" as const, fx: 0, buPerT: meta.consts.bu_per_t };
  await page.goto("/");
  const panel = page.getByTestId("decision-panel");
  await expect(panel.getByTestId("decision-labels")).toContainText("illustrative");
  await expect(panel.getByTestId("decision-labels")).toContainText("range-based, not VaR");
  await expect(panel.getByTestId("decision-labels")).toContainText("CBOT only");
  await expect(panel.getByTestId("decision-labels")).toContainText("basis unhedged");
  await expect(panel.getByTestId("strip-legend")).toContainText("1-in-10 adverse level");
  await expect(panel.getByTestId("strip-legend")).toContainText("selling today");

  for (const h of outlook.horizons as H[]) {
    expect(h.grid.levels.length).toBe(19);
    const card = panel.getByTestId(`decision-${h.h}`);
    const want = moneyAmount(pnlVsToday(adverse(h, "producer").oneInTen, p0, base), "usd");
    await expect(card.getByTestId("downside10")).toHaveText(want);
    // Side-aware tail flag (unit B): a producer is hurt by misses below the range.
    await expect(card.getByTestId("decision-warn")).toHaveCount(h.coverage.tail_warn_lo80 ? 1 : 0);
    await expect(card.getByTestId("downside40")).toHaveAttribute("data-weak", h.tail_obs_95 < meta.intervals.tail_obs_min_95 ? "true" : "false");
    await expect(card.locator("circle")).toHaveCount(19);
  }

  // The strip's end labels are the shared scale's limits (worst and best grid P&L over all horizons, and zero).
  const all = (outlook.horizons as H[]).flatMap((h) => h.grid.c_bu.map((c) => pnlVsToday(c, p0, base)));
  await expect(panel.getByTestId("decision-1").getByTestId("strip-scale")).toHaveText(
    moneyAmount(Math.min(0, ...all), "usd") + moneyAmount(Math.max(0, ...all), "usd"),
  );
  const rolls = (outlook.horizons as (H & { contract: { crosses_roll: boolean } })[]).filter((h) => h.contract.crosses_roll);
  await expect(panel.getByTestId("decision-footnote")).toContainText(rolls.length ? "contract roll" : "not a price call");

  await panel.getByRole("radio", { name: "Buyer (short)" }).click();
  await expect(panel.getByRole("heading", { name: /downside vs buying today/ })).toBeVisible();
  for (const h of outlook.horizons as H[])
    await expect(panel.getByTestId(`decision-${h.h}`).getByTestId("decision-warn")).toHaveCount(h.coverage.tail_warn_hi80 ? 1 : 0);
  const h1 = (outlook.horizons as H[])[0];
  await expect(panel.getByTestId("decision-1").getByTestId("downside10")).toHaveText(
    moneyAmount(pnlVsToday(h1.q900, p0, { ...base, side: "buyer" }), "usd"),
  );

  const tonnes = panel.getByLabel("Volume", { exact: true });
  await tonnes.fill("5,000");
  await tonnes.press("Enter");
  await panel.getByRole("radio", { name: "BRL" }).click();
  const fx = Math.round(meta.fx_default.value * 100) / 100;
  await expect(panel.getByTestId("decision-1").getByTestId("downside10")).toHaveText(
    moneyAmount(pnlVsToday(h1.q900, p0, { ...base, side: "buyer", tonnes: 5000, currency: "brl", fx }), "brl"),
  );

  await panel.getByLabel(/Hedge ratio/).fill("100");
  await expect(panel.getByTestId("hedge-value")).toContainText("100% hedged");
  await expect(panel.getByTestId("decision-1").getByTestId("downside10")).toHaveText("R$ 0");

  // Sacks keep the physical volume: 5,000 t shows as 83,333 sacks.
  await panel.getByRole("radio", { name: "sacks" }).click();
  await expect(tonnes).toHaveValue("83,333");
});

test("target readout: a range position from the grid, never a probability (unit B)", async ({ page }) => {
  const meta = await json(page, "meta.json");
  const outlook = await json(page, "outlook.json");
  await page.goto("/");
  await page.getByRole("radio", { name: "CBOT ¢/bu" }).click();
  const panel = page.getByTestId("decision-panel");
  await expect(panel.getByTestId("target-pos")).toHaveCount(0);
  const levels: number[] = meta.intervals.target_readout_levels;
  const h3 = (outlook.horizons as H[]).find((h) => h.h === 3)!;
  const at = (l: number) => h3.grid.c_bu[h3.grid.levels.findIndex((x) => Math.abs(x - l) < 1e-6)];
  // Halfway between the p50 and p75 of the 3-month range.
  const target = Math.round(((at(0.5) + at(0.75)) / 2) * 10) / 10;
  const input = panel.getByLabel(/target price/i);
  await input.fill(String(target));
  await input.press("Enter");
  await expect(panel.getByTestId("decision-3").getByTestId("target-pos")).toHaveText(
    "Your target sits between the p50 and p75 of the tested range.",
  );
  await input.fill(String(Math.round(at(levels[0]) - 50)));
  await input.press("Enter");
  await expect(panel.getByTestId("decision-3").getByTestId("target-pos")).toHaveText("Your target sits below the p10 of the tested range.");
  await expect(panel).not.toContainText(/probability of/i);
  await input.fill("abc");
  await input.press("Enter");
  await expect(panel.getByText("Enter a positive price, or leave it empty.")).toBeVisible();
});

test("WASDE page draws the release-day move band with its out-of-sample hit rate (P14)", async ({ page }) => {
  const wasde = await json(page, "wasde.json");
  const move = wasde.reaction.release_move;
  await page.goto("/wasde/");
  const band = page.getByTestId("release-move");
  await expect(band.getByTestId("move-band")).toBeVisible();
  await expect(band).toContainText(`Typical move: ±${move.typical_usd_t.toFixed(1)} USD/t`);
  await expect(band).toContainText(`±${move.one_in_ten_usd_t.toFixed(1)} USD/t`);
  await expect(band.getByTestId("move-hit50")).toContainText(moveHitText(move.hit_rate.validation, "50"));
  await expect(band.getByTestId("move-hit50")).toContainText(moveHitText(move.hit_rate.holdout, "50"));
  await expect(band.getByTestId("move-hit90")).toContainText(moveHitText(move.hit_rate.validation, "90"));
  await expect(band.getByTestId("move-hit90")).toContainText(moveHitText(move.hit_rate.holdout, "90"));
});
