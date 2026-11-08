"""CBOT soybean contract calendar: the reference (hedge) contract per horizon (P10).

The published prices are the Yahoo continuous front month, which rolls between contracts.
These helpers only label which listed contract a horizon refers to and whether the window
crosses a roll; targets are not rebuilt on specific contracts (roadmap v2.1).
"""

from __future__ import annotations

from typing import Any

import pandas as pd
from pandas.tseries.offsets import BDay

from soyforecast.config import CONTRACT_LETTERS


def first_notice_day(year: int, month: int) -> pd.Timestamp:
    """Last business day of the month before the delivery month."""
    return pd.Timestamp(year, month, 1) - BDay(1)


def last_trading_day(year: int, month: int) -> pd.Timestamp:
    """Business day before the 15th of the delivery month."""
    return pd.Timestamp(year, month, 15) - BDay(1)


def reference_contract(when: pd.Timestamp) -> dict[str, Any]:
    """The first soybean contract whose first notice day falls after `when`."""
    when = pd.Timestamp(when)
    for year in range(when.year, when.year + 3):
        for month, letter in sorted(CONTRACT_LETTERS.items()):
            fnd = first_notice_day(year, month)
            if fnd > when:
                return {
                    "code": f"{letter}{year % 100:02d}",
                    "delivery_month": f"{year}-{month:02d}",
                    "first_notice": fnd.date().isoformat(),
                    "last_trade": last_trading_day(year, month).date().isoformat(),
                }
    raise ValueError(f"no soybean contract found after {when.date()}")  # pragma: no cover


def crosses_roll(origin: pd.Timestamp, target: pd.Timestamp) -> bool:
    """True when the reference contract at the target differs from the one at the origin."""
    return bool(reference_contract(origin)["code"] != reference_contract(target)["code"])
