"""Bronze: BRL per USD (PTAX selling rate, Banco Central do Brasil SGS series 1).

The API accepts at most ten years per request, so history is fetched in five-year chunks.
Only used to display prices in reais per sack; it never enters a model. A download replaces
the cache only if it passes `ptax_problems` (P24); otherwise the cache is used.
"""

from __future__ import annotations

from pathlib import Path

import httpx
import numpy as np
import pandas as pd

from soyforecast.config import PTAX_BOUNDS, PTAX_MAX_DAILY_CHANGE, PTAX_URL
from soyforecast.errors import InputDataError
from soyforecast.freshness import SourceLog
from soyforecast.ingest._cache import atomic_write_parquet
from soyforecast.logs import get_logger

log = get_logger(__name__)


class FxDataError(InputDataError):
    pass


def parse_ptax(rows: list[dict[str, str]]) -> pd.Series:
    if not rows:
        return pd.Series(dtype="float64", name="brl_per_usd")
    df = pd.DataFrame(rows)
    s = pd.Series(
        df["valor"].astype(float).to_numpy(),
        index=pd.to_datetime(df["data"], format="%d/%m/%Y"),
        name="brl_per_usd",
    )
    s.index.name = "date"
    return s.sort_index()


def ptax_problems(new: pd.Series, cached: pd.Series | None) -> list[str]:
    """Reasons a downloaded PTAX series must not replace the cache (empty list = accept)."""
    if new.empty:
        return ["no values"]
    problems: list[str] = []
    values = new.to_numpy(dtype=float)
    lo, hi = PTAX_BOUNDS
    if not (np.isfinite(values) & (values > lo) & (values < hi)).all():
        problems.append(f"rate outside {lo}-{hi} BRL/USD")
    elif len(values) > 1 and np.abs(np.diff(values) / values[:-1]).max() >= PTAX_MAX_DAILY_CHANGE:
        problems.append(f"daily change of {PTAX_MAX_DAILY_CHANGE:.0%} or more")
    if cached is not None and not cached.empty and new.index.max() < cached.index.max():
        problems.append("ends before the cache")
    return problems


def _download(start_year: int, transport: httpx.BaseTransport | None) -> pd.Series:
    today = pd.Timestamp.today().normalize()
    parts: list[pd.Series] = []
    with httpx.Client(transport=transport, timeout=60) as client:
        year = start_year
        while year <= today.year:
            end = min(pd.Timestamp(year + 4, 12, 31), today)
            resp = client.get(
                PTAX_URL,
                params={
                    "formato": "json",
                    "dataInicial": f"01/01/{year}",
                    "dataFinal": end.strftime("%d/%m/%Y"),
                },
            )
            resp.raise_for_status()
            parts.append(parse_ptax(resp.json()))
            year += 5
    s = pd.concat(parts) if parts else pd.Series(dtype="float64", name="brl_per_usd")
    return s[~s.index.duplicated(keep="last")].sort_index()


def fetch_ptax(
    bronze: Path,
    offline: bool = False,
    start_year: int = 2016,
    sources: SourceLog | None = None,
    transport: httpx.BaseTransport | None = None,
) -> pd.Series:
    path = bronze / "ptax_daily.parquet"
    cached = pd.read_parquet(path)["brl_per_usd"] if path.exists() else None
    if offline:
        if cached is None:
            raise FxDataError("offline mode and no PTAX cache")
        if sources is not None:
            sources.record("ptax", "offline", cached.index.max())
        return cached
    try:
        s = _download(start_year, transport)
        problems = ptax_problems(s, cached)
    except (httpx.HTTPError, ValueError, KeyError) as exc:
        s, problems = pd.Series(dtype="float64"), [f"download failed: {exc}"[:200]]
    if problems:
        if cached is None:
            raise FxDataError(f"PTAX download rejected and no cache: {problems}")
        log.warning("ptax.using_cache", problems=problems, last=str(cached.index.max().date()))
        if sources is not None:
            sources.record("ptax", "cache", cached.index.max(), "; ".join(problems))
        return cached
    s = s.rename("brl_per_usd")
    s.index.name = "date"
    atomic_write_parquet(s.to_frame(), path)
    if sources is not None:
        sources.record("ptax", "live", s.index.max())
    log.info("ptax.ready", rows=len(s), last=str(s.index.max().date()), value=float(s.iloc[-1]))
    return s
