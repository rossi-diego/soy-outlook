"""Trailing daily volatility of the CBOT close, known at each close (P2).

Both series are indexed by session date and use returns up to and including that session
only, so `vol_at(series, origin)` never looks past the origin close.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from soyforecast.config import EWMA_BURN_SESSIONS, EWMA_LAMBDA, RV_WINDOW


def daily_log_returns(prices: pd.Series) -> pd.Series:
    p = prices.sort_index().astype(float)
    return pd.Series(np.log(p.to_numpy()), index=p.index).diff().dropna()


def ewma_vol(
    prices: pd.Series, lam: float = EWMA_LAMBDA, burn: int = EWMA_BURN_SESSIONS
) -> pd.Series:
    """RiskMetrics EWMA daily vol: var_t = lam var_{t-1} + (1 - lam) r_t^2.

    Seeded with the mean squared return of the first `burn` sessions and undefined (NaN)
    before that, so no value depends on a later return.
    """
    r = daily_log_returns(prices)
    r2 = r.to_numpy() ** 2
    out = np.full(len(r2), np.nan)
    if len(r2) >= burn:
        var = float(r2[:burn].mean())
        out[burn - 1] = var
        for i in range(burn, len(r2)):
            var = lam * var + (1 - lam) * r2[i]
            out[i] = var
    return pd.Series(np.sqrt(out), index=r.index, name="vol_ewma")


def realized_vol(prices: pd.Series, window: int = RV_WINDOW) -> pd.Series:
    """Trailing realized daily vol: sample sd of the last `window` daily log returns."""
    r = daily_log_returns(prices)
    return r.rolling(window, min_periods=window).std(ddof=1).rename("vol_rv")


def vol_at(vol: pd.Series, when: pd.Timestamp) -> float:
    """The vol known at the close on or before `when` (NaN if none yet)."""
    i = int(vol.index.searchsorted(when, side="right")) - 1
    return float(vol.iloc[i]) if i >= 0 else float("nan")
