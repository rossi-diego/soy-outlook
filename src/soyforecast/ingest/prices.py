"""Bronze: daily CBOT soybean settlements, front month by last trading day, with a validated cache.

The series is the same one the models were built on: the continuous front month, i.e. the
nearest contract until its last trading day, unadjusted (`features.contracts.front_contract`).
History comes from Yahoo's continuous symbol ZS=F. Its recent bars are not reliable, though:
Yahoo moves ZS=F to the liquid next contract before the front expires (so for a few weeks the
newest bars quote another contract than the history) and rewrites those bars later. Over the
last PRICE_CONTRACT_WINDOW_BDAYS business days each session is therefore read from the front
contract's own symbol (e.g. ZSX26.CBT), and only final bars are kept (`final_through`: a bar
dated today is never final).

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
from soyforecast.features.contracts import front_contract
from soyforecast.freshness import SourceLog, final_through, previous_weekday, trade_date
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
    """(regularMarketPreviousClose, regularMarketTime) of a contract from Yahoo's quote."""
    import yfinance as yf

    info = yf.Ticker(symbol).info
    prev, when = info.get("regularMarketPreviousClose"), info.get("regularMarketTime")
    stamp = datetime.fromtimestamp(int(when), tz=UTC) if when else None
    return (float(prev) if prev is not None else None), stamp


def confirm_newest_settlement(
    series: pd.Series,
    quote: Callable[[str], Quote],
    now: datetime | None = None,
    trusted: pd.Series | None = None,
) -> pd.Series:
    """Replace the newest session's bar with its settlement, or hold that session back.

    Yahoo's daily bar for a session is not its settlement the morning after (it can hold the
    last trade or overnight prints). The contract's quote carries the settlement as
    `regularMarketPreviousClose` while the next session trades: from 19:00 CT that evening
    until 19:00 CT the next weekday. The newest session is kept only if it is already stored
    as final in the cache, or if the quote's own time falls in the session right after it (so
    its previous close is that session's settlement), which then replaces the bar.
    """
    if series.empty:
        return series
    newest = series.index.max()
    if trusted is not None and newest in trusted.index:
        series = series.copy()
        series.loc[newest] = float(trusted.loc[newest])
        return series
    code = front_contract(newest)["code"]
    try:
        settle, stamp = quote(contract_symbol(code))
    except Exception as exc:  # network, crumb, rate limit
        settle, stamp = None, None
        log.warning("prices.quote_failed", contract=code, error=str(exc))
    quote_session = trade_date(stamp) if stamp is not None else None
    if (
        settle is not None
        and np.isfinite(settle)
        and settle > 0
        and quote_session is not None
        and previous_weekday(quote_session) == newest.date()
    ):
        bar = float(series.loc[newest])
        if abs(bar - settle) > 0.001:
            log.info(
                "prices.bar_replaced_by_settlement", date=str(newest.date()), bar=bar, settle=settle
            )
        series = series.copy()
        series.loc[newest] = settle
        return series
    log.warning(
        "prices.newest_held_back",
        date=str(newest.date()),
        contract=code,
        quote_session=str(quote_session),
        reason="no settlement quote for this session yet",
    )
    return series.drop(newest)


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
    return s.sort_index().astype("float64").dropna()


def stitch_front_contracts(
    base: pd.Series,
    downloader: Callable[[str, str], pd.Series],
    now: datetime | None = None,
    trusted: pd.Series | None = None,
) -> pd.Series:
    """`base` (ZS=F) with its recent sessions replaced by the front contract's own bars.

    For each session in the window, in order of preference: the front contract's bar from its
    own symbol, a value already stored as final in the cache (`trusted`; an expired contract
    can disappear from Yahoo), and, only outside the newest PRICE_REQUIRE_CONTRACT_BDAYS
    sessions, ZS=F itself. A newest-window session with none of the first two ends the series
    just before it, so a contract-mixed ZS=F bar is never published.
    """
    cutoff = pd.Timestamp(final_through(now))
    base = base[base.index <= cutoff]
    window_start = cutoff - BDay(PRICE_CONTRACT_WINDOW_BDAYS)
    require_start = cutoff - BDay(PRICE_REQUIRE_CONTRACT_BDAYS - 1)
    trusted = trusted if trusted is not None else pd.Series(dtype="float64")

    candidate_days = pd.bdate_range(window_start, cutoff)
    codes = sorted({front_contract(d)["code"] for d in candidate_days})
    start = window_start.date().isoformat()
    by_code = {c: _safe_download(downloader, contract_symbol(c), start) for c in codes}

    days = sorted(
        set(base.index[base.index >= window_start])
        | {d for s in by_code.values() for d in s.index if window_start <= d <= cutoff}
    )
    out = base[base.index < window_start].copy()
    taken: dict[pd.Timestamp, float] = {}
    counts = {"contract": 0, "cache": 0, "zs_f": 0}
    mismatches = 0
    for d in days:
        code = front_contract(d)["code"]
        own = by_code[code]
        if d in own.index:
            taken[d] = float(own.loc[d])
            counts["contract"] += 1
            if d in base.index and d < require_start and abs(base.loc[d] - own.loc[d]) > 0.01:
                mismatches += 1
        elif d in trusted.index:
            taken[d] = float(trusted.loc[d])
            counts["cache"] += 1
        elif d < require_start and d in base.index:
            taken[d] = float(base.loc[d])
            counts["zs_f"] += 1
        else:
            log.warning("prices.front_contract_missing", date=str(d.date()), contract=code)
            break
    stitched = pd.concat([out, pd.Series(taken, dtype="float64")]).sort_index()
    log.info(
        "prices.front_contracts",
        contracts=codes,
        window_start=str(window_start.date()),
        final_through=str(cutoff.date()),
        mismatched_zs_f_bars=mismatches,
        **counts,
    )
    return stitched


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


def read_trusted_cache(bronze: Path, now: datetime | None = None) -> pd.Series | None:
    """The cached series, cut to the rows that were final when it was written.

    A cache without the sidecar predates the final-bar rule: its newest
    PRICE_REQUIRE_CONTRACT_BDAYS rows may hold a live, last-trade or overnight value, so they
    are dropped (the download replaces them).
    """
    path = bronze / CACHE_FILE
    if not path.exists():
        return None
    cached = pd.read_parquet(path)["close_c_bu"].sort_index()
    meta = bronze / CACHE_META
    if meta.exists():
        stored = pd.Timestamp(json.loads(meta.read_text(encoding="utf-8"))["final_through"])
        cached = cached[cached.index <= stored]
    elif len(cached):
        cached = cached.iloc[:-PRICE_REQUIRE_CONTRACT_BDAYS]
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
    dispatch, a local run): the download and the cache are both cut at `final_through`.
    """
    path = bronze / CACHE_FILE
    if offline:
        if not path.exists():
            raise PriceDataError("offline mode and no price cache")
        offline_prices: pd.Series = pd.read_parquet(path)["close_c_bu"]
        if sources is not None:
            sources.record("prices", "offline", offline_prices.index.max())
        return offline_prices
    cached = read_trusted_cache(bronze, now)
    base = drop_unfinal(_safe_download(downloader, SOY_TICKER, START), now)
    new = stitch_front_contracts(base, downloader, now, cached) if not base.empty else base
    new = confirm_newest_settlement(new, quote, now, cached)
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
    atomic_write_parquet(new.to_frame(), path)
    (bronze / CACHE_META).write_text(
        json.dumps({"final_through": final_through(now).isoformat()}), encoding="utf-8"
    )
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
