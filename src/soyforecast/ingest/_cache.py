"""Small helpers shared by the ingest modules: atomic writes, file hashes, dated snapshots."""

from __future__ import annotations

import hashlib
import os
import shutil
import tempfile
from datetime import UTC, date, datetime
from pathlib import Path

import pandas as pd


def atomic_write_parquet(df: pd.DataFrame, path: Path) -> None:
    """Write to a temporary file in the same folder, then rename (never a half-written cache)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, suffix=".tmp")
    os.close(fd)
    try:
        df.to_parquet(tmp)
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)


def atomic_write_bytes(data: bytes, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, suffix=".tmp")
    with os.fdopen(fd, "wb") as fh:
        fh.write(data)
    os.replace(tmp, path)


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


SNAPSHOT_DIR = "snapshots"
# Dated snapshots kept per source; older ones are deleted (the bronze layer is not committed).
SNAPSHOT_KEEP = 30


def snapshot_name(path: Path, digest: str, day: date) -> str:
    return f"{path.stem}_{day:%Y%m%d}_{digest[:12]}{path.suffix}"


def write_snapshot(path: Path, day: date | None = None, keep: int = SNAPSHOT_KEEP) -> Path:
    """Keep a dated, content-hashed copy of an accepted bronze file (P24).

    bronze/snapshots/<stem>_<YYYYMMDD>_<sha256[:12]>.<ext>, dated the first day these bytes were
    accepted: identical bytes are stored once, so a rerun or an unchanged WASDE file adds nothing.
    The run manifest records which snapshot a run used.
    """
    day = day or datetime.now(UTC).date()
    folder = path.parent / SNAPSHOT_DIR
    folder.mkdir(parents=True, exist_ok=True)
    digest = sha256(path)
    same = sorted(folder.glob(f"{path.stem}_[0-9]*_{digest[:12]}{path.suffix}"))
    if same:
        return same[0]
    target = folder / snapshot_name(path, digest, day)
    shutil.copyfile(path, target)
    olds = sorted(folder.glob(f"{path.stem}_[0-9]*{path.suffix}"))
    for old in olds[: max(len(olds) - keep, 0)]:
        old.unlink()
    return target
