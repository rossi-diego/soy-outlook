"use client";

import Link from "next/link";
import { useCallback, useState } from "react";

import EChart, { axisCommon, baseOption, type Tokens } from "@/components/EChart";
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

const signed0 = (v: number) => (v > 0 ? `+${num(v)}` : v < 0 ? `−${num(Math.abs(v))}` : "0");
const signedUsd = (v: number) => (v > 0 ? `+${num(v)}` : v < 0 ? `−${num(Math.abs(v))}` : "0");

export default function OutlookView({ meta, outlook }: Props) {
  const [unit, setUnit] = useState<Unit>("usd_t");
  const [premiumOverride, setPremiumOverride] = useState<number | null>(null);
  const [fx, setFx] = useState<number>(Math.round(meta.fx_default.value * 100) / 100);

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

  // Chart: the CBOT leg only (the part that is forecast), in ¢/bu or USD/t.
  const chartUnit: Unit = unit === "c_bu" ? "c_bu" : "usd_t";
  const option = useCallback(
    (t: Tokens) => {
      const zeroPrem: Assumptions = { premium: 0, fx: 1, buPerT: meta.consts.bu_per_t, sackKg: meta.consts.sack_kg };
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
      // The 95% band is drawn lighter with dashed edges: its tails rest on one or two past errors.
      const band = (name: string, lo: number[], hi: number[], opacity: number, edge: boolean) => {
        const lineStyle = edge
          ? { color: t.series1, width: 1, type: "dashed" as const, opacity: 0.55 }
          : { opacity: 0 };
        return [
          {
            name: `${name} low`,
            type: "line",
            data: xs.map((x, i) => [x, lo[i]]),
            stack: name,
            symbol: "none",
            lineStyle,
            tooltip: { show: false },
            silent: true,
          },
          {
            name,
            type: "line",
            data: xs.map((x, i) => [x, Math.round((hi[i] - lo[i]) * 100) / 100]),
            stack: name,
            symbol: "none",
            lineStyle,
            areaStyle: { color: t.series1, opacity },
            tooltip: { show: false },
            silent: true,
          },
        ];
      };
      return {
        ...baseOption(t),
        legend: { show: false },
        tooltip: { ...baseOption(t).tooltip, trigger: "axis", valueFormatter: (v: number) => num(v, 0) },
        xAxis: { type: "time", ...axisCommon(t), splitLine: { show: false } },
        yAxis: {
          type: "value",
          scale: true,
          ...axisCommon(t),
          name: chartUnit === "c_bu" ? "¢/bu" : "USD/t",
          nameTextStyle: { color: t.muted },
        },
        series: [
          ...band("95% range", lo95, hi95, 0.07, true),
          ...band("80% range", lo80, hi80, 0.22, false),
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
    [chartUnit, outlook, last, meta.consts.bu_per_t, meta.consts.sack_kg],
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
          <HorizonCard key={h.h} h={h} unit={unit} a={todayA} origin={originNote} />
        ))}
      </section>

      <section className="card space-y-3 p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold">CBOT soybeans: three years of closes and the tested ranges ahead</h2>
          <p className="text-xs text-muted">{chartUnit === "c_bu" ? UNIT_LONG.c_bu : "CBOT front month in USD/t, before any premium"}</p>
        </div>
        <EChart option={option} height={360} ariaLabel="CBOT soybean price history with 80% and 95% forecast ranges for 1, 3 and 6 months" />
        <p className="text-xs leading-relaxed text-muted">
          Darker band: nominal 80% range; lighter band with dashed edges: nominal 95% range, whose tails rest on one or two
          past errors each, so read it as rough. The hit rate each range actually achieved is on the cards above. Ranges
          come from the errors of the last {meta.calibration_window} out-of-sample forecasts and cover CBOT moves only: the
          premium and the exchange rate are your inputs above. FOB is (CBOT + premium) × {num(meta.consts.bu_per_t, 4)}{" "}
          bu/t ÷ 100. Reais per sack are port FOB converted at your exchange rate, not a farm-gate price (no freight or
          port costs).
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
              This WASDE page
            </Link>{" "}
            shows the latest revisions and the historical average reaction to each one, with a calculator for your
            own what-ifs. Next report: {meta.next_wasde ? dateLabel(meta.next_wasde, "long") : "see USDA calendar"}.
          </p>
        </div>
      </section>
    </div>
  );
}
