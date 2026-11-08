"""P23: close guard, freshness block, source status, outlook archive and validation gate."""

from __future__ import annotations

import json
import shutil
from datetime import UTC, datetime
from pathlib import Path

import pandas as pd
import pytest
from typer.testing import CliRunner

from soyforecast import fixtures
from soyforecast.cli import app
from soyforecast.freshness import (
    SourceLog,
    business_days_between,
    cbot_closed_today,
    freshness_block,
    is_wasde_day,
)
from soyforecast.ingest.prices import fetch_soy_prices
from soyforecast.publish.archive import load_archive, publish_archive, score
from soyforecast.publish.schema import SCHEMA_VERSION
from soyforecast.publish.validate import validate

FIXTURES = Path(__file__).parent / "fixtures" / "bronze"


# ---------------------------------------------------------------- close guard and freshness


@pytest.mark.parametrize(
    ("utc", "expected"),
    [
        # The scheduled cron (19:45 UTC) is after the 13:20 CT close in both seasons.
        ("2026-01-14T19:45", True),  # CST: 13:45 local
        ("2026-07-15T19:45", True),  # CDT: 14:45 local
        # A run that fires early (or a misconfigured cron) is skipped in either season.
        ("2026-01-14T19:15", False),  # CST: 13:15 local, before the guard
        ("2026-07-15T18:15", False),  # CDT: 13:15 local
        ("2026-07-15T18:30", True),  # CDT: 13:30 local, exactly at the guard
        # Weekends never run, even when UTC is still Friday evening in Chicago terms.
        ("2026-11-07T19:45", False),  # Saturday
        ("2026-11-07T02:00", True),  # Friday 20:00 CST (UTC already Saturday)
        # DST switch days keep working: 2026-03-09 (Mon after spring forward), 2026-11-02.
        ("2026-03-09T19:45", True),
        ("2026-11-02T19:45", True),
    ],
)
def test_close_guard_is_dst_safe(utc, expected):
    now = datetime.fromisoformat(utc).replace(tzinfo=UTC)
    assert cbot_closed_today(now) is expected


def test_business_days_between_counts_weekdays_after_start():
    assert business_days_between("2026-11-06", "2026-11-06") == 0
    assert business_days_between("2026-11-06", "2026-11-07") == 0  # Fri -> Sat
    assert business_days_between("2026-11-06", "2026-11-09") == 1  # Fri -> Mon
    assert business_days_between("2026-11-06", "2026-11-11") == 3
    assert business_days_between("2026-11-06", "2026-11-12") == 4
    assert business_days_between("2026-11-09", "2026-11-06") == 0


def test_wasde_day_uses_the_chicago_date():
    late_evening = datetime(2026, 11, 11, 3, 0, tzinfo=UTC)  # 21:00 CST on Nov 10
    assert is_wasde_day("2026-11-10", late_evening)
    assert not is_wasde_day("2026-11-10", datetime(2026, 11, 11, 15, 0, tzinfo=UTC))
    assert not is_wasde_day(None, late_evening)


def test_freshness_block_flags_cache_fallbacks_only():
    log = SourceLog()
    log.record("prices", "live", pd.Timestamp("2026-11-06"))
    log.record("ptax", "offline", pd.Timestamp("2026-11-06"))
    block = freshness_block(
        pd.Timestamp("2026-11-06"), datetime(2026, 11, 10, 2, tzinfo=UTC), "2026-11-10", log, False
    )
    assert block["degraded"] is False
    assert block["bdays_close_to_generated"] == 1  # Monday evening in Chicago
    assert block["sources"]["prices"] == {"status": "live", "last": "2026-11-06", "detail": None}
    log.record("ptax", "cache", "2026-11-05", "timeout")
    block = freshness_block("2026-11-06", datetime(2026, 11, 7, tzinfo=UTC), None, log, True)
    assert block["degraded"] is True and block["degraded_sources"] == ["ptax"]
    assert block["mode"] == "offline"


def test_price_fetch_records_live_cache_and_offline(tmp_path):
    prices = fixtures.synthetic_prices("2020-01-31")
    log = SourceLog()
    fetch_soy_prices(tmp_path, downloader=lambda *_: prices, sources=log)
    assert log.sources["prices"].status == "live"
    assert log.sources["prices"].last == "2020-01-31"

    def broken(*_):
        raise TimeoutError("network down")

    fetch_soy_prices(tmp_path, downloader=broken, sources=log)
    assert log.sources["prices"].status == "cache"
    assert log.degraded == ["prices"]
    fetch_soy_prices(tmp_path, offline=True, sources=log)
    assert log.sources["prices"].status == "offline"


# ---------------------------------------------------------------- archive


