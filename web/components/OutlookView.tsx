"use client";

import Link from "next/link";
import { useCallback, useState } from "react";

import Chart from "@/components/Chart";
import StressReplay from "@/components/StressReplay";
import { axisCommon, baseOption, type Tokens } from "@/lib/chart";
import {
  type Assumptions,
  ciText,
  convert,
  dateLabel,
  decimalsFor,
  heldText,
  horizonLabel,
  money,
  MONTHS,
  monthLabel,
  num,
  parseFx,
  premiumUsdT,
  rangeLabel,
  type Unit,
  UNIT_LABEL,
  UNIT_LONG,
} from "@/lib/format";
import type { Horizon, Meta, Outlook } from "@/lib/types";

type Props = { meta: Meta; outlook: Outlook };

const UNITS: { id: Unit; label: string }[] = [
  { id: "usd_t", label: "FOB USD/t" },
  { id: "brl_sack", label: "FOB R$/sack" },
  { id: "c_bu", label: "CBOT ¢/bu" },
];

// P1 phase 1: the band is CBOT risk only; premium and FX uncertainty are not in it.
const CBOT_ONLY = "CBOT price risk only; premium and BRL held fixed";
const FOB_BRIDGE = "FOB = CBOT + your premium; CBOT unchanged, FOB changes only through the premium you enter.";

function Segmented({ value, onChange }: { value: Unit; onChange: (u: Unit) => void }) {
  return (
    <div role="radiogroup" aria-label="Price unit" className="inline-flex rounded-lg border border-line bg-surface p-0.5">
      {UNITS.map((u) => (
        <button
          key={u.id}
          type="button"
          role="radio"
          aria-checked={value === u.id}
          onClick={() => onChange(u.id)}
          className={`rounded-md px-3 py-1.5 text-sm ${
            value === u.id ? "bg-surface-2 font-medium text-ink" : "text-ink-2 hover:text-ink"
          }`}
        >
          {u.label}
        </button>
      ))}
    </div>
  );
}

/** Small word badge; the amber tone always comes with text, never colour alone. */
function Badge({ children, title, warn = false }: { children: React.ReactNode; title?: string; warn?: boolean }) {
  return (
    <span
      title={title}
      className={`ml-1.5 inline-block rounded-full border px-1.5 py-px align-middle text-[0.7rem] font-medium leading-4 ${
        warn ? "border-warn-line bg-warn-soft text-warn" : "border-line bg-surface-2 text-ink-2"
      }`}
    >
      {children}
    </span>
  );
}

