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
from soyforecast.freshness import SourceLog, final_through, previous_session, trade_date
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


def confirm_newest_settlement(
    series: pd.Series,
    quote: Callable[[str], Quote],
    now: datetime | None = None,
    trusted: pd.Series | None = None,
) -> tuple[pd.Series, dict[pd.Timestamp, float]]:
    """Replace the newest session's bar with its settlement, or hold that session back.

    Yahoo's daily bar for a session is not always its settlement (Friday's and a pre-holiday
    session's keep the last trade). The contract's quote carries the settlement as the previous
    close while the next session trades. The newest session is kept only if it is already
    stored as final in the cache, or if the quote's last trade is in the session now trading
    (`trade_date(now)`) and that session directly follows the newest one (`previous_session`,
    so holidays are skipped); its previous close then replaces the bar. Requiring the session
    now trading rules out a stale quote: in the evening, before a thin contract trades in the
    new session, the previous close has already rolled but the quote time has not.

    Returns the series and the settlements confirmed by this call ({} if none), which the
    caller stores so later runs prefer them over the session's bar. When the quote itself could
    not be read, the returned series carries `attrs["quote_unavailable"]` (the run alerts).
    """
    if series.empty:
        return series, {}
    newest = series.index.max()
    if trusted is not None and newest in trusted.index:
        series = series.copy()
        series.loc[newest] = float(trusted.loc[newest])
        return series, {}
    code = price_contract(newest)["code"]
    try:
        settle, stamp = quote(contract_symbol(code))
    except Exception as exc:  # network, rate limit, delisted symbol
        settle, stamp = None, None
        log.warning("prices.quote_failed", contract=code, error=str(exc))
    usable = settle is not None and bool(np.isfinite(settle)) and settle > 0 and stamp is not None
    quote_session = trade_date(stamp) if stamp is not None else None
    if (
        usable
        and settle is not None
        and quote_session is not None
        and quote_session == trade_date(now)
        and previous_session(quote_session) == newest.date()
    ):
        bar = float(series.loc[newest])
        if abs(bar - settle) > 0.001:
            log.info(
                "prices.bar_replaced_by_settlement", date=str(newest.date()), bar=bar, settle=settle
            )
        series = series.copy()
        series.loc[newest] = settle
        return series, {newest: float(settle)}
    reason = "no settlement quote for this session yet" if usable else "quote unavailable"
    log.warning(
        "prices.newest_held_back",
        date=str(newest.date()),
        contract=code,
        quote_session=str(quote_session),
        reason=reason,
    )
    held = series.drop(newest)
    if not usable:
        held.attrs["quote_unavailable"] = (
            f"{contract_symbol(code)} quote unavailable: {newest.date()} held back"
        )
    return held, {}


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
    settled: pd.Series | None = None,
) -> pd.Series:
    """`base` (ZS=F) with its recent sessions replaced by the front contract's own bars.

    For each session in the window, in order of preference: a settlement confirmed from the
    quote by an earlier run (`settled`; the bar can keep a last trade or overnight print), the
    front contract's bar from its own symbol, a value already stored as final in the cache
    (`trusted`; an expired contract can disappear from Yahoo), and, only outside the newest
    PRICE_REQUIRE_CONTRACT_BDAYS sessions, ZS=F itself. A newest-window session with none of the first two ends the series
    just before it, so a contract-mixed ZS=F bar is never published.
    """
    cutoff = pd.Timestamp(final_through(now))
    base = base[base.index <= cutoff]
    window_start = cutoff - BDay(PRICE_CONTRACT_WINDOW_BDAYS)
    require_start = cutoff - BDay(PRICE_REQUIRE_CONTRACT_BDAYS - 1)
    trusted = trusted if trusted is not None else pd.Series(dtype="float64")
    settled = settled if settled is not None else pd.Series(dtype="float64")

    candidate_days = pd.bdate_range(window_start, cutoff)
    codes = sorted({price_contract(d)["code"] for d in candidate_days})
    start = window_start.date().isoformat()
    by_code = {c: _safe_download(downloader, contract_symbol(c), start) for c in codes}

    days = sorted(
        set(base.index[base.index >= window_start])
        | {d for s in by_code.values() for d in s.index if window_start <= d <= cutoff}
    )
    out = base[base.index < window_start].copy()
    taken: dict[pd.Timestamp, float] = {}
    counts = {"settlement": 0, "contract": 0, "cache": 0, "zs_f": 0}
    mismatches = 0
    missing: str | None = None
    for d in days:
        code = price_contract(d)["code"]
        own = by_code[code]
        if d in settled.index:
            taken[d] = float(settled.loc[d])
            counts["settlement"] += 1
            if d in own.index and abs(float(own.loc[d]) - taken[d]) > 0.001:
                log.info(
                    "prices.bar_differs_from_settlement",
                    date=str(d.date()),
                    bar=float(own.loc[d]),
                    settle=taken[d],
                )
        elif d in own.index:
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
            missing = f"no {contract_symbol(code)} bar for {d.date()}"
            break
    stitched = pd.concat([out, pd.Series(taken, dtype="float64")]).sort_index()
    stitched.attrs["front_contract_missing"] = missing
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
    cached = cached[~cached.index.duplicated(keep="last")]
    meta = bronze / CACHE_META
    if meta.exists():
        stored = pd.Timestamp(json.loads(meta.read_text(encoding="utf-8"))["final_through"])
        cached = cached[cached.index <= stored]
    elif len(cached):
        cached = cached.iloc[:-PRICE_REQUIRE_CONTRACT_BDAYS]
        if len(cached):
            log.warning("prices.legacy_cache_trimmed", last=str(cached.index.max().date()))
    return drop_unfinal(cached, now)


