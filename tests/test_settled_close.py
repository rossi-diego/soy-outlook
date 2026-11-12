"""Only final front-month sessions are ever published, whatever triggers the run.

Regressions for three real incidents:
* 2026-11-11 10:46 UTC (04:46 Chicago): a manual run published Yahoo's moving 2026-11-11 bar;
* 2026-11-10 02:24 UTC (20:24 Chicago on the 9th): a delayed cron published the 2026-11-09 bar
  while it moved with overnight Globex trades (1192.5 against a 1182.25 settlement);
* 2026-11-06/09: ZS=F's newest bars quoted F27 while the series was still X26 (Yahoo moves the
  continuous symbol to the liquid contract before the front expires), and were rewritten later.
"""

from __future__ import annotations

import json
from datetime import UTC, date, datetime

import pandas as pd
import pytest
from typer.testing import CliRunner

from soyforecast.cli import app
from soyforecast.freshness import (
    SourceLog,
    close_to_publish,
    final_through,
    previous_weekday,
    trade_date,
)
from soyforecast.ingest.prices import (
    CACHE_FILE,
    CACHE_META,
    confirm_newest_settlement,
    contract_symbol,
    drop_unfinal,
    fetch_soy_prices,
    stitch_front_contracts,
)
from soyforecast.publish.archive import load_archive, revised_close_snapshots, write_snapshot
from soyforecast.publish.validate import check_final_close


def utc(s: str) -> datetime:
    return datetime.fromisoformat(s).replace(tzinfo=UTC)


# ---------------------------------------------------------------- the final-bar rule


def test_final_through_is_a_weekday_before_today_in_chicago_at_every_hour():
    """Hourly over a year (both DST switches): never today, never a weekend, never stale."""
    for now in pd.date_range("2026-01-01", "2027-01-01", freq="h", tz="UTC"):
        local_day = now.tz_convert("America/Chicago").date()
        got = final_through(now.to_pydatetime())
        assert got < local_day and got.weekday() < 5
        assert (pd.Timestamp(local_day) - pd.Timestamp(got)).days <= 3


@pytest.mark.parametrize(
    ("now", "expected"),
    [
        ("2026-11-11T10:46", "2026-11-10"),  # incident 1: 04:46 CST, today's bar is moving
        (
            "2026-11-10T02:24",
            "2026-11-06",
        ),  # incident 2: 20:24 CST Mon 9th -> Fri 6th, never the 9th
        ("2026-11-11T19:45", "2026-11-10"),  # after today's close: still not today's bar
        ("2026-11-12T05:59", "2026-11-10"),  # 23:59 CST on the 11th
        ("2026-11-12T06:00", "2026-11-11"),  # Chicago midnight (CST): the 11th is final
        ("2026-07-16T04:59", "2026-07-14"),  # 23:59 CDT on the 15th
        ("2026-07-16T05:00", "2026-07-15"),  # Chicago midnight (CDT)
        ("2026-11-12T16:00", "2026-11-11"),  # the scheduled run, 10:00 CST
        ("2026-11-14T16:00", "2026-11-13"),  # Saturday run -> Friday
        ("2026-11-16T05:30", "2026-11-13"),  # Sunday 23:30 CST (UTC Monday) -> Friday
        ("2026-11-16T16:00", "2026-11-13"),  # Monday -> Friday
        ("2026-03-09T16:00", "2026-03-06"),  # Monday after spring forward
        ("2026-11-02T16:00", "2026-10-30"),  # Monday after fall back
    ],
)
def test_final_through_spot_checks(now, expected):
    assert final_through(utc(now)) == date.fromisoformat(expected)


@pytest.mark.parametrize(
    ("published", "now", "expected"),
    [
        ("2026-11-10", "2026-11-11T10:46", False),  # incident 1: nothing newer is final
        ("2026-11-06", "2026-11-10T02:24", False),  # incident 2: the 9th is not final yet
        ("2026-11-10", "2026-11-12T16:00", True),  # the morning run publishes the 11th
        ("2026-11-11", "2026-11-12T20:00", False),  # the retry is a no-op
        ("2026-11-10", "2026-11-13T02:00", True),  # a run delayed into the evening catches up
        ("2026-11-13", "2026-11-16T16:00", False),  # Monday, Friday on record
        (None, "2026-11-11T10:46", True),  # first publish
    ],
)
def test_close_guard_catches_up_and_never_publishes_today(published, now, expected):
    assert close_to_publish(published, utc(now)) is expected


