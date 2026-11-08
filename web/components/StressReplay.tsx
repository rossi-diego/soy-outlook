"use client";

import { useCallback, useState } from "react";

import Chart from "@/components/Chart";
import { axisCommon, baseOption, type Tokens } from "@/lib/chart";
import { dateLabel, horizonLabel, num } from "@/lib/format";
import type { Stress } from "@/lib/types";

const sgnPct = (v: number, d = 1) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${num(Math.abs(v), d)}%`;
/** Simple return (%) of a log return. */
const simple = (lr: number) => (Math.exp(lr) - 1) * 100;

/**
 * P19 stress replay: what today's CBOT price becomes if a named past episode's realized h-month
 * move happened again, shown next to the full historical distribution of h-month moves.
 * Folded by default, and labelled as illustrative scenarios, not probabilities.
 */
export default function StressReplay({ stress, buPerT }: { stress: Stress; buPerT: number }) {
  const hs = stress.horizons.map((x) => x.h);
  const [h, setH] = useState(hs.includes(3) ? 3 : hs[0]);
  const sh = stress.horizons.find((x) => x.h === h) ?? stress.horizons[0];
  const dist = sh.distribution;
  const p0UsdT = (stress.p0_c_bu / 100) * buPerT;

  const option = useCallback(
    (t: Tokens) => {
      const edges = dist.bin_edges;
      const cats = dist.counts.map((_, i) => sgnPct(simple((edges[i] + edges[i + 1]) / 2), 0));
      const binOf = (lr: number) => Math.min(dist.counts.length - 1, Math.max(0, edges.findIndex((e, i) => lr >= e && lr < edges[i + 1])));
      const marked = new Set(sh.episodes.map((e) => binOf(e.logret)));
      return {
        ...baseOption(t),
        grid: { ...baseOption(t).grid, top: 28, bottom: 4 },
        tooltip: {
          ...baseOption(t).tooltip,
          trigger: "axis",
          formatter: (ps: { dataIndex: number; value: number }[]) => {
            const p = ps[0];
            if (!p) return "";
            const i = p.dataIndex;
            const eps = sh.episodes.filter((e) => binOf(e.logret) === i).map((e) => e.name);
            return [
              `${sgnPct(simple(edges[i]))} to ${sgnPct(simple(edges[i + 1]))}`,
              `${num(p.value)} of ${num(dist.n)} ${h}-month windows`,
              ...(eps.length ? [`<b>${eps.join(", ")}</b>`] : []),
            ].join("<br/>");
          },
        },
        xAxis: {
          type: "category",
          data: cats,
          ...axisCommon(t),
          splitLine: { show: false },
          axisLabel: { ...axisCommon(t).axisLabel, interval: 3 },
        },
        yAxis: { type: "value", ...axisCommon(t), name: "windows", nameTextStyle: { color: t.muted } },
        series: [
          {
            name: `${h}-month CBOT moves`,
            type: "bar",
            barCategoryGap: "8%",
            data: dist.counts.map((c, i) => ({
              value: c,
              itemStyle: { color: marked.has(i) ? t.series2 : t.neutral, borderRadius: [2, 2, 0, 0] },
            })),
            markLine: {
              silent: true,
              symbol: "none",
              animation: false,
              label: { color: t.muted, fontSize: 11, formatter: "{b}" },
              lineStyle: { color: t.axis, type: "solid" },
              data: [{ xAxis: binOf(0), name: "no change" }],
            },
          },
        ],
      };
    },
    [dist, sh.episodes, h],
  );

  return (
    <details className="card p-5" data-testid="stress-replay">
      <summary className="cursor-pointer text-lg font-semibold">
        Stress replay: past shocks applied to today&apos;s price{" "}
        <span className="ml-1 rounded-full border border-line bg-surface-2 px-2 py-0.5 align-middle text-xs font-medium text-ink-2">
          {stress.label}
        </span>
      </summary>
      <div className="mt-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-3xl text-sm leading-relaxed text-ink-2">
            If the CBOT move of a named episode happened again from today&apos;s close ({num(stress.p0_c_bu)}¢/bu, ≈ $
            {num(p0UsdT)}/t). These are scenarios, not probabilities: the five episodes were named before any outcome was
            computed, and the bars show how common moves of each size have been. They complement the 95% range, whose tails
            rest on only one or two past errors.
          </p>
          <div role="radiogroup" aria-label="Stress horizon" className="inline-flex rounded-lg border border-line bg-surface p-0.5">
            {hs.map((x) => (
              <button
                key={x}
                type="button"
                role="radio"
                aria-checked={x === h}
                onClick={() => setH(x)}
                className={`rounded-md px-3 py-1.5 text-sm ${x === h ? "bg-surface-2 font-medium text-ink" : "text-ink-2 hover:text-ink"}`}
              >
                {horizonLabel(x)}
              </button>
            ))}
          </div>
        </div>
        <div className="grid gap-5 lg:grid-cols-[1.25fr_1fr]">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[34rem] text-sm" data-testid="stress-table">
              <thead>
                <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                  <th className="py-2 font-medium">Episode</th>
                  <th className="py-2 text-right font-medium">{h}-month move</th>
                  <th className="py-2 text-right font-medium">Rank</th>
                  <th className="py-2 text-right font-medium">¢/bu</th>
                  <th className="py-2 text-right font-medium">USD/t</th>
                  <th className="py-2 text-right font-medium">R$/sack*</th>
                </tr>
              </thead>
              <tbody>
                {sh.episodes.map((e) => (
                  <tr key={e.id} className="border-b border-line align-top last:border-0">
                    <td className="py-1.5">
                      <span className="font-medium text-ink">{e.name}</span>
                      <span className="block text-xs text-muted" title={e.rationale}>
                        from {dateLabel(e.start)}
                      </span>
                    </td>
                    <td className={`tabular py-1.5 text-right font-medium ${e.pct < 0 ? "text-down" : e.pct > 0 ? "text-up" : ""}`}>
                      {sgnPct(e.pct)}
                    </td>
                    <td className="tabular py-1.5 text-right text-ink-2">p{num(e.percentile, 0)}</td>
                    <td className="tabular py-1.5 text-right">{num(e.c_bu)}</td>
                    <td className="tabular py-1.5 text-right">{num(e.usd_t)}</td>
                    <td className="tabular py-1.5 text-right">{num(e.cbot_brl_sack, 2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div>
            <Chart option={option} height={240} ariaLabel={`Histogram of all ${h}-month CBOT moves since ${dist.first.slice(0, 4)}, with the stress episodes highlighted`} />
            <p className="tabular mt-1 text-xs text-muted">
              All {num(dist.n)} {h}-month windows starting {dist.first.slice(0, 4)}–{dist.last_start.slice(0, 4)}: 1 in 10 fell
              more than {sgnPct(simple(dist.quantiles.q10))}, 1 in 10 rose more than {sgnPct(simple(dist.quantiles.q90))}.
              Orange bars hold an episode.
            </p>
          </div>
        </div>
        <p className="text-xs leading-relaxed text-muted">
          {stress.rule} * {stress.basis}
          {stress.basis.endsWith(".") ? "" : "."} Rank: the move&apos;s percentile among all {h}-month windows (p5 = only
          5% of windows moved lower).
        </p>
      </div>
    </details>
  );
}
