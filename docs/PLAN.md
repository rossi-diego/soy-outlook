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

## Definition of done
Static Next.js site with real data, an honest README with backtest numbers and screenshots, `docker compose up`,
CI (Python checks → live pipeline → site build + Playwright), tests for no look-ahead.