def _closes(days, values=None) -> pd.Series:
    idx = pd.to_datetime(list(days))
    vals = values if values is not None else [1100.0 + i for i in range(len(idx))]
    return pd.Series(vals, index=idx, dtype="float64", name="close_c_bu")


def test_drop_unfinal_never_keeps_todays_bar():
    s = _closes(["2026-11-06", "2026-11-09", "2026-11-10", "2026-11-11"])
    assert list(drop_unfinal(s, utc("2026-11-11T10:46")).index.date)[-1] == date(2026, 11, 10)
    assert list(drop_unfinal(s, utc("2026-11-12T16:00")).index.date)[-1] == date(2026, 11, 11)
    assert drop_unfinal(s.iloc[:0], utc("2026-11-11T10:46")).empty


# ---------------------------------------------------------------- front contract stitching


def _yahoo(zs_f: pd.Series, contracts: dict[str, pd.Series]):
    """A fake downloader: ZS=F plus the listed contract symbols; anything else is unlisted."""

    def download(ticker: str, start: str) -> pd.Series:
        if ticker == "ZS=F":
            return zs_f
        code = ticker.removeprefix("ZS").removesuffix(".CBT")
        if code in contracts:
            return contracts[code]
        raise ValueError(f"Quote not found for symbol: {ticker}")

    return download


def _incident_market():
    """2026-11: ZS=F history is X26 but its newest bars quote F27 (as Yahoo showed on the 11th)."""
    days = pd.bdate_range("2026-07-01", "2026-11-11")
    x26 = pd.Series(1100.0, index=days, name="c")
    x26.loc["2026-11-06"], x26.loc["2026-11-09"], x26.loc["2026-11-10"] = 1189.0, 1182.25, 1224.5
    f27 = x26 + 6.0
    f27.loc["2026-11-06"], f27.loc["2026-11-09"] = 1193.75, 1188.25
    zs_f = x26.copy()
    zs_f.loc["2026-11-06"], zs_f.loc["2026-11-09"] = 1193.75, 1192.5  # F27 / overnight prints
    zs_f.loc["2026-11-11"] = 1231.5  # today's moving bar
    return zs_f, {"X26": x26, "F27": f27}


def test_recent_sessions_come_from_the_front_contract_not_zs_f():
    zs_f, contracts = _incident_market()
    got = stitch_front_contracts(zs_f, _yahoo(zs_f, contracts), utc("2026-11-11T16:00"))
    assert got.index.max() == pd.Timestamp("2026-11-10")
    # X26 is the front until its last trading day (13 Nov): its settlements, not F27's.
    assert got.loc["2026-11-06"] == 1189.0
    assert got.loc["2026-11-09"] == 1182.25
    assert got.loc["2026-11-10"] == 1224.5
    # Older than the window: ZS=F as before.
    assert got.loc["2026-07-01"] == 1100.0


def test_after_the_roll_the_next_contract_is_the_front():
    days = pd.bdate_range("2026-10-01", "2026-11-20")
    x26 = pd.Series(1100.0, index=days[days <= "2026-11-13"])
    f27 = pd.Series(1110.0, index=days)
    zs_f = pd.Series(1000.0, index=days)  # deliberately wrong everywhere
    got = stitch_front_contracts(
        zs_f, _yahoo(zs_f, {"X26": x26, "F27": f27}), utc("2026-11-20T16:00")
    )
    assert got.loc["2026-11-13"] == 1100.0  # X26's last trading day
    assert got.loc["2026-11-16"] == 1110.0  # F27 from the next session
    assert got.index.max() == pd.Timestamp("2026-11-19")


def test_a_recent_session_without_its_contract_ends_the_series_before_it():
    zs_f, contracts = _incident_market()
    x26 = contracts["X26"].drop(pd.Timestamp("2026-11-09"))  # Yahoo lost one X26 bar
    got = stitch_front_contracts(
        zs_f, _yahoo(zs_f, {**contracts, "X26": x26}), utc("2026-11-11T16:00")
    )
    assert got.index.max() == pd.Timestamp("2026-11-06")  # never ZS=F's 1192.5 for the 9th


def test_an_expired_contract_gone_from_yahoo_is_replaced_by_the_trusted_cache():
    zs_f, contracts = _incident_market()
    trusted = contracts["X26"][contracts["X26"].index <= "2026-11-10"]
    gone = {"F27": contracts["F27"]}  # X26 delisted
    got = stitch_front_contracts(zs_f, _yahoo(zs_f, gone), utc("2026-11-11T16:00"), trusted)
    assert got.loc["2026-11-09"] == 1182.25 and got.index.max() == pd.Timestamp("2026-11-10")


