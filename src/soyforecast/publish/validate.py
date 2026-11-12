"""Validation gate for published site data (used by the refresh workflow before any PR).

Four kinds of check, each returning human-readable problems (an empty list passes):
  shape     - every file exists, the schema version matches, and every JSON file validates
              against its pydantic model in publish/schema.py (complete horizons with
              finite, monotone quantiles, no nulls where the site expects numbers);
  freshness - the as-of close is at most STALE_CLOSE_BDAYS business days old;
  deltas    - against the previously published copy: the as-of close and the latest WASDE
              never go backwards, backtest rows and weekly history do not shrink by more
              than MAX_ROW_LOSS_SHARE, and archived outlooks are untouched (append-only);
  archive   - an outlook built within ARCHIVE_MAX_LAG_BDAYS of its close is on record, so
              every timely outlook the site shows can be scored later, and the newest
              archived record of the outlook on the site matches outlook.json (a revised
              close is a new `.r<N>` record, never a silent difference, and each `.r<N>`
              follows revision N-1 of the same outlook).
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any

from pydantic import ValidationError

from soyforecast.config import (
    ARCHIVE_MAX_LAG_BDAYS,
    MAX_ROW_LOSS_SHARE,
    STALE_CLOSE_BDAYS,
)
from soyforecast.freshness import business_days_between, chicago_now
from soyforecast.publish.archive import (
    ARCHIVE_DIR,
    INDEX,
    NAME_RE,
    REVISION_RE,
    build_lag_bdays,
    differences,
    load_archive,
    records_for,
    revision_of,
    snapshot,
)
from soyforecast.publish.schema import FILES, validate_payload

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
    """Every file exists and validates against its pydantic model (publish/schema.py)."""
    missing = [f for f in REQUIRED_FILES if not (data / f).exists()]
    if missing:
        return [f"missing file: {f}" for f in missing]
    meta = _json(data / "meta.json")
    if meta.get("schema_version") != schema_version:
        return [f"schema_version {meta.get('schema_version')} != {schema_version}"]
    problems: list[str] = []
    for name in FILES:
        try:
            validate_payload(name, _json(data / name))
        except ValidationError as exc:
            problems += [f"{name}: {_loc(e['loc'])}: {e['msg']}" for e in exc.errors()]
        except ValueError as exc:  # not JSON at all
            problems.append(f"{name}: {exc}")
    if problems:
        return problems
    if _json(data / "outlook.json")["as_of_close"] != meta["as_of_close"]:
        problems.append("outlook and meta disagree on as_of_close")
    if _csv_rows(data / "backtest.csv") == 0:
        problems.append("backtest.csv is empty")
    return problems


def _loc(loc: tuple[Any, ...]) -> str:
    return ".".join(str(p) for p in loc) or "(root)"


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


def check_revision_chain(data: Path) -> list[str]:
    """Every `.r<N>` record says it is revision N and follows revision N-1 of the same outlook.

    The tally scores revision 1 only, so a revision file whose content claimed `revision: 1`
    (or a broken `revises` link) would be scored twice or detached from its original.
    """
    records = load_archive(data)
    by_file = {r["file"]: r for r in records}
    problems = []
    for r in records:
        m = REVISION_RE.search(r["file"])
        n = int(m.group(1)) if m else 1
        if revision_of(r) != n:
            problems.append(f"archive {r['file']}: revision {revision_of(r)}, file name says {n}")
            continue
        if n == 1:
            continue
        prev = by_file.get(r.get("revises") or "")
        if (
            prev is None
            or revision_of(prev) != n - 1
            or prev["as_of_close"] != r["as_of_close"]
            or prev["latest_wasde"]["month"] != r["latest_wasde"]["month"]
        ):
            problems.append(
                f"archive {r['file']}: revises {r.get('revises')!r}, "
                f"not revision {n - 1} of the same outlook"
            )
    return problems


def check_archived(data: Path, meta: dict[str, Any]) -> list[str]:
    """The outlook on the site is on record, and its newest record shows the same numbers.

    A timely outlook must be archived (late rebuilds are left out on purpose). Whenever the
    outlook is archived, timely or not, its newest record must match outlook.json: a revised
    close is written as a new revision, so the site never silently differs from the record.
    """
    chain = check_revision_chain(data)
    if chain:
        return chain
    as_of, month = meta["as_of_close"], meta["latest_wasde"]["month"]
    records = records_for(load_archive(data), as_of, month)
    if not records:
        snap = {"as_of_close": as_of, "generated_at": meta["generated_at"]}
        if build_lag_bdays(snap) > ARCHIVE_MAX_LAG_BDAYS:
            return []
        return [f"outlook for {as_of} ({month} WASDE) is not archived"]
    newest = records[-1]
    diff = differences(newest, snapshot(meta, _json(data / "outlook.json")))
    if diff:
        return [
            f"newest archived record {newest['file']} differs from outlook.json: "
            + "; ".join(diff[:4])
        ]
    return []


# From this version on the pipeline publishes final sessions only (freshness.final_through);
# earlier data was published the same day and is not held to the rule.
FINAL_CLOSE_SINCE = (2, 1, 0)


def check_final_close(meta: dict[str, Any]) -> list[str]:
    """The as-of close is a session that had ended in Chicago before the outlook was built."""
    m = re.match(r"v?(\d+)\.(\d+)(?:\.(\d+))?", str(meta.get("version", "")))
    version = tuple(int(g or 0) for g in m.groups()) if m else (0, 0, 0)
    if version < FINAL_CLOSE_SINCE:
        return []
    built = chicago_now(datetime.fromisoformat(meta["generated_at"])).date().isoformat()
    if str(meta["as_of_close"]) >= built:
        return [
            f"as_of_close {meta['as_of_close']} was not a final session when built "
            f"(Chicago date {built})"
        ]
    return []


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
    report.problems += check_final_close(meta)
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
