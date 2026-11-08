"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";

import EChart, { axisCommon, baseOption, type Tokens } from "@/components/EChart";
import {
  type Assumptions,
  convert,
  dateLabel,
  decimalsFor,
  horizonLabel,
  money,
  MONTHS,
  monthLabel,
  num,
  pct,
  type Unit,
  UNIT_LABEL,
  UNIT_LONG,
} from "@/lib/format";
import type { Horizon, Meta, Outlook } from "@/lib/types";

type Props = {
  meta: Meta;
  outlook: Outlook;
  hitRates: Record<string, { cover80: number | null; n: number | null }>;
};

const UNITS: { id: Unit; label: string }[] = [
  { id: "usd_t", label: "FOB USD/t" },
  { id: "brl_sack", label: "FOB R$/sack" },
  { id: "c_bu", label: "CBOT ¢/bu" },
];

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

function HorizonCard({
  h,
  unit,
  a,
  hit,
  origin,
}: {
  h: Horizon;
  unit: Unit;
  a: Assumptions;
  hit: { cover80: number | null; n: number | null };
  origin: string;
}) {
  const c = (v: number) => convert(v, unit, a);
  const isRw = h.model === "rw";
  return (
    <article className="card flex flex-col gap-3 p-5">
      <header className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium text-ink-2">In {horizonLabel(h.h)}</h3>
        <span className="text-xs text-muted">{dateLabel(h.target_date)}</span>
      </header>
      <div>
        <p className="text-xs text-muted">80% range, {UNIT_LABEL[unit]}</p>
        <p className="tabular text-2xl font-semibold tracking-tight">
          {num(c(h.q100), decimalsFor(unit))} – {num(c(h.q900), decimalsFor(unit))}
        </p>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        <dt className="text-ink-2">Central</dt>
        <dd className="tabular text-right">
          {money(c(h.central), unit)}
          {isRw && <span className="ml-1 text-xs text-muted">(CBOT unchanged)</span>}
        </dd>
        <dt className="text-ink-2">95% range</dt>
        <dd className="tabular text-right text-ink-2">
          {num(c(h.q025), decimalsFor(unit))} – {num(c(h.q975), decimalsFor(unit))}
        </dd>
        {unit !== "c_bu" && (
          <>
            <dt className="text-ink-2">Premium used</dt>
            <dd className="tabular text-right text-ink-2">{signed0(a.premium)}¢/bu</dd>
          </>
        )}
      </dl>
      <p className="mt-auto border-t border-line pt-3 text-xs text-muted">
        {hit.cover80 !== null
          ? `In 2016–2023 the 80% range held the actual CBOT price ${pct(hit.cover80)} of the time (${hit.n} reports).`
          : "Hit rate not available yet."}{" "}
        {origin}
      </p>
    </article>
  );
}

// P15: how far the live forecast is from the release-day origins the ranges were tested on.
const issuedLabel = (month: string, days: number) =>
  days <= 0
    ? `Issued on the ${month} WASDE release day`
    : `Issued from the ${month} WASDE, ${days} day${days === 1 ? "" : "s"} after its release`;

const signed0 = (v: number) => (v > 0 ? `+${num(v)}` : v < 0 ? `−${num(Math.abs(v))}` : "0");