def test_contract_symbols():
    assert contract_symbol("F27") == "ZSF27.CBT"


# ---------------------------------------------------------------- fetch and cache


def test_fetch_publishes_final_front_month_and_marks_the_cache(tmp_path):
    zs_f, contracts = _incident_market()
    log = SourceLog()
    got = fetch_soy_prices(
        tmp_path, downloader=_yahoo(zs_f, contracts), sources=log, now=utc("2026-11-11T10:46")
    )
    assert got.index.max() == pd.Timestamp("2026-11-10")
    assert got.loc["2026-11-09"] == 1182.25
    assert log.sources["prices"].status == "live"
    meta = json.loads((tmp_path / CACHE_META).read_text(encoding="utf-8"))
    assert meta["final_through"] == "2026-11-10"

    def broken(*_):
        raise TimeoutError("network down")

    # Cache fallback serves the stored final rows only.
    got = fetch_soy_prices(tmp_path, downloader=broken, sources=log, now=utc("2026-11-12T16:00"))
    assert got.index.max() == pd.Timestamp("2026-11-10")
    assert log.sources["prices"].status == "cache"


def test_a_legacy_cache_loses_its_newest_rows(tmp_path):
    """A cache from before the final-bar rule may hold a moving bar at its end."""
    zs_f, _ = _incident_market()
    zs_f.rename("close_c_bu").to_frame().rename_axis("date").to_parquet(tmp_path / CACHE_FILE)

    def broken(*_):
        raise TimeoutError("network down")

    got = fetch_soy_prices(tmp_path, downloader=broken, now=utc("2026-11-12T16:00"))
    assert got.index.max() < pd.Timestamp("2026-11-06")  # the F27 and overnight prints are gone


def test_offline_mode_is_untouched(tmp_path):
    s = _closes(["2026-11-05", "2026-11-06"])
    s.to_frame().rename_axis("date").to_parquet(tmp_path / CACHE_FILE)
    got = fetch_soy_prices(tmp_path, offline=True, now=utc("2026-11-06T10:00"))
    assert got.index.max() == pd.Timestamp("2026-11-06")


# ---------------------------------------------------------------- archive revisions and gate


def _record(as_of: str, p0: float) -> dict:
    return {
        "archive_schema_version": 1,
        "as_of_close": as_of,
        "generated_at": f"{as_of}T20:25:00+00:00",
        "version": "2.0.0",
        "latest_wasde": {"month": "2026-10", "release_date": "2026-10-09"},
        "interval_method": "empirical quantiles of past errors",
        "interval_centring": "median",
        "p0_c_bu": p0,
        "horizons": [
            {
                "h": h,
                "model": "rw",
                "target_date": "2026-12-09",
                "central": p0,
                "q025": round(p0 * 0.9, 2),
                "q100": round(p0 * 0.95, 2),
                "q900": round(p0 * 1.05, 2),
                "q975": round(p0 * 1.1, 2),
            }
            for h in (1, 3, 6)
        ],
    }


def test_an_archived_close_that_settled_differently_gets_a_visible_revision(tmp_path):
    folder = tmp_path / "archive"
    folder.mkdir()
    (folder / "2026-11-09.json").write_text(
        json.dumps(_record("2026-11-09", 1192.5)), encoding="utf-8"
    )
    (folder / "2026-11-06.json").write_text(
        json.dumps(_record("2026-11-06", 1189.1)), encoding="utf-8"
    )
    prices = _closes(["2026-11-06", "2026-11-09"], [1189.0, 1182.25])
    meta = {"generated_at": "2026-11-12T16:00:00+00:00", "version": "2.1.0"}
    snaps = revised_close_snapshots(load_archive(tmp_path), prices, meta)
    assert [s["as_of_close"] for s in snaps] == [
        "2026-11-09"
    ]  # 0.1c on the 6th is within tolerance
    for s in snaps:
        write_snapshot(s, tmp_path)
    rev = json.loads((folder / "2026-11-09.r2.json").read_text(encoding="utf-8"))
    assert rev["revision"] == 2 and rev["revises"] == "2026-11-09.json"
    assert rev["revision_reason"] == "close revised"
    assert rev["p0_c_bu"] == 1182.25
    ratio = 1182.25 / 1192.5
    h1 = rev["horizons"][0]
    assert h1["central"] == 1182.25 and h1["q100"] == round(round(1192.5 * 0.95, 2) * ratio, 2)
    assert json.loads((folder / "2026-11-09.json").read_text(encoding="utf-8"))["p0_c_bu"] == 1192.5
    # Idempotent: the revision now matches, so a second run writes nothing.
    assert revised_close_snapshots(load_archive(tmp_path), prices, meta) == []


