"""Settings and pre-registered experiment constants.

Everything that changes the experiment (horizons, splits, features) lives here and is
fixed before looking at results; environment variables only change *where* things are.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[2]

# Forecast horizons, in calendar months after the origin.
HORIZONS: tuple[int, ...] = (1, 3, 6)

# Out-of-sample predictions start here (residual burn-in for the intervals) ...
OOS_START = pd.Timestamp("2013-01-01")
# ... metrics and model selection use the validation window only ...
VALIDATION_START = pd.Timestamp("2016-01-01")
VALIDATION_END = pd.Timestamp("2023-12-31")
# ... and the holdout is reported once, never used for choosing anything.
HOLDOUT_START = pd.Timestamp("2024-01-01")

# Conformal calibration: realized out-of-sample residuals only.
CALIB_WINDOW = 60
CALIB_MIN = 24
QUANTILES: tuple[float, ...] = (0.025, 0.10, 0.50, 0.90, 0.975)

# Interval construction (v2.1, pre-registered 2026-11-07 before any v2.1 result was computed).
# The method is named for what it is: empirical quantiles (linear interpolation) of the last
# CALIB_WINDOW realized out-of-sample errors. It is not split-conformal: overlapping h-month
# windows are not exchangeable, and at n = 60 the finite-sample conformal rank would make the
# 95% bound equal to the largest past error. Two centrings compete:
#   "raw"    - the errors as they are (the v2.0 baseline);
#   "median" - errors minus their median, so the band is centred on the model forecast and
#              does not carry a drift that the random-walk comparison rejected.
# Selection rule, validation split only: for every model and horizon, the mean of the 80% plus
# the 95% interval score (Gneiting-Raftery, log-return units) is divided by the baseline's; the
# challenger replaces the baseline only if the average ratio is below 1. Holdout is reported.
INTERVAL_METHOD = "empirical quantiles of past errors"
INTERVAL_CENTRINGS: tuple[str, ...] = ("raw", "median")
INTERVAL_BASELINE = "raw"
NOMINAL_LEVELS: tuple[float, ...] = (0.80, 0.95)
# A band is flagged (amber) when its validation hit rate is more than this below nominal.
COVERAGE_WARN_PP = 0.05

# Range method (v2.1, P2, pre-registered 2026-11-08 before any vol-scaled result was computed).
# Exactly three candidates, all built from the same purged window of the last CALIB_WINDOW
# realized errors and the same chosen centring:
#   "empirical"    - the baseline: unconditional empirical quantiles of past errors (above);
#   "ewma_fhs"     - the one challenger, EWMA filtered historical simulation: each past error is
#                    divided by the EWMA(lambda = EWMA_LAMBDA) daily vol at its own origin times
#                    sqrt(trading days in h), quantiles of those standardised errors are taken,
#                    then rescaled by the EWMA vol at today's origin (same sqrt(h) scaling);
#   "lognormal_rv" - the naive benchmark: a lognormal band centred on the model forecast with
#                    sd = trailing realized vol over RV_WINDOW sessions times sqrt(trading days).
# Vol is computed from CBOT closes up to and including the origin close only. GARCH, adaptive
# conformal, other RV windows and CVOL (no free, pinnable source) are deliberately left out.
# Selection rule, validation split only: the same interval-score ratio as the centring rule
# (mean 80% + 95% interval score / the baseline's, averaged over every model x horizon cell);
# the candidate with the lowest ratio wins if that ratio is below 1, else the baseline stays.
# Pinball loss, Kupiec/Christoffersen and coverage by vol regime (terciles of the origin vol)
# are diagnostics only. The holdout is reported once and never used. Only the winner is
# published as the site range; if the plain lognormal band wins, it is published and labelled so.
RANGE_METHODS: tuple[str, ...] = ("empirical", "ewma_fhs", "lognormal_rv")
RANGE_BASELINE = "empirical"
RANGE_CHALLENGER = "ewma_fhs"
RANGE_BENCHMARK = "lognormal_rv"
EWMA_LAMBDA = 0.94
EWMA_BURN_SESSIONS = 60  # EWMA vol is undefined until this many daily returns exist
RV_WINDOW = 63  # one quarter of sessions
TRADING_DAYS_PER_MONTH = 21
VOL_REGIME_QUANTILES: tuple[float, ...] = (1 / 3, 2 / 3)

# Calibration reporting (v2.1, P4, pre-registered 2026-11-08). For every hit rate (inside the
# 80% / 95% band): the HAC standard error (Bartlett, lag h-1), a moving-block bootstrap 95% CI
# (block length h, BOOTSTRAP_DRAWS draws, fixed seed), and n_eff = n p(1-p) / long-run variance
# (capped at n). Upper and lower misses are reported separately. Kupiec POF and Christoffersen
# independence are run on each of the h non-overlapping subsamples (every h-th origin) and the
# median p-value across them is reported. MDE = (z_0.95 + z_0.80) x HAC-SE of the mean
# absolute-error differential vs the random walk / the random walk's MAE: the smallest relative
# improvement a one-sided 5% test would detect with 80% power.
BOOTSTRAP_DRAWS = 2000
BOOTSTRAP_SEED = 20261108
MDE_ALPHA = 0.05
MDE_POWER = 0.80

# Inference rule v2 (P16, pre-registered 2026-11-08; v1 was MAE-based DM, CW Holm-adjusted
# across the three horizons of each model, iid binomial direction test). In v2:
#   - one primary loss, the squared log-return error (the loss Clark-West and the ridge use);
#     the MAE in USD/t is kept as a secondary loss, reported, never used to choose;
#   - Holm across the whole family of 9 Clark-West tests (3 challengers x 3 horizons);
#   - a challenger replaces the random walk at h only if its family-wide Holm p is below
#     CHAMPION_ALPHA and its validation primary loss is lower than the random walk's;
#   - the direction test is the regression form of Pesaran-Timmermann (hit indicator on the
#     forecast-sign indicator) with a HAC (Bartlett, lag h-1) t statistic, one-sided.
INFERENCE_RULE_VERSION = 2
PRIMARY_LOSS = "squared log-return error"
SECONDARY_LOSS = "absolute error, USD/t"

# Stress replay (P19, pre-registered 2026-11-08 before any episode outcome was computed).
# Selection rule: the five CBOT soybean episodes named by the review panel (risk and stats
# reviewers) as the market shocks a desk would replay, chosen for their narrative, not their
# size; no episode is added or removed after seeing its return. Each starts at the first CBOT
# session of its month and is replayed over each horizon h: the realized log return from that
# close to the last close on or before start + h months is applied to today's price. An episode
# window that has not fully happened is not shown. Illustrative scenarios, not probabilities.
STRESS_EPISODES: tuple[tuple[str, str, str], ...] = (
    ("2018-06", "Trade war", "China's retaliatory tariff on US soybeans, announced mid-June 2018."),
    ("2020-07", "China buying", "Record Chinese purchases of US new crop from the summer of 2020."),
    ("2021-05", "May 2021 correction", "The May 2021 peak and the fall that followed."),
    ("2022-02", "Ukraine invasion", "Russia's invasion of Ukraine on 24 February 2022."),
    ("2024-07", "2024 sell-off", "The July 2024 slide on a large US crop outlook."),
)
STRESS_HISTOGRAM_STEP = 0.025  # bin width of the full h-month return distribution (log return)

# Reference contract (P10 minimum step, 2026-11-08). The site's price is the Yahoo continuous
# front month; the contract a hedge would use for horizon h is the first soybean contract
# (F H K N Q U X) whose first notice day (last business day of the month before delivery) falls
# after the target date. A window "crosses a roll" when that contract differs from the one the
# same rule gives at the origin. Targets are not rebuilt on specific contracts (roadmap v2.1).
CONTRACT_LETTERS: dict[int, str] = {1: "F", 3: "H", 5: "K", 7: "N", 8: "Q", 9: "U", 11: "X"}

# Premium defaults: the derived monthly table is "stale" once its source series ended more
# than this many days before the forecast date.
STALE_PREMIUM_DAYS = 90
PREMIUM_PROFILE_FIRST_YEAR = 2015

# Release-day event study (v2.1, pre-registered 2026-11-07). The six revision coefficients are
# Holm-adjusted as one family; a coefficient is quoted as a headline only if its adjusted p is
# below REACTION_ALPHA. Expected signs (for flagging, never for dropping a coefficient):
REACTION_ALPHA = 0.05
REACTION_EXPECTED_SIGN: dict[str, int] = {
    "rev_us_soy_stu": -1,
    "rev_us_corn_stu": -1,
    "rev_br_soy_prod": -1,
    "rev_ar_soy_prod": -1,
    "rev_cn_soy_imports": 1,
    "rev_world_soy_es": -1,
}
# Robustness checks reported next to the main fit (the main fit is never replaced by them):
# placebo = the same regression on the one-session return ending PLACEBO_LAG_SESSIONS sessions
# before each release; split sample = reports before vs from SPLIT_SAMPLE_BREAK; roll
# exclusion = drop release days within ROLL_EXCLUSION_BDAYS business days of the last trading
# day (business day before the 15th) of any soybean contract (F, H, K, N, Q, U, X).
PLACEBO_LAG_SESSIONS = 5
SPLIT_SAMPLE_BREAK = pd.Timestamp("2018-01-01")
ROLL_EXCLUSION_BDAYS = 3
SOY_CONTRACT_MONTHS: tuple[int, ...] = (1, 3, 5, 7, 8, 9, 11)

# Champion rule: a model replaces the random walk at a horizon only if its Clark-West
# test against the random walk, Holm-adjusted (v2: across all 9 tests, see
# INFERENCE_RULE_VERSION), has p below this level.
CHAMPION_ALPHA = 0.10

# The pre-registered feature set (no data-driven feature selection).
FEATURES: tuple[str, ...] = (
    "us_soy_stu",
    "us_corn_stu",
    "rev_us_soy_stu",
    "rev_us_corn_stu",
    "rev_br_soy_prod",
    "rev_ar_soy_prod",
    "rev_cn_soy_imports",
    "rev_world_soy_es",
    "mom_1m",
    "mom_3m",
    "may_rollover",
)

# Data freshness (v2.1, P23). These change how the published data is labelled and gated,
# never a forecast. The CBOT soybean day session closes at 13:20 America/Chicago; the
# scheduled refresh runs at 19:45 UTC (13:45 CST / 14:45 CDT) and a guard in code skips
# any run that starts before CLOSE_GUARD_LOCAL on a Chicago weekday, whatever the season.
CBOT_TZ = "America/Chicago"
CLOSE_GUARD_LOCAL = (13, 30)
# The site shows a stale banner (and the refresh gate fails) once the as-of close is more
# than this many business days old.
STALE_CLOSE_BDAYS = 3
# Validation gate against the previously published data: a refresh may not lose more than
# this share of backtest rows or of weekly history points.
MAX_ROW_LOSS_SHARE = 0.02
# Outlook archive (P23): an outlook is archived only when it is built within this many
# business days of its as-of close (dated in Chicago). A later rebuild, for example an
# offline run on an old cache after closes beyond the as-of date are known, is published
# but never enters the unseen record, so the archive cannot be backfilled with hindsight.
ARCHIVE_MAX_LAG_BDAYS = 1

# Inputs (v2.1, P24). The WASDE history is pinned to one release tag of the WASDE Tracker and
# its sha256 in data/wasde.lock.json; a normal run downloads exactly that asset and rejects any
# other bytes. `--update-pin` (the scheduled refresh) resolves the latest tag, checks the new file
# against the cache, and rewrites the lock, so every change of input is a reviewable diff.
WASDE_RELEASES_URL = "https://github.com/rossi-diego/wasde-monthly-report/releases"
WASDE_ASSET = "wasde_full.parquet"
SOY_TICKER = "ZS=F"
PTAX_URL = "https://api.bcb.gov.br/dados/serie/bcdata.sgs.1/dados"
# A PTAX download only replaces the cache when every rate lies in this open BRL/USD range,
# no day-on-day move is larger than PTAX_MAX_DAILY_CHANGE, and it ends at or after the cache.
PTAX_BOUNDS: tuple[float, float] = (1.0, 15.0)
PTAX_MAX_DAILY_CHANGE = 0.15


@dataclass(frozen=True)
class Settings:
    """Runtime locations, overridable through environment variables."""

    data_dir: Path = field(default_factory=lambda: Path(os.getenv("SOY_DATA_DIR", ROOT / "data")))
    web_data_dir: Path = field(
        default_factory=lambda: Path(
            os.getenv("SOY_WEB_DATA_DIR", ROOT / "web" / "public" / "data")
        )
    )
    wasde_releases_url: str = field(
        default_factory=lambda: os.getenv("SOY_WASDE_RELEASES_URL", WASDE_RELEASES_URL)
    )
    # The pin is part of the repository, not of the data folder (CI points SOY_DATA_DIR elsewhere).
    wasde_lock: Path = field(
        default_factory=lambda: Path(os.getenv("SOY_WASDE_LOCK", ROOT / "data" / "wasde.lock.json"))
    )
    wasde_local: str | None = field(default_factory=lambda: os.getenv("SOY_WASDE_PARQUET") or None)
    offline: bool = field(default_factory=lambda: os.getenv("SOY_OFFLINE", "0") == "1")
    log_level: str = field(default_factory=lambda: os.getenv("SOY_LOG_LEVEL", "INFO"))

    @property
    def bronze(self) -> Path:
        return self.data_dir / "bronze"

    @property
    def silver(self) -> Path:
        return self.data_dir / "silver"

    @property
    def gold(self) -> Path:
        return self.data_dir / "gold"

    @property
    def premium_table(self) -> Path:
        """Derived 12-row monthly premium profile (the raw daily export is not in the repo)."""
        return self.data_dir / "seed" / "paranagua_premium_monthly.csv"

    @property
    def premium_card(self) -> Path:
        """Data card and provenance note for the derived premium table."""
        return self.data_dir / "seed" / "paranagua_premium_monthly.meta.json"

    def ensure(self) -> None:
        for p in (self.bronze, self.silver, self.gold, self.web_data_dir):
            p.mkdir(parents=True, exist_ok=True)
