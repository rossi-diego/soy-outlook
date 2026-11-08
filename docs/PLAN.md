# Rebuild plan (v2), agreed by three independent reviewers

Reviewers: ML/quant rigour, data engineering, stakeholder product. Each audited v1 independently,
then critiqued a draft plan; all three returned **"agree with changes"**, and those changes are folded in below.

## Problem statement
Soybean stakeholders (export traders, crushers, co-ops, risk teams) need an honest view of where Paranaguá FOB
(CBOT + premium) could be 1, 3 and 6 months after each WASDE, with tested ranges, a track record against
"no change", and what a WASDE revision is worth.

## Decisions
| Topic | Decision | Why |
|---|---|---|
| Target | Log return of the CBOT front-month close, release day → last session ≤ t + h months | Public, live data; the premium has no licensed public feed |
| Premium / FX | Visible user inputs (v2.1: one current-month median held flat for every horizon, flagged stale; PTAX) | Seed premium has no provenance and ends 2025-06; v2.1 commits only a derived 12-row monthly table (DATA_LICENSES.md) |
| Ranges | Calibrated on CBOT errors only; never on FOB errors applied to an assumed premium | Consistency (ML reviewer) |
| Features | Fixed set of 11: US soy/corn stocks-to-use, revisions (US, Brazil, Argentina, China, World), momentum, May dummy | No selection leakage |
| Marketing year | Rank MYs within each report (latest = projected); `proj` flag is missing in 2010 | Data reviewer |
| Purging | Row usable at origin t only if its target date ≤ t (dates, not row counts) | Irregular report spacing |
| Models | Random walk → drift → ARIMA(0,1,1) → ridge (SARIMAX-WASDE dropped: future exog unknown) | Scope + rigour |
| Tests | DM with HLN correction + Newey-West lag h−1; Clark-West for nested models; Holm across horizons | Nested models, overlap |
| Champion | Replace random walk only if CW Holm p < 0.10 on validation and lower MAE | Honest fallback |
| Splits | Burn-in 2013–2015, validation 2016–2023, holdout 2024+ (not used for any model choice; the author had seen 2024–25 prices) | |
| Rolls | Flag windows crossing Jul/Aug/Sep expiries; report metrics with and without | No back-adjustable history on Yahoo |
| UI | Outlook, This WASDE, Track record, Methodology; "what moved" waterfall cut if random walk wins | Product reviewer |
| Added | Release-day event study (revision → same-day CBOT move) and what-if calculator | Gives stakeholders a use even with no forward edge |

## Pre-registration, 2026-11-08 (v2.1, unit U5)

Fixed in `src/soyforecast/config.py` and committed before any of the results below were computed.

**Range method (P2).** Exactly three candidates, all built from the same purged window of the last 60 realized errors:

| Candidate | Role | Construction |
|---|---|---|
| `empirical` | baseline | Empirical quantiles of past errors (the v2.1 method, with the centring chosen earlier) |
| `ewma_fhs` | the one challenger | Filtered historical simulation: each past error divided by the EWMA(λ = 0.94) daily vol at its own origin × √(21h), quantiles taken, rescaled by today's EWMA vol |
| `lognormal_rv` | naive benchmark | Lognormal band on the model forecast, sd = 63-session realized vol × √(21h) |

Selection: on validation only, the mean 80% + 95% interval score divided by the baseline's, averaged over every model × horizon cell; the lowest ratio wins if it is below 1. Pinball, Kupiec/Christoffersen and coverage by vol regime are diagnostics. The holdout is reported once. Only the winner is published as the site range; if the plain vol band wins, it is published and labelled as such. GARCH, adaptive conformal, other RV windows and CVOL are left out on purpose.

**Calibration reporting (P4).** Per hit rate: HAC SE (Bartlett, lag h−1), moving-block bootstrap 95% CI (block h, 2,000 draws, fixed seed), n_eff = n·p(1−p)/long-run variance; upper vs lower misses; Kupiec POF and Christoffersen independence on each of the h non-overlapping subsamples (median p reported); MDE = (z₀.₉₅ + z₀.₈₀)·HAC-SE(d)/MAE_rw.

**Inference rule v2 (P16).** v1 mixed losses: DM on absolute USD/t errors, CW on squared log-return errors, and the champion tie-break on MAE. v2 fixes one primary loss, the squared log-return error; MAE is secondary and never chooses. Holm runs across all 9 Clark-West tests (3 challengers × 3 horizons). A challenger replaces no change only if its Holm p < 0.10 and its primary loss is below the random walk's. The iid binomial direction test is replaced by the regression form of Pesaran-Timmermann with a HAC t statistic.

