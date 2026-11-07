"""Gold: the modelling table. One row per WASDE release (the forecast origin).

Information set at origin t: the WASDE released at 12:00 ET on t and every CBOT close up to
and including the close of t (13:20 CT, after the report). Targets are log returns of the
front-month close from t to the last session on or before t + h calendar months. A target is
"realized" only once its date is on or before the last available close; until then it is NaN.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from pandas.tseries.offsets import BDay

from soyforecast.config import FEATURES, HORIZONS

# CBOT soybean contracts whose expiry carries the old-crop / new-crop spread into the
# continuous series (July, August, September); the jump is a calendar spread, not a move.
CROP_ROLL_MONTHS = (7, 8, 9)


def close_on_or_before(prices: pd.Series, when: pd.Timestamp) -> tuple[pd.Timestamp, float] | None:
    """The last close dated on or before `when`."""
    idx = prices.index.searchsorted(when, side="right") - 1
    if idx < 0:
        return None
    return prices.index[idx], float(prices.iloc[idx])


def crop_roll_dates(start: int, end: int) -> pd.DatetimeIndex:
    """Last trading day (business day before the 15th) of Jul/Aug/Sep soybean contracts."""
    return pd.DatetimeIndex(
        [pd.Timestamp(y, m, 15) - BDay(1) for y in range(start, end + 1) for m in CROP_ROLL_MONTHS]
    )


def crosses_crop_roll(origin: pd.Timestamp, target: pd.Timestamp, rolls: pd.DatetimeIndex) -> bool:
    return bool(((rolls >= origin) & (rolls < target)).any())


def _momentum(prices: pd.Series, anchor: pd.Timestamp, p0: float, months: int) -> float:
    past = close_on_or_before(prices, anchor - pd.DateOffset(months=months))
    return float(np.log(p0 / past[1])) if past else np.nan


def build_dataset(vintages: pd.DataFrame, prices: pd.Series) -> pd.DataFrame:
    """Join vintages to prices without look-ahead and attach the h-month targets."""
    prices = prices.sort_index()
    last_close = prices.index.max()
    rolls = crop_roll_dates(prices.index.min().year, last_close.year + 1)
    rows = []
    for month, v in vintages.iterrows():
        origin = pd.Timestamp(v["release_date"])
        anchor = close_on_or_before(prices, origin)
        if anchor is None:
            continue
        anchor_date, p0 = anchor
        row: dict[str, object] = {
            "report_month": month,
            "origin": origin,
            "anchor_date": anchor_date,
            "p0_c_bu": p0,
            "mom_1m": _momentum(prices, anchor_date, p0, 1),
            "mom_3m": _momentum(prices, anchor_date, p0, 3),
        }
        for f in FEATURES:
            if f not in row:
                row[f] = v[f]
        for h in HORIZONS:
            target_date = origin + pd.DateOffset(months=h)
            row[f"target_date_{h}"] = target_date
            row[f"crop_roll_{h}"] = crosses_crop_roll(origin, target_date, rolls)
            realized = (
                close_on_or_before(prices, target_date) if target_date <= last_close else None
            )
            row[f"pT_c_bu_{h}"] = realized[1] if realized else np.nan
            row[f"y_{h}"] = float(np.log(realized[1] / p0)) if realized else np.nan
        rows.append(row)
    df = pd.DataFrame(rows).set_index("report_month")
    return df.dropna(subset=["mom_3m"])


def live_row(vintages: pd.DataFrame, prices: pd.Series) -> pd.Series:
    """Features for today's forecast: the latest WASDE plus the latest close as anchor."""
    prices = prices.sort_index()
    anchor_date = prices.index.max()
    p0 = float(prices.iloc[-1])
    known = vintages[vintages["release_date"] <= anchor_date]
    v = known.iloc[-1]
    row = {f: v[f] for f in FEATURES if f in v.index}
    row.update(
        {
            "report_month": known.index[-1],
            "origin": anchor_date,
            "anchor_date": anchor_date,
            "release_date": pd.Timestamp(v["release_date"]),
            "p0_c_bu": p0,
            "mom_1m": _momentum(prices, anchor_date, p0, 1),
            "mom_3m": _momentum(prices, anchor_date, p0, 3),
        }
    )
    return pd.Series(row)
