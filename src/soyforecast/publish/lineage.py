"""run_manifest.json: what exactly produced the published data (P24).

Input file hashes (and the dated bronze snapshot holding those bytes), the WASDE pin, the hash
of uv.lock, the git commit and the versions of the packages that shape a forecast. With the
snapshots and the lock, a published outlook can be rebuilt byte for byte.
"""

from __future__ import annotations

import os
import platform
import subprocess
from datetime import datetime
from importlib import metadata
from pathlib import Path
from typing import TYPE_CHECKING, Any

import pandas as pd

from soyforecast import __version__
from soyforecast.config import ROOT, WASDE_ASSET, Settings
from soyforecast.ingest._cache import SNAPSHOT_DIR, sha256
from soyforecast.ingest.wasde import load_pin

if TYPE_CHECKING:
    from soyforecast.pipeline import Artefacts

RUN_MANIFEST_VERSION = 1
PACKAGES = (
    "numpy",
    "pandas",
    "scipy",
    "statsmodels",
    "scikit-learn",
    "pyarrow",
    "yfinance",
    "httpx",
    "pydantic",
)


def _git(*args: str) -> str | None:
    try:
        out = subprocess.run(
            ["git", *args], cwd=ROOT, capture_output=True, text=True, timeout=10, check=True
        )
    except (OSError, subprocess.SubprocessError):
        return None
    return out.stdout.strip()


def git_state() -> dict[str, Any]:
    """Commit SHA (GITHUB_SHA in Actions) and whether the code differed from it."""
    sha = os.getenv("GITHUB_SHA") or _git("rev-parse", "HEAD")
    # Only code and the lock count as dirty: a refresh changes web/public/data by design.
    status = _git(
        "status", "--porcelain", "--untracked-files=no", "--", "src", "pyproject.toml", "uv.lock"
    )
    return {"sha": sha or None, "code_dirty": None if status is None else bool(status)}


def _version(name: str) -> str | None:
    try:
        return metadata.version(name)
    except metadata.PackageNotFoundError:
        return None


def _snapshot(path: Path, digest: str) -> str | None:
    found = sorted(
        (path.parent / SNAPSHOT_DIR).glob(f"{path.stem}_[0-9]*_{digest[:12]}{path.suffix}")
    )
    return found[0].name if found else None


def _file(path: Path) -> dict[str, Any]:
    if not path.exists():  # e.g. inputs injected in tests
        return {"file": path.name, "sha256": None, "bytes": None, "snapshot": None}
    digest = sha256(path)
    return {
        "file": path.name,
        "sha256": digest,
        "bytes": path.stat().st_size,
        "snapshot": _snapshot(path, digest),
    }


def _series_span(s: pd.Series) -> dict[str, Any]:
    return {
        "rows": len(s),
        "first": s.index.min().date().isoformat(),
        "last": s.index.max().date().isoformat(),
    }


def build_run_manifest(a: Artefacts, settings: Settings, now: datetime) -> dict[str, Any]:
    bronze = settings.bronze
    pin = load_pin(settings.wasde_lock)
    lock = ROOT / "uv.lock"
    wasde = _file(bronze / WASDE_ASSET)
    return {
        "run_manifest_version": RUN_MANIFEST_VERSION,
        "generated_at": now.isoformat(timespec="seconds"),
        "soyforecast_version": __version__,
        "mode": "offline" if a.offline else "live",
        "git": git_state(),
        "python": platform.python_version(),
        "packages": {p: _version(p) for p in PACKAGES},
        "lock": {"file": "uv.lock", "sha256": sha256(lock) if lock.exists() else None},
        "inputs": {
            "wasde": {
                **wasde,
                "release_tag": a.wasde_manifest.get("release_tag"),
                "pin_sha256": pin.sha256 if pin else None,
                "matches_pin": bool(pin and pin.sha256 == wasde["sha256"]),
                "reports": a.wasde_manifest.get("reports"),
                "latest_report": str(a.vintages.index[-1]),
            },
            "prices": {**_file(bronze / "zs_daily.parquet"), **_series_span(a.prices)},
            "ptax": {**_file(bronze / "ptax_daily.parquet"), **_series_span(a.ptax)},
            "premium_table": _file(settings.premium_table),
            "premium_card": _file(settings.premium_card),
        },
        "sources": a.sources.as_dict(),
    }
