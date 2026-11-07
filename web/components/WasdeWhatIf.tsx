"use client";

import { useState } from "react";

import Delta from "@/components/Delta";
import { num } from "@/lib/format";
import type { Wasde } from "@/lib/types";

type Props = { reaction: Wasde["reaction"]; buPerT: number; lines: Wasde["lines"] };

const STEP: Record<string, number> = { pp: 0.1, Mt: 0.5 };
const RANGE: Record<string, number> = { pp: 3, Mt: 10 };

function strength(p: number): { label: string; tone: string } {
  if (p < 0.05) return { label: "clear", tone: "text-ink" };
  if (p < 0.1) return { label: "weak", tone: "text-ink-2" };
  return { label: "not distinguishable from zero", tone: "text-muted" };
}

export default function WasdeWhatIf({ reaction, buPerT }: Props) {
  const [moves, setMoves] = useState<Record<string, number>>({});
  const total = reaction.items.reduce((s, it) => s + it.usd_t_per_unit * (moves[it.feature] ?? 0), 0);
  // Standard error of the sum, ignoring covariances between estimates (approximate).
  const se = Math.sqrt(reaction.items.reduce((s, it) => s + (it.se_usd_t * (moves[it.feature] ?? 0)) ** 2, 0));
  const anyMove = Object.values(moves).some((v) => v !== 0);

  return (
    <section className="card space-y-4 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">What-if: the release-day move for a revision you expect</h2>
        {anyMove && (
          <button type="button" className="text-sm text-ink-2 underline hover:text-ink" onClick={() => setMoves({})}>
            Reset
          </button>
        )}
      </div>
      <div className="grid gap-x-8 gap-y-5 md:grid-cols-2">
        {reaction.items.map((it) => {
          const v = moves[it.feature] ?? 0;
          const s = strength(it.p_value);
          return (
            <div key={it.feature} className="space-y-1">
              <label htmlFor={it.feature} className="flex items-baseline justify-between gap-2 text-sm">
                <span>{it.label}</span>
                <span className="tabular font-medium">
                  {v > 0 ? "+" : ""}
                  {num(v, it.unit === "pp" ? 1 : 1)} {it.unit}
                </span>
              </label>
              <input
                id={it.feature}
                type="range"
                min={-RANGE[it.unit]}
                max={RANGE[it.unit]}
                step={STEP[it.unit]}
                value={v}
                onChange={(e) => setMoves((m) => ({ ...m, [it.feature]: Number(e.target.value) }))}
                className="w-full accent-[var(--accent)]"
              />
              <p className="text-xs text-muted">
                Each {it.unit === "pp" ? "+1 pp" : "+1 Mt"}: {it.usd_t_per_unit > 0 ? "+" : "−"}
                {num(Math.abs(it.usd_t_per_unit), 2)} ± {num(it.se_usd_t, 2)} USD/t ·{" "}
                <span className={s.tone}>evidence {s.label}</span>
              </p>
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-t border-line pt-4">
        <span className="text-sm text-ink-2">Expected CBOT move on release day</span>
        <span className="text-2xl font-semibold">
          <Delta value={total} digits={1} suffix=" USD/t" />
        </span>
        <span className="tabular text-sm text-muted">
          ± {num(se, 1)} USD/t · {num(total / buPerT * 100, 1)}¢/bu
        </span>
      </div>
      <p className="text-xs leading-relaxed text-muted">
        Average past reaction from close to close on {reaction.n_reports} release days (excluding May reports, where the
        new marketing year starts), estimated jointly and scaled to today&apos;s price. These revisions explain{" "}
        {num(reaction.r2 * 100, 0)}% of release-day moves; the rest is everything else in the report and the market. A
        surprise matters only relative to what traders expected, which this table does not know. A coefficient with the
        &ldquo;wrong&rdquo; sign and weak evidence is most likely noise.
      </p>
    </section>
  );
}
