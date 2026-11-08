"use client";

import { useState } from "react";

import { adverse, type Currency, moneyAmount, parseTonnes, pnlVsToday, profile, type Side } from "@/lib/decision";
import { dateLabel, heldText, horizonLabel, num, signed } from "@/lib/format";
import type { Horizon } from "@/lib/types";

type Props = { horizons: Horizon[]; p0: number; buPerT: number; fx: number };

function Choice<T extends string>({
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
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-lg border border-line bg-surface p-0.5 text-sm">
      {options.map(([id, text]) => (
        <button
          key={id}
          type="button"
          role="radio"
          aria-checked={value === id}
          onClick={() => onChange(id)}
          className={`rounded-md px-3 py-1.5 ${value === id ? "bg-surface-2 font-medium text-ink" : "text-ink-2 hover:text-ink"}`}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

function Tag({ children, warn = false, title }: { children: React.ReactNode; warn?: boolean; title?: string }) {
  return (
    <span
      title={title}
      className={`inline-block rounded-full border px-2 py-px text-[0.7rem] font-medium leading-5 ${
        warn ? "border-warn-line bg-warn-soft text-warn" : "border-line bg-surface-2 text-ink-2"
      }`}
    >
      {children}
    </span>
  );
}

/** The P&L vs today at each 5% step of the range, on one scale shared by the three horizons. */
function Strip({ pts, lo, hi, adverseLevel }: { pts: { level: number; pnl: number }[]; lo: number; hi: number; adverseLevel: number }) {
  const W = 300;
  const pad = 6;
  const x = (v: number) => pad + ((v - lo) / (hi - lo || 1)) * (W - 2 * pad);
  const zero = x(0);
  return (
    <svg viewBox={`0 0 ${W} 28`} className="h-7 w-full" role="img" aria-label="Gain or loss at each 5% step of the range">
      <line x1={x(pts[0].pnl)} x2={x(pts[pts.length - 1].pnl)} y1={14} y2={14} stroke="var(--grid)" strokeWidth={6} strokeLinecap="round" />
      <line x1={zero} x2={zero} y1={3} y2={25} stroke="var(--ink-2)" strokeWidth={1} />
      {pts.map((p) => {
        const isAdverse = Math.abs(p.level - adverseLevel) < 1e-6;
        return (
          <circle
            key={p.level}
            cx={x(p.pnl)}
            cy={14}
            r={isAdverse ? 4.5 : 2.5}
            fill={p.pnl < 0 ? "var(--down)" : "var(--up)"}
            stroke={isAdverse ? "var(--ink)" : "none"}
            strokeWidth={isAdverse ? 1.25 : 0}
            opacity={isAdverse ? 1 : 0.75}
          />
        );
      })}
    </svg>
  );
}

export default function DecisionPanel({ horizons, p0, buPerT, fx }: Props) {
  const [side, setSide] = useState<Side>("producer");
  const [currency, setCurrency] = useState<Currency>("usd");
  const [hedgePct, setHedgePct] = useState(0);
  const [tonnes, setTonnes] = useState(1000);
  const [tonnesText, setTonnesText] = useState("1,000");
  const [tonnesError, setTonnesError] = useState<string | null>(null);
  const commitTonnes = () => {
    const r = parseTonnes(tonnesText);
    if (r.ok) {
      setTonnes(r.value);
      setTonnesText(r.value.toLocaleString("en-US"));
      setTonnesError(null);
    } else setTonnesError(r.error);
  };

  const x = { side, tonnes, hedge: hedgePct / 100, currency, fx, buPerT };
  const vs = side === "producer" ? "selling" : "buying";
  const rows = horizons.map((h) => ({ h, adv: adverse(h, side), prof: profile(h, p0, x) }));
  const all = rows.flatMap((r) => r.prof.map((p) => p.pnl));
  const lo = Math.min(0, ...all);
  const hi = Math.max(0, ...all);
  const usdT = (c: number) => (c / 100) * buPerT;
  const rolls = horizons.filter((h) => h.contract.crosses_roll).map((h) => horizonLabel(h.h));

  return (
    <section className="card space-y-5 p-5" aria-labelledby="decision-title" data-testid="decision-panel">
      <div className="space-y-2">
        <h2 id="decision-title" className="text-lg font-semibold">
          Budgeting and hedging: downside vs {vs} today
        </h2>
        <div className="flex flex-wrap gap-1.5" data-testid="decision-labels">
          <Tag>illustrative</Tag>
          <Tag>range-based, not VaR</Tag>
          <Tag>CBOT only</Tag>
          <Tag>basis unhedged</Tag>
        </div>
        <p className="max-w-3xl text-sm leading-relaxed text-ink-2">
          What the tested ranges above would mean for your volume if CBOT ended at their adverse end: the 1-in-10 level
          ({side === "producer" ? "10th percentile, prices lower" : "90th percentile, prices higher"}) and a rough 1-in-40
          level. Hedged tonnes are treated as locked at today&apos;s close of {num(p0, 0)}¢/bu.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-x-6 gap-y-4">
        <div className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-wide text-muted">Your side</p>
          <Choice
            label="Your side"
            value={side}
            onChange={setSide}
            options={[
              ["producer", "Producer (long)"],
              ["buyer", "Buyer (short)"],
            ]}
          />
        </div>
        <div className="w-40 space-y-1">
          <label htmlFor="tonnes" className="text-xs font-medium uppercase tracking-wide text-muted">
            Tonnes
          </label>
          <input
            id="tonnes"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            value={tonnesText}
            onChange={(e) => setTonnesText(e.target.value)}
            onBlur={commitTonnes}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitTonnes();
            }}
            aria-invalid={tonnesError !== null}
            aria-describedby="tonnes-help"
            className={`tabular w-full rounded-md border bg-surface px-2 py-1.5 ${tonnesError ? "border-warn-line" : "border-line"}`}
          />
          <p id="tonnes-help" className={`text-xs ${tonnesError ? "font-medium text-warn" : "text-muted"}`} role={tonnesError ? "alert" : undefined}>
            {tonnesError ? `${tonnesError} Using ${tonnes.toLocaleString("en-US")}.` : "Physical volume exposed"}
          </p>
        </div>
        <div className="min-w-56 flex-1 space-y-1">
          <label htmlFor="hedge" className="flex justify-between text-xs font-medium uppercase tracking-wide text-muted">
            <span>Hedge ratio</span>
            <span className="tabular normal-case text-ink" data-testid="hedge-value">
              {hedgePct}% hedged · {(tonnes * (1 - hedgePct / 100)).toLocaleString("en-US", { maximumFractionDigits: 0 })} t open
            </span>
          </label>
          <input
            id="hedge"
            type="range"
            min={0}
            max={100}
            step={5}
            value={hedgePct}
            onChange={(e) => setHedgePct(Number(e.target.value))}
            className="w-full accent-[var(--accent)]"
          />
          <p className="text-xs text-muted">CBOT futures at today&apos;s close; margin and rolls ignored.</p>
        </div>
        <div className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-wide text-muted">Currency</p>
          <Choice
            label="Currency"
            value={currency}
            onChange={setCurrency}
            options={[
              ["usd", "USD"],
              ["brl", "BRL"],
            ]}
          />
          <p className="text-xs text-muted">{currency === "brl" ? `at ${num(fx, 2)} BRL/USD, held fixed` : " "}</p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {rows.map(({ h, adv, prof }) => {
          const cov = h.coverage;
          const tenth = pnlVsToday(adv.oneInTen, p0, x);
          const fortieth = pnlVsToday(adv.oneInForty, p0, x);
          return (
            <article key={h.h} className="flex flex-col gap-2 rounded-lg border border-line p-4" data-testid={`decision-${h.h}`}>
              <header className="flex items-baseline justify-between gap-2">
                <h3 className="text-sm font-medium text-ink-2">{horizonLabel(h.h)} ahead</h3>
                <span className="text-xs text-muted">{dateLabel(h.target_date)}</span>
              </header>
              <p className="text-xs text-muted">1 in 10 adverse</p>
              <p className={`tabular text-2xl font-semibold tracking-tight ${tenth < 0 ? "text-down" : "text-up"}`} data-testid="downside10">
                {moneyAmount(tenth, currency)}
              </p>
              <p className="text-xs text-ink-2">
                if CBOT is {side === "producer" ? "at or below" : "at or above"}{" "}
                <span className="tabular">{num(adv.oneInTen, 0)}¢/bu</span> ({signed(usdT(adv.oneInTen) - usdT(p0), 1)} USD/t vs today)
              </p>
              {cov.warn80 && (
                <p className="text-xs font-medium text-warn" data-testid="decision-warn">
                  <Tag warn title="Validation hit rate more than 5 percentage points below the nominal 80%">
                    below 80%
                  </Tag>{" "}
                  80% range {heldText(cov, "80")}: this downside is likely understated.
                </p>
              )}
              <p className="text-sm text-ink-2" data-testid="downside40">
                Rough 1 in 40: <span className="tabular font-medium text-ink">{moneyAmount(fortieth, currency)}</span>
                <span className="block text-xs text-muted">
                  at {num(adv.oneInForty, 0)}¢/bu; each tail rests on about {num(h.tail_obs_95, 1)} past errors
                  {cov.warn95 ? `, and the 95% range ${heldText(cov, "95")}` : ""}
                </span>
              </p>
              <div className="mt-auto pt-1">
                <Strip pts={prof} lo={lo} hi={hi} adverseLevel={side === "producer" ? 0.1 : 0.9} />
                <p className="tabular flex justify-between text-[0.7rem] text-muted" data-testid="strip-scale">
                  <span>{moneyAmount(lo, currency)}</span>
                  <span>{moneyAmount(hi, currency)}</span>
                </p>
              </div>
            </article>
          );
        })}
      </div>

      <p className="text-xs leading-relaxed text-muted" data-testid="decision-footnote">
        Each dot is one 5% step of the range (5th to 95th percentile), on one scale for all three horizons; the ringed dot
        is the 1-in-10 level, the vertical line is {vs} today, and the end labels are the shared scale&apos;s limits. Illustrative and range-based, not VaR: CBOT only, with the
        premium and the exchange rate held fixed, so the basis is unhedged and the figures ignore freight, margin calls and
        contract rolls. No expected shortfall is shown, because each 95% tail rests on one or two of {horizons[0]?.calibration_n}{" "}
        overlapping past errors; and no chance of reaching a target price, because the ranges are not a price call.
        {rolls.length > 0
          ? ` Prices are the continuous front month and ${rolls.length === horizons.length ? "every horizon crosses" : `the ${rolls.join(" and ")} ${rolls.length > 1 ? "horizons cross" : "horizon crosses"}`} a contract roll, so part of the move is a calendar spread that a hedge in today's front contract would not capture.`
          : ""}
      </p>
    </section>
  );
}
