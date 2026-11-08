"use client";

import { useCallback, useState } from "react";

import EChart, { axisCommon, baseOption, type Tokens } from "@/components/EChart";
import { dateLabel, horizonLabel, monthLabel, num, pct } from "@/lib/format";
import type { ArchiveIndex, Meta, MetricRow, ModelId, TrackRecord } from "@/lib/types";

const MODELS: ModelId[] = ["rw", "drift", "arima", "ridge"];
const PATH_MODELS: ModelId[] = ["rw", "arima", "ridge"];
const HS = [1, 3, 6];

function find(rows: MetricRow[], split: string, model: ModelId, h: number, subset = "all") {
  return rows.find((r) => r.subset === subset && r.split === split && r.model === model && r.h === h);
}

function Pill<T extends string | number>({
  options,
  value,
  onChange,
  label,
  render,
}: {
  options: T[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  render: (v: T) => string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-lg border border-line bg-surface p-0.5">
      {options.map((o) => (
        <button
          key={String(o)}
          type="button"
          role="radio"
          aria-checked={o === value}
          onClick={() => onChange(o)}
          className={`rounded-md px-3 py-1.5 text-sm ${o === value ? "bg-surface-2 font-medium text-ink" : "text-ink-2 hover:text-ink"}`}
        >
          {render(o)}
        </button>
      ))}
    </div>
  );
}

function Outcome({ ok, label }: { ok: boolean | null; label: string }) {
  if (ok === null) return <span className="text-muted">—</span>;
  return (
    <span className={ok ? "text-ink" : "font-medium text-warn"}>
      {ok ? "inside" : "outside"}
      <span className="sr-only"> the {label} range</span>
    </span>
  );
}

function PublishedVsOutcome({ archive, k }: { archive: ArchiveIndex; k: number }) {
  const usd = (v: number | null) => (v === null ? "—" : num(v * k, 0));
  const rows = archive.entries.flatMap((e) => e.horizons.map((h) => ({ e, h })));
  return (
    <section className="card space-y-3 p-5" data-testid="published-vs-outcome">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">Published outlooks against what happened</h2>
        <p className="max-w-3xl text-sm text-ink-2">
          Every outlook this site publishes is frozen in an append-only archive on the day it goes out, and scored here
          once its target date passes. Nothing in these rows was ever used to choose a model or a range method, so, as
          they mature, this becomes the only genuinely unseen out-of-sample record.
        </p>
      </div>
      <p className="text-sm" data-testid="archive-summary">
        <strong>{archive.n_outlooks}</strong> {archive.n_outlooks === 1 ? "outlook" : "outlooks"} archived ·{" "}
        <strong>{archive.n_resolved}</strong> of {rows.length} forecasts resolved
        {archive.n_resolved > 0 && (
          <>
            {" "}
            · inside the 80% range {archive.inside80} of {archive.n_resolved}, inside the 95% range {archive.inside95} of{" "}
            {archive.n_resolved}
          </>
        )}
        {archive.prices_through && <span className="text-muted"> · closes through {dateLabel(archive.prices_through)}</span>}
      </p>
      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                <th className="py-2 font-medium">Published</th>
                <th className="py-2 font-medium">Horizon</th>
                <th className="py-2 font-medium">Target</th>
                <th className="py-2 text-right font-medium">Central</th>
                <th className="py-2 text-right font-medium">80% range</th>
                <th className="py-2 text-right font-medium">Outcome</th>
                <th className="py-2 text-right font-medium">80%</th>
                <th className="py-2 text-right font-medium">95%</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ e, h }) => (
                <tr key={`${e.as_of_close}-${h.h}`} className="border-b border-line last:border-0" data-status={h.status}>
                  <td className="py-1.5">
                    {dateLabel(e.as_of_close)} <span className="text-muted">({monthLabel(e.latest_wasde).split(" ")[0].slice(0, 3)} WASDE)</span>
                  </td>
                  <td className="py-1.5">{horizonLabel(h.h)}</td>
                  <td className="py-1.5">{dateLabel(h.target_date)}</td>
                  <td className="tabular py-1.5 text-right">{usd(h.central)}</td>
                  <td className="tabular py-1.5 text-right">
                    {usd(h.low80)}–{usd(h.high80)}
                  </td>
                  <td className="tabular py-1.5 text-right">
                    {h.status === "resolved" ? usd(h.actual) : <span className="text-muted">pending</span>}
                  </td>
                  <td className="py-1.5 text-right">
                    <Outcome ok={h.inside80} label="80%" />
                  </td>
                  <td className="py-1.5 text-right">
                    <Outcome ok={h.inside95} label="95%" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-muted">
        CBOT front month, USD/t; the outcome is the last close on or before the target date. The archive files are
        published at{" "}
        <a className="underline hover:text-ink" href="/data/archive/index.json">
          /data/archive/
        </a>{" "}
        and a refresh is rejected if it would change or remove one.
      </p>
    </section>
  );
}

