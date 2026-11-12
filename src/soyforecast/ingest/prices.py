"""Bronze: daily CBOT soybean settlements, front month by last trading day, with a validated cache.

The series is the same one the models were built on: the continuous front month, i.e. the
nearest contract, unadjusted, rolling on its last trading day (`features.contracts.price_contract`).
History comes from Yahoo's continuous symbol ZS=F. Its recent bars are not reliable, though:
Yahoo moves ZS=F to the liquid next contract before the front expires (so for a few weeks the
newest bars quote another contract than the history) and rewrites those bars later. Over the
last PRICE_CONTRACT_WINDOW_BDAYS business days each session is therefore read from the front
contract's own symbol (e.g. ZSX26.CBT), only final bars are kept (`final_through`: a bar
dated today is never final), and the newest session is replaced by its settlement from the
contract's quote or held back (`confirm_newest_settlement`).

The checks follow rossi-diego/soybean-crush-margin (src/data_loader.py): a download only
replaces the cache when its prices are finite and positive, contain no unit jump, keep most
of the cached history and are not rescaled against it. Otherwise the cache is used.
"""

from __future__ import annotations

import json
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path

import numpy as np
import pandas as pd
from pandas.tseries.offsets import BDay

from soyforecast.config import (
    PRICE_CONTRACT_WINDOW_BDAYS,
    PRICE_REQUIRE_CONTRACT_BDAYS,
    SOY_TICKER,
)
from soyforecast.errors import InputDataError
from soyforecast.features.contracts import price_contract
from soyforecast.freshness import (
    SourceLog,
    bar_is_settlement,
    final_through,
    is_session,
    previous_session,
    trade_date,
    trading_session,
)
from soyforecast.ingest._cache import atomic_write_parquet, write_snapshot
from soyforecast.logs import get_logger

log = get_logger(__name__)

MAX_ABS_LOG_RETURN = float(np.log(2))
MIN_ROW_SHARE_OF_CACHE = 0.9
MAX_CACHE_RATIO_DRIFT = 0.02
START = "2004-01-01"
CACHE_FILE = "zs_daily.parquet"
# Sidecar written with the cache: up to which date its rows were final when stored.
CACHE_META = "zs_daily.meta.json"


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


Quote = tuple[float | None, datetime | None]


def _quote_yahoo(symbol: str) -> Quote:
    """(previous close, time of the last trade) of a contract from Yahoo's chart metadata.

    With a one-day range, the chart's `chartPreviousClose` is the previous session's
    settlement (it matched `.info`'s regularMarketPreviousClose and the settled bar on every
    probe), from the same chart endpoint as the daily bars and without the quoteSummary call
    that needs a crumb. Never `fast_info`: it is built from the daily bars.
    """
    import yfinance as yf

    ticker = yf.Ticker(symbol)
    ticker.history(period="1d", interval="1d", auto_adjust=False)
    meta = ticker.history_metadata or {}
    prev, when = meta.get("chartPreviousClose"), meta.get("regularMarketTime")
    return (float(prev) if prev is not None else None), _as_utc(when)


def _as_utc(when: object) -> datetime | None:
    """A quote time as an aware UTC datetime: yfinance returns a Timestamp, the raw API epoch s."""
    if when is None or when == "":
        return None
    if isinstance(when, int | float):
        return datetime.fromtimestamp(int(when), tz=UTC)
    ts = (
        pd.Timestamp(str(when))
        if not isinstance(when, pd.Timestamp | datetime)
        else pd.Timestamp(when)
    )
    ts = ts.tz_localize(UTC) if ts.tzinfo is None else ts.tz_convert(UTC)
    return ts.to_pydatetime()


Issue = tuple[pd.Timestamp, str]
# The one issue a legacy-cache rebuild may raise on sessions it had already published: their
# Friday settlements are gone from Yahoo, so the bar is the best value left (logged only).
UNCONFIRMED = "settlement not confirmed in time"


