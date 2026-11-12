# Data loop: hermetic CI, scheduled refresh, freshness and the outlook archive

This is how new data reaches the site, what stops bad data, and what the repository owner has to switch on.

## Two workflows

| | `ci.yml` (push, PR) | `refresh.yml` (cron, manual) |
|---|---|---|
| Data | none downloaded; synthetic fixtures in `tests/fixtures/bronze` | live: WASDE Tracker release, Yahoo `ZS=F` and front-contract symbols (e.g. `ZSF27.CBT`), BCB PTAX |
| Pipeline | `soyforecast run --offline` into a scratch folder, behind a dead-proxy tripwire | `soyforecast run` into `web/public/data` |
| Gate | `soyforecast validate --allow-stale` (shape) on the fixture output and on the committed data | `soyforecast validate --baseline <previous>`: shape, freshness, row deltas, append-only archive |
| Site | build and Playwright on the committed `web/public/data` | build and Playwright on the new data |
| Writes | nothing (`contents: read`) | one PR from `bot/data-refresh` with auto-merge; issues for alerts |

`ci.yml` is hermetic: package installs are the only network use. The fixtures are generated from fixed seeds by `soyforecast make-fixtures` (`src/soyforecast/fixtures.py`). They contain no licensed or downloaded data, and a test checks that the committed files match the generator.

## Schedule (DST-safe)

- **Only final sessions are published.** Yahoo dates futures bars by the New York calendar day and keeps rewriting the newest one: before the 13:20 CT close it is the live session, after it the last trade rather than the settlement, and from 19:00 CT (Globex reopens) to 23:00 CT it moves with overnight trades. `final_through` in `freshness.py` is therefore the last CBOT session *before* today in Chicago (weekends and the exchange holidays in `cbot_holidays` skipped), and the ingest drops every later bar, from the download and from the cache, whatever started the run. A session's settlement goes out the morning after. `tests/test_settled_close.py` covers both seasons, the DST switch days and the 2026-11-09/11 incidents.
- **The front contract is read from its own symbol.** Yahoo moves `ZS=F` to the liquid next contract a few weeks before the front expires, so its newest bars can quote another contract than its history (on 2026-11-06 and 11-09 they quoted F27 while the series was still X26), and it rewrites them later. Over the last `PRICE_CONTRACT_WINDOW_BDAYS` (60) business days each session comes from the front contract's own symbol (`price_contract`: the nearest contract, rolling on its last trading day; the models' `front_contract` keeps the expiring contract that one day, but Yahoo carries no settlement for it and soon delists it), a settlement confirmed by an earlier run taking precedence, then from a value already stored as final in the cache, and only for sessions older than `PRICE_REQUIRE_CONTRACT_BDAYS` (10) from `ZS=F`. A newer session with neither ends the series before it; the prices source is then reported as a cache fallback, which alerts.
- **The newest session is published at its settlement.** Yahoo rewrites a Monday-to-Thursday bar to the settlement once the next session opens, but Friday's bar (9 of the last 10 Fridays) and a pre-holiday session's keep the last trade. The contract's chart metadata carries the settlement as `chartPreviousClose` (one-day range) while the next session trades. `confirm_newest_settlement` replaces the newest bar with it when the quote's last trade is in the session trading now and that session directly follows the newest one (holidays skipped: the Friday after Thanksgiving confirms the Wednesday); the settlement is stored in the cache sidecar and preferred over the bar by every later run. Otherwise the session is held back for a later run; if the quote could not be read at all, the prices source is reported as a cache fallback, which alerts. On 2026-11-11 at 19:30 CST the quote showed F27 1230.75 while the bar showed 1229.75, an overnight print.
- `0 16 * * 1-5` UTC (10:00 CST / 11:00 CDT, Monday to Friday) publishes the previous session (Monday publishes Friday; on a contract's last trading day, such as Friday 2026-11-13 for X26, the published close is already the next contract's settlement); `0 20 * * 1-5` retries. A run GitHub delays past 19:00 CT holds the newest session back, and the next run publishes it. `soyforecast guard --event close` runs only when a final session is newer than the published `as_of_close`, so a run GitHub delays by hours still publishes the right session, and a second run is a no-op. A WASDE day's report goes out with that day's close, the morning after (`days_since_report` 0, the origin the ranges are calibrated on).
- **Archived closes are revised, never rewritten.** If the final series later differs from an archived outlook's close by more than `CLOSE_REVISION_TOL_C_BU` (0.25¢/bu), the next run writes `<date>.r<N>.json` with the close replaced and every number rescaled by the same ratio (the published ranges, log offsets around the close under the no-change champion, moved to the corrected close with the calibration they were published with). The tally still scores revision 1.
- **The gate rejects a same-day close.** From version 2.1.0, `soyforecast validate` fails when `as_of_close` is not before the Chicago date of `generated_at`.
- **Exchange holidays** (`cbot_holidays`: the standing CME holidays, checked against every `ZS=F` bar since 2007) are not sessions. On a holiday the guard finds no newer final session, or the run holds the pre-holiday session back until the next session's quote confirms it, and no PR is opened. One-off closures are not modelled and only delay a publication by one run.

