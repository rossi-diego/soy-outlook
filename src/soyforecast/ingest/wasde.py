"""Bronze: the harmonized WASDE history published by rossi-diego/wasde-monthly-report.

Each report's values are kept as published (one vintage per release), which is what makes
point-in-time features possible.

Lineage (P24): a normal run downloads the release tag pinned in data/wasde.lock.json and
accepts the file only if its sha256 matches the pin. `update_pin=True` (the scheduled refresh)
resolves the latest tag instead and rewrites the lock once the new file passes the checks. In
both cases a download replaces the cache only if it passes `wasde_problems` (columns, dtypes,
unique keys, no fewer reports and no older latest report than the cache); otherwise the cache
is used and the run is marked degraded. Offline runs never touch the network.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import tempfile
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx
import pandas as pd

from soyforecast.config import WASDE_ASSET, Settings
from soyforecast.errors import InputDataError
from soyforecast.freshness import SourceLog
from soyforecast.ingest._cache import sha256
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
# One published value per key; reliability_stat is part of the key when present.
KEY_COLUMNS = (
    "report_month",
    "table_id",
    "commodity_id",
    "region_id",
    "attribute_id",
    "market_year",
    "period",
    "reliability_stat",
)
MONTH_RE = re.compile(r"^\d{4}-\d{2}$")
MANIFEST = "wasde_manifest.json"


class WasdeDataError(InputDataError):
    pass


@dataclass(frozen=True)
class WasdePin:
    """The WASDE Tracker release this repository is built on (data/wasde.lock.json)."""

    release_tag: str
    asset: str
    sha256: str
    bytes: int
    reports: int
    latest_report: str
    updated_at: str


def load_pin(path: Path) -> WasdePin | None:
    if not path.exists():
        return None
    return WasdePin(**json.loads(path.read_text(encoding="utf-8")))


def write_pin(pin: WasdePin, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(asdict(pin), indent=2) + "\n", encoding="utf-8", newline="\n")


def wasde_problems(df: pd.DataFrame, cached: dict[str, Any] | None = None) -> list[str]:
    """Reasons a WASDE file must not be used or replace the cache (empty list = accept)."""
    missing = REQUIRED_COLUMNS - set(df.columns)
    if missing:
        return [f"missing columns: {sorted(missing)}"]
    if df.empty:
        return ["no rows"]
    problems: list[str] = []
    if not pd.api.types.is_numeric_dtype(df["value"]):
        problems.append(f"value column is {df['value'].dtype}, not numeric")
    months = df["report_month"].astype(str)
    if not months.map(lambda m: bool(MONTH_RE.match(m))).all():
        problems.append("report_month is not YYYY-MM everywhere")
    if pd.to_datetime(df["release_date"], errors="coerce").isna().any():
        problems.append("release_date has missing or unparseable values")
    keys = [k for k in KEY_COLUMNS if k in df.columns]
    dups = int(df.duplicated(keys).sum())
    if dups:
        problems.append(f"{dups} duplicated keys")
    if cached:
        reports, latest = int(months.nunique()), str(months.max())
        if cached.get("reports") and reports < int(cached["reports"]):
            problems.append(f"{reports} reports, fewer than the cache's {cached['reports']}")
        if cached.get("latest_report") and latest < str(cached["latest_report"]):
            problems.append(f"latest report {latest} is older than the cache's")
    return problems


def _read_manifest(bronze: Path) -> dict[str, Any] | None:
    path = bronze / MANIFEST
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else None


def _write_manifest(bronze: Path, manifest: dict[str, Any]) -> None:
    (bronze / MANIFEST).write_text(json.dumps(manifest, indent=2), encoding="utf-8")


def _manifest(
    path: Path, source: str, release_tag: str | None, next_release: str | None
) -> dict[str, Any]:
    months = pd.read_parquet(path, columns=["report_month"])["report_month"].astype(str)
    return {
        "release_tag": release_tag,
        "next_release": next_release,
        "source": source,
        "sha256": sha256(path),
        "bytes": path.stat().st_size,
        "reports": int(months.nunique()),
        "latest_report": str(months.max()),
        "fetched_at": datetime.now(UTC).isoformat(timespec="seconds"),
    }


def _ensure_manifest(target: Path) -> dict[str, Any]:
    """The cache's manifest, rebuilt from the file itself if it went missing."""
    manifest = _read_manifest(target.parent)
    if manifest is None:
        manifest = _manifest(target, "cache", None, None)
        _write_manifest(target.parent, manifest)
    return manifest


def _release_meta(client: httpx.Client, url: str) -> dict[str, Any]:
    """Release tag and next WASDE date from the tracker's meta.json; empty when unreachable."""
    try:
        resp = client.get(url)
        resp.raise_for_status()
        data = resp.json()
        return data if isinstance(data, dict) else {}
    except (httpx.HTTPError, ValueError) as exc:
        log.warning("wasde.meta_unavailable", url=url, error=str(exc))
        return {}


def _use_cache(target: Path, problems: list[str], sources: SourceLog | None, what: str) -> Path:
    if not target.exists():
        raise WasdeDataError(f"WASDE {what} rejected and no cache: {problems}")
    manifest = _ensure_manifest(target)
    log.warning("wasde.using_cache", problems=problems, latest=manifest["latest_report"])
    if sources is not None:
        sources.record("wasde", "cache", manifest["latest_report"], "; ".join(problems)[:200])
    return target


