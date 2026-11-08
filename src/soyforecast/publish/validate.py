"""Validation gate for published site data (used by the refresh workflow before any PR).

Three kinds of check, each returning human-readable problems (an empty list passes):
  shape     - every file exists, the schema version matches, horizons are complete with
              finite, monotone quantiles (a structural check until the pydantic contract
              of P25 replaces it);
  freshness - the as-of close is at most STALE_CLOSE_BDAYS business days old;
  deltas    - against the previously published copy: the as-of close and the latest WASDE
              never go backwards, backtest rows and weekly history do not shrink by more
              than MAX_ROW_LOSS_SHARE, and archived outlooks are untouched (append-only);
  archive   - an outlook built within ARCHIVE_MAX_LAG_BDAYS of its close is on record, so
              every timely outlook the site shows can be scored later.
"""

from __future__ import annotations

import itertools
import json
import math
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any

from soyforecast.config import (
    ARCHIVE_MAX_LAG_BDAYS,
    HORIZONS,
    MAX_ROW_LOSS_SHARE,
    STALE_CLOSE_BDAYS,
)
from soyforecast.freshness import business_days_between, chicago_now
from soyforecast.publish.archive import (
    ARCHIVE_DIR,
    INDEX,
    NAME_RE,
    archived_for,
    build_lag_bdays,
    load_archive,
)

REQUIRED_FILES = (
    "meta.json",
    "outlook.json",
    "track_record.json",
    "wasde.json",
    "backtest.csv",
    "metrics.csv",
    "run_manifest.json",
    f"{ARCHIVE_DIR}/{INDEX}",
)
QUANTILE_KEYS = ("q025", "q100", "q500", "q900", "q975")


@dataclass
class Report:
    problems: list[str] = field(default_factory=list)
    stale: bool = False
    degraded: list[str] = field(default_factory=list)
    as_of_close: str | None = None
    bdays_old: int | None = None

    @property
    def ok(self) -> bool:
        return not self.problems


def _json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def _csv_rows(path: Path) -> int:
    with path.open(encoding="utf-8") as fh:
        return max(sum(1 for _ in fh) - 1, 0)


def check_shape(data: Path, schema_version: int) -> list[str]:
    missing = [f for f in REQUIRED_FILES if not (data / f).exists()]
    if missing:
        return [f"missing file: {f}" for f in missing]
    problems: list[str] = []
    meta, outlook = _json(data / "meta.json"), _json(data / "outlook.json")
    if meta.get("schema_version") != schema_version:
        problems.append(f"schema_version {meta.get('schema_version')} != {schema_version}")
    for key in ("as_of_close", "latest_wasde", "freshness", "generated_at"):
        if key not in meta:
            problems.append(f"meta.json lacks {key}")
    if outlook.get("as_of_close") != meta.get("as_of_close"):
        problems.append("outlook and meta disagree on as_of_close")
    horizons = outlook.get("horizons") or []
    if [h.get("h") for h in horizons] != list(HORIZONS):
        problems.append(f"outlook horizons {[h.get('h') for h in horizons]} != {list(HORIZONS)}")
    for h in horizons:
        qs = [h.get(k) for k in QUANTILE_KEYS]
        if any(not isinstance(q, int | float) or not math.isfinite(q) for q in qs):
            problems.append(f"horizon {h.get('h')}: missing or non-finite quantile")
        elif any(a > b for a, b in itertools.pairwise(qs)):
            problems.append(f"horizon {h.get('h')}: quantiles are not monotone")
        if not isinstance(h.get("central"), int | float):
            problems.append(f"horizon {h.get('h')}: no central value")
    if not outlook.get("history"):
        problems.append("outlook history is empty")
    track = _json(data / "track_record.json")
    if not track.get("metrics") or not track.get("paths"):
        problems.append("track_record.json has no metrics or paths")
    if len(_json(data / "wasde.json").get("lines") or []) == 0:
        problems.append("wasde.json has no balance-sheet lines")
    if _csv_rows(data / "backtest.csv") == 0:
        problems.append("backtest.csv is empty")
    return problems


