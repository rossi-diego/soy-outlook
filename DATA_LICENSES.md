# Data licences and provenance

The code is MIT-licensed (see [LICENSE](LICENSE)). The data it uses is not all public, and each source has its own terms.
This file says what each source is, what the repository stores, and what you may do with it.

| Source | What it is | Stored in the repository | Terms |
|---|---|---|---|
| **USDA WASDE** | World Agricultural Supply and Demand Estimates, every report since July 2010, as published, via the [WASDE Tracker](https://github.com/rossi-diego/wasde-monthly-report) release (pinned by sha256) | No. Downloaded at run time into `data/bronze/` (git-ignored) | A US government work: public domain in the United States. Cite USDA as the source. |
| **Banco Central do Brasil, PTAX** | BRL/USD selling rate, SGS series 1, from the BCB open-data API | No. Downloaded at run time | BCB open data; free to reuse with attribution to the Banco Central do Brasil. |
| **CBOT soybean futures (`ZS=F`)** | Continuous front-month daily closes from Yahoo Finance, which redistributes delayed CME Group data | No. Downloaded at run time; only derived results (forecasts, errors, weekly closes for the chart) are published | Yahoo Finance terms of service and CME Group market-data policies. Personal and research use; the raw price history is not redistributed here. Verify the terms before any commercial use. |
| **Paranaguá FOB premium** | A private daily export from a market terminal, 2004-02-19 to 2025-06-18. Vendor, assessment method and CBOT reference contract were not recorded | **Only a derived table:** `data/seed/paranagua_premium_monthly.csv` (12 rows: median, 10th and 90th percentile per calendar month from 2015, with the number of quotes and years) and its data card `paranagua_premium_monthly.meta.json` | Not public data. Permission to redistribute the original export has not been confirmed, so the daily quotes are not published. The aggregate statistics are shown for illustration only and are not a market assessment. |

## The premium table: provenance note

- **Why derived only.** The daily export came from a commercial market terminal. Its licence is not known to cover
  redistribution, so the repository keeps only 12 monthly aggregates, the minimum the site needs for a default.
- **Data card.** `paranagua_premium_monthly.meta.json` records the source as known, the unit (US cents per bushel over
  CBOT), the contract convention (`unknown`), the method, `valid_until` (90 days after the last quote), the last quote
  of the original series, and the sha256 of the exact raw file it came from. `load_premium_table` validates the card on
  every run, and the site marks the premium default **stale** once `valid_until` has passed.
- **Frozen FOB backtest.** The illustrative FOB backtest on the Track record page needed the daily series. Its summary
  (random walk, premium held at its report-day value) was computed once when the table was derived and is stored in the
  card. It cannot be recomputed from the monthly table.
- **Regenerating.** With a private copy of the export outside the repository:
  `soyforecast derive-premium --raw /path/to/paranagua_premium.csv`. The raw file must never be committed; `.gitignore`
  only allows the two derived files under `data/seed/`.
- **Git history.** The raw export (`data/seed/paranagua_premium.csv`) was removed from the working tree on 2026-11-07.
  **Earlier commits still contain it.** Purging it (for example with `git filter-repo` and a force-push) rewrites history
  and is a separate, destructive decision for the owner, who should first confirm whether the terminal licence covered
  the export. Existing clones and forks keep the old file regardless.

## Roadmap: a public premium

A premium implied from public data would replace the derived table: the CEPEA/ESALQ Paranaguá soybean price
(R$ per 60 kg) divided by PTAX, converted to US cents per bushel, minus the CBOT nearby close, with the lineage of each
input recorded in the run manifest. It has its own basis and timing mismatches (CEPEA's assessment time, contract month),
which would be documented on its data card before it is used for any range.
