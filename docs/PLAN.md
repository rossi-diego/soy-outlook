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

**Reference contract (P10, minimum step).** For each horizon, the first soybean contract whose first notice day falls after the target date; a window crosses a roll when that contract differs from the origin's. Targets are not rebuilt (roadmap v2.1).

## Definition of done
Static Next.js site with real data, an honest README with backtest numbers and screenshots, `docker compose up`,
CI (Python checks → live pipeline → site build + Playwright), tests for no look-ahead.
