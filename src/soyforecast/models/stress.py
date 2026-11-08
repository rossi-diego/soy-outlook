"""Historical stress replay (P19): realized h-month CBOT returns of fixed episodes, applied to
today's price, next to the full distribution of h-month returns.

Illustrative scenarios, not probabilities. The episode list, its selection rule and the start
convention are pre-registered in config.STRESS_EPISODES; only returns that have fully happened
(end date on or before the last close) are used.
"""

from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd

from soyforecast.config import HORIZONS, STRESS_EPISODES, STRESS_HISTOGRAM_STEP
from soyforecast.features.dataset import close_on_or_before
from soyforecast.units import c_bu_to_usd_t, usd_t_to_brl_sack

DIST_QUANTILES = (0.01, 0.05, 0.10, 0.25, 0.50, 0.75, 0.90, 0.95, 0.99)


def episode_return(prices: pd.Series, start_month: str, h: int) -> dict[str, Any] | None:
    """Realized log return from the first session of `start_month` to the last close on or
    before start + h months, or None if that window has not fully happened."""
    prices = prices.sort_index()
    month = pd.Period(start_month, freq="M")
    in_month = prices[(prices.index >= month.start_time) & (prices.index <= month.end_time)]
    if in_month.empty:
        return None
    start, p0 = in_month.index[0], float(in_month.iloc[0])
    end_target = start + pd.DateOffset(months=h)
    if end_target > prices.index.max():
        return None
    end = close_on_or_before(prices, end_target)
    if end is None:  # pragma: no cover - start exists, so an end on or before it exists
        return None
    return {
        "start": start,
        "end": end[0],
        "logret": float(np.log(end[1] / p0)),
    }


def h_month_returns(prices: pd.Series, h: int) -> pd.Series:
    """Every realized h-month log return, one per session start (overlapping windows)."""
    p = prices.sort_index().astype(float)
    ends = pd.DatetimeIndex(p.index) + pd.DateOffset(months=h)
    ok = ends <= p.index.max()
    idx = p.index.searchsorted(ends[ok], side="right") - 1
    return pd.Series(np.log(p.to_numpy()[idx] / p.to_numpy()[ok]), index=p.index[ok])


def _distribution(r: pd.Series) -> dict[str, Any]:
    step = STRESS_HISTOGRAM_STEP
    lo = np.floor(r.min() / step) * step
    hi = np.ceil(r.max() / step) * step
    edges = np.round(np.arange(lo, hi + step / 2, step), 6)
    counts, _ = np.histogram(r.to_numpy(), bins=edges)
    return {
        "n": len(r),
        "first": r.index.min(),
        "last_start": r.index.max(),
        "quantiles": {
            f"q{round(q * 100):02d}": round(float(r.quantile(q)), 4) for q in DIST_QUANTILES
        },
        "bin_step": step,
        "bin_edges": [float(e) for e in edges],
        "counts": [int(c) for c in counts],
    }


def stress_replay(prices: pd.Series, p_now_c_bu: float, fx_now: float) -> dict[str, Any]:
    """Each pre-registered episode's realized h-month return applied to today's CBOT price."""
    out_h: list[dict[str, Any]] = []
    for h in HORIZONS:
        dist = h_month_returns(prices, h)
        episodes = []
        for month, name, why in STRESS_EPISODES:
            ep = episode_return(prices, month, h)
            if ep is None:
                continue
            c_bu = p_now_c_bu * float(np.exp(ep["logret"]))
            usd_t = c_bu_to_usd_t(c_bu)
            episodes.append(
                {
                    "id": month,
                    "name": name,
                    "rationale": why,
                    "start": ep["start"],
                    "end": ep["end"],
                    "logret": round(ep["logret"], 4),
                    "pct": round(float(np.expm1(ep["logret"])) * 100, 1),
                    "percentile": round(float((dist <= ep["logret"]).mean()) * 100, 1),
                    "c_bu": round(c_bu, 2),
                    "usd_t": round(usd_t, 2),
                    "brl_sack": round(usd_t_to_brl_sack(usd_t, fx_now), 2),
                }
            )
        out_h.append({"h": h, "episodes": episodes, "distribution": _distribution(dist)})
    return {
        "label": "illustrative scenarios, not probabilities",
        "rule": (
            "Five episodes named before any outcome was computed; each starts at the first CBOT "
            "session of its month; the realized h-month return is applied to today's price."
        ),
        "basis": "CBOT only: premium and BRL/USD held at today's values",
        "p0_c_bu": round(p_now_c_bu, 2),
        "fx": round(fx_now, 4),
        "horizons": out_h,
    }