def check_freshness(meta: dict[str, Any], now: datetime | None, max_bdays: int) -> tuple[bool, int]:
    today = chicago_now(now).date()
    age = business_days_between(meta["as_of_close"], today)
    return age > max_bdays, age


def check_deltas(data: Path, baseline: Path) -> list[str]:
    if not (baseline / "meta.json").exists():
        return []  # first publish: nothing to compare with
    problems: list[str] = []
    new_meta, old_meta = _json(data / "meta.json"), _json(baseline / "meta.json")
    if new_meta["as_of_close"] < old_meta["as_of_close"]:
        problems.append(
            f"as_of_close went backwards: {old_meta['as_of_close']} -> {new_meta['as_of_close']}"
        )
    if new_meta["latest_wasde"]["month"] < old_meta["latest_wasde"]["month"]:
        problems.append("latest WASDE went backwards")
    floor = 1 - MAX_ROW_LOSS_SHARE
    if (baseline / "backtest.csv").exists():
        old_n, new_n = _csv_rows(baseline / "backtest.csv"), _csv_rows(data / "backtest.csv")
        if new_n < floor * old_n:
            problems.append(f"backtest rows fell from {old_n} to {new_n}")
    if (baseline / "outlook.json").exists():
        old_h = len(_json(baseline / "outlook.json")["history"])
        new_h = len(_json(data / "outlook.json")["history"])
        if new_h < floor * old_h:
            problems.append(f"weekly history fell from {old_h} to {new_h} points")
    old_archive = baseline / ARCHIVE_DIR
    if old_archive.exists():
        for p in sorted(f for f in old_archive.iterdir() if NAME_RE.match(f.name)):
            q = data / ARCHIVE_DIR / p.name
            if not q.exists():
                problems.append(f"archived outlook removed: {p.name}")
            elif q.read_bytes() != p.read_bytes():
                problems.append(f"archived outlook rewritten: {p.name}")
    return problems


def check_archived(data: Path, meta: dict[str, Any]) -> list[str]:
    """A timely outlook must be in the archive (late rebuilds are left out on purpose)."""
    snap = {"as_of_close": meta["as_of_close"], "generated_at": meta["generated_at"]}
    if build_lag_bdays(snap) > ARCHIVE_MAX_LAG_BDAYS:
        return []
    if archived_for(load_archive(data), meta["as_of_close"], meta["latest_wasde"]["month"]):
        return []
    return [
        f"outlook for {meta['as_of_close']} ({meta['latest_wasde']['month']} WASDE) is not archived"
    ]


def validate(
    data: Path,
    schema_version: int,
    baseline: Path | None = None,
    now: datetime | None = None,
    max_bdays: int = STALE_CLOSE_BDAYS,
    require_fresh: bool = True,
) -> Report:
    report = Report(problems=check_shape(data, schema_version))
    if report.problems:
        return report
    meta = _json(data / "meta.json")
    report.as_of_close = meta["as_of_close"]
    report.degraded = list(meta["freshness"].get("degraded_sources", []))
    report.stale, report.bdays_old = check_freshness(meta, now, max_bdays)
    if report.stale and require_fresh:
        report.problems.append(
            f"as_of_close {meta['as_of_close']} is {report.bdays_old} business days old "
            f"(limit {max_bdays})"
        )
    report.problems += check_archived(data, meta)
    if baseline is not None:
        report.problems += check_deltas(data, baseline)
    return report


def summary_markdown(report: Report) -> str:
    lines = [
        "### Data validation gate",
        "",
        f"- as-of close: `{report.as_of_close}` ({report.bdays_old} business days old)",
        f"- degraded sources: {', '.join(report.degraded) or 'none'}",
        f"- result: {'**pass**' if report.ok else '**fail**'}",
    ]
    lines += [f"  - {p}" for p in report.problems]
    return "\n".join(lines) + "\n"