## Validation gate (`soyforecast validate`)

- **Shape.** Every file exists and `schema_version` matches. There is one horizon per configured horizon, each with finite, monotone quantiles. History, metrics, paths and WASDE lines are non-empty. The pydantic site contract (P25) enforces it.
- **Freshness.** The as-of close may be at most `STALE_CLOSE_BDAYS` (3) business days old. `--allow-stale` reports an old close without failing on it.
- **Deltas against the previously published copy.**
  - `as_of_close` and the latest WASDE never go backwards.
  - Backtest rows and weekly history points shrink by at most `MAX_ROW_LOSS_SHARE` (2%).
  - Every archived outlook is still present and byte-identical.
- **Archive.** An outlook built within `ARCHIVE_MAX_LAG_BDAYS` (1) business day of its close must be in the archive.

The results are written to the run summary and as step outputs: `ok`, `stale`, `degraded`, `degraded_sources` and `as_of_close`.

## Freshness block and the site banner

`meta.json` has a `freshness` block with these fields: `as_of_close`, `generated_at`, `mode` (live or offline), `stale_after_bdays`, `bdays_close_to_generated`, `next_wasde`, and `sources`.

`sources` records each input as `live`, `offline` or `cache`. `cache` means a download was attempted and failed or was rejected, so the cache was used. The block also has `degraded` and `degraded_sources`.

The site's banner (`web/components/FreshnessBanner.tsx`) is computed in the browser, because the static HTML is built once and staleness depends on when it is read. It appears on every page when any of these holds:

- the as-of close is more than `stale_after_bdays` business days old;
- the next WASDE (12:00 ET on `next_wasde`) has been released since the data was built;
- the last refresh fell back to cached data.

The as-of close stays in the header at every width.

## Alerts

When a refresh fails, including a failed gate, when its close is stale (even on a manual `allow_stale` run), or when it runs on degraded data, the workflow opens an issue labelled `data-alert`. If one is already open, it comments on that issue instead. A failure before the guard has decided (install, a pending data PR, an unreadable `meta.json`) alerts too. `data-merged.yml` closes the open alerts once a data PR with non-degraded data has merged into `main`. The README badge shows the status of the last refresh run.

## Outlook archive: the unseen track record

- Each publish writes `web/public/data/archive/<as_of_close>.json` with the horizons, central values, ranges, model, interval method and code version. It does this only if the file does not exist yet, so a file is never rewritten, and the gate rejects any refresh that would change or delete one.
- If the same close is published again with a newer WASDE report (a forced re-run after a late report), that outlook is archived too, as `archive/<as_of_close>_<wasde month>.json`.
- An outlook built more than `ARCHIVE_MAX_LAG_BDAYS` (1) business day after its close, such as an offline rebuild on an old cache, is published but not archived. Later closes are already known by then, so archiving it would backfill the record with hindsight.
- `archive/index.json` is rebuilt on every run. Each horizon's outcome is the last CBOT close on or before its target date, marked `inside80` and `inside95`, and `pending` until that date passes.
- **Revisions (P23b).** If a later run sees a revised close for an archived date, it writes `<date>.r<N>.json` (`revision`, `revises`, `revision_reason`) next to the original, which is never rewritten. `check_revision_chain` in `publish/validate.py` rejects a revision whose number or `revises` link is wrong, and only the first-published record is scored. The newest archive record must match `outlook.json`; publish, `soyforecast validate`, a pytest and an e2e test check this.
- The Track record page shows these rows under "Published outlooks against what happened".
- None of these rows was used to choose a model or a range method. Unlike the backtest, where I had seen the 2024–25 holdout prices, this is the only genuinely unseen out-of-sample record. The first 1-month outcome is due a month after the first archived close (2026-11-06).