def _meta_outlook(as_of: str, p0: float = 1000.0) -> tuple[dict, dict]:
    meta = {
        "generated_at": f"{as_of}T20:00:00+00:00",
        "version": "test",
        "latest_wasde": {"month": "2026-10", "release_date": "2026-10-09"},
        "intervals": {"method": "empirical quantiles of past errors", "centring": "median"},
    }
    horizons = [
        {
            "h": h,
            "model": "rw",
            "target_date": (pd.Timestamp(as_of) + pd.DateOffset(months=h)).date().isoformat(),
            "central": p0,
            "q025": p0 * 0.8,
            "q100": p0 * 0.9,
            "q900": p0 * 1.1,
            "q975": p0 * 1.2,
        }
        for h in (1, 3, 6)
    ]
    outlook = {"as_of_close": as_of, "last": {"c_bu": p0}, "horizons": horizons}
    return meta, outlook


def test_archive_is_append_only_and_scored_once_targets_pass(tmp_path):
    meta, outlook = _meta_outlook("2026-01-09")
    prices = pd.Series(1000.0, index=pd.bdate_range("2025-12-01", "2026-04-30"))
    publish_archive(meta, outlook, prices, tmp_path)
    first = (tmp_path / "archive" / "2026-01-09.json").read_bytes()

    # A later run for the same close (different code, different numbers) never rewrites it.
    meta2, outlook2 = _meta_outlook("2026-01-09", p0=2000.0)
    publish_archive(meta2, outlook2, prices, tmp_path)
    assert (tmp_path / "archive" / "2026-01-09.json").read_bytes() == first

    prices.loc[pd.Timestamp("2026-02-09")] = 1150.0  # 1m target: inside 95%, outside 80%
    index = score(load_archive(tmp_path), prices)
    h = {r["h"]: r for r in index["entries"][0]["horizons"]}
    assert h[1]["status"] == "resolved" and h[1]["actual"] == 1150.0
    assert h[1]["inside80"] is False and h[1]["inside95"] is True
    assert h[3]["status"] == "resolved" and h[3]["inside80"] is True
    assert h[6]["status"] == "pending" and h[6]["actual"] is None
    assert index["n_resolved"] == 2


def test_archive_outcome_uses_only_closes_on_or_before_the_target(tmp_path):
    meta, outlook = _meta_outlook("2026-01-09")
    prices = pd.Series(
        [1000.0, 1300.0], index=pd.to_datetime(["2026-02-06", "2026-02-09"])
    )  # target 2026-02-09 (Monday) exists; earlier target uses Friday
    publish_archive(meta, outlook, prices, tmp_path)
    index = json.loads((tmp_path / "archive" / "index.json").read_text())
    h1 = index["entries"][0]["horizons"][0]
    assert h1["target_date"] == "2026-02-09" and h1["actual"] == 1300.0
    assert index["prices_through"] == "2026-02-09"


def test_archive_keeps_a_wasde_day_republish_and_skips_late_rebuilds(tmp_path):
    prices = pd.Series(1000.0, index=pd.bdate_range("2025-12-01", "2026-01-30"))
    meta, outlook = _meta_outlook("2026-01-09")
    publish_archive(meta, outlook, prices, tmp_path)

    # Same close, newer WASDE (second pass on a release day): archived alongside, not over.
    meta_w = dict(meta, latest_wasde={"month": "2026-11", "release_date": "2026-01-09"})
    publish_archive(meta_w, outlook, prices, tmp_path)
    publish_archive(meta_w, outlook, prices, tmp_path)  # a rerun adds nothing
    names = sorted(p.name for p in (tmp_path / "archive").glob("2026-*.json"))
    assert names == ["2026-01-09.json", "2026-01-09_2026-11.json"]
    index = json.loads((tmp_path / "archive" / "index.json").read_text())
    assert [e["latest_wasde"] for e in index["entries"]] == ["2026-11", "2026-10"]

    # Built two business days after its close (e.g. an offline rebuild on an old cache):
    # published, but never archived, so the unseen record cannot be backfilled.
    late_meta, late_outlook = _meta_outlook("2026-01-14")
    late_meta["generated_at"] = "2026-01-16T20:00:00+00:00"
    index = publish_archive(late_meta, late_outlook, prices, tmp_path)
    assert not (tmp_path / "archive" / "2026-01-14.json").exists()
    assert index["n_outlooks"] == 2
    late_meta["generated_at"] = "2026-01-15T20:00:00+00:00"  # one business day: archived
    assert publish_archive(late_meta, late_outlook, prices, tmp_path)["n_outlooks"] == 3


# ---------------------------------------------------------------- validation gate and fixtures


def test_committed_fixtures_match_the_generator(tmp_path):
    fixtures.write_fixtures(tmp_path)
    for name in ("wasde_full.parquet", "zs_daily.parquet", "ptax_daily.parquet"):
        pd.testing.assert_frame_equal(
            pd.read_parquet(tmp_path / name), pd.read_parquet(FIXTURES / name)
        )
    manifest = json.loads((FIXTURES / "wasde_manifest.json").read_text())
    assert manifest["source"].startswith("synthetic")


