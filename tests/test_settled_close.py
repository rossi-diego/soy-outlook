"""Only settled CBOT sessions are ever published, whatever triggers the run.

Regression for 2026-11-11: a manual run at 10:46 UTC (04:46 Chicago) published Yahoo's
partial 2026-11-11 session as that day's close and archived it as revision 1.
"""

from __future__ import annotations

import json
from datetime import UTC, date, datetime

import pandas as pd
import pytest
from typer.testing import CliRunner

from soyforecast.cli import app
from soyforecast.freshness import SourceLog, close_to_publish, settled_through
from soyforecast.ingest.prices import drop_unsettled, fetch_soy_prices


def utc(s: str) -> datetime:
    return datetime.fromisoformat(s).replace(tzinfo=UTC)


@pytest.mark.parametrize(
    ("now", "expected"),
    [
        ("2026-11-11T10:46", "2026-11-10"),  # the incident: 04:46 CST, today's session is open
        ("2026-11-11T19:29", "2026-11-10"),  # 13:29 CST, one minute before the guard
        ("2026-11-11T19:30", "2026-11-11"),  # 13:30 CST, at the guard
        ("2026-11-12T02:00", "2026-11-11"),  # 20:00 CST: Globex already trades the 12th
        ("2026-11-12T08:00", "2026-11-11"),  # 02:00 CST next day: a cron delayed past midnight
        ("2026-07-15T18:29", "2026-07-14"),  # CDT: 13:29 local
        ("2026-07-15T18:30", "2026-07-15"),  # CDT: 13:30 local
        ("2026-11-14T19:45", "2026-11-13"),  # Saturday -> Friday
        ("2026-11-16T10:00", "2026-11-13"),  # Monday morning -> Friday
        ("2026-11-16T05:30", "2026-11-13"),  # Sunday 23:30 CST (UTC Monday) -> Friday
        ("2026-03-09T19:45", "2026-03-09"),  # Monday after spring forward, 14:45 CDT
        ("2026-11-02T19:45", "2026-11-02"),  # Monday after fall back, 13:45 CST
    ],
)
def test_settled_through_is_the_last_closed_chicago_session(now, expected):
    assert settled_through(utc(now)) == date.fromisoformat(expected)


@pytest.mark.parametrize(
    ("published", "now", "expected"),
    [
        ("2026-11-10", "2026-11-11T10:46", False),  # the incident: nothing new has settled
        ("2026-11-10", "2026-11-11T19:45", True),  # the scheduled run after the close
        ("2026-11-11", "2026-11-11T23:30", False),  # already published: a second run is a no-op
        ("2026-11-10", "2026-11-12T08:00", True),  # delayed past Chicago midnight: catch up
        ("2026-11-12", "2026-11-12T08:00", False),  # a published close ahead of the clock
        ("2026-11-13", "2026-11-16T10:00", False),  # Monday morning, Friday on record
        (None, "2026-11-11T10:46", True),  # first publish
    ],
)
def test_close_guard_catches_up_and_never_runs_early(published, now, expected):
    assert close_to_publish(published, utc(now)) is expected


def _closes(*days: str) -> pd.Series:
    s = pd.Series([1100.0 + i for i in range(len(days))], index=pd.to_datetime(list(days)))
    s.index.name = "date"
    return s.rename("close_c_bu")


def test_drop_unsettled_removes_the_live_session_only():
    s = _closes("2026-11-09", "2026-11-10", "2026-11-11")
    kept = drop_unsettled(s, utc("2026-11-11T10:46"))
    assert list(kept.index.date) == [date(2026, 11, 9), date(2026, 11, 10)]
    assert drop_unsettled(s, utc("2026-11-11T19:45")).equals(s)
    assert drop_unsettled(s.iloc[:0], utc("2026-11-11T10:46")).empty


def test_fetch_never_stores_or_serves_an_unsettled_session(tmp_path):
    history = pd.Series(1000.0, index=pd.bdate_range("2025-01-01", "2026-11-11"), name="close_c_bu")
    log = SourceLog()
    # Live download at the incident time: the partial 11-11 bar is dropped before the cache.
    got = fetch_soy_prices(
        tmp_path, downloader=lambda *_: history, sources=log, now=utc("2026-11-11T10:46")
    )
    assert got.index.max() == pd.Timestamp("2026-11-10")
    stored = pd.read_parquet(tmp_path / "zs_daily.parquet")["close_c_bu"]
    assert stored.index.max() == pd.Timestamp("2026-11-10")
    assert log.sources["prices"].last == "2026-11-10"

    # A cache polluted by an earlier run is cut too when the download fails.
    history.to_frame().rename_axis("date").to_parquet(tmp_path / "zs_daily.parquet")

    def broken(*_):
        raise TimeoutError("network down")

    got = fetch_soy_prices(tmp_path, downloader=broken, sources=log, now=utc("2026-11-11T10:46"))
    assert got.index.max() == pd.Timestamp("2026-11-10")
    assert log.sources["prices"].status == "cache"
    # After the close the same session is taken.
    got = fetch_soy_prices(tmp_path, downloader=lambda *_: history, now=utc("2026-11-11T19:45"))
    assert got.index.max() == pd.Timestamp("2026-11-11")


def test_cli_close_guard_reads_the_published_close(tmp_path, monkeypatch):
    out = tmp_path / "gh_output"
    monkeypatch.setenv("GITHUB_OUTPUT", str(out))
    meta = tmp_path / "meta.json"
    runner = CliRunner()

    meta.write_text(json.dumps({"as_of_close": "2000-01-03"}), encoding="utf-8")
    res = runner.invoke(app, ["guard", "--event", "close", "--meta", str(meta)])
    assert res.exit_code == 0, res.output
    assert out.read_text().strip().endswith("should_run=true")

    meta.write_text(json.dumps({"as_of_close": "2999-01-01"}), encoding="utf-8")
    res = runner.invoke(app, ["guard", "--event", "close", "--meta", str(meta)])
    assert res.exit_code == 0, res.output
    assert out.read_text().strip().endswith("should_run=false")