## Contract, input pins and lineage

- **The JSON the site reads is a checked contract.** `src/soyforecast/publish/schema.py` defines every published file as a pydantic model (unknown keys, nulls where numbers are expected, NaN, non-monotone quantiles and missing horizons are all rejected). `publish` validates before writing, writes into a staging folder, re-checks it against the live copy (as-of close and latest WASDE never go backwards) and only then swaps it in with `os.replace`; a failure leaves the published data untouched (exit code 4). `soyforecast export-schema` writes the models as JSON Schema to `web/lib/schema/`; `npm run gen:types` turns that into `web/lib/types.generated.ts`, and `web/lib/data.ts` validates every file against the same schema at build time, so a wrong `schema_version` or shape fails `next build`. CI fails when the schema or the generated types are stale. Generated types rather than zod: zod would be a second, hand-written copy of the contract.
- **Inputs are pinned and checked before they replace the cache.** The WASDE history is pinned to one WASDE Tracker release tag and its sha256 in `data/wasde.lock.json`; other bytes under that tag are rejected, and only the scheduled refresh moves the pin (`run --update-pin`), as a reviewable diff in its PR. A new WASDE file must keep every column, numeric values and unique keys, and may not lose reports. A PTAX download must stay within 1-15 BRL/USD, move less than 15% a day and end no earlier than the cache. A rejected or failed download falls back to the cache and marks the run degraded. `--offline` never touches the network and fails with exit code 3 when a cache is missing (exit codes are listed in `src/soyforecast/errors.py`).
- **Every run says what produced it.** `web/public/data/run_manifest.json` lists the sha256 of every input file, the WASDE pin and whether the file matched it, the hash of `uv.lock`, the git commit (and whether the code differed from it), and the versions of the packages that shape a forecast. Every input is also kept as a dated, content-hashed snapshot in `data/bronze/snapshots/` (identical bytes stored once, the last 30 per source kept). In the Docker image, which has no git checkout, the commit comes from the `GIT_SHA` build argument and `uv.lock` ships next to the virtualenv.

## What the owner must enable

1. **Auto-merge.** Settings → General → Pull Requests → *Allow auto-merge*.
2. **Branch protection on `main`** with the required checks from `ci.yml` (`python (3.11)`, `python (3.12)`, `pipeline-offline`, `docker`, `web`). Auto-merge only waits for required checks; without any, it merges at once.
3. **A token that triggers CI on the bot PR.** PRs opened with the default `GITHUB_TOKEN` do not start other workflows, so the required checks would never report. Add a fine-grained PAT, or a GitHub App token, as the repository secret `REFRESH_TOKEN`. It needs *Contents: read and write*, *Pull requests: read and write* and *Issues: read and write* on this repository only. Without the secret, the workflow falls back to `GITHUB_TOKEN`. The PR is still opened, and the refresh job has already built and tested the site on the new data, but you would merge it by hand or drop the required checks.
4. **Actions permissions.** Settings → Actions → General → Workflow permissions: allow GitHub Actions to create and approve pull requests. This is needed when no `REFRESH_TOKEN` is set.
5. **Deploys.** The Vercel Git integration deploys `main` when the PR merges, and no deploy secret is needed in Actions.
6. **Cron keep-alive.** GitHub disables scheduled workflows after 60 days without repository activity. Merged refresh PRs count as activity, but if the refresh has been failing for two months, re-enable it under Actions → Data refresh.

A manual run (Actions → Data refresh → *Run workflow*) goes through the same close guard, so before the close or once the close is published it does nothing. Its `force` input skips the guard, for example to retry after a degraded run or to pick up a late WASDE report for an already published close; the ingest still publishes final sessions only. Its `allow_stale` input lets an old close through, for example right after a long exchange holiday.

Every pull request also runs the validation gate against its base branch (`ci.yml`), so a data PR can never move the close backwards or change or delete an archived outlook relative to what `main` holds. A deliberate correction of the archive therefore needs an admin merge.