def read_settlements(bronze: Path) -> pd.Series:
    """Settlements confirmed from the quote by earlier runs (from the cache sidecar)."""
    meta = bronze / CACHE_META
    if not meta.exists():
        return pd.Series(dtype="float64")
    stored = json.loads(meta.read_text(encoding="utf-8")).get("settlements", {})
    s = pd.Series({pd.Timestamp(k): float(v) for k, v in stored.items()}, dtype="float64")
    return s.sort_index()


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
    settled = read_settlements(bronze)
    base = drop_unfinal(_safe_download(downloader, SOY_TICKER, START), now)
    new = stitch_front_contracts(base, downloader, now, cached, settled) if not base.empty else base
    missing = new.attrs.get("front_contract_missing")
    new, confirmed = confirm_newest_settlement(new, quote, now, cached)
    # Both are alertable: a missing contract bar, or a quote that could not be read at all
    # (as opposed to one that does not carry the newest settlement yet).
    missing = missing or new.attrs.get("quote_unavailable")
    # A newest session held back (or a missing front-contract bar) leaves the series short of
    # final_through: nothing new is published, the source status says why, and the stale gate
    # alerts if it lasts more than STALE_CLOSE_BDAYS.
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
    atomic_write_parquet(new.to_frame(), path)
    keep_from = new.index.max() - BDay(PRICE_CONTRACT_WINDOW_BDAYS)
    settlements: dict[pd.Timestamp, float] = {
        pd.Timestamp(str(d)): float(v) for d, v in settled.items()
    }
    settlements.update(confirmed)
    sidecar = {
        "final_through": final_through(now).isoformat(),
        "settlements": {
            pd.Timestamp(d).date().isoformat(): v
            for d, v in sorted(settlements.items())
            if pd.Timestamp(d) >= keep_from
        },
    }
    (bronze / CACHE_META).write_text(json.dumps(sidecar), encoding="utf-8")
    write_snapshot(path)
    if sources is not None:
        if missing:
            # The newest sessions could not be read from their own contract or confirmed from
            # its quote: this is reported as a cache fallback, which alerts.
            sources.record("prices", "cache", new.index.max(), missing)
        else:
            sources.record("prices", "live", new.index.max(), behind)
    log.info(
        "prices.ready",
        rows=len(new),
        first=str(new.index.min().date()),
        last=str(new.index.max().date()),
    )
    return new
