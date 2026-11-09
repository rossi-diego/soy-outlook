# Data licences and provenance

The code is MIT-licensed (see [LICENSE](LICENSE)). The data it uses is not all public, and each source has its own terms.
This file says what each source is, what the repository stores, and what you may do with it.

| Source | What it is | Stored in the repository | Terms |
|---|---|---|---|
| **USDA WASDE** | World Agricultural Supply and Demand Estimates, every report since July 2010, as published, via the [USDA Reports Dashboard](https://github.com/rossi-diego/usda-reports-dashboard) release (pinned by sha256) | No. Downloaded at run time into `data/bronze/` (git-ignored) | A US government work: public domain in the United States. Cite USDA as the source. |
| **Banco Central do Brasil, PTAX** | BRL/USD selling rate, SGS series 1, from the BCB open-data API | No. Downloaded at run time | BCB open data; free to reuse with attribution to the Banco Central do Brasil. |
| **CBOT soybean futures (`ZS=F`)** | Continuous front-month daily closes from Yahoo Finance, which redistributes delayed CME Group data | No. Downloaded at run time; only derived results (forecasts, errors, weekly closes for the chart) are published | Yahoo Finance terms of service and CME Group market-data policies. Personal and research use; the raw price history is not redistributed here. Verify the terms before any commercial use. |
| **Paranaguá FOB premium** | Not distributed. The premium is a **user input only**: the viewer types a broker's quote in US cents per bushel over the named CBOT contract | **No.** No premium data, raw or derived, is in the repository, the published site data, the run manifest or the Docker image. `.gitignore` blocks any `*premium*` file under `data/` and `web/public/` | Nothing to license. The typed value stays in the viewer's own browser (`localStorage`) and is never sent anywhere. |

## The premium: user input only

- **Owner decision (2026-11-08).** There is no free, licensed, machine-readable source for the Paranaguá premium, so
  the repository ships no premium data at all. The derived 12-row monthly table, its data card, the frozen FOB
  backtest computed from it and the `derive-premium` command were removed, and the site contract (schema v4) carries no
  premium field.
- **What the site does without it.** CBOT ¢/bu, CBOT USD/t and CBOT in R$/sack (at PTAX) work with no premium and are
  labelled "CBOT only, excl. premium". FOB USD/t and FOB R$/sack appear only once the viewer types a premium; the
  field is empty by default and there is no historical default, median or percentile band.
- **Git history.** An earlier raw daily terminal export (`data/seed/paranagua_premium.csv`, removed from the working
  tree on 2026-11-07) and the derived monthly table (removed on 2026-11-08) are still in **earlier commits**. Purging
  them (for example with `git filter-repo` and a force-push) rewrites history and is a separate, destructive decision
  for the owner. Existing clones and forks keep the old files regardless.

## Roadmap: a public premium

A premium implied from public data could later be offered as an optional reference: the CEPEA/ESALQ Paranaguá soybean price
(R$ per 60 kg) divided by PTAX, converted to US cents per bushel, minus the CBOT nearby close, with the lineage of each
input recorded in the run manifest. It has its own basis and timing mismatches (CEPEA's assessment time, contract month),
which would be documented on its data card before it is used for any range. Until then the premium stays a user input.