def confirm_newest_settlement(
    series: pd.Series,
    new_days: list[pd.Timestamp],
    quote: Callable[[str], Quote],
    now: datetime | None = None,
) -> tuple[pd.Series, list[Issue]]:
    """Settle the sessions this run adds to the series (`new_days`), or hold the newest back.

    A Monday-to-Thursday bar (not the eve of a holiday) is the settlement once final
    (`bar_is_settlement`). A Friday's or pre-holiday session's bar keeps the last trade; its
    settlement is only in the next session's quote, as the previous close. So:

    * the newest new session takes the quote's previous close when the quote's last trade is in
      the session trading now (`trading_session`, which also excludes the afternoon and
      evening, when the previous close is not relied on) and that session directly follows it
      (`previous_session`, holidays skipped); otherwise its bar if that is the settlement;
      otherwise it is held back for a later run (an issue, which alerts, if the quote could
      not be read at all while it should have been);
    * an older new session whose bar is not the settlement can no longer be confirmed (the
      session that carried its settlement is over): its bar is kept, with an issue.

    Returns the series and the issues, as (session, message).
    """
    if series.empty or not new_days:
        return series, []
    issues: list[Issue] = []
    for d in new_days[:-1]:
        if not bar_is_settlement(d.date()):
            issues.append((d, f"{d.date()} {UNCONFIRMED}: last trade used"))
            log.warning("prices.unconfirmed_session", date=str(d.date()))
    newest = new_days[-1]
    code = price_contract(newest)["code"]
    session = trading_session(now)
    settle: float | None = None
    stamp: datetime | None = None
    if session is not None:
        try:
            settle, stamp = quote(contract_symbol(code))
        except Exception as exc:  # network, rate limit, delisted symbol
            log.warning("prices.quote_failed", contract=code, error=str(exc))
    usable = settle is not None and bool(np.isfinite(settle)) and settle > 0 and stamp is not None
    quote_session = trade_date(stamp) if stamp is not None else None
    if (
        usable
        and settle is not None
        and session is not None
        and quote_session == session
        and previous_session(session) == newest.date()
    ):
        bar = float(series.loc[newest])
        if abs(bar - settle) > 0.001:
            log.info(
                "prices.bar_replaced_by_settlement", date=str(newest.date()), bar=bar, settle=settle
            )
        series = series.copy()
        series[series.index == newest] = float(settle)
        return series, issues
    if bar_is_settlement(newest.date()):
        log.info("prices.newest_bar_is_settlement", date=str(newest.date()), contract=code)
        return series, issues
    reason = "quote unavailable" if session is not None and not usable else "not in its quote yet"
    log.warning(
        "prices.newest_held_back",
        date=str(newest.date()),
        contract=code,
        trading_session=str(session),
        quote_session=str(quote_session),
        reason=reason,
    )
    if reason == "quote unavailable":
        issues.append(
            (newest, f"{contract_symbol(code)} quote unavailable: {newest.date()} held back")
        )
    return series.drop(newest), issues


def contract_symbol(code: str) -> str:
    """Yahoo symbol of a soybean contract, e.g. 'F27' -> 'ZSF27.CBT'."""
    return f"ZS{code}.CBT"


def drop_unfinal(series: pd.Series, now: datetime | None = None) -> pd.Series:
    """Keep only final sessions (`final_through`); Yahoo also returns today's moving bar."""
    if series.empty:
        return series
    cutoff = pd.Timestamp(final_through(now))
    late = series.index > cutoff
    if late.any():
        log.info(
            "prices.unfinal_dropped",
            dates=[str(d.date()) for d in series.index[late]],
            final_through=str(cutoff.date()),
        )
    return series[~late]


def _safe_download(
    downloader: Callable[[str, str], pd.Series], ticker: str, start: str
) -> pd.Series:
    try:
        s = downloader(ticker, start)
    except Exception as exc:  # network, parsing, rate limit, delisted symbol
        log.warning("prices.download_failed", ticker=ticker, error=str(exc))
        return pd.Series(dtype="float64")
    s = s.sort_index().astype("float64").dropna()
    return s[~s.index.duplicated(keep="last")]  # yfinance sometimes repeats the last row


