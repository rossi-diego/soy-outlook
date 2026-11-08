"use client";

import { useCallback, useMemo, useState } from "react";

import Chart from "@/components/Chart";
import { axisCommon, baseOption, type Tokens } from "@/lib/chart";
import { MONTHS, dateLabel, horizonLabel, num, pct } from "@/lib/format";
import { HORIZONS, isoDay, maeVsNoChange, PATH_MODELS, type SlimMetric, type TrackView } from "@/lib/trackView";
import type { ArchiveIndex, Meta, ModelId } from "@/lib/types";

const CHALLENGERS: ModelId[] = ["drift", "arima", "ridge"];
const HS: number[] = [...HORIZONS];

const SHORT: Record<ModelId, string> = { rw: "No change", drift: "Average past change", arima: "ARIMA", ridge: "WASDE ridge" };

/** One-line definitions, shown on hover and focus. */
const TERMS = {
  dm: "Diebold-Mariano test: is the difference in average forecast error between two models larger than chance? Small p = a real difference.",
  cw: "Clark-West test: the right test when the challenger nests 'no change' (it adds terms to it). One-sided: small p = the challenger is better.",
  holm: "Holm adjustment: makes p-values stricter when many tests are run together, so one lucky result among nine does not count as a finding.",
  p: "p-value: how often a difference this large would appear by chance if there were no real difference. Below 0.05 is the usual bar.",
  hit: "Hit rate: the share of past outcomes that landed inside the range. A well-calibrated 80% range holds about 80% of the time.",
  mde: "Minimum detectable effect: the smallest error reduction the test would catch most of the time with this many reports.",
  kupiec: "Kupiec test: is the share of misses consistent with the nominal level? Small p = the range is mis-sized.",
  christ: "Christoffersen test: do misses cluster in time instead of arriving independently? Small p = clustering.",
} as const;

function Term({ k, children }: { k: keyof typeof TERMS; children: React.ReactNode }) {
  return (
    <abbr className="term" title={TERMS[k]} tabIndex={0}>
      {children}
    </abbr>
  );
}

function find(rows: SlimMetric[], split: string, model: ModelId, h: number) {
  return rows.find((r) => r.split === split && r.model === model && r.h === h);
}

