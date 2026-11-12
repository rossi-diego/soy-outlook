"""Freshness: where each input came from, how old the data is, and when a refresh may run.

Nothing here touches a forecast. It labels the published data (meta.json "freshness"),
guards the scheduled refresh against running before the CBOT close in either season,
and gives the site's stale banner the facts it needs.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import UTC, date, datetime, time, timedelta
from functools import lru_cache
from typing import Any, Literal
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd

from soyforecast.config import CBOT_TZ, STALE_CLOSE_BDAYS

# live    - downloaded in this run and accepted by the checks;
# offline - the cache was used on purpose (--offline or a local file);
# cache   - a download was attempted and failed or was rejected, so the cache was used.
Status = Literal["live", "offline", "cache"]


@dataclass
class SourceStatus:
    status: Status
    last: str | None = None
    detail: str | None = None


@dataclass
class SourceLog:
    """Collects one status per input source during a pipeline run."""

    sources: dict[str, SourceStatus] = field(default_factory=dict)

    def record(
        self, name: str, status: Status, last: Any = None, detail: str | None = None
    ) -> None:
        last_s = None
        if last is not None:
            last_s = pd.Timestamp(last).date().isoformat() if not isinstance(last, str) else last
        self.sources[name] = SourceStatus(status, last_s, detail)

    @property
    def degraded(self) -> list[str]:
        """Sources that fell back to the cache after a failed or rejected download."""
        return sorted(k for k, v in self.sources.items() if v.status == "cache")

    def as_dict(self) -> dict[str, dict[str, Any]]:
        return {k: asdict(v) for k, v in sorted(self.sources.items())}


def business_days_between(start: Any, end: Any) -> int:
    """Weekdays after `start` up to and including `end` (0 when end <= start)."""
    a = pd.Timestamp(start).date()
    b = pd.Timestamp(end).date()
    if b <= a:
        return 0
    one = timedelta(days=1)
    # busday_count counts [first, last); shifting both ends by a day counts (start, end].
    return int(np.busday_count(a + one, b + one, weekmask="1111100"))


def chicago_now(now: datetime | None = None) -> datetime:
    now = now or datetime.now(UTC)
    if now.tzinfo is None:
        now = now.replace(tzinfo=UTC)
    return now.astimezone(ZoneInfo(CBOT_TZ))


def _nth_weekday(year: int, month: int, weekday: int, n: int) -> date:
    first = date(year, month, 1)
    return first + timedelta(days=(weekday - first.weekday()) % 7 + 7 * (n - 1))


def _last_weekday(year: int, month: int, weekday: int) -> date:
    last = date(year + month // 12, month % 12 + 1, 1) - timedelta(days=1)
    return last - timedelta(days=(last.weekday() - weekday) % 7)


def _easter(year: int) -> date:
    """Gregorian Easter Sunday (anonymous Gregorian algorithm)."""
    a, b, c = year % 19, year // 100, year % 100
    d, e = divmod(b, 4)
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i, k = divmod(c, 4)
    m = (32 + 2 * e + 2 * i - h - k) % 7
    n = (a + 11 * h + 22 * m) // 451
    month, day = divmod(h + m - 7 * n + 114, 31)
    return date(year, month, day + 1)


def _observed(day: date) -> date:
    """A fixed-date holiday on a weekend is observed on the nearest weekday."""
    if day.weekday() == 5:
        return day - timedelta(days=1)
    if day.weekday() == 6:
        return day + timedelta(days=1)
    return day


@lru_cache(maxsize=64)
def cbot_holidays(year: int) -> frozenset[date]:
    """Weekdays the CBOT grain markets are closed for a full day (no session, no Yahoo bar).

    The standing US exchange holidays: New Year's Day (not moved back into the previous year
    when it falls on a Saturday), Martin Luther King Jr. Day, Presidents' Day, Good Friday,
    Memorial Day, Juneteenth (from 2022), Independence Day, Labor Day, Thanksgiving and
    Christmas. Checked against every ZS=F bar since 2007; one-off closures (a state funeral,
    a hurricane) are not modelled and only delay a publication by one run.
    """
    days = {
        _nth_weekday(year, 1, 0, 3),
        _nth_weekday(year, 2, 0, 3),
        _easter(year) - timedelta(days=2),
        _last_weekday(year, 5, 0),
        _observed(date(year, 7, 4)),
        _nth_weekday(year, 9, 0, 1),
        _nth_weekday(year, 11, 3, 4),
        _observed(date(year, 12, 25)),
    }
    if date(year, 1, 1).weekday() != 5:
        days.add(_observed(date(year, 1, 1)))
    if year >= 2022:
        days.add(_observed(date(year, 6, 19)))
    return frozenset(days)


def is_session(day: date) -> bool:
    """True when `day` is a CBOT trading day (a weekday that is not an exchange holiday)."""
    return day.weekday() < 5 and day not in cbot_holidays(day.year)


def previous_session(day: date) -> date:
    """The last CBOT trading day before `day`."""
    day -= timedelta(days=1)
    while not is_session(day):
        day -= timedelta(days=1)
    return day


def final_through(now: datetime | None = None) -> date:
    """The latest session whose Yahoo daily bar is final: the last session before today in Chicago.

    A bar dated today is never final, at any hour. Yahoo dates futures bars by the New York
    calendar day and keeps rewriting the newest one: before the 13:20 CT close it is the live
    session, after it the last trade rather than the settlement, and from 19:00 CT (Globex
    reopens) to 23:00 CT it moves with overnight trades. Every published close is therefore a
    previous day's settlement, taken the morning after. Exchange holidays (`cbot_holidays`) are
    skipped: the day after Thanksgiving, the newest final session is the Wednesday.
    """
    return previous_session(chicago_now(now).date())


# CBOT grains trade a day session that closes at 13:20 CT and an overnight session that opens at
# 19:00 CT for the next trade date (Sunday 19:00 opens Monday's).
SESSION_OPEN_LOCAL = time(19, 0)


def trade_date(now: datetime | None = None) -> date:
    """The trade date of the latest session that has opened (Chicago).

    19:00 CT Sunday to Thursday opens the next weekday's session; from Friday 19:00 to Sunday
    19:00 the latest session is still Friday's. A date that is not a session (a weekend, an
    exchange holiday) maps back to the last session before it.
    """
    local = chicago_now(now)
    day = local.date()
    if local.time() >= SESSION_OPEN_LOCAL and local.weekday() in (6, 0, 1, 2, 3):
        day += timedelta(days=1)
    while not is_session(day):
        day -= timedelta(days=1)
    return day


def close_to_publish(as_of_close: str | None, now: datetime | None = None) -> bool:
    """Close guard: True when a final session is newer than the published close.

    A catch-up rule rather than a time window: a run that GitHub delays by hours, or one
    started by hand, publishes the newest final session and nothing else.
    """
    if not as_of_close:
        return True
    return final_through(now).isoformat() > str(as_of_close)[:10]


def is_wasde_day(next_release: str | None, now: datetime | None = None) -> bool:
    """True when the Chicago date is the scheduled WASDE release date."""
    if not next_release:
        return False
    return chicago_now(now).date().isoformat() == str(next_release)[:10]


def freshness_block(
    as_of_close: Any,
    generated_at: datetime,
    next_wasde: str | None,
    sources: SourceLog,
    offline: bool,
) -> dict[str, Any]:
    """meta.json "freshness": what the site's banner and the refresh gate read."""
    gen_local = chicago_now(generated_at).date()
    degraded = sources.degraded
    return {
        "as_of_close": pd.Timestamp(as_of_close).date().isoformat(),
        "generated_at": generated_at.astimezone(UTC).isoformat(timespec="seconds"),
        "mode": "offline" if offline else "live",
        "stale_after_bdays": STALE_CLOSE_BDAYS,
        "bdays_close_to_generated": business_days_between(as_of_close, gen_local),
        "next_wasde": next_wasde,
        "sources": sources.as_dict(),
        "degraded": bool(degraded),
        "degraded_sources": degraded,
    }