def stitch_front_contracts(
    base: pd.Series,
    downloader: Callable[[str, str], pd.Series],
    now: datetime | None = None,
    trusted: pd.Series | None = None,
    published: pd.Series | None = None,
) -> tuple[pd.Series, list[pd.Timestamp], list[Issue]]:
    """The cached final series extended with the sessions after it, read from their contract.

    Sessions in the cache (`trusted`) are final and never replaced. Without a cache the series
    starts as ZS=F up to PRICE_CONTRACT_WINDOW_BDAYS sessions back. Each later session up to
    `final_through` comes, in order of preference, from its contract's own symbol
    (`price_contract`), from ZS=F if it is older than PRICE_REQUIRE_CONTRACT_BDAYS sessions,
    or from ZS=F with an issue if its contract has expired and Yahoo no longer lists it. A
    session with none of these ends the series before it (an issue), so a contract-mixed ZS=F
    bar is never published quietly.

    `published` (the whole cached series, final or not) comes right after the contract's own
    bar: rebuilding a legacy cache keeps what was published for a contract Yahoo dropped.

    Returns the series, the sessions added after the cache, and the issues.
    """
    cutoff = pd.Timestamp(final_through(now))
    base = base[base.index <= cutoff]
    window_start = cutoff - BDay(PRICE_CONTRACT_WINDOW_BDAYS)
    require_start = cutoff - BDay(PRICE_REQUIRE_CONTRACT_BDAYS - 1)
    trusted = trusted[trusted.index <= cutoff] if trusted is not None else None
    if trusted is not None and not trusted.empty:
        # Every session after the cache is filled below, however old the cache is.
        head = trusted
        fill_start = trusted.index.max() + pd.Timedelta(days=1)
    else:
        head = base[base.index < window_start]
        fill_start = window_start

    codes = sorted({price_contract(d)["code"] for d in pd.bdate_range(fill_start, cutoff)})
    start = fill_start.date().isoformat()
    by_code = {c: _safe_download(downloader, contract_symbol(c), start) for c in codes}
    seen = set(base.index[base.index >= fill_start]) | {
        d for s in by_code.values() for d in s.index if fill_start <= d <= cutoff
    }
    # Every calendar session up to the newest date any source has, plus any other date a
    # download has: a session missing from every source is reported, not skipped silently.
    calendar = pd.bdate_range(fill_start, max(seen)) if seen else pd.DatetimeIndex([])
    days = sorted(seen | {d for d in calendar if is_session(d.date())})
    cutoff_iso = cutoff.date().isoformat()
    taken: dict[pd.Timestamp, float] = {}
    issues: list[Issue] = []
    counts = {"contract": 0, "published": 0, "zs_f": 0, "zs_f_expired": 0}
    for d in days:
        contract = price_contract(d)
        code = contract["code"]
        own = by_code[code]
        # Yahoo can drop a contract from its last trading day on.
        gone = own.empty and contract["last_trade"] <= cutoff_iso
        was_published = published is not None and d in published.index
        recent = d >= require_start
        if d in own.index:
            taken[d] = float(own.loc[d])
            counts["contract"] += 1
        elif own.empty and not gone:
            issues.append(
                (d, f"{contract_symbol(code)} download failed: series ends before {d.date()}")
            )
            log.warning("prices.contract_download_failed", date=str(d.date()), contract=code)
            break
        elif d not in base.index and not was_published:
            issues.append((d, f"no bar from any source for {d.date()}: skipped"))
            log.warning("prices.session_missing_everywhere", date=str(d.date()))
        elif gone and was_published:
            # rebuilding a legacy cache: keep what was published for a contract Yahoo dropped
            taken[d] = float(published.loc[d])  # type: ignore[union-attr]
            counts["published"] += 1
            if recent:
                issues.append(
                    (d, f"{contract_symbol(code)} gone: published value kept for {d.date()}")
                )
        elif gone:
            # ZS=F, as for all history before the window; on a recent session it may quote
            # another contract, so that alerts
            taken[d] = float(base.loc[d])
            counts["zs_f_expired"] += 1
            if recent:
                issues.append(
                    (d, f"{contract_symbol(code)} expired and gone: ZS=F used for {d.date()}")
                )
                log.warning("prices.expired_contract_zs_f", date=str(d.date()), contract=code)
        elif not recent and d in base.index:
            taken[d] = float(base.loc[d])  # an old hole in a listed contract's history
            counts["zs_f"] += 1
        else:
            issues.append((d, f"no {contract_symbol(code)} bar for {d.date()}"))
            log.warning("prices.front_contract_missing", date=str(d.date()), contract=code)
            break
    added = pd.Series(taken, dtype="float64")
    stitched = pd.concat([head, added]).sort_index() if len(head) else added.sort_index()
    log.info(
        "prices.front_contracts",
        contracts=codes,
        cached_through=str(head.index.max().date()) if len(head) else None,
        final_through=str(cutoff.date()),
        added=len(added),
        **counts,
    )
    return stitched, sorted(taken), issues


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


def _read_cache(bronze: Path) -> pd.Series | None:
    path = bronze / CACHE_FILE
    if not path.exists():
        return None
    cached = pd.read_parquet(path)["close_c_bu"].sort_index()
    return cached[~cached.index.duplicated(keep="last")]