function HorizonCard({
  h,
  unit,
  a,
  origin,
}: {
  h: Horizon;
  unit: Unit;
  a: Assumptions;
  origin: string;
}) {
  const c = (v: number) => convert(v, unit, a);
  const isRw = h.model === "rw";
  const cov = h.coverage;
  const ref = h.premium_reference;
  const usdT = (v: number) => premiumUsdT(v, a.buPerT);
  const ci80 = ciText(cov.validation, "80");
  const ci95 = ciText(cov.validation, "95", false);
  const ct = h.contract;
  return (
    <article className="card flex flex-col gap-3 p-5" data-testid={`horizon-${h.h}`}>
      <header className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium text-ink-2">In {horizonLabel(h.h)}</h3>
        <span className="text-xs text-muted">{dateLabel(h.target_date)}</span>
      </header>
      <div>
        <p className={`text-xs ${cov.warn80 ? "font-medium text-warn" : "text-muted"}`} data-testid="label80">
          {rangeLabel(cov, "80")}, {UNIT_LABEL[unit]}
          {cov.warn80 && (
            <Badge warn title="Validation hit rate more than 5 percentage points below the nominal 80%">
              below 80%
            </Badge>
          )}
        </p>
        {ci80 && (
          <p className="text-xs text-muted" data-testid="ci80">
            {cov.validation?.years}: {ci80}
          </p>
        )}
        <p className="tabular text-2xl font-semibold tracking-tight">
          {num(c(h.q100), decimalsFor(unit))} – {num(c(h.q900), decimalsFor(unit))}
        </p>
        {unit !== "c_bu" && <p className="mt-0.5 text-xs text-muted">{CBOT_ONLY}</p>}
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
        <dt className="text-ink-2">Central</dt>
        <dd className="tabular text-right">
          {money(c(h.central), unit)}
          {isRw && <span className="ml-1 text-xs text-muted">(CBOT unchanged)</span>}
        </dd>
        <dt className="text-ink-2">95% range</dt>
        <dd className="tabular text-right text-ink-2">
          {num(c(h.q025), decimalsFor(unit))} – {num(c(h.q975), decimalsFor(unit))}
          <span className={`block text-xs ${cov.warn95 ? "text-warn" : "text-muted"}`} data-testid="held95">
            {heldText(cov, "95")}
          </span>
          {ci95 && (
            <span className="block text-xs text-muted" data-testid="ci95">
              {ci95}
            </span>
          )}
          {cov.warn95 && (
            <Badge warn title="Validation hit rate more than 5 percentage points below the nominal 95%">
              below 95%
            </Badge>
          )}
        </dd>
        <dt className="text-ink-2">Hedge contract</dt>
        <dd className="tabular text-right" data-testid="contract">
          {ct.reference.code}
          {ct.crosses_roll && (
            <Badge title="The continuous front-month price rolls to another contract inside this window, so part of the move is a calendar spread">
              crosses a roll
            </Badge>
          )}
          <span className="block text-xs text-muted">
            {ct.crosses_roll
              ? `price series rolls ${ct.front_at_origin} → ${ct.front_at_target}${ct.crosses_crop_roll ? ", old to new crop" : ""}`
              : `price series stays on ${ct.front_at_origin}`}
          </span>
        </dd>
        {unit !== "c_bu" && (
          <>
            <dt className="text-ink-2">Premium used</dt>
            <dd className="tabular text-right text-ink-2">
              {signed0(a.premium)}¢/bu
              <span className="block text-xs text-muted">{signedUsd(usdT(a.premium))} USD/t, held flat</span>
            </dd>
            <dt className="text-ink-2">Premium p10–p90</dt>
            <dd className="tabular text-right text-ink-2" data-testid="premium-band">
              {signedUsd(usdT(ref.p10))} / {signedUsd(usdT(ref.p90))} USD/t
              <span className="block text-xs text-muted">
                {MONTHS[ref.month - 1]} shipments {ref.years}: {signedUsd(usdT(ref.median))} USD/t ({ref.note})
              </span>
            </dd>
          </>
        )}
      </dl>
      <p className="text-xs leading-relaxed text-ink-2">{FOB_BRIDGE}</p>
      <p className="mt-auto border-t border-line pt-3 text-xs leading-relaxed text-muted">
        Hit rates on {cov.validation?.n ?? "—"} validation and {cov.holdout?.n ?? "—"} later reports. Each 95% tail rests on
        about {num(h.tail_obs_95, 1)} of the {h.calibration_n} past errors behind the range (about{" "}
        {num(h.calibration_n_eff, 0)} non-overlapping). {origin}
      </p>
    </article>
  );
}

// P15: how far the live forecast is from the release-day origins the ranges were tested on.
const issuedLabel = (month: string, days: number) =>
  days <= 0
    ? `Issued on the ${month} WASDE release day`
    : `Issued from the ${month} WASDE, ${days} day${days === 1 ? "" : "s"} after its release`;

type HistSpan = "18m" | "3y";
const HIST_MONTHS: Record<HistSpan, number> = { "18m": 18, "3y": 36 };