**Stress replay (P19).** The five episodes named by the review panel, fixed before any outcome was computed: Jun 2018 trade war, Jul 2020 China buying, May 2021 correction, Feb 2022 Ukraine invasion, Jul 2024 sell-off. Each starts at the first CBOT session of its month; the realized h-month return is applied to today's price. Illustrative scenarios, not probabilities, shown next to the full distribution of h-month returns.

**Reference contract (P10, minimum step).** For each horizon, the first soybean contract whose first notice day falls after the target date; a window crosses a roll when that contract differs from the origin's. Targets are not rebuilt (roadmap v2.1). *Amended in the U5 review (a label, not a model or a choice made on results):* "crosses a roll" now means the continuous front month (ZS=F) itself rolls inside the window, i.e. a contract's last trading day falls between origin and target, the same expiry convention as the crop-roll flag. The first-notice comparison missed rolls just after the origin (X26 → F27 on 13 Nov 2026, inside the 1-month window from 6 Nov).

**Results (computed after the pre-registration commit 2d33ed6).** Range method, validation score ratio vs the baseline: EWMA FHS 1.096, lognormal vol band 1.071, so the empirical baseline stays and the published ranges are unchanged. Holdout, reported only: FHS 1.091, vol band 0.804. Rule v2: all nine Holm-adjusted CW p = 1.0, champion no change at every horizon (unchanged). MDE for the ridge model 5–7% of the random walk's MAE.

## Pre-registration, 2026-11-08 (v2.1, unit U7)

Fixed in `src/soyforecast/config.py` and committed before any of the numbers below were computed.

**Release-day move band (P14, this round).** The band on /wasde is the empirical quantile of |release-day log return| over every usable report of the event study (non-May reports since July 2010 with a session on the release day): the median ("typical move") and the 90th percentile ("1 report in 10 moves more"), quoted in USD/t at today's price and drawn as a range around today's close. Its hit rate is out of sample: every report from 2016 on is scored against the band built from earlier reports only (expanding window, at least 36 of them); a hit is |r| ≤ band. Reported for validation (2016–2023), holdout (2024+) and both, with Wilson 95% intervals. Nothing is chosen on it. No new page and no new model family this round.

**Volatility ladder (P14, v2 roadmap, not implemented in v2.1).** Registered now so that the v2 result cannot be shaped after the fact:

| Item | Fixed choice |
|---|---|
| Targets | (a) \|release-day log return\| per report; (b) realized variance of daily CBOT log returns over (t, t + h], h = 1, 3, 6 months, from each release-day close |
| Ladder | unconditional mean (the band above) → EWMA (λ = 0.94, the P2 vol series) → HAR-RV (daily, weekly, monthly RV) → HAR-RV + report-month dummies and US soy stocks-to-use level |
| Loss and tests | QLIKE; Diebold-Mariano (HLN, Newey-West lag h − 1) against the unconditional rung, under the existing purged rolling origin and the same 2016–2023 validation / 2024+ holdout split |
| Multiplicity | every ladder test joins the inference-rule Holm family (the nine Clark-West tests plus the ladder's tests) |
| Shared inputs | the vol estimate is the same EWMA / realized-vol series the P2 range candidates use |
| Publication | the result is published whatever it is, including a loss; the /wasde line is upgraded from the empirical band only if a rung beats it out of sample on validation |

**Decision panel (P18).** The published range method's quantiles are also exported on a finer grid (5% to 95% in 5% steps). It is the same method on more levels, so nothing is chosen on it. The panel on / is client-side arithmetic: side (producer long or buyer short), tonnes, hedge ratio and currency; downside vs selling (or buying) at today's close at the 1-in-10 adverse level (q10 for a producer, q90 for a buyer) and the rough 1-in-40 level (q2.5 / q97.5), times tonnes × (1 − hedge ratio). CBOT only, with premium and BRL held fixed, so the hedge is futures at today's close and the basis is unhedged. Labelled "illustrative, range-based, not VaR", with the 6-month under-coverage shown inline. No target-price probability (it reads as directional advice) and no expected shortfall (each 95% tail rests on about 1.5 of 60 overlapping errors).

## Definition of done
Static Next.js site with real data, an honest README with backtest numbers and screenshots, `docker compose up`,
CI (Python checks → live pipeline → site build + Playwright), tests for no look-ahead.
