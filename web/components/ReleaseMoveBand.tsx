import { dateLabel, moveHitText, num } from "@/lib/format";
import type { ReleaseMove as Move } from "@/lib/types";

/** The empirical release-day move band (P14), drawn as a range around today's CBOT close. */
export default function ReleaseMoveBand({ move, p0UsdT, nextRelease }: { move: Move; p0UsdT: number; nextRelease: string | null }) {
  // Position in % of the strip: the 1-in-10 band spans the middle 76%, centred on today.
  const span = move.one_in_ten_usd_t / 0.38;
  const x = (d: number) => 50 + (d / span) * 100;
  const v = move.hit_rate.validation;
  const ho = move.hit_rate.holdout;
  return (
    <section className="card space-y-4 p-5" aria-labelledby="move-title" data-testid="release-move">
      <div className="space-y-1">
        <h2 id="move-title" className="text-lg font-semibold">
          How far does CBOT move on a WASDE day?
        </h2>
        <p className="max-w-3xl text-sm leading-relaxed text-ink-2">
          The size of the release-day move ({move.n} reports), with no direction: drawn around today&apos;s CBOT price of{" "}
          {num(p0UsdT, 0)} USD/t{nextRelease ? `, as a guide for the ${dateLabel(nextRelease)} report` : ""}.
        </p>
      </div>
      <div
        className="relative mx-auto h-24 max-w-3xl"
        role="img"
        aria-label={`Typical release-day move plus or minus ${num(move.typical_usd_t, 1)} USD per tonne around today's ${num(p0UsdT, 0)}; 1 report in 10 moves more than plus or minus ${num(move.one_in_ten_usd_t, 1)}`}
        data-testid="move-band"
      >
        <span className="tabular absolute top-0 -translate-x-1/2 text-xs text-ink-2" style={{ left: "50%" }}>
          today {num(p0UsdT, 0)} USD/t
        </span>
        <div
          className="absolute top-6 h-7 rounded-md"
          style={{ left: `${x(-move.one_in_ten_usd_t)}%`, width: `${x(move.one_in_ten_usd_t) - x(-move.one_in_ten_usd_t)}%`, background: "var(--accent-soft)" }}
        />
        <div
          className="absolute top-6 h-7 rounded-md"
          style={{ left: `${x(-move.typical_usd_t)}%`, width: `${x(move.typical_usd_t) - x(-move.typical_usd_t)}%`, background: "var(--accent)", opacity: 0.85 }}
        />
        <div className="absolute top-4 h-11 w-0.5 -translate-x-1/2 bg-ink" style={{ left: "50%" }} />
        {[-1, 1].flatMap((sg) =>
          [
            [move.typical_usd_t, "text-ink-2"],
            [move.one_in_ten_usd_t, "text-muted"],
          ].map(([d, cls]) => (
            <span
              key={`${sg}-${d}`}
              className={`tabular absolute top-[3.75rem] -translate-x-1/2 text-center text-xs leading-tight ${cls}`}
              style={{ left: `${x(sg * Number(d))}%` }}
            >
              {sg < 0 ? "−" : "+"}
              {num(Number(d), 1)}
              <span className="block text-[0.65rem] text-muted">{num(p0UsdT + sg * Number(d), 0)}</span>
            </span>
          )),
        )}
      </div>
      <dl className="grid gap-4 text-sm sm:grid-cols-2">
        <div className="space-y-1">
          <dt className="flex items-center gap-2 font-medium text-ink">
            <span className="inline-block h-3 w-3 rounded-sm" style={{ background: "var(--accent)" }} aria-hidden />
            Typical move: ±{num(move.typical_usd_t, 1)} USD/t (±{num(move.typical_pct, 2)}%)
          </dt>
          <dd className="text-ink-2" data-testid="move-hit50">
            Half of reports should stay inside. Out of sample it held {moveHitText(v, "50")}, and{" "}
            {moveHitText(ho, "50")}.
          </dd>
        </div>
        <div className="space-y-1">
          <dt className="flex items-center gap-2 font-medium text-ink">
            <span className="inline-block h-3 w-3 rounded-sm" style={{ background: "var(--accent-soft)" }} aria-hidden />1 in 10
            moves more than ±{num(move.one_in_ten_usd_t, 1)} USD/t (±{num(move.one_in_ten_pct, 2)}%)
          </dt>
          <dd className="text-ink-2" data-testid="move-hit90">
            Nine reports in ten should stay inside. Out of sample it held {moveHitText(v, "90")}, and{" "}
            {moveHitText(ho, "90")}.
          </dd>
        </div>
      </dl>
      <p className="text-xs leading-relaxed text-muted">
        Band: the median and 90th percentile of the absolute release-day log return over every usable report since 2010
        (May reports and reports without a session on the day excluded), in USD/t at today&apos;s price. Hit rate: each
        report from {v.years.slice(0, 4)} on is scored against the band built from earlier reports only (at least{" "}
        {move.min_past}); ranges are Wilson 95% intervals. A volatility model (EWMA, HAR-RV) is pre-registered for v2 and
        replaces this band only if it beats it out of sample.
      </p>
    </section>
  );
}
