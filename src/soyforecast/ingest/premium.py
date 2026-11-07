"""Seed: historical Paranaguá FOB soybean premium, US cents per bushel over CBOT.

The file was exported from a market terminal by the author; its original source and the
CBOT contract month each quote refers to are not recorded. It is used only for an
illustrative FOB backtest and to suggest a default premium per calendar month. There is no
public, licensed, machine-readable source of the FOB premium, so the seed stops in June 2025.
"""

from __future__ import annotations

from pathlib import Path

import pandas as pd

PREMIUM_LIMIT_C_BU = 300  # quotes at exactly +/-300 look like terminal placeholders


def load_premium(path: Path) -> pd.Series:
    df = pd.read_csv(path, parse_dates=["date"])
    s = df.set_index("date")["premium_c_bu"].astype("float64").sort_index()
    s = s[s.abs() < PREMIUM_LIMIT_C_BU]
    return s[~s.index.duplicated(keep="last")]


def monthly_premium_profile(premium: pd.Series, first_year: int = 2015) -> pd.DataFrame:
    """Median and 10th/90th percentile premium per calendar month, from first_year on."""
    p = premium[premium.index.year >= first_year]
    g = p.groupby(p.index.month)
    out = pd.DataFrame({"median": g.median(), "p10": g.quantile(0.10), "p90": g.quantile(0.90)})
    out.index.name = "month"
    return out
