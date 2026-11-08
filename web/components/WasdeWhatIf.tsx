"use client";

import { useState } from "react";

import Delta from "@/components/Delta";
import { monthLabel, num } from "@/lib/format";
import type { Wasde } from "@/lib/types";

type Props = { reaction: Wasde["reaction"]; buPerT: number };

/** Realistic monthly revisions (P13): ±1 pp for stocks-to-use, ±3 Mt for crops and stocks. */
const BASE_RANGE: Record<string, number> = { pp: 1, Mt: 3 };
const STEP: Record<string, number> = { pp: 0.01, Mt: 0.01 };
/** Two-sided 80% normal quantile. */
const Z80 = 1.2815515655446004;
/** One decimal with a true minus sign. */
const fmt1 = (v: number) => (v < 0 ? `−${num(-v, 1)}` : v > 0 ? `+${num(v, 1)}` : num(v, 1));
const fmtRev = (v: number, unit: string) => {
  const d = Math.abs(v * 10 - Math.round(v * 10)) > 1e-9 || unit === "pp" ? 2 : 1;
  const s = num(Math.abs(v), d);
  return `${v > 0 ? "+" : v < 0 ? "−" : ""}${s} ${unit}`;
};

/**
 * The line under each slider: median and 90th-percentile absolute revision and the latest one.
 * A zero median (most reports leave the line unchanged, e.g. Brazil's crop) reads "usually
 * unchanged" rather than "±0.0 Mt", and a zero latest revision reads "latest unchanged".
 */
export function typicalRevText(unit: string, median: number | null, p90: number | null, latest: number | null): string {
  const d = unit === "pp" ? 2 : 1;
  const zero = (v: number) => Math.abs(v) < 0.5 * 10 ** -d;
  const parts = [
    median === null ? "Typical revision —" : zero(median) ? "Usually unchanged" : `Typical revision ±${num(median, d)} ${unit}`,
  ];
  if (p90 !== null) parts.push(`1 in 10 beyond ±${num(p90, d)} ${unit}`);
  if (latest !== null) parts.push(zero(latest) ? "latest unchanged" : `latest ${fmtRev(latest, unit)}`);
  return parts.join(" · ");
}

/**
 * Slider half-range for one revision: the realistic base (±1 pp, ±3 Mt), widened only so the
 * historical 1-in-10 revision and the latest revision both fit. Data-driven, never narrower.
 */
export function sliderRange(unit: string, p90: number | null, latest: number | null): number {
  const base = BASE_RANGE[unit] ?? 3;
  const step = unit === "pp" ? 0.5 : 1;
  const need = Math.max(p90 ?? 0, Math.abs(latest ?? 0));
  return Math.max(base, Math.ceil(need / step) * step);
}

/**
 * 80% prediction interval of the release-day move for a vector of surprises m:
 * mean = b'm, variance = m'Vm (HC1 coefficient covariance) + sigma_resid^2.
 */
export function predictionInterval(
  b: number[],
  cov: number[][],
  residSd: number,
  m: number[],
): { mean: number; sd: number; lo: number; hi: number } {
  const mean = b.reduce((s, bi, i) => s + bi * m[i], 0);
  let mVm = 0;
  for (let i = 0; i < m.length; i++) for (let j = 0; j < m.length; j++) mVm += m[i] * cov[i][j] * m[j];
  const sd = Math.sqrt(Math.max(mVm, 0) + residSd ** 2);
  return { mean, sd, lo: mean - Z80 * sd, hi: mean + Z80 * sd };
}

// Strength uses the Holm-adjusted p-value: the six coefficients are one family of tests.
function strength(p: number): string {
  if (p < 0.05) return "clear";
  if (p < 0.1) return "weak";
  return "not distinguishable from zero";
}