const signedPct = (v: number, d = 1) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${num(Math.abs(v), d)}%`;
const pFmt = (v: number | null | undefined) => (v === null || v === undefined ? "—" : v < 0.001 ? "<0.001" : num(v, 3));

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

/** P4 breach strip: where the misses of the published 80% range fell, below vs above. */
function BreachStrip({ rows, years }: { rows: { h: number; lo: number; hi: number; cover: number }[]; years: string }) {
  return (
    <div className="space-y-2" data-testid="breach-strip">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">
        Where the 80% range missed ({years}, no change)
      </p>
      {rows.map((r) => {
        const inside = Math.max(0, 1 - r.lo - r.hi);
        return (
          <div key={r.h} className="grid grid-cols-[4.5rem_1fr] items-center gap-3 text-xs" data-testid={`breach-${r.h}`}>
            <span className="text-ink-2">{horizonLabel(r.h)}</span>
            <div>
              <div className="flex h-3 overflow-hidden rounded-full bg-surface-2" aria-hidden>
                <div style={{ width: `${r.lo * 100}%`, background: "var(--down)" }} />
                <div style={{ width: `${inside * 100}%`, background: "var(--neutral)", opacity: 0.55 }} />
                <div style={{ width: `${r.hi * 100}%`, background: "var(--up)" }} />
              </div>
              <p className="tabular mt-0.5 flex justify-between text-muted">
                <span>
                  <span className="text-down">{pct(r.lo)}</span> fell below
                </span>
                <span>{pct(r.cover)} inside</span>
                <span>
                  <span className="text-up">{pct(r.hi)}</span> rose above
                </span>
              </p>
            </div>
          </div>
        );
      })}
    </div>
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
                <tr key={`${e.file ?? e.as_of_close}-${e.latest_wasde}-${h.h}`} className="border-b border-line last:border-0" data-status={h.status}>
                  <td className="py-1.5">
                    {dateLabel(e.as_of_close)} <span className="text-muted">({MONTHS[Number(e.latest_wasde.slice(5, 7)) - 1]} WASDE)</span>
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

/** Spoken range of the WASDE model's MDE across horizons, e.g. "~6% (5–7% by horizon)". */
export function mdeText(values: number[]): string | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const med = s[Math.floor(s.length / 2)];
  const lo = Math.round(s[0] * 100);
  const hi = Math.round(s[s.length - 1] * 100);
  return lo === hi ? `~${lo}%` : `~${Math.round(med * 100)}% (${lo}–${hi}% by horizon)`;
}

export default function TrackRecordView({ meta, view, archive }: { meta: Meta; view: TrackView; archive: ArchiveIndex }) {
  const [h, setH] = useState(3);
  const [model, setModel] = useState<ModelId>("rw");
  const k = meta.consts.bu_per_t / 100;
  const m = view.metrics;
  const valYears = `${meta.splits.validation[0].slice(0, 4)}–${meta.splits.validation[1].slice(0, 4)}`;
  const holdYears = `${meta.splits.holdout_start.slice(0, 4)}+`;
  const testsBy = useMemo(() => new Map(view.tests.map((t) => [`${t.model}-${t.h}`, t])), [view.tests]);

  // ---- verdict (always visible): no model beat no change, and how big an edge we could have seen
  const allRw = HS.every((hh) => meta.champion[String(hh)] === "rw");
  const mdes = HS.map((hh) => find(m, "validation", "ridge", hh)?.mde_mae).filter((v): v is number => v != null);
  const mde = mdeText(mdes);
  const verdict = allRw
    ? `No model beat no change at any horizon, Holm-adjusted${mde ? `; we could detect a ${mde} lower error by the WASDE model` : ""}.`
    : `${HS.filter((hh) => meta.champion[String(hh)] !== "rw")
        .map((hh) => `${SHORT[meta.champion[String(hh)]]} beat no change at ${horizonLabel(hh)}`)
        .join("; ")} (Holm-adjusted).`;
  const breach = HS.map((hh) => {
    const r = find(m, "validation", "rw", hh);
    return { h: hh, lo: r?.miss_lo80 ?? 0, hi: r?.miss_hi80 ?? 0, cover: r?.cover80 ?? 0 };
  });

  // ---- dot plot: % MAE vs no change, per challenger and horizon
  const dots = useMemo(
    () =>
      HS.flatMap((hh) =>
        CHALLENGERS.map((mo) => {
          const v = find(m, "validation", mo, hh);
          const ho = find(m, "holdout", mo, hh);
          const ci = maeVsNoChange(v?.mase, testsBy.get(`${mo}-${hh}`)?.dm_mae_t);
          return {
            label: `${SHORT[mo]} · ${hh}m`,
            model: mo,
            h: hh,
            val: ci?.d ?? null,
            lo: ci?.lo ?? null,
            hi: ci?.hi ?? null,
            hold: ho?.mase == null ? null : (ho.mase - 1) * 100,
          };
        }),
      ).reverse(),
    [m, testsBy],
  );

  const dotOption = useCallback(
    (t: Tokens) => {
      const cats = dots.map((d) => d.label);
      const span = Math.max(10, ...dots.flatMap((d) => [d.lo, d.hi, d.val, d.hold].filter((x): x is number => x !== null).map(Math.abs)));
      const lim = Math.ceil(span / 5) * 5;
      return {
        ...baseOption(t),
        grid: { ...baseOption(t).grid, top: 36, left: 8, right: 24 },
        legend: {
          top: 0,
          left: 0,
          data: [`Validation ${valYears}`, `Holdout ${holdYears}`],
          textStyle: { color: t.ink2 },
          itemWidth: 10,
          itemHeight: 10,
        },
        tooltip: {
          ...baseOption(t).tooltip,
          trigger: "item",
          formatter: (p: { dataIndex: number; seriesName: string }) => {
            const d = dots[p.dataIndex];
            if (!d) return "";
            const ci = d.lo !== null && d.hi !== null ? `<br/>95% interval (DM): ${signedPct(d.lo)} to ${signedPct(d.hi)}` : "";
            const v = d.val === null ? "—" : signedPct(d.val);
            const ho = d.hold === null ? "—" : signedPct(d.hold);
            return `<b>${SHORT[d.model]}, ${horizonLabel(d.h)}</b><br/>Validation: ${v} MAE vs no change${ci}<br/>Holdout: ${ho}`;
          },
        },
        xAxis: {
          type: "value",
          min: -lim,
          max: lim,
          ...axisCommon(t),
          axisLabel: { ...axisCommon(t).axisLabel, formatter: (v: number) => signedPct(v, 0) },
          name: "error vs no change (− = better)",
          nameLocation: "middle",
          nameGap: 26,
          nameTextStyle: { color: t.muted, fontSize: 11 },
        },
        yAxis: { type: "category", data: cats, ...axisCommon(t), splitLine: { show: false }, axisLabel: { color: t.ink2, fontSize: 11 } },
        series: [
          {
            name: `Validation ${valYears}`,
            type: "line",
            symbol: "circle",
            symbolSize: 9,
            lineStyle: { width: 0 },
            itemStyle: { color: t.ink2 },
            data: dots.map((d, i) => [d.val, i]),
            markLine: {
              silent: true,
              symbol: "none",
              animation: false,
              label: { show: false },
              data: [
                [
                  { coord: [0, 0], lineStyle: { color: t.ink, width: 1.25, type: "solid" } },
                  { coord: [0, cats.length - 1] },
                ],
                ...dots
                  .map((d, i) =>
                    d.lo === null || d.hi === null
                      ? null
                      : [
                          { coord: [d.lo, i], lineStyle: { color: t.neutral, width: 2, type: "solid" } },
                          { coord: [d.hi, i] },
                        ],
                  )
                  .filter((x) => x !== null),
              ],
            },
          },
          {
            name: `Holdout ${holdYears}`,
            type: "line",
            symbol: "diamond",
            symbolSize: 10,
            lineStyle: { width: 0 },
            itemStyle: { color: "transparent", borderColor: t.ink, borderWidth: 1.5 },
            data: dots.map((d, i) => [d.hold, i]),
          },
        ],
      };
    },
    [dots, valYears, holdYears],
  );

  // ---- path chart: holdout shading, 80% misses, roll flags
  const raw = view.paths[String(h)];
  const path = useMemo(
    () => ({ ...raw, t: raw.t.map(isoDay), split: [...raw.split], roll: [...raw.roll].map(Number), crop: [...raw.crop].map(Number) }),
    [raw],
  );
  const pathOption = useCallback(
    (t: Tokens) => {
      const pm = path.models[model as (typeof PATH_MODELS)[number]];
      const n = path.t.length;
      const iBand = [...Array(n).keys()].filter((i) => pm.lo[i] !== null && pm.hi[i] !== null);
      const miss = [...Array(n).keys()].filter(
        (i) => path.actual[i] !== null && pm.lo[i] !== null && pm.hi[i] !== null && (path.actual[i]! < pm.lo[i]! || path.actual[i]! > pm.hi[i]!),
      );
      const crop = [...Array(n).keys()].filter((i) => path.crop[i] === 1 && path.actual[i] !== null);
      const holdStart = path.t[path.split.indexOf("h")];
      const lastT = path.t[n - 1];
      return {
        ...baseOption(t),
        legend: {
          top: 0,
          left: 0,
          data: ["80% range", `Forecast made ${horizonLabel(h)} earlier`, "Actual CBOT", "Outside the 80% range", "Crosses old→new crop roll"],
          textStyle: { color: t.ink2 },
          itemWidth: 14,
          itemHeight: 8,
        },
        tooltip: {
          ...baseOption(t).tooltip,
          trigger: "axis",
          formatter: (ps: { dataIndex: number; seriesName: string; value: [string, number | null] }[]) => {
            const p = ps.find((x) => x.seriesName === "Actual CBOT") ?? ps.find((x) => x.seriesName.startsWith("Forecast"));
            if (!p) return "";
            const i = path.t.indexOf(p.value[0]);
            if (i < 0) return "";
            const lines = [
              `<b>${dateLabel(path.t[i])}</b> · ${path.split[i] === "h" ? "holdout" : "validation"}`,
              `Actual: ${path.actual[i] === null ? "pending" : `${num(path.actual[i], 0)} USD/t`}`,
              `Forecast: ${num(pm.f[i], 0)} USD/t`,
              pm.lo[i] === null ? "80% range: not yet (too few past errors)" : `80% range: ${num(pm.lo[i], 0)}–${num(pm.hi[i], 0)} USD/t`,
            ];
            if (path.roll[i]) lines.push(path.crop[i] ? "Window crosses the old→new crop roll" : "Window crosses a contract roll");
            return lines.join("<br/>");
          },
        },
        grid: { ...baseOption(t).grid, top: 56 },
        xAxis: { type: "time", ...axisCommon(t), splitLine: { show: false } },
        yAxis: { type: "value", scale: true, name: "USD/t", nameTextStyle: { color: t.muted }, ...axisCommon(t) },
        series: [
          {
            name: "80% range low",
            type: "line",
            stack: "band",
            symbol: "none",
            lineStyle: { opacity: 0 },
            data: iBand.map((i) => [path.t[i], pm.lo[i]]),
            tooltip: { show: false },
            silent: true,
            markArea: holdStart
              ? {
                  silent: true,
                  itemStyle: { color: t.grid, opacity: 0.45 },
                  label: { show: true, position: "insideTopLeft", color: t.muted, fontSize: 11, formatter: "holdout" },
                  data: [[{ xAxis: holdStart }, { xAxis: lastT }]],
                }
              : undefined,
          },
          {
            name: "80% range",
            type: "line",
            stack: "band",
            symbol: "none",
            lineStyle: { opacity: 0 },
            areaStyle: { color: t.series1, opacity: 0.2 },
            itemStyle: { color: t.series1, opacity: 0.4 },
            data: iBand.map((i) => [path.t[i], Math.round((pm.hi[i]! - pm.lo[i]!) * 10) / 10]),
            tooltip: { show: false },
          },
          {
            name: `Forecast made ${horizonLabel(h)} earlier`,
            type: "line",
            symbol: "none",
            lineStyle: { color: t.series1, width: 1.5, type: "dashed" },
            itemStyle: { color: t.series1 },
            data: path.t.map((d, i) => [d, pm.f[i]]),
          },
          {
            name: "Actual CBOT",
            type: "line",
            symbol: "none",
            lineStyle: { color: t.ink, width: 1.5 },
            itemStyle: { color: t.ink },
            data: path.t.map((d, i) => [d, path.actual[i]]).filter((x) => x[1] !== null),
          },
          {
            name: "Outside the 80% range",
            type: "line",
            symbol: "circle",
            symbolSize: 6,
            lineStyle: { width: 0 },
            itemStyle: { color: t.warn, borderColor: t.surface, borderWidth: 1 },
            data: miss.map((i) => [path.t[i], path.actual[i]]),
            tooltip: { show: false },
            z: 4,
          },
          {
            name: "Crosses old→new crop roll",
            type: "line",
            symbol: "triangle",
            symbolSize: 7,
            lineStyle: { width: 0 },
            itemStyle: { color: t.surface, borderColor: t.ink2, borderWidth: 1.25 },
            data: crop.map((i) => [path.t[i], path.actual[i]]),
            tooltip: { show: false },
            z: 3,
          },
        ],
      };
    },
    [path, h, model],
  );

  const pm = path.models[model as (typeof PATH_MODELS)[number]];
  const rollShare = {
    n: path.roll.filter((x) => x === 1).length,
    crop: path.crop.filter((x) => x === 1).length,
    total: path.t.length,
  };
  const nMiss = path.t.filter(
    (_, i) => path.actual[i] !== null && pm.lo[i] !== null && pm.hi[i] !== null && (path.actual[i]! < pm.lo[i]! || path.actual[i]! > pm.hi[i]!),
  ).length;
  const nScored = path.t.filter((_, i) => path.actual[i] !== null && pm.lo[i] !== null).length;

  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <p className="text-sm font-medium text-brand">Out-of-sample, one forecast per WASDE report</p>
        <h1 className="max-w-3xl text-3xl font-semibold tracking-tight">Did any model beat &ldquo;no change&rdquo;?</h1>
        <div className="card grid gap-5 p-5 lg:grid-cols-[1fr_1.1fr]">
          <div className="space-y-2">
            <p className="text-lg font-semibold leading-snug text-ink" data-testid="verdict">
              {verdict}
            </p>
            <p className="text-sm leading-relaxed text-ink-2">
              Every forecast was made with only what was public on that report day and scored later against the actual CBOT
              close. Models were compared on {dateLabel(meta.splits.validation[0])} – {dateLabel(meta.splits.validation[1])};
              the reports since {dateLabel(meta.splits.holdout_start)} were kept aside and not used for any model choice (I
              had seen 2024–25 prices, so they are not a blind test).
            </p>
          </div>
          <BreachStrip rows={breach} years={valYears} />
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        {HS.map((hh) => {
          const rw = find(m, "validation", "rw", hh);
          const rwH = find(m, "holdout", "rw", hh);
          const others = CHALLENGERS.map((x) => find(m, "validation", x, hh)).filter((x): x is SlimMetric => !!x);
          const best = others.reduce<SlimMetric | undefined>((a, b) => ((b.mase ?? 9) < (a?.mase ?? 9) ? b : a), undefined);
          const mdeRidge = find(m, "validation", "ridge", hh)?.mde_mae;
          const champ = meta.champion[String(hh)];
          const d = best?.mase == null ? null : (best.mase - 1) * 100;
          return (
            <article key={hh} className="card space-y-3 p-5" data-testid={`tr-card-${hh}`}>
              <h2 className="text-sm font-medium text-ink-2">{horizonLabel(hh)} ahead</h2>
              <p className="text-2xl font-semibold tracking-tight">Winner: {champ === "rw" ? "no change" : SHORT[champ]}</p>
              <p className="text-sm text-ink-2" data-testid={`rival-${hh}`}>
                {best && d !== null
                  ? `Closest rival: ${SHORT[best.model]}, ${num(Math.abs(d), 1)}% ${d > 0 ? "worse" : d < 0 ? "better" : "level"}.`
                  : "No rival scored."}
              </p>
              <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
                <dt className="text-ink-2">Typical miss, no change</dt>
                <dd className="tabular text-right">{num(rw?.mae_usd_t, 1)} USD/t</dd>
                <dt className="text-ink-2">
                  80% range <Term k="hit">hit rate</Term>
                </dt>
                <dd className="tabular text-right">
                  {pct(rw?.cover80)} <span className="text-muted">/ {pct(rwH?.cover80)} holdout</span>
                </dd>
                <dt className="text-ink-2">
                  95% range <Term k="hit">hit rate</Term>
                </dt>
                <dd className="tabular text-right">
                  {pct(rw?.cover95)} <span className="text-muted">/ {pct(rwH?.cover95)} holdout</span>
                </dd>
              </dl>
              {mdeRidge != null && (
                <p className="text-xs leading-relaxed text-ink-2" data-testid={`mde-${hh}`}>
                  We could detect a ~{num(mdeRidge * 100, 0)}% lower error by the WASDE model than by no change;{" "}
                  {champ === "rw" ? "none was found." : `${meta.models[champ]} passed.`}
                </p>
              )}
              {hh > 1 && <p className="text-xs text-muted">Overlapping {hh}-month windows: few independent outcomes, low power.</p>}
            </article>
          );
        })}
      </section>

      <section className="card space-y-3 p-5">
        <h2 className="text-lg font-semibold">Error against no change, by model and horizon</h2>
        <Chart option={dotOption} height={340} ariaLabel="Dot plot of each challenger's mean absolute error relative to no change, with intervals" />
        <p className="text-xs leading-relaxed text-muted">
          Each dot is a challenger&apos;s mean absolute error (USD/t) relative to no change: left of the line is better,
          right is worse. Circles: validation {valYears}, with an approximate 95% interval from the{" "}
          <Term k="dm">Diebold-Mariano</Term> statistic on the same errors. Hollow diamonds: holdout {holdYears}, no interval
          (few reports). Challengers share one neutral colour on purpose: none of them is the answer.
        </p>
      </section>

      <PublishedVsOutcome archive={archive} k={k} />

      <section className="card space-y-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Past forecasts against what happened</h2>
          <div className="flex flex-wrap gap-2">
            <Pill label="Horizon" options={HS} value={h} onChange={setH} render={(x) => horizonLabel(x)} />
            <Pill label="Model" options={[...PATH_MODELS] as ModelId[]} value={model} onChange={setModel} render={(x) => SHORT[x]} />
          </div>
        </div>
        <Chart option={pathOption} height={380} ariaLabel="Past forecasts with 80% ranges against the actual CBOT price" />
        <p className="text-xs leading-relaxed text-muted">
          Each point sits on the date the forecast was for; the shaded block is the holdout. Ranges start once{" "}
          <span data-testid="calib-min">{meta.calib_min}</span> realized errors exist.{" "}
          <span data-testid="miss-count">
            {nMiss} of {nScored} outcomes fell outside the 80% range (amber dots).
          </span>{" "}
          CBOT front month, USD/t. The continuous front month jumps when a contract expires, so a window crossing a roll
          partly measures a calendar spread; the July–September rolls (old crop to new crop, triangles) are the largest.{" "}
          <span data-testid="roll-share">
            {rollShare.n} of {rollShare.total} {h}-month windows shown cross a roll ({rollShare.crop} an old-to-new-crop roll).
          </span>
        </p>
      </section>

      <section className="card space-y-3 p-5 text-sm">
        <h2 className="text-base font-semibold">Paranaguá FOB, illustrative</h2>
        <p className="text-ink-2">
          Where the premium history exists (to {dateLabel(meta.premium_source.last)}), FOB = CBOT forecast + premium held at
          its value on the report day, for no change only. Computed once from the daily series, which is no longer
          published.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[28rem]" data-testid="fob-table">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                <th className="py-2 font-medium">Horizon</th>
                <th className="py-2 text-right font-medium">Validation</th>
                <th className="py-2 text-right font-medium">Holdout</th>
              </tr>
            </thead>
            <tbody>
              {HS.map((hh) => {
                const cell = (split: string) => {
                  const r = view.fob.find((x) => x.model === "rw" && x.h === hh && x.split === split);
                  return r ? (
                    <>
                      {num(r.mae_usd_t, 1)} USD/t <span className="text-muted">({num(r.mape_pct, 1)}%, {num(r.n)} reports)</span>
                    </>
                  ) : (
                    "—"
                  );
                };
                return (
                  <tr key={hh} className="border-b border-line last:border-0">
                    <td className="py-1.5">{horizonLabel(hh)}</td>
                    <td className="tabular py-1.5 text-right">{cell("validation")}</td>
                    <td className="tabular py-1.5 text-right">{cell("holdout")}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted">Average miss (mean absolute error). Holdout FOB covers few reports; read it as indicative only.</p>
      </section>

      <ForStatisticians meta={meta} view={view} testsBy={testsBy} valYears={valYears} holdYears={holdYears} />
    </div>
  );
}

function ForStatisticians({
  meta,
  view,
  testsBy,
  valYears,
  holdYears,
}: {
  meta: Meta;
  view: TrackView;
  testsBy: Map<string, TrackView["tests"][number]>;
  valYears: string;
  holdYears: string;
}) {
  const m = view.metrics;
  const allHolmOne = view.tests.every((t) => t.cw_p_holm !== null && t.cw_p_holm >= 0.9995);
  const methodLabel = meta.intervals.range_labels as Record<string, string>;
  // The fold's tables are rendered on first open: they are the bulk of the page's markup, and
  // keeping them out of the static HTML holds /track-record/ under its 100 KB budget.
  const [opened, setOpened] = useState(false);
  return (
    <details
      className="card p-5 text-sm"
      id="for-statisticians"
      data-testid="for-statisticians"
      onToggle={(e) => {
        if ((e.currentTarget as HTMLDetailsElement).open) setOpened(true);
      }}
    >
      <summary className="cursor-pointer text-base font-semibold">For statisticians: tests, calibration and the range method</summary>
      {opened && (
      <div className="mt-4 space-y-6">
        <div className="space-y-2">
          <h3 className="font-semibold">Forecast accuracy tests (validation {valYears})</h3>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem]" data-testid="tests-table">
              <thead>
                <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                  <th className="py-2 font-medium">Model</th>
                  <th className="py-2 font-medium">Horizon</th>
                  <th className="py-2 text-right font-medium">MAE vs no change</th>
                  <th className="py-2 text-right font-medium">
                    <Term k="dm">DM</Term> <Term k="p">p</Term>
                  </th>
                  <th className="py-2 text-right font-medium">DM p (MAE)</th>
                  <th className="py-2 text-right font-medium">
                    <Term k="cw">CW</Term> p
                  </th>
                  <th className="py-2 text-right font-medium">
                    CW p (<Term k="holm">Holm</Term>)
                  </th>
                </tr>
              </thead>
              <tbody>
                {view.tests.map((r) => {
                  const mase = find(m, "validation", r.model, r.h)?.mase;
                  const worse = r.dm_t != null && r.dm_p != null && r.dm_t > 0 && r.dm_p < 0.05;
                  return (
                    <tr key={`${r.model}-${r.h}`} className="border-b border-line last:border-0">
                      <td className="py-1.5">{meta.models[r.model]}</td>
                      <td className="py-1.5">{horizonLabel(r.h)}</td>
                      <td className="tabular py-1.5 text-right" data-testid={`mae-vs-${r.model}-${r.h}`}>
                        {mase == null ? "—" : signedPct((mase - 1) * 100)}
                      </td>
                      <td className="tabular py-1.5 text-right">
                        {pFmt(r.dm_p)} {worse ? <span className="text-down">(worse)</span> : null}
                      </td>
                      <td className="tabular py-1.5 text-right">{pFmt(r.dm_mae_p)}</td>
                      <td className="tabular py-1.5 text-right">{pFmt(r.cw_p)}</td>
                      <td className="tabular py-1.5 text-right">{pFmt(r.cw_p_holm)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-xs leading-relaxed text-muted">
            DM: Diebold-Mariano on the {meta.inference_rule.primary_loss} (the primary loss), Harvey-Leybourne-Newbold
            correction, Newey-West lag h−1; &ldquo;DM p (MAE)&rdquo; is the same test on absolute USD/t errors. CW:
            Clark-West, one-sided, for models that nest no change; Holm-adjusted across all nine tests. A model replaces no
            change only if Holm CW p &lt; {meta.champion_alpha} and its primary loss is lower.
            {allHolmOne &&
              " The Holm column reads 1.000 everywhere: no raw CW p is small enough to stay below 1 after multiplying by the number of remaining tests, and Holm caps adjusted p-values at 1. It is kept because it is the column the decision rule uses."}{" "}
            Interval for the dot plot: d ± 1.96·d/t<sub>DM</sub> on the MAE version of the statistic.
            {(() => {
              const t = testsBy.get("ridge-1");
              return t?.dm_mae_p != null && t.dm_mae_p < 0.05 ? " The WASDE ridge model is significantly worse than no change on MAE at 1 month." : "";
            })()}
          </p>
        </div>

        <div className="space-y-2">
          <h3 className="font-semibold">Calibration of the published no-change ranges</h3>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[44rem]" data-testid="calibration-table">
              <thead>
                <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                  <th className="py-2 font-medium">Range</th>
                  <th className="py-2 font-medium">Horizon</th>
                  <th className="py-2 font-medium">Split</th>
                  <th className="py-2 text-right font-medium">
                    <Term k="hit">Hit rate</Term> (95% CI)
                  </th>
                  <th className="py-2 text-right font-medium">n_eff</th>
                  <th className="py-2 text-right font-medium">Below / above</th>
                  <th className="py-2 text-right font-medium">
                    <Term k="kupiec">Kupiec</Term> p
                  </th>
                  <th className="py-2 text-right font-medium">
                    <Term k="christ">Christoffersen</Term> p
                  </th>
                  <th className="py-2 text-right font-medium">
                    <Term k="mde">MDE</Term> (ridge)
                  </th>
                </tr>
              </thead>
              <tbody>
                {(["80", "95"] as const).flatMap((lv) =>
                  HS.flatMap((hh) =>
                    (["validation", "holdout"] as const).map((sp) => {
                      const r = find(m, sp, "rw", hh);
                      const ridge = find(m, sp, "ridge", hh);
                      if (!r) return null;
                      const c = lv === "80" ? r.cover80 : r.cover95;
                      const lo = lv === "80" ? r.cover80_ci_lo : r.cover95_ci_lo;
                      const hi = lv === "80" ? r.cover80_ci_hi : r.cover95_ci_hi;
                      const ne = lv === "80" ? r.cover80_n_eff : r.cover95_n_eff;
                      const mlo = lv === "80" ? r.miss_lo80 : r.miss_lo95;
                      const mhi = lv === "80" ? r.miss_hi80 : r.miss_hi95;
                      const ku = lv === "80" ? r.kupiec80_p : r.kupiec95_p;
                      const ch = lv === "80" ? r.christ80_p : r.christ95_p;
                      return (
                        <tr key={`${lv}-${hh}-${sp}`} className="border-b border-line last:border-0">
                          <td className="py-1.5">{lv}%</td>
                          <td className="py-1.5">{horizonLabel(hh)}</td>
                          <td className="py-1.5 text-ink-2">{sp === "validation" ? valYears : holdYears}</td>
                          <td className="tabular py-1.5 text-right">
                            {pct(c)} <span className="text-muted">({pct(lo)}–{pct(hi)})</span>
                          </td>
                          <td className="tabular py-1.5 text-right">{num(ne, 0)}</td>
                          <td className="tabular py-1.5 text-right">
                            {pct(mlo)} / {pct(mhi)}
                          </td>
                          <td className="tabular py-1.5 text-right">{pFmt(ku)}</td>
                          <td className="tabular py-1.5 text-right">{pFmt(ch)}</td>
                          <td className="tabular py-1.5 text-right">{ridge?.mde_mae == null ? "—" : pct(ridge.mde_mae)}</td>
                        </tr>
                      );
                    }),
                  ),
                )}
              </tbody>
            </table>
          </div>
          <p className="text-xs leading-relaxed text-muted">
            Method: {meta.inference_rule.calibration}. The median p over the h every-h-th subsamples is used because
            overlapping windows break the independence those two tests assume.
          </p>
        </div>

        <div className="space-y-2">
          <h3 className="font-semibold">Our range method against a plain volatility band</h3>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[38rem]" data-testid="range-choice-table">
              <thead>
                <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                  <th className="py-2 font-medium">Method</th>
                  <th className="py-2 text-right font-medium">Interval score vs ours, validation</th>
                  <th className="py-2 text-right font-medium">80% hit rate 1/3/6m, validation</th>
                  <th className="py-2 text-right font-medium">Score, holdout (reported only)</th>
                </tr>
              </thead>
              <tbody>
                {meta.intervals.range_candidates.map((mt) => {
                  const v = view.rangeChoice.find((r) => r.method === mt && r.split === "validation");
                  const ho = view.rangeChoice.find((r) => r.method === mt && r.split === "holdout");
                  return (
                    <tr key={mt} className="border-b border-line last:border-0">
                      <td className="py-1.5">
                        {methodLabel[mt] ?? mt}
                        {v?.chosen && <span className="ml-1.5 text-xs text-muted">(published)</span>}
                      </td>
                      <td className="tabular py-1.5 text-right">{num(v?.score_ratio, 3)}</td>
                      <td className="tabular py-1.5 text-right">
                        {HS.map((hh) => pct(view.rangeDiag.find((r) => r.method === mt && r.split === "validation" && r.h === hh)?.c80)).join(" / ")}
                      </td>
                      <td className="tabular py-1.5 text-right">{num(ho?.score_ratio, 3)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-xs leading-relaxed text-muted">
            {meta.intervals.range_rule} Below 1 = a better interval score than ours (sharper for the same coverage).
            {(() => {
              const better = view.rangeChoice.filter((r) => r.split === "holdout" && !r.chosen && (r.score_ratio ?? 9) < 1);
              return better.length
                ? ` On the holdout ${better.map((r) => methodLabel[r.method] ?? r.method).join(" and ")} scored better; that is reported and not acted on, because choosing on the holdout would spend it.`
                : "";
            })()}
          </p>
        </div>
      </div>
      )}
    </details>
  );
}