def read_trusted_cache(bronze: Path, now: datetime | None = None) -> pd.Series | None:
    """The cached series, cut to the rows that were final when it was written.

    Every row up to the sidecar's `final_through` was a settlement when stored and is never
    replaced. A cache without the sidecar predates the settlement rule: its newest
    PRICE_CONTRACT_WINDOW_BDAYS rows may hold a live, last-trade, overnight or contract-mixed
    value, so they are dropped and rebuilt from the contracts.
    """
    cached = _read_cache(bronze)
    if cached is None:
        return None
    meta = bronze / CACHE_META
    if meta.exists():
        stored = pd.Timestamp(json.loads(meta.read_text(encoding="utf-8"))["final_through"])
        cached = cached[cached.index <= stored]
    elif len(cached):
        cached = cached.iloc[:-PRICE_CONTRACT_WINDOW_BDAYS]
        if len(cached):
            log.warning("prices.legacy_cache_trimmed", last=str(cached.index.max().date()))
    return drop_unfinal(cached, now)


def fetch_soy_prices(
    bronze: Path,
    offline: bool = False,
    downloader: Callable[[str, str], pd.Series] = _download_yahoo,
    sources: SourceLog | None = None,
    now: datetime | None = None,
    quote: Callable[[str], Quote] = _quote_yahoo,
) -> pd.Series:
    """Daily front-month settlements in US cents per bushel, indexed by session date.

    Live runs publish final sessions only, whatever triggered them (a delayed cron, a manual
    dispatch, a local run): the download and the cache are both cut at `final_through`, the
    cached sessions are kept as stored, and the sessions after them are settled by
    `confirm_newest_settlement`.
    """
    path = bronze / CACHE_FILE
    if offline:
        if not path.exists():
            raise PriceDataError("offline mode and no price cache")
        offline_prices: pd.Series = pd.read_parquet(path)["close_c_bu"]
        if sources is not None:
            sources.record("prices", "offline", offline_prices.index.max())
        return offline_prices
    now = now or datetime.now(UTC)  # one clock for the whole run
    raw = _read_cache(bronze)
    raw = drop_unfinal(raw, now) if raw is not None else None  # a legacy cache's moving bar
    cached = read_trusted_cache(bronze, now)
    base = drop_unfinal(_safe_download(downloader, SOY_TICKER, START), now)
    issues: list[Issue] = []
    if base.empty:
        new = base
    else:
        new, new_days, issues = stitch_front_contracts(base, downloader, now, cached, raw)
        new, more = confirm_newest_settlement(new, new_days, quote, now)
        issues += more
    # Every issue alerts (the prices source becomes "cache"), except a missing Friday
    # settlement on a session a legacy cache had already published (nothing better is left).
    known = raw.index.max() if raw is not None and len(raw) else None
    alerts = [m for d, m in issues if not (UNCONFIRMED in m and known is not None and d <= known)]
    behind = None
    if not new.empty and new.index.max().date() < final_through(now):
        behind = (
            f"ends {new.index.max().date()}, final sessions through {final_through(now)}: "
            "newest session not confirmed yet"
        )
    problems = price_problems(new, cached)
    if problems:
        if cached is None or cached.empty:
            raise PriceDataError(f"price download rejected: {problems}")
        log.warning("prices.using_cache", problems=problems, last=str(cached.index.max().date()))
        if sources is not None:
            sources.record("prices", "cache", cached.index.max(), "; ".join(problems))
        return cached
    new = new.rename("close_c_bu")
    new.index.name = "date"
    if known is not None and new.index.max() < known:
        # A partial run (a download failed mid-rebuild) never shrinks the stored series: the
        # cache stays as it is for the next run, and this run alerts.
        alerts.append(f"series ends {new.index.max().date()}, before the cache: cache kept")
        log.warning("prices.cache_kept", ends=str(new.index.max().date()), cache=str(known.date()))
    else:
        atomic_write_parquet(new.to_frame(), path)
        sidecar = {"final_through": min(new.index.max().date(), final_through(now)).isoformat()}
        (bronze / CACHE_META).write_text(json.dumps(sidecar), encoding="utf-8")
        write_snapshot(path)
    if sources is not None:
        if alerts:
            sources.record("prices", "cache", new.index.max(), "; ".join(alerts))
        else:
            sources.record("prices", "live", new.index.max(), behind)
    log.info(
        "prices.ready",
        rows=len(new),
        first=str(new.index.min().date()),
        last=str(new.index.max().date()),
    )
    return new