def test_offline_fixture_run_passes_the_gate(published):
    meta = json.loads((published / "meta.json").read_text(encoding="utf-8"))
    fresh = meta["freshness"]
    assert fresh["mode"] == "offline" and fresh["degraded"] is False
    assert set(fresh["sources"]) == {"prices", "ptax", "wasde"}
    assert (published / "archive" / f"{meta['as_of_close']}.json").exists()
    now = datetime(2026, 11, 9, 21, tzinfo=UTC)  # Monday, one business day later
    assert validate(published, meta["schema_version"], now=now).ok
    late = validate(published, meta["schema_version"], now=datetime(2026, 11, 13, tzinfo=UTC))
    assert late.stale and not late.ok and "business days old" in late.problems[0]
    assert validate(
        published,
        meta["schema_version"],
        now=datetime(2026, 11, 13, tzinfo=UTC),
        require_fresh=False,
    ).ok


def test_gate_rejects_regressions_against_the_baseline(published, tmp_path):
    new = tmp_path / "new"
    shutil.copytree(published, new)
    now = datetime(2026, 11, 9, 21, tzinfo=UTC)
    meta = json.loads((new / "meta.json").read_text(encoding="utf-8"))
    sv = meta["schema_version"]
    assert validate(new, sv, baseline=published, now=now).ok

    old = tmp_path / "old"
    shutil.copytree(published, old)
    old_meta = dict(meta, as_of_close="2026-11-09")
    (old / "meta.json").write_text(json.dumps(old_meta), encoding="utf-8")
    (old / "archive" / "2026-10-30.json").write_text("{}", encoding="utf-8")
    lines = (new / "backtest.csv").read_text(encoding="utf-8").splitlines()
    (new / "backtest.csv").write_text("\n".join(lines[: len(lines) // 2]), encoding="utf-8")
    problems = validate(new, sv, baseline=old, now=now).problems
    assert any("went backwards" in p for p in problems)
    assert any("backtest rows fell" in p for p in problems)
    assert any("archived outlook removed: 2026-10-30.json" in p for p in problems)


def test_gate_requires_a_timely_outlook_to_be_archived(published, tmp_path):
    data = tmp_path / "data"
    shutil.copytree(published, data)
    meta = json.loads((data / "meta.json").read_text(encoding="utf-8"))
    now = datetime(2026, 11, 9, 21, tzinfo=UTC)
    (data / "archive" / f"{meta['as_of_close']}.json").unlink()
    problems = validate(data, meta["schema_version"], now=now).problems
    assert problems == [f"outlook for {meta['as_of_close']} (2026-10 WASDE) is not archived"]
    # A late rebuild is not archived on purpose, and the gate accepts that.
    meta["generated_at"] = "2026-11-11T21:00:00+00:00"
    (data / "meta.json").write_text(json.dumps(meta), encoding="utf-8")
    assert validate(data, meta["schema_version"], now=now).ok


def test_gate_rejects_bad_shape(published, tmp_path):
    bad = tmp_path / "bad"
    shutil.copytree(published, bad)
    outlook = json.loads((bad / "outlook.json").read_text(encoding="utf-8"))
    outlook["horizons"][0]["q900"] = outlook["horizons"][0]["q025"] - 1
    outlook["horizons"][1]["q500"] = None
    (bad / "outlook.json").write_text(json.dumps(outlook), encoding="utf-8")
    problems = validate(bad, SCHEMA_VERSION, now=datetime(2026, 11, 9, tzinfo=UTC)).problems
    assert any("not monotone" in p for p in problems)
    assert any(p.startswith("outlook.json: horizons.1.q500:") for p in problems)
    assert (
        validate(bad, 99, now=datetime(2026, 11, 9, tzinfo=UTC))
        .problems[0]
        .startswith("schema_version")
    )
    (bad / "wasde.json").unlink()
    assert validate(bad, 2).problems == ["missing file: wasde.json"]


def test_cli_validate_and_guard_write_github_outputs(published, tmp_path, monkeypatch):
    out = tmp_path / "gh_output"
    monkeypatch.setenv("GITHUB_OUTPUT", str(out))
    monkeypatch.setenv("GITHUB_STEP_SUMMARY", str(tmp_path / "summary.md"))
    runner = CliRunner()
    res = runner.invoke(app, ["validate", "--data", str(published), "--allow-stale"])
    assert res.exit_code == 0, res.output
    text = out.read_text()
    assert "ok=true" in text and "degraded=false" in text
    assert "Data validation gate" in (tmp_path / "summary.md").read_text()
    res = runner.invoke(app, ["guard", "--event", "wasde", "--meta", str(published / "meta.json")])
    assert res.exit_code == 0 and "should_run=" in out.read_text()
    assert runner.invoke(app, ["guard", "--event", "nope"]).exit_code != 0