def fetch_wasde(
    settings: Settings,
    sources: SourceLog | None = None,
    *,
    update_pin: bool = False,
    transport: httpx.BaseTransport | None = None,
) -> Path:
    """Put a checked WASDE parquet in bronze and write its manifest; returns its path."""
    target = settings.bronze / WASDE_ASSET
    target.parent.mkdir(parents=True, exist_ok=True)
    cached = _read_manifest(settings.bronze) if target.exists() else None

    if settings.offline and not settings.wasde_local:
        if not target.exists():
            raise WasdeDataError("offline mode and no WASDE cache")
        manifest = _ensure_manifest(target)
        log.info("wasde.offline_cache", path=str(target), latest=manifest["latest_report"])
        if sources is not None:
            sources.record("wasde", "offline", manifest["latest_report"])
        return target

    fd, tmp_name = tempfile.mkstemp(dir=target.parent, suffix=".tmp")
    os.close(fd)
    tmp = Path(tmp_name)
    try:
        if settings.wasde_local:
            return _from_local(settings, target, tmp, cached, sources, transport)
        return _download(settings, target, tmp, cached, sources, update_pin, transport)
    finally:
        tmp.unlink(missing_ok=True)


def _from_local(
    settings: Settings,
    target: Path,
    tmp: Path,
    cached: dict[str, Any] | None,
    sources: SourceLog | None,
    transport: httpx.BaseTransport | None,
) -> Path:
    """An explicit local copy (SOY_WASDE_PARQUET): checked for shape, never against the cache."""
    assert settings.wasde_local is not None
    shutil.copyfile(settings.wasde_local, tmp)
    problems = wasde_problems(pd.read_parquet(tmp))
    if problems:
        raise WasdeDataError(f"local WASDE file rejected: {problems}")
    meta: dict[str, Any] = {}
    if not settings.offline:  # offline runs skip the release meta as well
        url = f"{settings.wasde_releases_url}/latest/download/meta.json"
        with httpx.Client(transport=transport, follow_redirects=True, timeout=30) as client:
            meta = _release_meta(client, url)
    os.replace(tmp, target)
    next_release = meta.get("next_release") or (cached or {}).get("next_release")
    manifest = _manifest(
        target, str(settings.wasde_local), meta.get("data_release_tag"), next_release
    )
    _write_manifest(settings.bronze, manifest)
    if sources is not None:
        sources.record("wasde", "offline", manifest["latest_report"], "local file")
    log.info("wasde.ready", **manifest)
    return target


def _download(
    settings: Settings,
    target: Path,
    tmp: Path,
    cached: dict[str, Any] | None,
    sources: SourceLog | None,
    update_pin: bool,
    transport: httpx.BaseTransport | None,
) -> Path:
    base = settings.wasde_releases_url.rstrip("/")
    pin = load_pin(settings.wasde_lock)
    with httpx.Client(transport=transport, follow_redirects=True, timeout=120) as client:
        if update_pin or pin is None:
            meta = _release_meta(client, f"{base}/latest/download/meta.json")
            tag, expected = meta.get("data_release_tag"), None
            if not tag:
                return _use_cache(target, ["latest release tag unavailable"], sources, "update")
        else:
            tag, expected = pin.release_tag, pin.sha256
            meta = _release_meta(client, f"{base}/download/{tag}/meta.json")
        url = f"{base}/download/{tag}/{WASDE_ASSET}"
        log.info("wasde.download", url=url, pinned=expected is not None)
        try:
            resp = client.get(url)
            resp.raise_for_status()
        except httpx.HTTPError as exc:
            return _use_cache(target, [f"download failed: {exc}"[:200]], sources, "download")
    tmp.write_bytes(resp.content)
    digest = sha256(tmp)
    problems = [] if expected is None or digest == expected else [f"sha256 {digest[:12]} != pin"]
    if not problems:
        try:
            problems = wasde_problems(pd.read_parquet(tmp), cached)
        except (OSError, ValueError) as exc:  # not a parquet file at all
            problems = [f"unreadable parquet: {exc}"[:200]]
    if problems:
        return _use_cache(target, problems, sources, "download")

    os.replace(tmp, target)
    manifest = _manifest(target, url, str(tag), meta.get("next_release"))
    _write_manifest(settings.bronze, manifest)
    if pin is None or update_pin:
        new_pin = WasdePin(
            release_tag=str(tag),
            asset=WASDE_ASSET,
            sha256=manifest["sha256"],
            bytes=manifest["bytes"],
            reports=manifest["reports"],
            latest_report=manifest["latest_report"],
            updated_at=manifest["fetched_at"],
        )
        if pin is None or (new_pin.release_tag, new_pin.sha256) != (pin.release_tag, pin.sha256):
            write_pin(new_pin, settings.wasde_lock)
            log.info("wasde.pin_updated", tag=new_pin.release_tag, sha256=new_pin.sha256)
    if sources is not None:
        if meta:
            sources.record("wasde", "live", manifest["latest_report"])
        else:
            sources.record("wasde", "cache", manifest["latest_report"], "release meta unavailable")
    log.info("wasde.ready", **manifest)
    return target


def load_wasde(path: Path) -> pd.DataFrame:
    df = pd.read_parquet(path)
    missing = REQUIRED_COLUMNS - set(df.columns)
    if missing:
        raise WasdeDataError(f"WASDE parquet is missing columns: {sorted(missing)}")
    return df