@pytest.mark.parametrize(
    ("version", "as_of", "generated", "ok"),
    [
        ("2.1.0", "2026-11-10", "2026-11-11T16:00:00+00:00", True),
        ("2.1.0", "2026-11-11", "2026-11-11T16:00:00+00:00", False),  # same Chicago day
        ("2.1.0", "2026-11-09", "2026-11-10T02:24:00+00:00", False),  # 20:24 CST on the 9th
        ("2.0.0", "2026-11-09", "2026-11-10T02:25:00+00:00", True),  # older data: not held to it
    ],
)
def test_gate_rejects_a_close_that_was_not_final_when_built(version, as_of, generated, ok):
    meta = {"version": version, "as_of_close": as_of, "generated_at": generated}
    assert (check_final_close(meta) == []) is ok


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


# ---------------------------------------------------------------- newest session at its settlement


@pytest.mark.parametrize(
    ("now", "expected"),
    [
        ("2026-11-11T16:00", "2026-11-11"),  # Wed 10:00 CST: Wednesday's session
        ("2026-11-12T00:59", "2026-11-11"),  # 18:59 CST: still Wednesday's
        ("2026-11-12T01:00", "2026-11-12"),  # 19:00 CST: Thursday's opened
        ("2026-11-14T16:00", "2026-11-13"),  # Saturday: Friday's
        ("2026-11-16T00:59", "2026-11-13"),  # Sunday 18:59 CST: Friday's
        ("2026-11-16T01:00", "2026-11-16"),  # Sunday 19:00 CST: Monday's opened
        ("2026-07-16T00:00", "2026-07-16"),  # CDT: 19:00 local on the 15th opens the 16th
        ("2026-07-15T23:59", "2026-07-15"),  # CDT: 18:59 local
    ],
)
def test_trade_date_follows_the_19_00_session_open(now, expected):
    assert trade_date(utc(now)) == date.fromisoformat(expected)


def test_previous_weekday_skips_weekends():
    assert previous_weekday(date(2026, 11, 16)) == date(2026, 11, 13)
    assert previous_weekday(date(2026, 11, 12)) == date(2026, 11, 11)


def _series_through(last: str) -> pd.Series:
    days = pd.bdate_range("2026-10-01", last)
    return pd.Series(1200.0, index=days, name="close_c_bu")


def _quote(settle, stamp):
    seen = []

    def q(symbol):
        seen.append(symbol)
        return settle, (utc(stamp) if stamp else None)

    q.seen = seen
    return q


@pytest.mark.settlement
def test_newest_bar_is_replaced_by_the_settlement_the_morning_after():
    s = _series_through("2026-11-11")
    s.loc["2026-11-11"] = 1229.75  # the bar Yahoo showed at 19:30 CST: an overnight print
    q = _quote(1230.75, "2026-11-12T15:55")  # Thursday's session is trading
    got, _ = confirm_newest_settlement(s, q, utc("2026-11-12T16:00"))
    assert got.loc["2026-11-11"] == 1230.75
    assert q.seen == ["ZSX26.CBT"]  # X26 is the front until its last trading day, 13 Nov
    assert got.loc["2026-11-10"] == 1200.0


@pytest.mark.settlement
def test_monday_confirms_friday_and_saturday_cannot():
    s = _series_through("2026-11-20")  # an ordinary Friday (F27 is the front)
    monday, _ = confirm_newest_settlement(
        s, _quote(1210.0, "2026-11-23T15:50"), utc("2026-11-23T16:00")
    )
    assert monday.loc["2026-11-20"] == 1210.0
    # On Saturday the quote still describes Friday's session, so its previous close is Thursday's.
    saturday, _ = confirm_newest_settlement(
        s, _quote(1205.0, "2026-11-20T19:20"), utc("2026-11-21T16:00")
    )
    assert saturday.index.max() == pd.Timestamp("2026-11-19")


