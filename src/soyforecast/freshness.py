"""Freshness: where each input came from, how old the data is, and when a refresh may run.

Nothing here touches a forecast. It labels the published data (meta.json "freshness"),
guards the scheduled refresh against running before the CBOT close in either season,
and gives the site's stale banner the facts it needs.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import UTC, date, datetime, time, timedelta
from typing import Any, Literal
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd

from soyforecast.config import CBOT_TZ, CLOSE_GUARD_LOCAL, STALE_CLOSE_BDAYS

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


def cbot_closed_today(now: datetime | None = None) -> bool:
    """True on a Chicago weekday once the local clock has passed the close guard.

    Exchange holidays are not modelled: on those days the run finds no new close and the
    validation gate leaves the published data as it is.
    """
    local = chicago_now(now)
    return local.weekday() < 5 and local.time() >= time(*CLOSE_GUARD_LOCAL)


def settled_through(now: datetime | None = None) -> date:
    """The latest Chicago weekday whose CBOT day session has closed (CLOSE_GUARD_LOCAL passed).

    Any bar dated after this is an unfinished session. This is a date cut only: Yahoo dates
    ZS=F bars by the New York calendar day, so from 19:00 CT (Globex reopens) to 23:00 CT the
    bar dated today also moves with overnight trades, and the newest bar can be the last trade
    rather than the settlement. Exchange holidays are not modelled; on those days there is
    simply no bar to take.
    """
    local = chicago_now(now)
    day = local.date()
    if local.weekday() < 5 and local.time() >= time(*CLOSE_GUARD_LOCAL):
        return day
    day -= timedelta(days=1)
    while day.weekday() >= 5:
        day -= timedelta(days=1)
    return day


def close_to_publish(as_of_close: str | None, now: datetime | None = None) -> bool:
    """Close guard: True when a settled session is newer than the published close.

    A catch-up rule rather than "after the close today": a scheduled run that GitHub delays
    past Chicago midnight still picks up the previous session instead of skipping it.
    """
    if not as_of_close:
        return True
    return settled_through(now).isoformat() > str(as_of_close)[:10]


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
