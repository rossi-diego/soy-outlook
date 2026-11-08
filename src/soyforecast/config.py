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
# test against the random walk, Holm-adjusted across horizons, has p below this level.
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

WASDE_RELEASE_URL = "https://github.com/rossi-diego/wasde-monthly-report/releases/latest/download/wasde_full.parquet"
SOY_TICKER = "ZS=F"
PTAX_URL = "https://api.bcb.gov.br/dados/serie/bcdata.sgs.1/dados"


@dataclass(frozen=True)
class Settings:
    """Runtime locations, overridable through environment variables."""

    data_dir: Path = field(default_factory=lambda: Path(os.getenv("SOY_DATA_DIR", ROOT / "data")))
    web_data_dir: Path = field(
        default_factory=lambda: Path(
            os.getenv("SOY_WEB_DATA_DIR", ROOT / "web" / "public" / "data")
        )
    )
    wasde_url: str = field(default_factory=lambda: os.getenv("SOY_WASDE_URL", WASDE_RELEASE_URL))
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
