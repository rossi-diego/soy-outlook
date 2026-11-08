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
| Premium / FX | Visible user inputs: the premium is typed by the user, empty by default (FOB only once entered); PTAX default for FX | Owner decision 2026-11-08: no licensed premium source, so no premium data (raw or derived) is shipped (DATA_LICENSES.md) |
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

## Pre-registration, 2026-11-08 (v2.1 polish unit B, display rules)

Fixed in `src/soyforecast/config.py` before the per-side tail split of any horizon was read. Display only: no range, model or method is chosen on them, and the holdout plays no part.

| Rule | Fixed choice |
|---|---|
| Side-aware tail warning | Each tail of the 80% range has a one-tail nominal miss rate of 10% (`TAIL_NOMINAL_80`). The decision panel flags the adverse tail of the chosen side (lower misses `miss_lo80` for a producer, upper misses `miss_hi80` for a buyer) when its validation rate is more than 5 points (`COVERAGE_WARN_PP`) above 10%, i.e. above 15%. Published per horizon as `coverage.tail_warn_lo80` / `tail_warn_hi80`. |
| 1-in-40 emphasis | The rough 1-in-40 money figure is shown in muted, smaller type when `tail_obs_95` < 2 (`TAIL_OBS_MIN_95`). |
| Target readout | A user-typed CBOT target is placed among the p10, p25, p50, p75 and p90 of the tested range (`TARGET_READOUT_LEVELS`): "below p10", "between p50 and p75", "above p90". Worded as a range position, never as a probability of reaching the price. |

## v2.1 panel round (2026-11-08)

Twelve reviewer lenses (quant, stats, trader, farmer, risk, UX, dataviz, frontend, data engineering, software engineering, recruiter, skeptic) scored v2 and voted on 28 proposals in two rounds (adoption bar: two thirds). The agreed final wording of each adopted proposal was the spec; each unit was implemented, then audited against that wording by a separate reviewer.

**Adopted and shipped (25).**

| Wave | Proposals | What shipped |
|---|---|---|
| 1 · honesty and operations | P9, P6, P8, P15, P3, P11, P5, P1 (phase 1), P26, P23 | Raw premium export removed; later (2026-11-08) the derived monthly table too, making the premium a user input only. Explicit-sum FOB headline once a premium is typed. Origin-distance flag. Ranges renamed "empirical quantiles of past errors", centring pre-registered and chosen on validation. Event study with Holm, HC1 covariance, placebo, split-sample and roll-exclusion checks; what-if with an 80% prediction interval. Range labels built from measured coverage, amber below nominal. "CBOT price risk only" label on FOB/R$ bands. Author, metadata, OG card. Hermetic CI, gated scheduled refresh, freshness banner and an append-only outlook archive. |
| 2 · rigour and contracts | P25, P24, P4, P2, P16, P19, P10 (minimum step), P21, P22, P13, P28 | Pydantic site contract with staged publish and generated TS types. Pinned WASDE input, PTAX checks, uv.lock, run manifest and snapshots. Overlap-aware calibration (CIs, n_eff, tail split, Kupiec, Christoffersen, MDE). Pre-registered vol-scaled range challengers (the baseline won). Inference rule v2. Stress replay. Reference contract and roll flags. Hero chart whiskers, Track record verdict and "For statisticians" fold, realistic what-if sliders, lazy charts and a size budget. |
| 3 · decision use and audience | P18, P14, P20, P27 | Decision panel (downside vs selling today at 1-in-10 and rough 1-in-40, illustrative, not VaR). Release-day move band with an out-of-sample hit rate and the pre-registered v2 volatility ladder. pt-BR toggle with R$/saca and an optional user-entered port-to-interior discount. WCAG AA, axe gate in CI and a tested 390 px layout. |

**Rejected (2).** P12, measuring surprise instead of revision (25% support): applying a revision beta to user-entered surprises is inconsistent, and analyst-poll data has provenance and licence problems; P11's relabelling covers it. P17, a second pre-registered feature set (8%): designed after seeing v1's null result, it would read as specification search.

**Unresolved (1).** P7, a premium curve by shipment month tied to a named contract (58%). Its agreed part, one FOB bridge line per card, shipped with P6, and the shipment-month median reference text was removed with the premium data (2026-11-08). Whether to add an opt-in seasonal premium path stays open; without a sourced premium series (the owner confirmed there is no alternative source) it would invent provenance.

**Still partial, by design.**
- P1 phase 2 (a joint CBOT × PTAX × premium band with a coverage backtest) needs a premium series with documented provenance. Since 2026-11-08 the premium is a user input only and no premium band is shown; a CBOT x PTAX band does not need a premium and stays possible.
- P10: targets are not rebuilt on specific contracts; that is the v2.1 roadmap item.
- P14: the volatility ladder is pre-registered only (v2).
- P13: the optional display-only US yield/area/production/export lines need new ingest work.
- The validation gate's shape check is now the P25 pydantic contract; Docker was built only in CI.

**Final numbers (live run, CBOT close of 6 Nov 2026, October 2026 WASDE).** Champion: no change at every horizon; all nine Holm-adjusted Clark-West p = 1.0. No-change MAE, validation 2016-2023: 20.3 / 37.3 / 50.8 USD/t at 1 / 3 / 6 months; holdout 2024+: 14.2 / 20.3 / 31.4. Published range method: empirical quantiles of past errors, median-centred (0.974 of the raw score on validation; 1.008 on the holdout, reported only). It beat EWMA FHS (1.096) and the lognormal vol band (1.071) on validation; the vol band scored 0.804 on the holdout, reported only. 80% range hit rate, validation / holdout: 80% / 84%, 75% / 90%, 71% / 85% (6 months flagged); 95%: 96% / 97%, 90% / 97%, 89% / 100%. Event study: no revision survives Holm (strongest, US soybean stocks-to-use, −2.06 USD/t per pp, p 0.019, Holm p 0.112); joint p 0.00041, R² 0.18. Release-day move ±4.5 USD/t typical, ±11.6 for 1 report in 10 (out-of-sample hit rate 89.5% in validation, 96.6% in the holdout).

The live run re-fetched the 6 Nov 2026 close as 1,193.75¢/bu; an earlier local run from cached prices had archived 1,189¢/bu. That archive file was created on this unreleased branch and never deployed, so it was not a published record: polish unit C (P23b) regenerated it from the current publish, and the archive now matches the outlook. From here on the rule is mechanical. The newest archive record of the outlook on the site must match outlook.json (the publish step and `soyforecast validate` both check this, plus a pytest and an e2e contract test). When a later run sees a revised close for an archived date, it writes `<date>.r<N>.json` (`revision`, `revises`, `revision_reason`) next to the original, which is never rewritten. The scored tally uses only the first-published record.

## Definition of done
Static Next.js site with real data, an honest README with backtest numbers and screenshots, `docker compose up`,
CI (Python checks → live pipeline → site build + Playwright), tests for no look-ahead.