@pytest.mark.settlement
@pytest.mark.parametrize(
    ("settle", "stamp", "now", "why"),
    [
        (None, None, "2026-11-12T16:00", "quote unavailable"),
        (1230.75, "2026-11-11T19:20", "2026-11-12T16:00", "stale quote from the previous session"),
        (
            1231.0,
            "2026-11-12T01:55",
            "2026-11-12T02:00",
            "run delayed past 19:00 CT: quote is a day ahead",
        ),
        (float("nan"), "2026-11-12T15:55", "2026-11-12T16:00", "non-finite settlement"),
    ],
)
def test_newest_session_is_held_back_without_a_matching_settlement(settle, stamp, now, why):
    s = _series_through("2026-11-11" if now >= "2026-11-12T06" else "2026-11-10")
    got, _ = confirm_newest_settlement(s, _quote(settle, stamp), utc(now))
    assert got.index.max() == s.index[-2], why


@pytest.mark.settlement
def test_a_session_already_stored_as_final_needs_no_quote():
    s = _series_through("2026-11-11")
    trusted = s.copy()
    trusted.loc["2026-11-11"] = 1230.75
    q = _quote(None, None)
    got, _ = confirm_newest_settlement(s, q, utc("2026-11-12T20:00"), trusted)
    assert got.loc["2026-11-11"] == 1230.75 and q.seen == []


@pytest.mark.settlement
def test_fetch_end_to_end_publishes_the_settlement_not_the_overnight_print(tmp_path):
    zs_f, contracts = _incident_market()
    contracts["X26"].loc["2026-11-11"] = 1229.25  # bar during the overnight session
    q = _quote(1229.0, "2026-11-12T15:55")  # X26 settled 1229.00 on the 11th
    got = fetch_soy_prices(
        tmp_path, downloader=_yahoo(zs_f, contracts), now=utc("2026-11-12T16:00"), quote=q
    )
    assert got.index.max() == pd.Timestamp("2026-11-11") and got.loc["2026-11-11"] == 1229.0
    assert got.loc["2026-11-09"] == 1182.25


@pytest.mark.settlement
def test_a_quote_from_the_session_right_after_the_newest_one_is_enough():
    """Wednesday was held back (or a holiday): on Thursday a quote still timed in Wednesday's
    session carries Tuesday's settlement, which is what the newest session needs."""
    s = _series_through("2026-11-10")
    got, _ = confirm_newest_settlement(
        s, _quote(1224.5, "2026-11-11T18:00"), utc("2026-11-12T16:00")
    )
    assert got.loc["2026-11-10"] == 1224.5


@pytest.mark.settlement
def test_a_confirmed_settlement_beats_the_bar_on_later_runs(tmp_path):
    """Run 1 confirms the 11th from the quote; run 2 must not swap it for the 11th's bar."""
    zs_f, contracts = _incident_market()
    days = pd.bdate_range("2026-07-01", "2026-11-12")
    x26 = contracts["X26"].reindex(days, fill_value=1100.0)
    x26.loc["2026-11-11"], x26.loc["2026-11-12"] = 1229.25, 1240.0  # bars, not settlements
    contracts = {**contracts, "X26": x26}
    zs_f = zs_f.reindex(days, fill_value=1100.0)
    yahoo = _yahoo(zs_f, contracts)
    fetch_soy_prices(
        tmp_path,
        downloader=yahoo,
        now=utc("2026-11-12T16:00"),
        quote=_quote(1229.0, "2026-11-12T15:55"),
    )
    got = fetch_soy_prices(
        tmp_path,
        downloader=yahoo,
        now=utc("2026-11-13T16:00"),
        quote=_quote(1238.5, "2026-11-13T15:55"),
    )
    assert got.loc["2026-11-11"] == 1229.0 and got.loc["2026-11-12"] == 1238.5
    side = json.loads((tmp_path / CACHE_META).read_text(encoding="utf-8"))
    assert side["settlements"] == {"2026-11-11": 1229.0, "2026-11-12": 1238.5}


@pytest.mark.settlement
def test_a_held_back_session_is_reported_in_the_source_status(tmp_path):
    zs_f, contracts = _incident_market()
    log = SourceLog()
    got = fetch_soy_prices(
        tmp_path,
        downloader=_yahoo(zs_f, contracts),
        sources=log,
        now=utc("2026-11-11T16:00"),
        quote=_quote(None, None),
    )
    assert got.index.max() == pd.Timestamp("2026-11-09")
    assert log.sources["prices"].status == "live"
    assert "not confirmed" in (log.sources["prices"].detail or "")