function IntervalBar({ lo, hi, mean }: { lo: number; hi: number; mean: number }) {
  // Symmetric scale around zero, rounded up to a 5 USD/t step, so the zero line sits in the middle.
  const r = Math.max(10, Math.ceil(Math.max(Math.abs(lo), Math.abs(hi)) / 5) * 5);
  const pos = (v: number) => `${((v + r) / (2 * r)) * 100}%`;
  return (
    <div className="space-y-1" aria-hidden>
      <div className="relative h-6">
        <div className="absolute inset-x-0 top-1/2 h-px bg-grid" />
        <div className="absolute top-0 h-full w-px bg-[var(--axis)]" style={{ left: "50%" }} />
        <div
          className="absolute top-1/2 h-2.5 -translate-y-1/2 rounded-full bg-accent-soft ring-1 ring-[var(--accent)]"
          style={{ left: pos(lo), width: `calc(${pos(hi)} - ${pos(lo)})` }}
        />
        <div
          className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[var(--surface)] bg-[var(--accent)]"
          style={{ left: pos(mean) }}
        />
      </div>
      <div className="tabular flex justify-between text-[0.7rem] text-muted">
        <span>−{r}</span>
        <span>0</span>
        <span>+{r} USD/t</span>
      </div>
    </div>
  );
}

