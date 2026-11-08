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
    def premium_seed(self) -> Path:
        return self.data_dir / "seed" / "paranagua_premium.csv"

    def ensure(self) -> None:
        for p in (self.bronze, self.silver, self.gold, self.web_data_dir):
            p.mkdir(parents=True, exist_ok=True)
