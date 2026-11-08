"""Bronze: BRL per USD (PTAX selling rate, Banco Central do Brasil SGS series 1).

The API accepts at most ten years per request, so history is fetched in five-year chunks.
Only used to display prices in reais per sack; it never enters a model.
"""

from __future__ import annotations

from pathlib import Path

import httpx
import pandas as pd

from soyforecast.config import PTAX_URL
from soyforecast.freshness import SourceLog
from soyforecast.ingest._cache import atomic_write_parquet
from soyforecast.logs import get_logger

log = get_logger(__name__)


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


def fetch_ptax(
    bronze: Path,
    offline: bool = False,
    start_year: int = 2016,
    sources: SourceLog | None = None,
) -> pd.Series:
    path = bronze / "ptax_daily.parquet"
    if offline and path.exists():
        cached = pd.read_parquet(path)["brl_per_usd"]
        if sources is not None:
            sources.record("ptax", "offline", cached.index.max())
        return cached
    today = pd.Timestamp.today().normalize()
    parts: list[pd.Series] = []
    try:
        with httpx.Client(timeout=60) as client:
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
    except (httpx.HTTPError, ValueError) as exc:
        if path.exists():
            log.warning("ptax.using_cache", error=str(exc))
            cached = pd.read_parquet(path)["brl_per_usd"]
            if sources is not None:
                sources.record("ptax", "cache", cached.index.max(), str(exc)[:200])
            return cached
        raise
    s = pd.concat(parts)
    s = s[~s.index.duplicated(keep="last")]
    atomic_write_parquet(s.to_frame(), path)
    if sources is not None:
        sources.record("ptax", "live", s.index.max())
    log.info("ptax.ready", rows=len(s), last=str(s.index.max().date()), value=float(s.iloc[-1]))
    return s