export default function WasdeWhatIf({ reaction, buPerT }: Props) {
  const [moves, setMoves] = useState<Record<string, number>>({});
  const [loaded, setLoaded] = useState(false);
  const byFeature = Object.fromEntries(reaction.items.map((it) => [it.feature, it]));
  const b = reaction.features.map((f) => byFeature[f]?.usd_t_per_unit ?? 0);
  const m = reaction.features.map((f) => moves[f] ?? 0);
  // Every coefficient stays in the total, flagged or not: dropping weak ones would be post-hoc selection.
  const pi = predictionInterval(b, reaction.cov_usd_t, reaction.resid_sd_usd_t, m);
  const anyMove = m.some((v) => v !== 0);
  const unclear = pi.lo < 0 && pi.hi > 0;
  const flagged = reaction.items.filter((it) => it.weak || it.wrong_sign).length;
  const lr = reaction.latest_revisions;
  const canLoad = !lr.may && reaction.items.some((it) => it.latest_rev !== null);
  const latestLabel = lr.previous ? `${monthLabel(lr.month).split(" ")[0]} vs ${monthLabel(lr.previous).split(" ")[0]}` : monthLabel(lr.month);

  const loadLatest = () => {
    setMoves(Object.fromEntries(reaction.items.map((it) => [it.feature, it.latest_rev ?? 0])));
    setLoaded(true);
  };
  const clear = () => {
    setMoves({});
    setLoaded(false);
  };

  return (
    <section className="card space-y-4 p-5" data-testid="whatif">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-lg font-semibold">What-if: the historical average reaction to a WASDE surprise</h2>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={loadLatest}
            disabled={!canLoad}
            className="rounded-md border border-line bg-surface px-3 py-1.5 text-sm text-ink-2 hover:bg-surface-2 hover:text-ink disabled:opacity-50"
            title={canLoad ? `Fill every line with the ${monthLabel(lr.month)} report's revision vs the one before` : "The latest report starts a new marketing year: no revisions"}
          >
            Load latest ({latestLabel})
          </button>
          <button
            type="button"
            onClick={clear}
            disabled={!anyMove}
            className="rounded-md border border-line bg-surface px-3 py-1.5 text-sm text-ink-2 hover:bg-surface-2 hover:text-ink disabled:opacity-50"
          >
            Clear
          </button>
        </div>
      </div>
      <p className="text-sm text-ink-2">
        Set each line&apos;s <strong className="text-ink">surprise vs expectation</strong>: how far you think the report
        will land from what the market expects. The history only knows revisions against the previous report, so these
        averages are a stand-in for true surprise effects and likely understate them. The slider ranges match realistic
        monthly revisions; next to each is the typical size of one.
      </p>
      <div className="grid gap-x-8 gap-y-5 md:grid-cols-2">
        {reaction.items.map((it) => {
          const v = moves[it.feature] ?? 0;
          const grey = it.weak || it.wrong_sign;
          const r = sliderRange(it.unit, it.p90_abs_rev, it.latest_rev);
          return (
            <div key={it.feature} className="space-y-1" data-flagged={grey ? "true" : "false"} data-testid={`slider-${it.feature}`}>
              <label htmlFor={it.feature} className="flex items-baseline justify-between gap-2 text-sm">
                <span className={grey ? "text-ink-2" : "text-ink"}>
                  {it.label}
                  <span className="sr-only"> surprise</span>
                </span>
                <span className="tabular font-medium">{fmtRev(v, it.unit)}</span>
              </label>
              <input
                id={it.feature}
                type="range"
                min={-r}
                max={r}
                step={STEP[it.unit] ?? 0.1}
                value={v}
                onChange={(e) => {
                  setLoaded(false);
                  setMoves((mv) => ({ ...mv, [it.feature]: Number(e.target.value) }));
                }}
                className={`w-full accent-[var(--accent)] ${grey ? "opacity-60" : ""}`}
              />
              <p className="tabular text-xs text-ink-2" data-testid="typical-rev">
                {typicalRevText(it.unit, it.median_abs_rev, it.p90_abs_rev, it.latest_rev)}
              </p>
              <p className="text-xs text-muted">
                Each {it.unit === "pp" ? "+1 pp" : "+1 Mt"}: {it.usd_t_per_unit > 0 ? "+" : "−"}
                {num(Math.abs(it.usd_t_per_unit), 2)} ± {num(it.se_usd_t, 2)} USD/t · Holm p {num(it.p_holm, 2)},{" "}
                {strength(it.p_holm)}
                {it.wrong_sign && (
                  <span
                    className="ml-1.5 rounded-full border border-warn-line bg-warn-soft px-1.5 text-[0.7rem] font-medium text-warn"
                    title="The sign is the opposite of what supply and demand would predict; most likely noise."
                  >
                    unexpected sign
                  </span>
                )}
              </p>
            </div>
          );
        })}
      </div>
      <div className="space-y-2 border-t border-line pt-4">
        {loaded && (
          <p className="text-xs font-medium text-ink-2" data-testid="loaded-note">
            Filled with the {monthLabel(lr.month)} revisions vs {lr.previous ? monthLabel(lr.previous) : "the previous report"}.
            These are revisions, not surprises; read the move only together with its interval.
          </p>
        )}
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <span className="text-sm text-ink-2">Historical average reaction on release day</span>
          <span className="text-2xl font-semibold">
            <Delta value={pi.mean} digits={1} suffix=" USD/t" />
          </span>
          <span className="tabular text-sm text-muted">{num((pi.mean / buPerT) * 100, 1)}¢/bu</span>
        </div>
        <p className="tabular text-sm text-ink-2" data-testid="pi80">
          80% prediction interval: {fmt1(pi.lo)} to {fmt1(pi.hi)} USD/t
          {unclear ? (
            <span className="ml-1.5 font-medium text-ink">· direction unclear</span>
          ) : (
            <span className="ml-1.5 font-medium text-ink">· the whole 80% interval is {pi.mean > 0 ? "above" : "below"} zero</span>
          )}
        </p>
        <IntervalBar lo={pi.lo} hi={pi.hi} mean={pi.mean} />
      </div>
      <p className="text-xs leading-relaxed text-muted">
        Average past reaction from close to close on {reaction.n_reports} release days (excluding May reports, where the
        new marketing year starts), estimated jointly and scaled to today&apos;s price. The interval adds the estimation
        uncertainty of the coefficients (HC1 covariance) to the release-day noise they do not explain (residual sd{" "}
        {num(reaction.resid_sd_usd_t, 1)} USD/t); the revisions explain {num(reaction.r2 * 100, 0)}% of release-day moves.
        Typical revision: the median absolute revision over the same {reaction.n_reports} reports (&ldquo;usually
        unchanged&rdquo; when most of them left the line as it was).
        {flagged > 0 &&
          ` ${flagged} of ${reaction.items.length} coefficients are greyed because they do not survive the Holm adjustment or have an unexpected sign. They stay in the total: dropping them after seeing the results would be selection.`}{" "}
        No new regressors are added here: any would be a pre-registered change tested under Holm.
      </p>
    </section>
  );
}