export default function TrackRecordView({ meta, track, archive }: { meta: Meta; track: TrackRecord; archive: ArchiveIndex }) {
  const [h, setH] = useState(3);
  const [model, setModel] = useState<ModelId>("rw");
  const k = meta.consts.bu_per_t / 100;
  const m = track.metrics;

  const barOption = useCallback(
    (t: Tokens) => {
      const colors = [t.ink2, t.context, t.series2, t.series1];
      return {
        ...baseOption(t),
        legend: { top: 0, left: 0, textStyle: { color: t.ink2 }, icon: "roundRect", itemWidth: 10, itemHeight: 10 },
        tooltip: { ...baseOption(t).tooltip, trigger: "axis", valueFormatter: (v: number) => `${num(v, 1)} USD/t` },
        grid: { ...baseOption(t).grid, top: 40 },
        xAxis: { type: "category", data: HS.map(horizonLabel), ...axisCommon(t), splitLine: { show: false } },
        yAxis: { type: "value", name: "USD/t", nameTextStyle: { color: t.muted }, ...axisCommon(t) },
        series: MODELS.map((mo, i) => ({
          name: meta.models[mo],
          type: "bar",
          barMaxWidth: 22,
          itemStyle: { color: colors[i], borderRadius: [3, 3, 0, 0] },
          data: HS.map((hh) => Math.round((find(m, "validation", mo, hh)?.mae_usd_t ?? 0) * 10) / 10),
        })),
      };
    },
    [m, meta.models],
  );

  const pathOption = useCallback(
    (t: Tokens) => {
      const rows = track.paths[String(h)]?.[model] ?? [];
      const usd = (v: number | null) => (v === null ? null : Math.round(v * k * 10) / 10);
      const withBand = rows.filter((r) => r.q10 !== null && r.q90 !== null);
      return {
        ...baseOption(t),
        legend: {
          top: 0,
          left: 0,
          data: ["80% range", "Forecast made " + horizonLabel(h) + " earlier", "Actual CBOT"],
          textStyle: { color: t.ink2 },
          itemWidth: 14,
          itemHeight: 8,
        },
        tooltip: { ...baseOption(t).tooltip, trigger: "axis", valueFormatter: (v: number) => (v == null ? "—" : `${num(v, 0)} USD/t`) },
        grid: { ...baseOption(t).grid, top: 40 },
        xAxis: { type: "time", ...axisCommon(t), splitLine: { show: false } },
        yAxis: { type: "value", scale: true, name: "USD/t", nameTextStyle: { color: t.muted }, ...axisCommon(t) },
        series: [
          {
            name: "80% range low",
            type: "line",
            stack: "band",
            symbol: "none",
            lineStyle: { opacity: 0 },
            data: withBand.map((r) => [r.target_date, usd(r.q10)]),
            tooltip: { show: false },
            silent: true,
          },
          {
            name: "80% range",
            type: "line",
            stack: "band",
            symbol: "none",
            lineStyle: { opacity: 0 },
            areaStyle: { color: t.series1, opacity: 0.2 },
            itemStyle: { color: t.series1, opacity: 0.4 },
            data: withBand.map((r) => [r.target_date, Math.round(((r.q90! - r.q10!) * k) * 10) / 10]),
            tooltip: { show: false },
          },
          {
            name: "Forecast made " + horizonLabel(h) + " earlier",
            type: "line",
            symbol: "none",
            lineStyle: { color: t.series1, width: 1.5, type: "dashed" },
            itemStyle: { color: t.series1 },
            data: rows.map((r) => [r.target_date, usd(r.forecast)]),
          },
          {
            name: "Actual CBOT",
            type: "line",
            symbol: "none",
            lineStyle: { color: t.ink, width: 1.5 },
            itemStyle: { color: t.ink },
            data: rows.filter((r) => r.actual !== null).map((r) => [r.target_date, usd(r.actual)]),
          },
        ],
      };
    },
    [track.paths, h, model, k],
  );

  const tests = track.tests;
  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <p className="text-sm font-medium text-brand">Out-of-sample, one forecast per WASDE report</p>
        <h1 className="max-w-3xl text-3xl font-semibold tracking-tight">Did any model beat &ldquo;no change&rdquo;?</h1>
        <p className="max-w-3xl text-ink-2">
          Every forecast below was made with only what was public on that report day, and scored later against the
          actual CBOT close. Models were compared on {dateLabel(meta.splits.validation[0])} –{" "}
          {dateLabel(meta.splits.validation[1])}; the reports since {dateLabel(meta.splits.holdout_start)} were kept aside
          and not used for any model choice (the author had seen 2024–25 prices, so they are not a blind test).
        </p>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        {HS.map((hh) => {
          const rw = find(m, "validation", "rw", hh);
          const rwH = find(m, "holdout", "rw", hh);
          const others = MODELS.filter((x) => x !== "rw").map((x) => find(m, "validation", x, hh));
          const best = others.reduce((a, b) => ((b?.mase ?? 9) < (a?.mase ?? 9) ? b : a), others[0]);
          return (
            <article key={hh} className="card space-y-3 p-5">
              <h2 className="text-sm font-medium text-ink-2">{horizonLabel(hh)} ahead</h2>
              <p className="text-2xl font-semibold tracking-tight">
                Winner: {meta.champion[String(hh)] === "rw" ? "no change" : meta.models[meta.champion[String(hh)]]}
              </p>
              <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
                <dt className="text-ink-2">Typical miss, no change</dt>
                <dd className="tabular text-right">{num(rw?.mae_usd_t, 1)} USD/t</dd>
                <dt className="text-ink-2">Best challenger</dt>
                <dd className="tabular text-right">
                  {best ? `${meta.models[best.model].split(" (")[0]}, ${best.mase && best.mase >= 1 ? "+" : ""}${num(((best.mase ?? 1) - 1) * 100, 1)}%` : "—"}
                </dd>
                <dt className="text-ink-2">80% range hit rate</dt>
                <dd className="tabular text-right">
                  {pct(rw?.cover80)} <span className="text-muted">/ {pct(rwH?.cover80)} holdout</span>
                </dd>
                <dt className="text-ink-2">95% range hit rate</dt>
                <dd className="tabular text-right">
                  {pct(rw?.cover95)} <span className="text-muted">/ {pct(rwH?.cover95)} holdout</span>
                </dd>
              </dl>
              {hh > 1 && <p className="text-xs text-muted">Overlapping {hh}-month windows: few independent outcomes, low power.</p>}
            </article>
          );
        })}
      </section>

      <PublishedVsOutcome archive={archive} k={k} />

      <section className="card space-y-3 p-5">
        <h2 className="text-lg font-semibold">Average miss by horizon (validation {meta.splits.validation[0].slice(0, 4)}–{meta.splits.validation[1].slice(0, 4)})</h2>
        <EChart option={barOption} height={300} ariaLabel="Mean absolute error in USD per tonne by model and horizon" />
        <p className="text-xs text-muted">
          Mean absolute error of the CBOT price forecast, USD/t. Lower is better. &ldquo;Best challenger&rdquo; above is the
          change in that error against no change (+ means worse).
        </p>
      </section>

      <section className="card space-y-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Past forecasts against what happened</h2>
          <div className="flex flex-wrap gap-2">
            <Pill label="Horizon" options={HS} value={h} onChange={setH} render={(x) => horizonLabel(x)} />
            <Pill label="Model" options={PATH_MODELS} value={model} onChange={setModel} render={(x) => (x === "rw" ? "No change" : x === "arima" ? "ARIMA" : "WASDE ridge")} />
          </div>
        </div>
        <EChart option={pathOption} height={360} ariaLabel="Past forecasts with 80% ranges against the actual CBOT price" />
        <p className="text-xs text-muted">
          Each point sits on the date the forecast was for. Ranges start once {24} realized errors exist. CBOT front month,
          USD/t. The continuous front month jumps when a contract expires, so a window crossing a roll partly measures a calendar spread; the July–September rolls (old crop to new crop) are the largest.
        </p>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <details className="card p-5 text-sm" open>
          <summary className="cursor-pointer text-base font-semibold">Statistical tests (validation)</summary>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[26rem]">
              <thead>
                <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                  <th className="py-2 font-medium">Model</th>
                  <th className="py-2 font-medium">Horizon</th>
                  <th className="py-2 text-right font-medium">DM p</th>
                  <th className="py-2 text-right font-medium">CW p (Holm)</th>
                </tr>
              </thead>
              <tbody>
                {tests.map((r) => (
                  <tr key={`${r.model}-${r.h}`} className="border-b border-line last:border-0">
                    <td className="py-1.5">{meta.models[r.model]}</td>
                    <td className="py-1.5">{horizonLabel(r.h)}</td>
                    <td className="tabular py-1.5 text-right">
                      {num(r.dm_p, 3)} {r.dm_t > 0 && r.dm_p < 0.05 ? <span className="text-down">(worse)</span> : null}
                    </td>
                    <td className="tabular py-1.5 text-right">{num(r.cw_p_holm, 3)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs leading-relaxed text-muted">
            DM: Diebold-Mariano on absolute errors, Harvey-Leybourne-Newbold correction, Newey-West lag h−1. CW: Clark-West,
            one-sided, for models that nest no change; Holm-adjusted across horizons. A model replaces no change only if CW
            p &lt; {meta.champion_alpha} and its error is lower.
          </p>
        </details>
        <div className="card space-y-3 p-5 text-sm">
          <h2 className="text-base font-semibold">Paranaguá FOB, illustrative</h2>
          <p className="text-ink-2">
            Where the premium history exists (to {dateLabel(meta.premium_source.last)}), FOB = CBOT forecast + premium held
            at its value on the report day. Computed once from the daily series, which is no longer published.
          </p>
          <table className="w-full">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                <th className="py-2 font-medium">Period</th>
                <th className="py-2 font-medium">Horizon</th>
                <th className="py-2 text-right font-medium">Reports</th>
                <th className="py-2 text-right font-medium">Avg miss</th>
              </tr>
            </thead>
            <tbody>
              {track.fob_illustrative
                .filter((r) => r.model === "rw")
                .map((r) => (
                  <tr key={`${r.split}-${r.h}`} className="border-b border-line last:border-0">
                    <td className="py-1.5 capitalize">{r.split}</td>
                    <td className="py-1.5">{horizonLabel(r.h)}</td>
                    <td className="tabular py-1.5 text-right">{num(r.n)}</td>
                    <td className="tabular py-1.5 text-right">
                      {num(r.mae_usd_t, 1)} USD/t <span className="text-muted">({num(r.mape_pct, 1)}%)</span>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
          <p className="text-xs text-muted">Holdout FOB covers few reports; read it as indicative only.</p>
        </div>
      </section>
    </div>
  );
}
