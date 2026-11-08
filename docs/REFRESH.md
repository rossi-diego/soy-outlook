# Data loop: hermetic CI, scheduled refresh, freshness and the outlook archive

This is how new data reaches the site, what stops bad data, and what the repository owner has to switch on.

## Two workflows

| | `ci.yml` (push, PR) | `refresh.yml` (cron, manual) |
|---|---|---|
| Data | none downloaded; synthetic fixtures in `tests/fixtures/bronze` | live: WASDE Tracker release, Yahoo `ZS=F`, BCB PTAX |
| Pipeline | `soyforecast run --offline` into a scratch folder, behind a dead-proxy tripwire | `soyforecast run` into `web/public/data` |
| Gate | `soyforecast validate --allow-stale` (shape) on the fixture output and on the committed data | `soyforecast validate --baseline <previous>`: shape, freshness, row deltas, append-only archive |
| Site | build and Playwright on the committed `web/public/data` | build and Playwright on the new data |
| Writes | nothing (`contents: read`) | one PR from `bot/data-refresh` with auto-merge; issues for alerts |

`ci.yml` is hermetic: package installs are the only network use. The fixtures are generated from fixed seeds by `soyforecast make-fixtures` (`src/soyforecast/fixtures.py`). They contain no licensed or downloaded data, and a test checks that the committed files match the generator.

## Schedule (DST-safe)

- `45 19 * * 1-5` UTC is 13:45 CST in winter and 14:45 CDT in summer, so it always falls after the 13:20 CT soybean close.
- `soyforecast guard --event close` checks the Chicago clock again in code, using `America/Chicago`. A run that starts before 13:30 local time, or on a weekend, does nothing. `tests/test_freshness_and_archive.py` covers both seasons and the DST switch days.
- `30 22 * * 1-5` is the second pass. It only proceeds when the Chicago date equals `next_wasde` in the published `meta.json`. It picks up a report that the WASDE Tracker published after the first run.
- Exchange holidays are not modelled. On a holiday the run finds no new close, the "anything new?" step sees the same close, report and source status, and no PR is opened.

## Validation gate (`soyforecast validate`)

- **Shape.** Every file exists and `schema_version` matches. There is one horizon per configured horizon, each with finite, monotone quantiles. History, metrics, paths and WASDE lines are non-empty. This is a structural check until the pydantic contract (P25) replaces it.
- **Freshness.** The as-of close may be at most `STALE_CLOSE_BDAYS` (3) business days old. `--allow-stale` reports an old close without failing on it.
- **Deltas against the previously published copy.**
  - `as_of_close` and the latest WASDE never go backwards.
  - Backtest rows and weekly history points shrink by at most `MAX_ROW_LOSS_SHARE` (2%).
  - Every archived outlook is still present and byte-identical.

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

When a refresh fails, including a failed gate or a stale close, or when it runs on degraded data, the workflow opens an issue labelled `data-alert`. If one is already open, it comments on that issue instead. The README badge shows the status of the last refresh run.

## Outlook archive: the unseen track record

- Each publish writes `web/public/data/archive/<as_of_close>.json` with the horizons, central values, ranges, model, interval method and code version. It does this only if the file does not exist yet, so a file is never rewritten, and the gate rejects any refresh that would change or delete one.
- `archive/index.json` is rebuilt on every run. Each horizon's outcome is the last CBOT close on or before its target date, marked `inside80` and `inside95`, and `pending` until that date passes.
- The Track record page shows these rows under "Published outlooks against what happened".
- None of these rows was used to choose a model or a range method. Unlike the backtest, where I had seen the 2024–25 holdout prices, this is the only genuinely unseen out-of-sample record. The first 1-month outcome is due a month after the first archived close (2026-11-06).

## What the owner must enable

1. **Auto-merge.** Settings → General → Pull Requests → *Allow auto-merge*.
2. **Branch protection on `main`** with the required checks from `ci.yml` (`python`, `pipeline-offline`, `web`). Auto-merge only waits for required checks; without any, it merges at once.
3. **A token that triggers CI on the bot PR.** PRs opened with the default `GITHUB_TOKEN` do not start other workflows, so the required checks would never report. Add a fine-grained PAT, or a GitHub App token, as the repository secret `REFRESH_TOKEN`. It needs *Contents: read and write*, *Pull requests: read and write* and *Issues: read and write* on this repository only. Without the secret, the workflow falls back to `GITHUB_TOKEN`. The PR is still opened, and the refresh job has already built and tested the site on the new data, but you would merge it by hand or drop the required checks.
4. **Actions permissions.** Settings → Actions → General → Workflow permissions: allow GitHub Actions to create and approve pull requests. This is needed when no `REFRESH_TOKEN` is set.
5. **Deploys.** The Vercel Git integration deploys `main` when the PR merges, and no deploy secret is needed in Actions.
6. **Cron keep-alive.** GitHub disables scheduled workflows after 60 days without repository activity. Merged refresh PRs count as activity, but if the refresh has been failing for two months, re-enable it under Actions → Data refresh.

A manual run (Actions → Data refresh → *Run workflow*) skips the close guard. Its `allow_stale` input lets an old close through, for example right after a long exchange holiday.
