"""Bronze: daily CBOT soybean closes (Yahoo continuous front month) with a validated cache.

The checks follow rossi-diego/soybean-crush-margin (src/data_loader.py): a download only
replaces the cache when its prices are finite and positive, contain no unit jump, keep most
of the cached history and are not rescaled against it. Otherwise the cache is used.
"""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path

import numpy as np
import pandas as pd

from soyforecast.config import SOY_TICKER
from soyforecast.errors import InputDataError
from soyforecast.freshness import SourceLog
from soyforecast.ingest._cache import atomic_write_parquet, write_snapshot
from soyforecast.logs import get_logger

log = get_logger(__name__)

MAX_ABS_LOG_RETURN = float(np.log(2))
MIN_ROW_SHARE_OF_CACHE = 0.9
MAX_CACHE_RATIO_DRIFT = 0.02
START = "2004-01-01"


class PriceDataError(InputDataError):
    pass


def _download_yahoo(ticker: str, start: str) -> pd.Series:
    import yfinance as yf

    raw = yf.download(ticker, start=start, progress=False, auto_adjust=False, threads=False)
    if raw is None or raw.empty:
        return pd.Series(dtype="float64")
    close = raw["Close"]
    if isinstance(close, pd.DataFrame):
        close = close.iloc[:, 0]
    close.index = pd.DatetimeIndex(close.index).tz_localize(None).normalize()
    return close.astype("float64").dropna()


def price_problems(new: pd.Series, cached: pd.Series | None) -> list[str]:
    """Reasons a downloaded series must not replace the cache (empty list = accept)."""
    if new.empty:
        return ["no values"]
    problems: list[str] = []
    values = new.to_numpy()
    if not (np.isfinite(values) & (values > 0)).all():
        problems.append("non-positive or non-finite prices")
    elif np.abs(np.diff(np.log(values))).max(initial=0.0) > MAX_ABS_LOG_RETURN:
        problems.append("unit jump")
    if cached is not None and not cached.empty:
        if len(new) < MIN_ROW_SHARE_OF_CACHE * len(cached):
            problems.append("too few rows against the cache")
        if new.index.max() < cached.index.max():
            problems.append("ends before the cache")
        shared = new.index.intersection(cached.index)
        if len(shared):
            ratio = float((new.loc[shared] / cached.loc[shared]).median())
            if abs(ratio - 1) > MAX_CACHE_RATIO_DRIFT:
                problems.append("rescaled against the cache")
    return problems


def fetch_soy_prices(
    bronze: Path,
    offline: bool = False,
    downloader: Callable[[str, str], pd.Series] = _download_yahoo,
    sources: SourceLog | None = None,
) -> pd.Series:
    """Daily ZS=F closes in US cents per bushel, indexed by session date."""
    path = bronze / "zs_daily.parquet"
    cached = pd.read_parquet(path)["close_c_bu"] if path.exists() else None
    if offline:
        if cached is None:
            raise PriceDataError("offline mode and no price cache")
        if sources is not None:
            sources.record("prices", "offline", cached.index.max())
        return cached
    try:
        new = downloader(SOY_TICKER, START)
    except Exception as exc:  # network, parsing, rate limit: fall back to the cache
        new = pd.Series(dtype="float64")
        log.warning("prices.download_failed", error=str(exc))
    problems = price_problems(new, cached)
    if problems:
        if cached is None:
            raise PriceDataError(f"price download rejected: {problems}")
        log.warning("prices.using_cache", problems=problems, last=str(cached.index.max().date()))
        if sources is not None:
            sources.record("prices", "cache", cached.index.max(), "; ".join(problems))
        return cached
    new = new.rename("close_c_bu")
    new.index.name = "date"
    atomic_write_parquet(new.to_frame(), path)
    write_snapshot(path)
    if sources is not None:
        sources.record("prices", "live", new.index.max())
    log.info(
        "prices.ready",
        rows=len(new),
        first=str(new.index.min().date()),
        last=str(new.index.max().date()),
    )
    return new