def test_a_duplicated_yahoo_row_does_not_crash_the_stitch():
    zs_f, contracts = _incident_market()
    x26 = contracts["X26"]
    dup = pd.concat([x26, x26.iloc[[-2]]])  # yfinance repeating a row
    got = stitch_front_contracts(
        zs_f, _yahoo(zs_f, {**contracts, "X26": dup}), utc("2026-11-11T16:00")
    )
    assert got.index.is_unique and got.loc["2026-11-10"] == 1224.5


@pytest.mark.parametrize(
    ("version", "held"),
    [
        ("2.1.0", True),
        ("2.1", True),
        ("v2.1.0", True),
        ("2.1.0rc1", True),
        ("2.1.0+local", True),
        ("2.2.0", True),
        ("3.0.0", True),
        ("2.0.9", False),
        ("", False),
    ],
)
def test_final_close_gate_parses_versions(version, held):
    meta = {
        "version": version,
        "as_of_close": "2026-11-11",
        "generated_at": "2026-11-11T16:00:00+00:00",
    }
    assert bool(check_final_close(meta)) is held


# ---------------------------------------------------------------- expiry, missing bars, WASDE


@pytest.mark.settlement
def test_a_contracts_last_trading_day_is_taken_from_its_bar_once_the_next_session_began():
    """X26's last trading day is Fri 2026-11-13; no later X26 session carries its settlement."""
    s = _series_through("2026-11-13")
    s.loc["2026-11-13"] = 1250.0
    q = _quote(None, None)
    got, confirmed = confirm_newest_settlement(s, q, utc("2026-11-16T16:00"))
    assert got.loc["2026-11-13"] == 1250.0 and confirmed == {pd.Timestamp("2026-11-13"): 1250.0}
    assert q.seen == []
    # A non-expiry Friday still needs Monday's quote.
    s2 = _series_through("2026-11-20")
    held, _ = confirm_newest_settlement(s2, _quote(None, None), utc("2026-11-23T16:00"))
    assert held.index.max() == pd.Timestamp("2026-11-19")


@pytest.mark.settlement
def test_a_missing_front_contract_bar_is_reported_as_a_cache_fallback(tmp_path):
    zs_f, contracts = _incident_market()
    x26 = contracts["X26"].drop(pd.Timestamp("2026-11-09"))
    log = SourceLog()
    got = fetch_soy_prices(
        tmp_path,
        downloader=_yahoo(zs_f, {**contracts, "X26": x26}),
        sources=log,
        now=utc("2026-11-11T16:00"),
        quote=_quote(None, None),
    )
    # Ends before the missing 11-09 (and the 6th, unconfirmable without a quote, is held too).
    assert got.index.max() < pd.Timestamp("2026-11-09")
    assert log.sources["prices"].status == "cache" and "ZSX26.CBT" in log.sources["prices"].detail
    assert log.degraded == ["prices"]


def test_no_dataset_origin_for_a_report_released_after_the_newest_close(
    synthetic_wasde, synthetic_prices
):
    from soyforecast.features.dataset import build_dataset
    from soyforecast.features.vintages import build_vintages

    vintages = build_vintages(synthetic_wasde)
    last_release = pd.Timestamp(vintages["release_date"].max())
    prices = synthetic_prices[synthetic_prices.index < last_release]
    data = build_dataset(vintages, prices)
    assert pd.to_datetime(data["origin"]).max() <= prices.index.max()
    assert len(data) == int(
        (pd.to_datetime(vintages["release_date"]) <= prices.index.max()).sum()
    ) - (len(vintages) - len(build_dataset(vintages, synthetic_prices)))


def test_next_wasde_is_the_first_report_the_outlook_does_not_use():
    from types import SimpleNamespace

    from soyforecast.publish.web_json import next_report_after

    vintages = pd.DataFrame(
        {"release_date": pd.to_datetime(["2026-09-11", "2026-10-09", "2026-11-10"])}
    )
    manifest = {"next_release": "2026-12-10"}
    behind = SimpleNamespace(
        live={"release_date": "2026-10-09"}, vintages=vintages, wasde_manifest=manifest
    )
    current = SimpleNamespace(
        live={"release_date": "2026-11-10"}, vintages=vintages, wasde_manifest=manifest
    )
    assert next_report_after(behind) == "2026-11-10"  # out, but not in the numbers yet
    assert next_report_after(current) == "2026-12-10"
