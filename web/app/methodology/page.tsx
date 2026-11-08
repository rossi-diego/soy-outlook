import type { Metadata } from "next";

import { getMeta } from "@/lib/data";
import { dateLabel, num } from "@/lib/format";
import { AUTHOR, pageMetadata, REPO_URL } from "@/lib/site";

export const metadata: Metadata = pageMetadata(
  "/methodology/",
  "Methodology",
  "How Soy Outlook forecasts CBOT soybeans after each WASDE: point-in-time data, purging by date, a pre-registered model ladder, empirical-quantile ranges, units, data licences and the audit of the first version.",
);

function Block({ title, id, children }: { title: string; id?: string; children: React.ReactNode }) {
  return (
    <section id={id} className="card scroll-mt-20 space-y-3 p-5 sm:p-6">
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="space-y-3 text-sm leading-relaxed text-ink-2">{children}</div>
    </section>
  );
}

export default function Methodology() {
  const meta = getMeta();
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="text-3xl font-semibold tracking-tight">Methodology</h1>
      <p className="text-ink-2">
        Plain language first; the technical detail follows in each section. The CBOT, WASDE and exchange-rate data are
        public and rebuilt by the open-source pipeline on every run. The Paranaguá premium is not: its default comes from
        a 12-row monthly table derived from a private terminal export (see Data and licences below).
      </p>

      <Block title="What is forecast">
        <p>
          The Paranaguá FOB price is the CBOT soybean price plus the Paranaguá premium. The CBOT part is public and
          forecast here. The premium has no free, licensed feed, so it is <strong className="text-ink">your input</strong>,
          with a default: the historical median for the current calendar month, held flat for every horizon and
          flagged stale because its source ends in {meta.premium_source.last.slice(0, 4)}.
        </p>
        <p>
          Technically: for every WASDE release since July 2010, the target is the log change of the CBOT front-month close
          from the release day to the last session on or before 1, 3 and 6 calendar months later. The release-day close
          is part of the information set (USDA publishes at 12:00 ET, CBOT closes at 13:20 CT).
        </p>
      </Block>

      <Block title="Only what was known that day">
        <p>
          Every WASDE value is the one published in that report, never a later revision. They come from the{" "}
          <a className="underline hover:text-ink" href="https://wasde-tracker.vercel.app">
            WASDE Tracker
          </a>{" "}
          history ({meta.wasde_source.reports} reports, release {meta.wasde_source.tag ?? "local"}, file pinned by
          sha256). The projected marketing year is the latest one in each report; it rolls forward in May, so revisions
          are computed only within the same marketing year and a May dummy marks the switch.
        </p>
        <p>
          Purging rule: when a forecast is made on day t, any past row used to fit a model, choose a penalty or set a
          range must have its outcome dated on or before t. Report dates are irregular, so the rule is applied on dates,
          not on row counts. Unit tests enforce it.
        </p>
      </Block>

      <Block title="Models, from simplest up">
        <ol className="list-decimal space-y-1 pl-5">
          {Object.entries(meta.models).map(([id, label]) => (
            <li key={id}>{label}</li>
          ))}
        </ol>
        <p>
          The WASDE model uses a feature set fixed in advance (no data-driven selection):{" "}
          {meta.features.map((f) => f.label.toLowerCase()).join("; ")}. Features are standardised inside each training
          window; the ridge penalty is chosen on a purged inner split. ARIMA(0,1,1) without drift forecasts the same
          level at every horizon, so its 3- and 6-month forecasts equal its 1-step forecast.
        </p>
        <p>
          A model replaces &ldquo;no change&rdquo; at a horizon only if it beats it on the validation period with a
          Clark-West test (the right test when one model nests the other), Holm-adjusted across the three horizons at p
          &lt; {meta.champion_alpha}. Diebold-Mariano tests with the Harvey-Leybourne-Newbold correction and Newey-West
          variance are reported alongside. Current winners:{" "}
          {Object.entries(meta.champion)
            .map(([h, m]) => `${h}m ${m === "rw" ? "no change" : meta.models[m]}`)
            .join(", ")}
          .
        </p>
      </Block>

      <Block title="Ranges">
        <p>
          The 80% and 95% ranges are {meta.intervals.method}: quantiles of the last {meta.calibration_window} realized
          out-of-sample errors of the winning model at that horizon
          {meta.intervals.centring === "median" ? ", centred on their median so the band does not carry a past drift" : ""}.
          This is not split-conformal: 3- and 6-month windows overlap, so the errors are not exchangeable and no
          finite-sample guarantee is claimed. The centring was chosen between {meta.intervals.candidates.join(" and ")} by a
          rule fixed in advance (interval score on the validation period only).
        </p>
        <p>
          The labels show the hit rate actually achieved, next to the nominal level, including on the holdout since{" "}
          {dateLabel(meta.splits.holdout_start)}, which was not used for any model choice (the author had seen 2024–25 prices,
          so it is not a blind test). With {meta.calibration_window} errors, each 95% bound rests on about
          one or two past observations, and overlapping windows leave about {Math.round(meta.calibration_window / 6)}{" "}
          independent outcomes at 6 months, so the 95% tails are rough.
        </p>
        <p>
          Forecasts are tested from the close of each WASDE release day. The live forecast is issued from the latest close,{" "}
          {meta.days_since_report} days after the {dateLabel(meta.latest_wasde.release_date)} report.
        </p>
      </Block>

      <Block title="Units">
        <p>
          FOB USD/t = (CBOT ¢/bu + premium ¢/bu) ÷ 100 × {num(meta.consts.bu_per_t, 4)} bushels per tonne (exact: 1 bu of
          soybeans = 60 lb, 1 lb = 0.45359237 kg). Reais per {meta.consts.sack_kg} kg sack = USD/t × 0.06 × BRL per USD;
          the default rate is the Banco Central PTAX selling rate. These are port FOB values, not farm-gate prices.
        </p>
      </Block>

      <Block title="What this leaves out">
        <ul className="list-disc space-y-1 pl-5">
          <li>Analyst expectations: a WASDE &ldquo;surprise&rdquo; here is a revision versus the previous report, not versus consensus.</li>
          <li>The premium&apos;s own dynamics (freight, Brazilian crop timing, China demand) and the exchange rate.</li>
          <li>
            Contract rolls: the Yahoo continuous front month jumps at expiry. Windows crossing the July–September rolls
            also measure the old-crop/new-crop spread; metrics without them are in{" "}
            <a className="underline hover:text-ink" href="/data/metrics.csv">
              metrics.csv
            </a>
            . Other rolls (May, November) also cause smaller jumps.
          </li>
          <li>Taxes, logistics and costs from farm to port.</li>
        </ul>
      </Block>

      <Block title="Data and licences">
        <ul className="list-disc space-y-1 pl-5">
          <li>USDA WASDE: US government work, public domain, via the WASDE Tracker history.</li>
          <li>Banco Central do Brasil PTAX (SGS series 1): public open data from the BCB.</li>
          <li>
            CBOT soybean futures (ZS=F): delayed quotes from Yahoo Finance, originating from CME Group. Used for research
            under their terms; the raw price history is not redistributed in the repository.
          </li>
          <li>
            Paranaguá premium: only a derived table of 12 monthly medians and 10th/90th percentiles is published. The
            daily export it came from ({dateLabel(meta.premium_source.first)} –{" "}
            {dateLabel(meta.premium_source.last)}) has unrecorded vendor and contract convention and is not redistributed.
            Contract convention: {meta.premium_source.contract_convention}.
          </li>
        </ul>
        <p>
          Full details are in{" "}
          <a
            className="underline hover:text-ink"
            href="https://github.com/rossi-diego/sarimax-brazilian-soybean-forecasting/blob/main/DATA_LICENSES.md"
          >
            DATA_LICENSES.md
          </a>
          .
        </p>
      </Block>

      <Block title="About" id="about">
        <p>
          Built by <strong className="text-ink">{AUTHOR.name}</strong>, market risk coordinator in Brazilian
          agribusiness (commodity derivatives, FX, VaR), as a portfolio project in quantitative research and data
          engineering. I rebuilt it from an earlier version whose headline result turned out to be leakage (below); the
          point of this one is a forecast that says how often its ranges have actually held.
        </p>
        <p>
          <a className="underline hover:text-ink" href={AUTHOR.linkedin}>
            LinkedIn
          </a>{" "}
          ·{" "}
          <a className="underline hover:text-ink" href={AUTHOR.github}>
            GitHub
          </a>{" "}
          ·{" "}
          <a className="underline hover:text-ink" href={REPO_URL}>
            Source code
          </a>
        </p>
        <p>
          <strong className="text-ink">Disclaimer.</strong> Research and educational use only; not investment, trading or
          hedging advice, and not an offer to buy or sell anything. CBOT prices are delayed, the premium default is a stale
          historical median, and FOB and R$ values are illustrative until you enter your own quote. The ranges describe
          how large past forecast errors were; they are not a guarantee about future prices. No affiliation with USDA,
          CME Group, Banco Central do Brasil or any trading company.
        </p>
      </Block>

      <Block title="What changed from the first version">
        <p>
          The first version of this project reported a 1.46% error against 13.6% for a naive forecast. When I audited it, I
          found that number came from leakage: a feature multiplied CBOT corn by the soybean price being predicted, corn was taken
          over the same window as the target, and the naive benchmark repeated a price from twelve months earlier. Scored
          honestly, a one-month random walk misses by about 3.6% and the original model did not beat it. The interactive
          app showed simulated data. This version replaces all of it with the pipeline described above.
        </p>
      </Block>
    </div>
  );
}