function MiniToggle<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: [T, string][];
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-lg border border-line bg-surface p-0.5 text-xs">
      {options.map(([id, text]) => (
        <button
          key={id}
          type="button"
          role="radio"
          aria-checked={value === id}
          onClick={() => onChange(id)}
          className={`rounded-md px-2.5 py-1 ${value === id ? "bg-surface-2 font-medium text-ink" : "text-ink-2 hover:text-ink"}`}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

const signed0 = (v: number) => (v > 0 ? `+${num(v)}` : v < 0 ? `−${num(Math.abs(v))}` : "0");
const signedUsd = (v: number) => (v > 0 ? `+${num(v)}` : v < 0 ? `−${num(Math.abs(v))}` : "0");

export default function OutlookView({ meta, outlook }: Props) {
  const [unit, setUnit] = useState<Unit>("usd_t");
  const [premiumOverride, setPremiumOverride] = useState<number | null>(null);
  const fxDefault = Math.round(meta.fx_default.value * 100) / 100;
  // FX is typed as text and parsed on blur, so a half-typed "5," never snaps back to the default.
  const [fx, setFx] = useState<number>(fxDefault);
  const [fxText, setFxText] = useState<string>(fxDefault.toFixed(2));
  const [fxError, setFxError] = useState<string | null>(null);
  const commitFx = () => {
    const r = parseFx(fxText);
    if (r.ok) {
      setFx(r.value);
      setFxText(r.value.toFixed(2));
      setFxError(null);
    } else setFxError(r.error);
  };
  const [span, setSpan] = useState<HistSpan>("18m");
  const [chartView, setChartView] = useState<"cbot" | "fob">("cbot");

  const last = outlook.last.c_bu;
  const base = { fx, buPerT: meta.consts.bu_per_t, sackKg: meta.consts.sack_kg };
  // One premium for the headline and every horizon: with CBOT unchanged, FOB is unchanged.
  const premiumDefault = outlook.premium_now_default;
  const usingDefault = premiumOverride === null;
  const premium = premiumOverride ?? premiumDefault.median;
  const stale = usingDefault && meta.premium_source.stale;
  const championAllRw = outlook.horizons.every((h) => h.model === "rw");
  const h3 = outlook.horizons.find((h) => h.h === 3) ?? outlook.horizons[0];
  const todayA: Assumptions = { ...base, premium };
  const defaultMonth = MONTHS[premiumDefault.month - 1];
  const issued = issuedLabel(MONTHS[Number(meta.latest_wasde.month.slice(5, 7)) - 1], meta.days_since_report);
  const originNote = `${issued}; ranges are calibrated at release-day closes.`;
  const staleTitle = `Premium source ends ${dateLabel(meta.premium_source.last)}, ${meta.premium_source.days_since_last} days before this forecast (stale after ${meta.premium_source.stale_after_days}).`;

  // Chart (P21): CBOT ¢/bu by default. The FOB view is the same picture shifted by the one flat
  // premium (and scaled by FX for R$/sack): a constant shift, never a historical FOB series.
  const fobView = chartView === "fob" && unit !== "c_bu";
  const chartUnit: Unit = fobView ? unit : "c_bu";
  const option = useCallback(
    (t: Tokens) => {
      const a: Assumptions = { premium: fobView ? premium : 0, fx, buPerT: meta.consts.bu_per_t, sackKg: meta.consts.sack_kg };
      const d = decimalsFor(chartUnit);
      const cv = (v: number) => Math.round(convert(v, chartUnit, a) * 100) / 100;
      const cutoff = new Date(outlook.as_of_close + "T00:00:00Z");
      cutoff.setUTCMonth(cutoff.getUTCMonth() - HIST_MONTHS[span]);
      const hist: [string, number][] = outlook.history
        .filter((p) => new Date(p.date + "T00:00:00Z") >= cutoff)
        .map((p) => [p.date, cv(p.c_bu)]);
      if (hist.length === 0 || hist[hist.length - 1][0] !== outlook.as_of_close) hist.push([outlook.as_of_close, cv(last)]);
      const hs = outlook.horizons;
      const whisker = (hh: Horizon, lo: number, hi: number, level: "80" | "95") => ({
        name: `${level}% range ${hh.h}m`,
        type: "line",
        data: [
          [hh.target_date, cv(lo)],
          [hh.target_date, cv(hi)],
        ],
        symbol: "none",
        silent: true,
        tooltip: { show: false },
        z: level === "80" ? 3 : 2,
        lineStyle:
          level === "80"
            ? { color: hh.coverage.warn80 ? t.warn : t.series1, width: 7, opacity: 0.38, cap: "round" }
            : { color: hh.coverage.warn95 ? t.warn : t.series1, width: 1.5, opacity: 0.75, type: "dashed" },
      });
      // Today and the next WASDE are days apart: labels sit above the plot, pushed apart horizontally.
      const lines: { xAxis: string; name: string; label: { align: "left" | "right"; padding: number[] } }[] = [
        { xAxis: outlook.as_of_close, name: "today", label: { align: "right", padding: [0, 4, 0, 0] } },
      ];
      if (meta.next_wasde && meta.next_wasde > outlook.as_of_close)
        lines.push({
          xAxis: meta.next_wasde,
          name: `next WASDE ${dateLabel(meta.next_wasde)}`,
          label: { align: "left", padding: [0, 0, 0, 4] },
        });
      const fmt = (v: number) => num(v, d);
      return {
        ...baseOption(t),
        legend: { show: false },
        grid: { ...baseOption(t).grid, right: 64, top: 48 },
        tooltip: {
          ...baseOption(t).tooltip,
          trigger: "axis",
          formatter: (ps: { seriesName: string; dataIndex: number; value: [string, number] }[]) => {
            const f = ps.find((p) => p.seriesName === "Forecast" && p.dataIndex > 0);
            if (f) {
              const hh = hs[f.dataIndex - 1];
              return [
                `<b>In ${horizonLabel(hh.h)}</b> · ${dateLabel(hh.target_date)}`,
                `Central (no change): ${fmt(cv(hh.central))}`,
                `80% range: ${fmt(cv(hh.q100))} – ${fmt(cv(hh.q900))}`,
                `95% range: ${fmt(cv(hh.q025))} – ${fmt(cv(hh.q975))}`,
                `<span style="color:${t.muted}">80% ${heldText(hh.coverage, "80")}</span>`,
              ].join("<br/>");
            }
            const c = ps.find((p) => p.seriesName === "Close");
            return c ? `${dateLabel(c.value[0])}<br/>Close: <b>${fmt(c.value[1])}</b>` : "";
          },
        },
        xAxis: { type: "time", ...axisCommon(t), splitLine: { show: false } },
        yAxis: {
          type: "value",
          scale: true,
          ...axisCommon(t),
          name: UNIT_LABEL[chartUnit],
          nameTextStyle: { color: t.muted },
        },
        series: [
          ...hs.map((hh) => whisker(hh, hh.q025, hh.q975, "95")),
          ...hs.map((hh) => whisker(hh, hh.q100, hh.q900, "80")),
          {
            name: "Close",
            type: "line",
            data: hist,
            symbol: "none",
            lineStyle: { color: t.ink, width: 1.5 },
            markLine: {
              silent: true,
              symbol: "none",
              animation: false,
              lineStyle: { color: t.axis, type: "solid", width: 1 },
              label: { color: t.muted, fontSize: 11, position: "end", formatter: "{b}" },
              data: lines,
            },
          },
          {
            name: "Forecast",
            type: "line",
            data: [[outlook.as_of_close, cv(last)], ...hs.map((hh) => [hh.target_date, cv(hh.central)])],
            symbol: "circle",
            symbolSize: (_: unknown, p: { dataIndex: number }) => (p.dataIndex === 0 ? 0 : 8),
            itemStyle: { color: t.series1, borderColor: t.surface, borderWidth: 1.5 },
            lineStyle: { color: t.series1, type: "dashed", width: 1.5 },
            endLabel: { show: true, formatter: "no change", color: t.series1, fontSize: 11, distance: 6 },
            z: 4,
          },
        ],
      };
    },
    [chartUnit, fobView, premium, fx, span, outlook, last, meta.consts.bu_per_t, meta.consts.sack_kg, meta.next_wasde],
  );

  const range = {
    lo: money(convert(h3.q100, unit, todayA), unit),
    hi: money(convert(h3.q900, unit, todayA), unit),
    date: dateLabel(h3.target_date),
  };

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <p className="text-sm font-medium text-brand">
          After the {monthLabel(meta.latest_wasde.month)} WASDE · CBOT close {dateLabel(outlook.as_of_close)}
        </p>
        <h1 className="max-w-3xl text-3xl font-semibold tracking-tight sm:text-4xl">
          Where could Brazilian export soybeans trade in the next six months?
        </h1>
        <p className="max-w-3xl text-lg leading-relaxed text-ink-2" data-testid="headline">
          {unit === "c_bu" ? (
            <>
              CBOT soybeans closed at <strong className="text-ink">{money(last, "c_bu")}</strong>.
            </>
          ) : (
            <>
              CBOT <strong className="text-ink">{money(last, "c_bu")}</strong> +{" "}
              {usingDefault ? "assumed premium" : "your premium"}{" "}
              <strong className="text-ink">{signed0(premium)}¢/bu</strong>
              {usingDefault && (
                <span className="text-base">
                  {" "}
                  ({defaultMonth} median {premiumDefault.years}; data end {dateLabel(premiumDefault.source_last)})
                </span>
              )}
              {stale && (
                <Badge warn title={staleTitle}>
                  stale
                </Badge>
              )}{" "}
              = FOB <strong className="text-ink">{money(convert(last, unit, todayA), unit)}</strong>
              {unit === "brl_sack" && <span className="text-base"> at {num(fx, 2)} BRL/USD</span>}
              {usingDefault && premiumDefault.illustrative && (
                <Badge title="Illustrative until you enter a premium quote below">illustrative</Badge>
              )}
              .
            </>
          )}{" "}
          By {range.date}, the 3-month{" "}
          <span className={h3.coverage.warn80 ? "text-warn" : undefined} data-testid="hero-range-label">
            {rangeLabel(h3.coverage, "80")}
          </span>{" "}
          is <strong className="text-ink">{range.lo}</strong> to <strong className="text-ink">{range.hi}</strong>
          {unit !== "c_bu" && <span className="text-base"> ({CBOT_ONLY})</span>}.
        </p>
        <p className="max-w-3xl text-sm text-muted">
          {issued}. The ranges are calibrated on forecasts made at the close of WASDE release days, so treat them as
          approximate {meta.days_since_report > 0 ? "this far from one" : "between reports"}.
        </p>
      </section>

      {championAllRw && (
        <aside className="card border-l-4 p-4 text-sm leading-relaxed text-ink-2" style={{ borderLeftColor: "var(--accent)" }}>
          <strong className="text-ink">No reliable direction signal.</strong> Tested on every WASDE since 2016, no model
          (including one built on WASDE revisions) predicted CBOT soybeans better than &ldquo;no change&rdquo;. So the
          central line is today&apos;s price, and what this page adds is a <em>tested range</em> labelled with the hit rate
          it actually achieved.{" "}
          <Link className="underline hover:text-ink" href="/track-record/">
            See the track record
          </Link>
          .
        </aside>
      )}

      <section className="flex flex-wrap items-end gap-x-8 gap-y-4">
        <div className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-wide text-muted">Show prices as</p>
          <Segmented value={unit} onChange={setUnit} />
        </div>
        {unit !== "c_bu" && (
          <div className="min-w-64 flex-1 space-y-1">
            <label htmlFor="premium" className="flex justify-between text-xs font-medium uppercase tracking-wide text-muted">
              <span>Paranaguá premium (your input)</span>
              <span className="tabular normal-case text-ink">
                {usingDefault ? `${defaultMonth} median ${signed0(premium)}¢/bu` : `${signed0(premium)}¢/bu`}
                {stale && (
                  <Badge warn title={staleTitle}>
                    stale
                  </Badge>
                )}
              </span>
            </label>
            <input
              id="premium"
              type="range"
              min={-100}
              max={250}
              step={1}
              value={premium}
              onChange={(e) => setPremiumOverride(Number(e.target.value))}
              className="w-full accent-[var(--accent)]"
            />
            <p className="text-xs text-muted">
              Default: the {defaultMonth} median, {premiumDefault.years}, held flat for every horizon. Last quote in the
              source: {signed0(outlook.premium_last.c_bu)}¢/bu on {dateLabel(outlook.premium_last.date)},{" "}
              {meta.premium_source.days_since_last} days ago.{" "}
              {!usingDefault && (
                <button type="button" className="underline hover:text-ink" onClick={() => setPremiumOverride(null)}>
                  Reset
                </button>
              )}
            </p>
          </div>
        )}
        {unit === "brl_sack" && (
          <div className="w-44 space-y-1">
            <label htmlFor="fx" className="text-xs font-medium uppercase tracking-wide text-muted">
              BRL per USD
            </label>
            <input
              id="fx"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={fxText}
              onChange={(e) => setFxText(e.target.value)}
              onBlur={commitFx}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitFx();
              }}
              aria-invalid={fxError !== null}
              aria-describedby="fx-help"
              className={`tabular w-full rounded-md border bg-surface px-2 py-1.5 ${fxError ? "border-warn-line" : "border-line"}`}
            />
            {fxError ? (
              <p id="fx-help" className="text-xs font-medium text-warn" role="alert" data-testid="fx-error">
                {fxError} Using {num(fx, 2)}.
              </p>
            ) : (
              <p id="fx-help" className="text-xs text-muted">
                PTAX {dateLabel(meta.fx_default.date)}: {num(meta.fx_default.value, 4)}
              </p>
            )}
          </div>
        )}
      </section>

      <section className="grid gap-4 md:grid-cols-3" aria-label="Forecast by horizon">
        {outlook.horizons.map((h) => (
          <HorizonCard key={h.h} h={h} unit={unit} a={todayA} origin={originNote} />
        ))}
      </section>

      <section className="card space-y-3 p-5" data-testid="hero-chart">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">
            {fobView ? "FOB view" : "CBOT soybeans"}: recent closes and the tested ranges ahead
          </h2>
          <div className="flex flex-wrap gap-2">
            {unit !== "c_bu" && (
              <MiniToggle
                label="Chart unit"
                value={chartView}
                onChange={setChartView}
                options={[
                  ["cbot", "CBOT"],
                  ["fob", "FOB shift"],
                ]}
              />
            )}
            <MiniToggle
              label="History shown"
              value={span}
              onChange={setSpan}
              options={[
                ["18m", "18 months"],
                ["3y", "3 years"],
              ]}
            />
          </div>
        </div>
        <Chart
          option={option}
          height={360}
          ariaLabel="CBOT soybean closes with the 80% and 95% forecast ranges at 1, 3 and 6 months as whiskers"
        />
        <p className="text-xs leading-relaxed text-muted" data-testid="chart-caption">
          {fobView ? (
            <>
              <strong className="font-medium text-ink-2">FOB view, constant shift:</strong> every point, past and future, is
              CBOT + the one flat premium you set ({signed0(premium)}¢/bu)
              {unit === "brl_sack" ? `, converted at ${num(fx, 2)} BRL/USD` : ""}. It is not a historical FOB series, and the
              ranges still cover CBOT moves only.{" "}
            </>
          ) : (
            <>
              <strong className="font-medium text-ink-2">{UNIT_LONG.c_bu}</strong>, before any premium or exchange rate.{" "}
            </>
          )}
          Whiskers at 1, 3 and 6 months: thick = nominal 80% range, thin dashed = nominal 95% range, whose tails rest on one
          or two past errors each, so read it as rough; amber marks a range that held more than 5 points below its nominal
          level. The dashed &ldquo;no change&rdquo; line is the central forecast. Hover a whisker for its limits; the hit
          rate each range achieved is on the cards above. Ranges come from the errors of the last{" "}
          {meta.calibration_window} out-of-sample forecasts. FOB is (CBOT + premium) × {num(meta.consts.bu_per_t, 4)} bu/t ÷
          100; reais per sack are port FOB at your exchange rate, not a farm-gate price.
        </p>
      </section>

      <StressReplay stress={outlook.stress} buPerT={meta.consts.bu_per_t} />

      <section className="grid gap-4 md:grid-cols-2">
        <div className="card space-y-2 p-5 text-sm leading-relaxed text-ink-2">
          <h2 className="text-base font-semibold text-ink">About the premium</h2>
          <p>
            The Paranaguá premium has no free, licensed public feed. The default is a monthly median derived from a
            terminal export the author holds ({dateLabel(meta.premium_source.first)} –{" "}
            {dateLabel(meta.premium_source.last)}; original source and CBOT contract not recorded). Only the 12 monthly
            statistics are published. Last quote in the source: {signed0(outlook.premium_last.c_bu)}¢/bu on{" "}
            {dateLabel(outlook.premium_last.date)}, {meta.premium_source.days_since_last} days before this forecast.
          </p>
          <p>
            For reference only, the median by shipment month ({outlook.horizons[0]?.premium_reference.note}):{" "}
            {outlook.horizons
              .map(
                (h) =>
                  `${MONTHS[h.premium_reference.month - 1]} ${signed0(h.premium_reference.median)} (p10–p90 ${signed0(
                    h.premium_reference.p10,
                  )}/${signed0(h.premium_reference.p90)}, ${h.premium_reference.years})`,
              )
              .join(", ")}{" "}
            ¢/bu. The forecast holds one premium flat instead. Replace it with your broker&apos;s quote.
          </p>
        </div>
        <div className="card space-y-2 p-5 text-sm leading-relaxed text-ink-2">
          <h2 className="text-base font-semibold text-ink">What the WASDE does</h2>
          <p>
            Revisions move the price on release day, and after that they are priced in. The{" "}
            <Link className="underline hover:text-ink" href="/wasde/">
              WASDE page
            </Link>{" "}
            shows the latest revisions and the historical average reaction to each one, with a calculator for your
            own what-ifs. Next report: {meta.next_wasde ? dateLabel(meta.next_wasde, "long") : "see USDA calendar"}.
          </p>
        </div>
      </section>
    </div>
  );
}