export default function OutlookView({ meta, outlook, hitRates }: Props) {
  const [unit, setUnit] = useState<Unit>("usd_t");
  const [premiumOverride, setPremiumOverride] = useState<number | null>(null);
  const [fx, setFx] = useState<number>(Math.round(meta.fx_default.value * 100) / 100);

  const last = outlook.last.c_bu;
  const base = { fx, buPerT: meta.consts.bu_per_t, sackKg: meta.consts.sack_kg };
  // One premium for the headline and every horizon: with CBOT unchanged, FOB is unchanged.
  const premiumDefault = outlook.premium_now_default;
  const premium = premiumOverride ?? premiumDefault.median;
  const championAllRw = outlook.horizons.every((h) => h.model === "rw");
  const h1 = outlook.horizons[0];
  const todayA: Assumptions = { ...base, premium };
  const issued = issuedLabel(MONTHS[Number(meta.latest_wasde.month.slice(5, 7)) - 1], meta.days_since_report);
  const originNote = `${issued}; ranges are calibrated at release-day closes.`;

  // Chart: the CBOT leg only (the part that is forecast), in ¢/bu or USD/t.
  const chartUnit: Unit = unit === "c_bu" ? "c_bu" : "usd_t";
  const zeroPrem: Assumptions = { ...base, premium: 0 };
  const option = useCallback(
    (t: Tokens) => {
      const cv = (v: number) => Math.round(convert(v, chartUnit, zeroPrem) * 100) / 100;
      const cutoff = new Date(outlook.as_of_close);
      cutoff.setFullYear(cutoff.getFullYear() - 3);
      const hist = outlook.history.filter((p) => new Date(p.date) >= cutoff).map((p) => [p.date, cv(p.c_bu)]);
      hist.push([outlook.as_of_close, cv(last)]);
      const xs = [outlook.as_of_close, ...outlook.horizons.map((h) => h.target_date)];
      const lo95 = [cv(last), ...outlook.horizons.map((h) => cv(h.q025))];
      const hi95 = [cv(last), ...outlook.horizons.map((h) => cv(h.q975))];
      const lo80 = [cv(last), ...outlook.horizons.map((h) => cv(h.q100))];
      const hi80 = [cv(last), ...outlook.horizons.map((h) => cv(h.q900))];
      const central = [cv(last), ...outlook.horizons.map((h) => cv(h.central))];
      const band = (name: string, lo: number[], hi: number[], color: string, opacity: number) => [
        {
          name: `${name} low`,
          type: "line",
          data: xs.map((x, i) => [x, lo[i]]),
          stack: name,
          symbol: "none",
          lineStyle: { opacity: 0 },
          tooltip: { show: false },
          silent: true,
        },
        {
          name,
          type: "line",
          data: xs.map((x, i) => [x, Math.round((hi[i] - lo[i]) * 100) / 100]),
          stack: name,
          symbol: "none",
          lineStyle: { opacity: 0 },
          areaStyle: { color, opacity },
          tooltip: { show: false },
          silent: true,
        },
      ];
      return {
        ...baseOption(t),
        legend: { show: false },
        tooltip: { ...baseOption(t).tooltip, trigger: "axis", valueFormatter: (v: number) => num(v, 0) },
        xAxis: { type: "time", ...axisCommon(t), splitLine: { show: false } },
        yAxis: { type: "value", scale: true, ...axisCommon(t), name: chartUnit === "c_bu" ? "¢/bu" : "USD/t", nameTextStyle: { color: t.muted } },
        series: [
          ...band("95% range", lo95, hi95, t.series1, 0.12),
          ...band("80% range", lo80, hi80, t.series1, 0.22),
          { name: "CBOT close", type: "line", data: hist, symbol: "none", lineStyle: { color: t.ink, width: 1.5 } },
          {
            name: "Central (no change)",
            type: "line",
            data: xs.map((x, i) => [x, central[i]]),
            symbol: "circle",
            symbolSize: 6,
            itemStyle: { color: t.series1 },
            lineStyle: { color: t.series1, type: "dashed", width: 1.5 },
          },
        ],
      };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chartUnit, outlook, last],
  );

  const headline = useMemo(() => {
    const h3 = outlook.horizons.find((h) => h.h === 3) ?? h1;
    const a3: Assumptions = { ...base, premium };
    return {
      now: money(convert(last, unit, todayA), unit),
      lo: money(convert(h3.q100, unit, a3), unit),
      hi: money(convert(h3.q900, unit, a3), unit),
      date: dateLabel(h3.target_date),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unit, premiumOverride, fx]);

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <p className="text-sm font-medium text-brand">
          After the {monthLabel(meta.latest_wasde.month)} WASDE · CBOT close {dateLabel(outlook.as_of_close)}
        </p>
        <h1 className="max-w-3xl text-3xl font-semibold tracking-tight sm:text-4xl">
          Where could Brazilian export soybeans trade in the next six months?
        </h1>
        <p className="max-w-3xl text-lg text-ink-2">
          {unit === "c_bu" ? "CBOT soybeans closed at " : "Paranaguá FOB is about "}
          <strong className="text-ink">{headline.now}</strong>
          {unit !== "c_bu" && (
            <>
              {" "}
              with a {signed0(todayA.premium)}¢/bu premium
              {premiumOverride === null && (
                <>
                  {" "}
                  ({MONTHS[premiumDefault.month - 1]} median {premiumDefault.years}; data end{" "}
                  {dateLabel(premiumDefault.source_last)})
                </>
              )}
            </>
          )}
          . By {headline.date}, 8 in 10 past
          forecast errors would put it between <strong className="text-ink">{headline.lo}</strong> and{" "}
          <strong className="text-ink">{headline.hi}</strong>.
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
          central line is today&apos;s price, and what this page adds is a <em>tested range</em> and its hit rate.{" "}
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
                {premiumOverride === null
                  ? `${MONTHS[premiumDefault.month - 1]} median${premiumDefault.stale ? " (stale)" : ""}`
                  : `${signed0(premiumOverride)}¢/bu`}
              </span>
            </label>
            <input
              id="premium"
              type="range"
              min={-100}
              max={250}
              step={5}
              value={premium}
              onChange={(e) => setPremiumOverride(Number(e.target.value))}
              className="w-full accent-[var(--accent)]"
            />
            <p className="text-xs text-muted">
              Default: the {MONTHS[premiumDefault.month - 1]} median, {premiumDefault.years}, held flat for every
              horizon. Source data end {dateLabel(premiumDefault.source_last)}.{" "}
              {premiumOverride !== null && (
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
              type="number"
              step={0.01}
              min={3}
              max={9}
              value={fx}
              onChange={(e) => setFx(Number(e.target.value) || meta.fx_default.value)}
              className="tabular w-full rounded-md border border-line bg-surface px-2 py-1.5"
            />
            <p className="text-xs text-muted">PTAX {dateLabel(meta.fx_default.date)}: {num(meta.fx_default.value, 4)}</p>
          </div>
        )}
      </section>

      <section className="grid gap-4 md:grid-cols-3" aria-label="Forecast by horizon">
        {outlook.horizons.map((h) => (
          <HorizonCard
            key={h.h}
            h={h}
            unit={unit}
            a={{ ...base, premium }}
            hit={hitRates[String(h.h)]}
            origin={originNote}
          />
        ))}
      </section>

      <section className="card space-y-3 p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold">CBOT soybeans: three years of closes and the tested ranges ahead</h2>
          <p className="text-xs text-muted">{chartUnit === "c_bu" ? UNIT_LONG.c_bu : "CBOT front month in USD/t, before any premium"}</p>
        </div>
        <EChart option={option} height={360} ariaLabel="CBOT soybean price history with 80% and 95% forecast ranges for 1, 3 and 6 months" />
        <p className="text-xs leading-relaxed text-muted">
          Darker band: 80% range; lighter band: 95% range. Ranges come from the errors of the last{" "}
          {meta.calibration_window} out-of-sample forecasts and cover CBOT moves only: the premium and the exchange rate
          are your inputs above. FOB is (CBOT + premium) × {num(meta.consts.bu_per_t, 4)} bu/t ÷ 100. Reais per sack are
          port FOB converted at your exchange rate, not a farm-gate price (no freight or port costs).
        </p>
      </section>

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
            For reference only, the median by shipment month since {premiumDefault.years.split("-")[0]} (
            {outlook.horizons[0]?.premium_reference.note}):{" "}
            {outlook.horizons
              .map(
                (h) =>
                  `${MONTHS[h.premium_reference.month - 1]} ${signed0(h.premium_reference.median)} (p10–p90 ${signed0(
                    h.premium_reference.p10,
                  )}/${signed0(h.premium_reference.p90)})`,
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
              This WASDE
            </Link>{" "}
            page shows the latest revisions and what the market has paid for each one, with a calculator for your own
            what-ifs. Next report: {meta.next_wasde ? dateLabel(meta.next_wasde, "long") : "see USDA calendar"}.
          </p>
        </div>
      </section>
    </div>
  );
}
