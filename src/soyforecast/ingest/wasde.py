"""Bronze: the harmonized WASDE history published by rossi-diego/wasde-monthly-report.

Each report's values are kept as published (one vintage per release), which is what makes
point-in-time features possible. Release assets are re-uploaded on rebuilds, so the file is
pinned by its sha256 in a manifest next to it.
"""

from __future__ import annotations

import json
import shutil
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx
import pandas as pd

from soyforecast.config import Settings
from soyforecast.freshness import SourceLog
from soyforecast.ingest._cache import atomic_write_bytes, sha256
from soyforecast.logs import get_logger

log = get_logger(__name__)

REQUIRED_COLUMNS = {
    "report_month",
    "release_date",
    "table_id",
    "commodity_id",
    "region_id",
    "attribute_id",
    "market_year",
    "period",
    "value",
    "unit_id",
}


def fetch_wasde(settings: Settings, sources: SourceLog | None = None) -> Path:
    """Download (or copy) the WASDE parquet into bronze and write its manifest."""
    target = settings.bronze / "wasde_full.parquet"
    target.parent.mkdir(parents=True, exist_ok=True)
    if settings.wasde_local:
        shutil.copyfile(settings.wasde_local, target)
        source = str(settings.wasde_local)
    elif settings.offline and target.exists():
        log.info("wasde.offline_cache", path=str(target))
        if sources is not None:
            sources.record("wasde", "offline", _latest_report(target))
        return target
    else:
        log.info("wasde.download", url=settings.wasde_url)
        with httpx.Client(follow_redirects=True, timeout=120) as client:
            resp = client.get(settings.wasde_url)
            resp.raise_for_status()
        atomic_write_bytes(resp.content, target)
        source = settings.wasde_url
    months = pd.read_parquet(target, columns=["report_month"])["report_month"]
    release_meta = _release_meta(settings.wasde_url.rsplit("/", 1)[0] + "/meta.json")
    manifest = {
        "release_tag": release_meta.get("data_release_tag"),
        "next_release": release_meta.get("next_release"),
        "source": source,
        "sha256": sha256(target),
        "bytes": target.stat().st_size,
        "reports": int(months.nunique()),
        "latest_report": str(months.max()),
        "fetched_at": datetime.now(UTC).isoformat(timespec="seconds"),
    }
    (settings.bronze / "wasde_manifest.json").write_text(json.dumps(manifest, indent=2))
    if sources is not None:
        if settings.wasde_local:
            sources.record("wasde", "offline", manifest["latest_report"], "local file")
        elif not release_meta:
            sources.record("wasde", "cache", manifest["latest_report"], "release meta unavailable")
        else:
            sources.record("wasde", "live", manifest["latest_report"])
    log.info("wasde.ready", **manifest)
    return target


def _latest_report(path: Path) -> str:
    return str(pd.read_parquet(path, columns=["report_month"])["report_month"].max())


def _release_meta(url: str) -> dict[str, Any]:
    """Release tag and next WASDE date from the tracker's meta.json; empty when unreachable."""
    try:
        with httpx.Client(follow_redirects=True, timeout=30) as client:
            resp = client.get(url)
            resp.raise_for_status()
            data = resp.json()
            return data if isinstance(data, dict) else {}
    except (httpx.HTTPError, ValueError) as exc:
        log.warning("wasde.meta_unavailable", error=str(exc))
        return {}


def load_wasde(path: Path) -> pd.DataFrame:
    df = pd.read_parquet(path)
    missing = REQUIRED_COLUMNS - set(df.columns)
    if missing:
        raise ValueError(f"WASDE parquet is missing columns: {sorted(missing)}")
    return df
