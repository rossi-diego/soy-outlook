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
from soyforecast.features.contracts import front_contract, price_contract
from soyforecast.freshness import (
    SourceLog,
    bar_is_settlement,
    close_to_publish,
    final_through,
    is_session,
    previous_session,
    trade_date,
    trading_session,
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


def test_final_through_is_the_last_session_before_today_in_chicago_at_every_hour():
    """Hourly over a year (both DST switches): never today, never a closed day, and no
    session is skipped between it and today."""
    for now in pd.date_range("2026-01-01", "2027-01-01", freq="h", tz="UTC"):
        local_day = now.tz_convert("America/Chicago").date()
        got = final_through(now.to_pydatetime())
        assert got < local_day and is_session(got)
        between = pd.date_range(
            pd.Timestamp(got) + pd.Timedelta(days=1), local_day, inclusive="left"
        )
        assert not any(is_session(d.date()) for d in between)
        assert (pd.Timestamp(local_day) - pd.Timestamp(got)).days <= 4  # a long weekend


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


def _stitch(*a, **k) -> pd.Series:
    return stitch_front_contracts(*a, **k)[0]


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
    got = _stitch(zs_f, _yahoo(zs_f, contracts), utc("2026-11-11T16:00"))
    assert got.index.max() == pd.Timestamp("2026-11-10")
    # X26 is the front until its last trading day (13 Nov): its settlements, not F27's.
    assert got.loc["2026-11-06"] == 1189.0
    assert got.loc["2026-11-09"] == 1182.25
    assert got.loc["2026-11-10"] == 1224.5
    # Older than the window: ZS=F as before.
    assert got.loc["2026-07-01"] == 1100.0


def test_the_series_rolls_to_the_next_contract_on_the_last_trading_day():
    days = pd.bdate_range("2026-10-01", "2026-11-20")
    x26 = pd.Series(1100.0, index=days[days <= "2026-11-13"])
    f27 = pd.Series(1110.0, index=days)
    zs_f = pd.Series(1000.0, index=days)  # deliberately wrong everywhere
    got = _stitch(zs_f, _yahoo(zs_f, {"X26": x26, "F27": f27}), utc("2026-11-20T16:00"))
    assert got.loc["2026-11-12"] == 1100.0  # X26 until the day before its last trading day
    assert got.loc["2026-11-13"] == 1110.0  # X26 expires on the 13th: F27 already
    assert got.loc["2026-11-16"] == 1110.0
    assert got.index.max() == pd.Timestamp("2026-11-19")


def test_an_expired_contract_delisted_by_yahoo_does_not_stall_the_series():
    """After X26 expires Yahoo answers 404 for it; its sessions come from the cache."""
    days = pd.bdate_range("2026-08-03", "2026-11-25")
    f27 = pd.Series(1210.0, index=days)
    zs_f = pd.Series(1000.0, index=days)
    trusted = pd.Series(1100.0, index=days[days <= "2026-11-12"])
    for run in ("2026-11-17T16:00", "2026-11-24T16:00"):
        got = _stitch(zs_f, _yahoo(zs_f, {"F27": f27}), utc(run), trusted)
        assert got.index.max() == pd.Timestamp(final_through(utc(run)))
        assert got.loc["2026-11-12"] == 1100.0 and got.loc["2026-11-13"] == 1210.0


def test_price_contract_rolls_on_the_last_trading_day_front_contract_after_it():
    assert price_contract(pd.Timestamp("2026-11-12"))["code"] == "X26"
    assert price_contract(pd.Timestamp("2026-11-13"))["code"] == "F27"
    assert front_contract(pd.Timestamp("2026-11-13"))["code"] == "X26"  # models' convention


def test_a_recent_session_without_its_contract_ends_the_series_before_it():
    zs_f, contracts = _incident_market()
    x26 = contracts["X26"].drop(pd.Timestamp("2026-11-09"))  # Yahoo lost one X26 bar
    got = _stitch(zs_f, _yahoo(zs_f, {**contracts, "X26": x26}), utc("2026-11-11T16:00"))
    assert got.index.max() == pd.Timestamp("2026-11-06")  # never ZS=F's 1192.5 for the 9th


def test_an_expired_contract_gone_from_yahoo_is_replaced_by_the_trusted_cache():
    zs_f, contracts = _incident_market()
    trusted = contracts["X26"][contracts["X26"].index <= "2026-11-10"]
    gone = {"F27": contracts["F27"]}  # X26 delisted
    got = _stitch(zs_f, _yahoo(zs_f, gone), utc("2026-11-11T16:00"), trusted)
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


def test_previous_session_skips_weekends_and_holidays():
    assert previous_session(date(2026, 11, 16)) == date(2026, 11, 13)
    assert previous_session(date(2026, 11, 12)) == date(2026, 11, 11)
    assert previous_session(date(2026, 11, 27)) == date(2026, 11, 25)  # Thanksgiving
    assert previous_session(date(2027, 1, 19)) == date(2027, 1, 15)  # MLK Day


@pytest.mark.parametrize(
    ("day", "closed"),
    [
        ("2026-11-26", True),  # Thanksgiving
        ("2026-11-27", False),  # the early-close Friday after it trades
        ("2026-07-03", True),  # Independence Day on a Saturday, observed Friday
        ("2026-04-03", True),  # Good Friday
        ("2027-03-26", True),  # Good Friday
        ("2026-06-19", True),  # Juneteenth
        ("2021-06-18", False),  # before Juneteenth was an exchange holiday
        ("2021-12-24", True),  # Christmas on a Saturday
        ("2022-12-26", True),  # Christmas on a Sunday
        ("2021-12-31", False),  # New Year 2022 on a Saturday: not moved into 2021
        ("2023-01-02", True),  # New Year on a Sunday
        ("2026-01-19", True),  # MLK Day
        ("2026-02-16", True),  # Presidents' Day
        ("2026-05-25", True),  # Memorial Day
        ("2026-09-07", True),  # Labor Day
        ("2026-10-12", False),  # Columbus Day: CBOT trades
        ("2026-11-11", False),  # Veterans Day: CBOT trades
    ],
)
def test_cbot_holidays(day, closed):
    d = date.fromisoformat(day)
    assert (not is_session(d)) is closed


@pytest.mark.parametrize(
    ("now", "expected"),
    [
        ("2026-11-26T16:00", "2026-11-25"),  # Thanksgiving: Wednesday
        ("2026-11-27T16:00", "2026-11-25"),  # Friday after: still Wednesday
        ("2026-11-30T16:00", "2026-11-27"),
        ("2027-01-19T16:00", "2027-01-15"),  # Tuesday after MLK Day: Friday
    ],
)
def test_final_through_skips_holidays(now, expected):
    assert final_through(utc(now)).isoformat() == expected


def test_trade_date_before_a_monday_holiday_stays_on_friday():
    # Sunday 2027-01-17 20:00 CST: no session opens for MLK Day.
    assert trade_date(utc("2027-01-18T02:00")) == date(2027, 1, 15)
    # Monday 19:00 CST opens Tuesday's session.
    assert trade_date(utc("2027-01-19T01:30")) == date(2027, 1, 19)


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


def _confirm(s: pd.Series, q, now: str):
    """Settle `s` as if its newest session were the only one this run added."""
    return confirm_newest_settlement(s, [s.index.max()], q, utc(now))


@pytest.mark.parametrize(
    ("now", "expected"),
    [
        ("2026-11-12T16:00", "2026-11-12"),  # Thu 10:00 CST
        ("2026-11-12T12:00", "2026-11-12"),  # Thu 06:00 CST, overnight session
        ("2026-11-12T17:59", "2026-11-12"),  # 11:59 CST
        ("2026-11-12T18:00", None),  # 12:00 CST: settlement time approaching
        ("2026-11-12T20:00", None),  # 14:00 CST: afternoon, not relied on
        ("2026-11-13T01:00", "2026-11-13"),  # Thu 19:00 CST opens Friday
        ("2026-11-14T01:30", None),  # Fri 19:30 CST: no session until Sunday evening
        ("2026-11-16T01:30", "2026-11-16"),  # Sun 19:30 CST opens Monday
        ("2026-11-26T16:00", None),  # Thanksgiving
        ("2026-11-26T01:30", None),  # Wed 19:30 CST before it
        ("2026-11-27T16:00", "2026-11-27"),  # the Friday after
        ("2026-07-01T16:00", "2026-07-01"),  # 11:00 CDT
        ("2026-07-01T17:00", None),  # 12:00 CDT
    ],
)
def test_trading_session_is_when_the_previous_close_can_be_relied_on(now, expected):
    got = trading_session(utc(now))
    assert (got.isoformat() if got else None) == expected


@pytest.mark.parametrize(
    ("day", "settles"),
    [
        ("2026-11-12", True),  # Thursday
        ("2026-11-13", False),  # Friday
        ("2026-11-25", False),  # eve of Thanksgiving
        ("2026-11-27", False),
        ("2026-04-02", False),  # eve of Good Friday
        ("2027-01-15", False),  # Friday before MLK Day
        ("2027-01-19", True),
    ],
)
def test_bar_is_settlement_monday_to_thursday_except_the_eve_of_a_holiday(day, settles):
    assert bar_is_settlement(date.fromisoformat(day)) is settles


@pytest.mark.settlement
def test_newest_bar_is_replaced_by_the_settlement_the_morning_after():
    s = _series_through("2026-11-11")
    s.loc["2026-11-11"] = 1229.75  # the bar Yahoo showed at 19:30 CST: an overnight print
    q = _quote(1230.75, "2026-11-12T15:55")  # Thursday's session is trading
    got, issues = _confirm(s, q, "2026-11-12T16:00")
    assert got.loc["2026-11-11"] == 1230.75 and issues == []
    assert q.seen == ["ZSX26.CBT"]  # X26 until the day before its last trading day, 13 Nov
    assert got.loc["2026-11-10"] == 1200.0


@pytest.mark.settlement
def test_a_monday_to_thursday_bar_needs_no_quote():
    s = _series_through("2026-11-11")
    s.loc["2026-11-11"] = 1229.0  # after 23:00 CT the bar is the settlement
    for q, now in (
        (_quote(None, None), "2026-11-12T16:00"),
        (_quote(1.0, None), "2026-11-12T20:00"),
    ):
        got, issues = _confirm(s, q, now)
        assert got.loc["2026-11-11"] == 1229.0 and issues == []


@pytest.mark.settlement
def test_monday_confirms_friday_and_saturday_cannot():
    s = _series_through("2026-11-20")  # an ordinary Friday (F27 is the front)
    monday, _ = _confirm(s, _quote(1210.0, "2026-11-23T15:50"), "2026-11-23T16:00")
    assert monday.loc["2026-11-20"] == 1210.0
    # On Saturday no session trades: the quote is not even read.
    q = _quote(1205.0, "2026-11-20T19:20")
    saturday, issues = _confirm(s, q, "2026-11-21T16:00")
    assert saturday.index.max() == pd.Timestamp("2026-11-19") and q.seen == [] and issues == []


@pytest.mark.settlement
@pytest.mark.parametrize(
    ("settle", "stamp", "now", "alerts", "why"),
    [
        (None, None, "2026-11-23T16:00", True, "quote unavailable"),
        (1210.0, "2026-11-20T19:15", "2026-11-23T16:00", False, "no trade in Monday's session yet"),
        (1210.0, "2026-11-23T19:30", "2026-11-23T20:00", False, "Monday afternoon: not read"),
        (1211.0, "2026-11-24T01:55", "2026-11-24T02:00", False, "Monday evening: Tuesday's quote"),
        (float("nan"), "2026-11-23T15:55", "2026-11-23T16:00", True, "non-finite settlement"),
    ],
)
def test_a_friday_is_held_back_without_a_matching_settlement(settle, stamp, now, alerts, why):
    s = _series_through("2026-11-20")
    got, issues = _confirm(s, _quote(settle, stamp), now)
    assert got.index.max() == pd.Timestamp("2026-11-19"), why
    assert bool(issues) is alerts, why


@pytest.mark.settlement
def test_a_thin_contract_quote_not_yet_traded_in_the_new_session_is_not_used():
    """Mon 20:30 CST: the previous close may have rolled to Monday's settlement while the last
    trade is still Monday 13:19. Taken as Friday's it would be a session off."""
    s = _series_through("2026-11-20")
    got, _ = _confirm(s, _quote(1229.0, "2026-11-23T19:19"), "2026-11-24T02:30")
    assert got.index.max() == pd.Timestamp("2026-11-19")
    # The same stale quote time on Tuesday morning is not used either.
    got, _ = _confirm(s, _quote(1229.0, "2026-11-23T19:19"), "2026-11-24T16:00")
    assert got.index.max() == pd.Timestamp("2026-11-19")


@pytest.mark.settlement
def test_thanksgiving_week():
    s = _series_through("2026-11-25")
    s.loc["2026-11-25"] = 1205.0  # pre-holiday bar: the last trade
    # Thanksgiving: no session trades, nothing new.
    thu, issues = _confirm(s, _quote(1200.0, "2026-11-25T19:15"), "2026-11-26T16:00")
    assert thu.index.max() == pd.Timestamp("2026-11-24") and issues == []
    # Friday: its session follows Wednesday's, so the previous close is Wednesday's settlement.
    fri, issues = _confirm(s, _quote(1206.25, "2026-11-27T15:40"), "2026-11-27T16:00")
    assert fri.loc["2026-11-25"] == 1206.25 and issues == []


@pytest.mark.settlement
def test_tuesday_after_a_monday_holiday_confirms_friday():
    s = _series_through("2027-01-15")
    got, _ = _confirm(s, _quote(1190.5, "2027-01-19T15:30"), "2027-01-19T16:00")
    assert got.loc["2027-01-15"] == 1190.5


@pytest.mark.settlement
def test_a_contracts_last_trading_day_is_confirmed_from_the_next_contract():
    """X26's last trading day is Fri 2026-11-13: the close that day is F27's settlement."""
    s = _series_through("2026-11-13")
    q = _quote(1214.0, "2026-11-16T15:30")
    got, issues = _confirm(s, q, "2026-11-16T16:00")
    assert got.loc["2026-11-13"] == 1214.0 and issues == []
    assert q.seen == ["ZSF27.CBT"]
    held, issues = _confirm(s, _quote(None, None), "2026-11-16T16:00")
    assert held.index.max() == pd.Timestamp("2026-11-12")
    assert "quote unavailable" in issues[0][1]


@pytest.mark.settlement
def test_a_missed_friday_is_published_from_its_bar_with_an_alert():
    """Tuesday's run adds Friday and Monday: Friday's settlement was only in Monday's quote."""
    s = _series_through("2026-11-23")
    got, issues = confirm_newest_settlement(
        s,
        [pd.Timestamp("2026-11-20"), pd.Timestamp("2026-11-23")],
        _quote(None, None),
        utc("2026-11-24T16:00"),
    )
    assert got.index.max() == pd.Timestamp("2026-11-23")  # Monday's bar is its settlement
    assert [str(d.date()) for d, _ in issues] == ["2026-11-20"]


def _market(last: str, friday_bar: float | None = None):
    """ZS=F and F27 through `last` at 1200; X26 until its expiry at 1100."""
    days = pd.bdate_range("2026-08-03", last)
    f27 = pd.Series(1200.0, index=days)
    x26 = pd.Series(1100.0, index=days[days <= "2026-11-13"])
    zs_f = pd.Series(1200.0, index=days)
    if friday_bar is not None:
        f27.loc["2026-11-20"] = friday_bar
    return zs_f, {"X26": x26, "F27": f27}


@pytest.mark.settlement
def test_friday_settlement_survives_the_following_runs(tmp_path):
    """Friday's bar keeps the last trade for good; Monday's quote settlement must stick."""
    zs_f, contracts = _market("2026-11-24", friday_bar=1210.0)
    yahoo = _yahoo(zs_f, contracts)
    fetch_soy_prices(  # Friday's run: Thursday
        tmp_path, downloader=yahoo, now=utc("2026-11-20T16:00"), quote=_quote(None, None)
    )
    mon = fetch_soy_prices(
        tmp_path,
        downloader=yahoo,
        now=utc("2026-11-23T16:00"),
        quote=_quote(1212.25, "2026-11-23T15:30"),
    )
    assert mon.loc["2026-11-20"] == 1212.25
    for run, stamp in (("2026-11-24T16:00", "2026-11-24T15:30"), ("2026-11-25T16:00", None)):
        later = fetch_soy_prices(
            tmp_path, downloader=yahoo, now=utc(run), quote=_quote(1200.0, stamp)
        )
        assert later.loc["2026-11-20"] == 1212.25, run


@pytest.mark.settlement
def test_cached_sessions_are_never_replaced_by_later_downloads(tmp_path):
    """Months later ZS=F still has Friday's last trade; the stored settlement must not move."""
    zs_f, contracts = _market("2026-11-24", friday_bar=1210.0)
    fetch_soy_prices(
        tmp_path,
        downloader=_yahoo(zs_f, contracts),
        now=utc("2026-11-20T16:00"),
        quote=_quote(None, None),
    )
    fetch_soy_prices(
        tmp_path,
        downloader=_yahoo(zs_f, contracts),
        now=utc("2026-11-23T16:00"),
        quote=_quote(1212.25, "2026-11-23T15:30"),
    )
    days = pd.bdate_range("2026-08-03", "2027-03-01")
    zs_f = pd.Series(1200.0, index=days)
    zs_f.loc["2026-11-20"] = 1210.0
    h27 = pd.Series(1300.0, index=days)
    yahoo = _yahoo(zs_f, {"F27": pd.Series(1200.0, index=days[days <= "2027-01-14"]), "H27": h27})
    for run in pd.bdate_range("2026-11-24", "2027-03-01", freq="5B"):
        got = fetch_soy_prices(
            tmp_path, downloader=yahoo, now=utc(f"{run.date()}T16:00"), quote=_quote(None, None)
        )
        assert got.loc["2026-11-20"] == 1212.25, run


@pytest.mark.settlement
def test_an_unreadable_quote_on_monday_alerts(tmp_path):
    zs_f, contracts = _market("2026-11-23")
    log = SourceLog()
    yahoo = _yahoo(zs_f, contracts)
    fetch_soy_prices(
        tmp_path, downloader=yahoo, now=utc("2026-11-20T16:00"), quote=_quote(None, None)
    )
    got = fetch_soy_prices(
        tmp_path,
        downloader=yahoo,
        sources=log,
        now=utc("2026-11-23T16:00"),
        quote=_quote(None, None),
    )
    assert got.index.max() == pd.Timestamp("2026-11-19")
    assert log.sources["prices"].status == "cache"
    assert "quote unavailable" in (log.sources["prices"].detail or "")


@pytest.mark.settlement
def test_a_friday_waiting_for_its_quote_is_reported_without_an_alert(tmp_path):
    zs_f, contracts = _market("2026-11-23")
    log = SourceLog()
    yahoo = _yahoo(zs_f, contracts)
    fetch_soy_prices(
        tmp_path, downloader=yahoo, now=utc("2026-11-20T16:00"), quote=_quote(None, None)
    )
    got = fetch_soy_prices(
        tmp_path,
        downloader=yahoo,
        sources=log,
        now=utc("2026-11-23T16:00"),
        quote=_quote(1200.0, "2026-11-20T19:15"),  # readable, but no trade on Monday yet
    )
    assert got.index.max() == pd.Timestamp("2026-11-19")
    assert log.sources["prices"].status == "live"
    assert "not confirmed" in (log.sources["prices"].detail or "")


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
def test_x26_expiry_week_end_to_end(tmp_path):
    """Thu 11-12 from X26's bar, Fri 11-13 (X26's last day) from F27's quote on Monday, and
    X26 delisted from Tuesday on: nothing stalls, nothing alerts."""
    days = pd.bdate_range("2026-08-03", "2026-11-18")
    x26 = pd.Series(1100.0, index=days[days <= "2026-11-13"])
    f27 = pd.Series(1200.0, index=days)
    f27.loc["2026-11-13"] = 1201.0  # Friday's bar: the last trade
    zs_f = pd.Series(1200.0, index=days)
    cached = x26[x26.index <= "2026-11-11"].rename("close_c_bu").rename_axis("date")
    cached.to_frame().to_parquet(tmp_path / CACHE_FILE)  # Thursday's run published Wednesday
    (tmp_path / CACHE_META).write_text('{"final_through": "2026-11-11"}', encoding="utf-8")
    log = SourceLog()
    runs = [
        ("2026-11-13T16:00", {"X26": x26, "F27": f27}, _quote(None, None)),
        ("2026-11-16T16:00", {"X26": x26, "F27": f27}, _quote(1201.5, "2026-11-16T15:00")),
        ("2026-11-17T16:00", {"F27": f27}, _quote(None, None)),
        ("2026-11-18T16:00", {"F27": f27}, _quote(None, None)),
    ]
    for now, listed, q in runs:
        got = fetch_soy_prices(
            tmp_path, downloader=_yahoo(zs_f, listed), sources=log, now=utc(now), quote=q
        )
        assert got.index.max() == pd.Timestamp(final_through(utc(now))), now
        assert log.sources["prices"].status == "live", now
    assert got.loc["2026-11-12"] == 1100.0 and got.loc["2026-11-13"] == 1201.5


@pytest.mark.settlement
def test_cache_lost_after_an_expiry_falls_back_to_zs_f_with_an_alert(tmp_path):
    days = pd.bdate_range("2026-08-03", "2026-11-18")
    zs_f = pd.Series(1200.0, index=days)
    log = SourceLog()
    got = fetch_soy_prices(
        tmp_path,
        downloader=_yahoo(zs_f, {"F27": pd.Series(1200.0, index=days)}),  # X26 gone
        sources=log,
        now=utc("2026-11-18T16:00"),
        quote=_quote(None, None),
    )
    assert got.index.max() == pd.Timestamp("2026-11-17")
    assert log.sources["prices"].status == "cache" and "ZS=F used" in log.sources["prices"].detail


@pytest.mark.settlement
def test_rebuilding_a_legacy_cache_does_not_alert(tmp_path):
    zs_f, contracts = _incident_market()
    zs_f.rename("close_c_bu").to_frame().rename_axis("date").to_parquet(tmp_path / CACHE_FILE)
    log = SourceLog()
    got = fetch_soy_prices(
        tmp_path,
        downloader=_yahoo(zs_f, {"X26": contracts["X26"]}),
        sources=log,
        now=utc("2026-11-11T16:00"),
        quote=_quote(None, None),
    )
    assert got.loc["2026-11-06"] == 1189.0 and got.loc["2026-11-09"] == 1182.25
    assert log.sources["prices"].status == "live"


def test_quote_reads_the_chart_metadata(monkeypatch):
    import yfinance as yf

    from soyforecast.ingest.prices import _quote_yahoo

    calls = []

    class FakeTicker:
        def __init__(self, symbol):
            calls.append(symbol)
            self.history_metadata = {}

        def history(self, **kw):
            calls.append(kw)
            self.history_metadata = {
                "chartPreviousClose": 1229.0,
                "regularMarketTime": 1762963200,
                "previousClose": None,
            }

    monkeypatch.setattr(yf, "Ticker", FakeTicker)
    settle, stamp = _quote_yahoo("ZSX26.CBT")
    assert settle == 1229.0 and stamp == datetime.fromtimestamp(1762963200, tz=UTC)
    # yfinance itself hands back an exchange-local Timestamp
    when = pd.Timestamp("2026-11-12 00:21:54-0500", tz="America/New_York")
    FakeTicker.history = lambda self, **kw: setattr(  # type: ignore[method-assign]
        self, "history_metadata", {"chartPreviousClose": 1230.75, "regularMarketTime": when}
    )
    settle, stamp = _quote_yahoo("ZSF27.CBT")
    assert settle == 1230.75 and stamp == utc("2026-11-12T05:21:54")
    assert trade_date(stamp) == date(2026, 11, 12)
    assert calls[0] == "ZSX26.CBT" and calls[1]["period"] == "1d"


def test_a_duplicated_yahoo_row_does_not_crash_the_stitch():
    zs_f, contracts = _incident_market()
    x26 = contracts["X26"]
    dup = pd.concat([x26, x26.iloc[[-2]]])  # yfinance repeating a row
    got = _stitch(zs_f, _yahoo(zs_f, {**contracts, "X26": dup}), utc("2026-11-11T16:00"))
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


@pytest.mark.settlement
def test_rebuilding_a_legacy_cache_after_an_expiry_keeps_the_published_values(tmp_path):
    days = pd.bdate_range("2026-08-03", "2026-11-18")
    published = pd.Series(1100.0, index=days[days <= "2026-11-12"])
    published.rename("close_c_bu").to_frame().rename_axis("date").to_parquet(tmp_path / CACHE_FILE)
    zs_f = pd.Series(1200.0, index=days)  # F27 prices on X26 days: contract-mixed
    log = SourceLog()
    got = fetch_soy_prices(
        tmp_path,
        downloader=_yahoo(zs_f, {"F27": pd.Series(1200.0, index=days)}),  # X26 gone
        sources=log,
        now=utc("2026-11-18T16:00"),
        quote=_quote(None, None),
    )
    assert (got[got.index <= "2026-11-12"] == 1100.0).all()
    assert got.index.max() == pd.Timestamp("2026-11-17")


def test_an_expired_contract_still_listed_with_a_hole_ends_the_series_not_zs_f():
    days = pd.bdate_range("2026-08-03", "2026-11-18")
    x26 = pd.Series(1100.0, index=days[days <= "2026-11-12"]).drop(pd.Timestamp("2026-11-10"))
    f27 = pd.Series(1200.0, index=days)
    zs_f = pd.Series(1200.0, index=days)
    trusted = x26[x26.index <= "2026-11-06"]
    got, _, issues = stitch_front_contracts(
        zs_f, _yahoo(zs_f, {"X26": x26, "F27": f27}), utc("2026-11-18T16:00"), trusted
    )
    assert got.index.max() == pd.Timestamp("2026-11-09")  # never ZS=F's F27 price for the 10th
    assert issues and "no ZSX26.CBT bar for 2026-11-10" in issues[-1][1]


@pytest.mark.settlement
def test_a_partial_rebuild_never_shrinks_the_stored_cache(tmp_path):
    zs_f, contracts = _incident_market()
    zs_f.rename("close_c_bu").to_frame().rename_axis("date").to_parquet(tmp_path / CACHE_FILE)
    log = SourceLog()
    got = fetch_soy_prices(
        tmp_path,
        downloader=_yahoo(zs_f, {"F27": contracts["F27"]}),  # ZSX26.CBT download fails
        sources=log,
        now=utc("2026-11-11T16:00"),
        quote=_quote(None, None),
    )
    assert got.index.max() < pd.Timestamp("2026-09-14")  # ends before the first X26 session
    assert log.sources["prices"].status == "cache"
    assert not (tmp_path / CACHE_META).exists()  # the legacy cache is left for the next run
    stored = pd.read_parquet(tmp_path / CACHE_FILE)["close_c_bu"]
    assert stored.index.max() == zs_f.index.max()
    healthy = fetch_soy_prices(
        tmp_path,
        downloader=_yahoo(zs_f, contracts),
        sources=log,
        now=utc("2026-11-11T16:00"),
        quote=_quote(None, None),
    )
    assert healthy.loc["2026-11-09"] == 1182.25 and log.sources["prices"].status == "live"


def test_a_session_missing_from_every_source_is_reported_not_skipped_silently():
    days = pd.bdate_range("2026-08-03", "2026-12-04").drop(pd.Timestamp("2026-12-02"))
    f27 = pd.Series(1200.0, index=days)
    trusted = f27[f27.index <= "2026-11-27"]
    got, _, issues = stitch_front_contracts(
        f27, _yahoo(f27, {"F27": f27}), utc("2026-12-07T16:00"), trusted
    )
    assert got.index.max() == pd.Timestamp("2026-12-04")
    assert [m for _, m in issues] == ["no bar from any source for 2026-12-02: skipped"]


def test_on_the_monday_after_an_expiry_a_delisted_contract_counts_as_gone():
    """Mon 11-16: the cutoff is X26's last trading day; Yahoo may already 404 for X26."""
    days = pd.bdate_range("2026-08-03", "2026-11-16")
    f27 = pd.Series(1200.0, index=days)
    zs_f = pd.Series(1201.0, index=days)
    trusted = pd.Series(1100.0, index=days[days <= "2026-11-10"])
    got, _, issues = stitch_front_contracts(
        zs_f, _yahoo(zs_f, {"F27": f27}), utc("2026-11-16T16:00"), trusted
    )
    assert got.index.max() == pd.Timestamp("2026-11-13")
    assert got.loc["2026-11-12"] == 1201.0 and "ZS=F used" in issues[0][1]
