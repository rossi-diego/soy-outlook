import type { Metadata } from "next";

import WasdeWhatIf from "@/components/WasdeWhatIf";
import { getMeta, getWasde } from "@/lib/data";
import { dateLabel, monthLabel, num, signed } from "@/lib/format";

export const metadata: Metadata = { title: "This WASDE · Soy Outlook" };

export default function WasdePage() {
  const meta = getMeta();
  const w = getWasde();
  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <p className="text-sm font-medium text-brand">
          {monthLabel(w.report_month)} WASDE · released {dateLabel(w.release_date, "long")} · marketing year {w.market_year}
        </p>
        <h1 className="max-w-3xl text-3xl font-semibold tracking-tight">What did the latest WASDE change, and what is that worth?</h1>
        <p className="max-w-3xl text-ink-2">
          USDA publishes at 12:00 ET and CBOT soybeans close at 13:20 CT, so the market prices a report the same day. Over{" "}
          {w.reaction.n_reports} reports, the typical release-day move was {num(w.reaction.abs_move_usd_t_median, 1)} USD/t
          either way. Below: the lines that matter for soybeans and what the market has paid, on average, for each
          revision.
        </p>
      </section>

      <section className="card overflow-x-auto p-5">
        <h2 className="mb-3 text-lg font-semibold">
          Projected {w.market_year}: {monthLabel(w.report_month)} vs {monthLabel(w.previous_month)}
        </h2>
        <table className="w-full min-w-[30rem] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
              <th className="py-2 font-medium">Line</th>
              <th className="py-2 text-right font-medium">{monthLabel(w.previous_month)}</th>
              <th className="py-2 text-right font-medium">{monthLabel(w.report_month)}</th>
              <th className="py-2 text-right font-medium">Change</th>
            </tr>
          </thead>
          <tbody>
            {w.lines.map((l) => (
              <tr key={l.id} className="border-b border-line last:border-0">
                <td className="py-2">{l.label}</td>
                <td className="tabular py-2 text-right text-ink-2">
                  {l.previous === null ? "—" : `${num(l.previous, l.unit === "%" ? 1 : 1)} ${l.unit}`}
                </td>
                <td className="tabular py-2 text-right">
                  {num(l.value, 1)} {l.unit}
                </td>
                <td className="tabular py-2 text-right">
                  {l.change === null
                    ? "new MY"
                    : Math.abs(l.change) < 0.005
                      ? "unch."
                      : `${signed(l.change, l.unit === "%" ? 2 : 1)} ${l.unit === "%" ? "pp" : l.unit}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-3 text-xs text-muted">
          Stocks-to-use = ending stocks ÷ total use. Full balance sheets:{" "}
          <a className="underline hover:text-ink" href="https://wasde-tracker.vercel.app/commodity/soybeans/">
            WASDE Tracker
          </a>
          .
        </p>
      </section>

      <WasdeWhatIf reaction={w.reaction} buPerT={meta.consts.bu_per_t} lines={w.lines} />

      <section className="card space-y-3 p-5 text-sm leading-relaxed text-ink-2">
        <h2 className="text-lg font-semibold text-ink">And after release day?</h2>
        <p>
          The same revisions were also tested as predictors of the price 1, 3 and 6 months later. Out of sample they did
          not beat &ldquo;no change&rdquo; at any horizon, and in-sample none of the estimates below is distinguishable
          from zero at the usual 5% level. That is what an efficient market looks like: the news is in the price by the
          close.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[30rem]">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                <th className="py-2 font-medium">Revision (per unit)</th>
                {[1, 3, 6].map((h) => (
                  <th key={h} className="py-2 text-right font-medium">
                    {h}m later, USD/t
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from(new Set(w.forward.filter((f) => f.feature.startsWith("rev_")).map((f) => f.feature))).map((feat) => {
                const rows = w.forward.filter((f) => f.feature === feat);
                return (
                  <tr key={feat} className="border-b border-line last:border-0">
                    <td className="py-2">
                      {rows[0].label.replace("Revision: ", "")} ({rows[0].unit})
                    </td>
                    {[1, 3, 6].map((h) => {
                      const r = rows.find((x) => x.h === h);
                      return (
                        <td key={h} className="tabular py-2 text-right">
                          {r ? `${signed(r.usd_t_per_unit, 1)} ± ${num(r.se_usd_t, 1)}` : "—"}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted">Estimate ± one standard error (HAC), all reports since July 2010.</p>
      </section>
    </div>
  );
}
