"""Outlook archive: every published outlook, frozen, then scored once its targets pass.

`archive/<as_of_close>.json` is append-only. A file is written the first time an outlook for
that close is published and is never rewritten, so what the site showed on a given day stays
on record whatever the code does later. If the same close is published again with a newer
WASDE report (the second refresh pass on a WASDE day), that outlook is archived as well, as
`archive/<as_of_close>_<wasde month>.json`. An outlook built more than ARCHIVE_MAX_LAG_BDAYS
business days after its close is published but not archived, so a late rebuild can never
backfill the record with hindsight. `archive/index.json` is rebuilt on every run: it
lists the archived outlooks and, for each horizon whose target date has passed, the CBOT
close realized on or before that date and whether it fell inside the 80% and 95% ranges.

Unlike the backtest, nothing in these rows was ever seen when a model or method was
chosen; once targets mature, this becomes the project's only genuinely unseen
out-of-sample track record.
"""

from __future__ import annotations

import json
import re
from datetime import datetime
from pathlib import Path
from typing import Any

import pandas as pd

from soyforecast.config import ARCHIVE_MAX_LAG_BDAYS
from soyforecast.features.dataset import close_on_or_before
from soyforecast.freshness import business_days_between, chicago_now
from soyforecast.logs import get_logger

log = get_logger(__name__)

ARCHIVE_DIR = "archive"
INDEX = "index.json"
ARCHIVE_SCHEMA_VERSION = 1
NAME_RE = re.compile(r"^\d{4}-\d{2}-\d{2}(_\d{4}-\d{2})?\.json$")

HORIZON_KEYS = ("h", "model", "target_date", "central", "q025", "q100", "q900", "q975")


def snapshot(meta: dict[str, Any], outlook: dict[str, Any]) -> dict[str, Any]:
    """The part of a published outlook that is archived (CBOT cents per bushel)."""
    return {
        "archive_schema_version": ARCHIVE_SCHEMA_VERSION,
        "as_of_close": outlook["as_of_close"],
        "generated_at": meta["generated_at"],
        "version": meta["version"],
        "latest_wasde": meta["latest_wasde"],
        "interval_method": meta["intervals"]["method"],
        "interval_centring": meta["intervals"]["centring"],
        "p0_c_bu": outlook["last"]["c_bu"],
        "horizons": [{k: h[k] for k in HORIZON_KEYS} for h in outlook["horizons"]],
    }


def build_lag_bdays(snap: dict[str, Any]) -> int:
    """Business days from the as-of close to the Chicago date the outlook was built."""
    built = chicago_now(datetime.fromisoformat(snap["generated_at"])).date()
    return business_days_between(snap["as_of_close"], built)


def archived_for(entries: list[dict[str, Any]], as_of: str, wasde_month: str) -> bool:
    """True when an outlook for this close and WASDE report is already archived."""
    return any(
        e["as_of_close"] == as_of and e["latest_wasde"]["month"] == wasde_month for e in entries
    )


def write_snapshot(snap: dict[str, Any], out: Path) -> Path | None:
    """Archive an outlook unless it is already on record or built too late. None if skipped.

    Append-only: an existing file is never touched. The first outlook for a close goes to
    <as_of>.json; a re-publish of that close with a newer WASDE goes to <as_of>_<month>.json.
    """
    folder = out / ARCHIVE_DIR
    folder.mkdir(parents=True, exist_ok=True)
    as_of, month = snap["as_of_close"], snap["latest_wasde"]["month"]
    lag = build_lag_bdays(snap)
    if lag > ARCHIVE_MAX_LAG_BDAYS:
        log.warning("archive.too_late", as_of=as_of, lag_bdays=lag, limit=ARCHIVE_MAX_LAG_BDAYS)
        return None
    if archived_for(load_archive(out), as_of, month):
        log.info("archive.exists", as_of=as_of, wasde=month)
        return None
    path = folder / f"{as_of}.json"
    if path.exists():
        path = folder / f"{as_of}_{month}.json"
    if path.exists():  # a file with that name but other content: never overwrite it
        log.warning("archive.name_taken", path=path.name)
        return None
    # LF on every OS, so the append-only byte comparison does not depend on where it ran.
    text = json.dumps(snap, ensure_ascii=False, indent=1)
    path.write_text(text, encoding="utf-8", newline="\n")
    log.info("archive.written", path=path.name)
    return path


def load_archive(out: Path) -> list[dict[str, Any]]:
    folder = out / ARCHIVE_DIR
    if not folder.exists():
        return []
    rows = []
    for p in sorted(folder.iterdir()):
        if NAME_RE.match(p.name):
            rows.append({**json.loads(p.read_text(encoding="utf-8")), "file": p.name})
    return rows


def score(entries: list[dict[str, Any]], prices: pd.Series) -> dict[str, Any]:
    """Published vs outcome for every archived outlook, given the closes known today."""
    last_close = prices.index.max()
    out_rows: list[dict[str, Any]] = []
    for e in entries:
        horizons = []
        for h in e["horizons"]:
            target = pd.Timestamp(h["target_date"])
            row: dict[str, Any] = {
                "h": h["h"],
                "model": h["model"],
                "target_date": h["target_date"],
                "central": h["central"],
                "low80": h["q100"],
                "high80": h["q900"],
                "low95": h["q025"],
                "high95": h["q975"],
                "status": "pending",
                "actual": None,
                "actual_date": None,
                "inside80": None,
                "inside95": None,
            }
            hit = close_on_or_before(prices, target) if target <= last_close else None
            if hit is not None:
                date, actual = hit
                row.update(
                    status="resolved",
                    actual=round(actual, 2),
                    actual_date=date.date().isoformat(),
                    inside80=bool(h["q100"] <= actual <= h["q900"]),
                    inside95=bool(h["q025"] <= actual <= h["q975"]),
                )
            horizons.append(row)
        out_rows.append(
            {
                "file": e.get("file"),
                "as_of_close": e["as_of_close"],
                "latest_wasde": e["latest_wasde"]["month"],
                "p0_c_bu": e["p0_c_bu"],
                "horizons": horizons,
            }
        )
    resolved = [h for r in out_rows for h in r["horizons"] if h["status"] == "resolved"]
    return {
        "archive_schema_version": ARCHIVE_SCHEMA_VERSION,
        "prices_through": last_close.date().isoformat(),
        "n_outlooks": len(out_rows),
        "n_resolved": len(resolved),
        "inside80": sum(bool(h["inside80"]) for h in resolved),
        "inside95": sum(bool(h["inside95"]) for h in resolved),
        "entries": sorted(
            out_rows, key=lambda r: (r["as_of_close"], r["latest_wasde"]), reverse=True
        ),
    }


def publish_archive(
    meta: dict[str, Any], outlook: dict[str, Any], prices: pd.Series, out: Path
) -> dict[str, Any]:
    """Archive today's outlook (if new) and rewrite archive/index.json."""
    write_snapshot(snapshot(meta, outlook), out)
    index = score(load_archive(out), prices)
    (out / ARCHIVE_DIR / INDEX).write_text(
        json.dumps(index, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
    )
    log.info("archive.index", outlooks=index["n_outlooks"], resolved=index["n_resolved"])
    return index
