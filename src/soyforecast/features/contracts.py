"""CBOT soybean contract calendar: the reference (hedge) contract per horizon (P10).

The published prices are the continuous front month, which quotes the nearest contract until
its last trading day and then rolls to the next one (Yahoo's ZS=F for history, each front
contract's own symbol for recent sessions; see `ingest.prices`). These helpers only label
which listed contract a horizon refers to and whether the series rolls inside the window;
targets are not rebuilt on specific contracts (roadmap v2.1).

Two different conventions, on purpose:
* the *front* contract is the one ZS=F quotes on a date: the first contract whose last trading
  day is on or after that date. A window "crosses a roll" when the front contract at the
  target differs from the one at the origin, i.e. the realized return partly measures a
  calendar spread (the same expiry convention as `dataset.crop_roll_dates`);
* the *reference* (hedge) contract for a target date is the first contract whose first notice
  day falls after it, so a hedge held to the target never enters the delivery period.
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


def _contract(year: int, month: int) -> dict[str, Any]:
    return {
        "code": f"{CONTRACT_LETTERS[month]}{year % 100:02d}",
        "delivery_month": f"{year}-{month:02d}",
        "first_notice": first_notice_day(year, month).date().isoformat(),
        "last_trade": last_trading_day(year, month).date().isoformat(),
    }


def _first_listed(when: pd.Timestamp, after: Any) -> dict[str, Any]:
    when = pd.Timestamp(when).normalize()
    for year in range(when.year, when.year + 3):
        for month in sorted(CONTRACT_LETTERS):
            if after(year, month, when):
                return _contract(year, month)
    raise ValueError(f"no soybean contract found after {when.date()}")  # pragma: no cover


def reference_contract(when: pd.Timestamp) -> dict[str, Any]:
    """The hedge contract for a target date: the first whose first notice day is after it."""
    return _first_listed(when, lambda y, m, w: first_notice_day(y, m) > w)


def front_contract(when: pd.Timestamp) -> dict[str, Any]:
    """The contract the continuous front month quotes on `when` (last trading day >= when)."""
    return _first_listed(when, lambda y, m, w: last_trading_day(y, m) >= w)


def crosses_roll(origin: pd.Timestamp, target: pd.Timestamp) -> bool:
    """True when the continuous front month rolls to another contract inside the window."""
    return bool(front_contract(origin)["code"] != front_contract(target)["code"])
