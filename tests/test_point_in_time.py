"""The checks that keep the backtest honest: nothing from after the origin is ever used."""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from soyforecast.config import FEATURES, HORIZONS
from soyforecast.evaluation import backtest as bt_mod
from soyforecast.evaluation.backtest import add_intervals, eligible, run_backtest, summarize
from soyforecast.features.dataset import (
    build_dataset,
    close_on_or_before,
    crop_roll_dates,
    crosses_crop_roll,
    live_row,
)
from soyforecast.features.vintages import build_vintages


def test_vintages_use_projected_my_and_reset_revisions_in_may(synthetic_wasde):
    v = build_vintages(synthetic_wasde)
    assert len(v) == synthetic_wasde["report_month"].nunique()
    may = v[v.index.str.endswith("-05")]
    assert (may["may_rollover"] == 1).all()
    assert (may[[c for c in v.columns if c.startswith("rev_")]] == 0).all().all()
    june = v.loc["2015-06"]
    assert june["proj_my"] == "2015/16"
    # stocks-to-use is a ratio of the two US lines
    assert june["us_soy_stu"] == pytest.approx(june["us_soy_es"] / june["us_soy_use"] * 100)
    # a revision is this report minus the previous report for the same MY
    assert v.loc["2015-07", "rev_br_soy_prod"] == pytest.approx(
        v.loc["2015-07", "br_soy_prod"] - v.loc["2015-06", "br_soy_prod"]
    )


def test_dataset_has_no_look_ahead(synthetic_wasde, synthetic_prices):
    v = build_vintages(synthetic_wasde)
    df = build_dataset(v, synthetic_prices)
    assert (df["anchor_date"] <= df["origin"]).all()
    for h in HORIZONS:
        assert (df[f"target_date_{h}"] > df["origin"]).all()
        realized = df[f"y_{h}"].notna()
        assert (df.loc[realized, f"target_date_{h}"] <= synthetic_prices.index.max()).all()
        assert df.loc[~realized, f"target_date_{h}"].min() > synthetic_prices.index.max()
    # the momentum feature equals the price change *before* the anchor
    r = df.iloc[50]
    past = close_on_or_before(synthetic_prices, r["anchor_date"] - pd.DateOffset(months=1))
    assert r["mom_1m"] == pytest.approx(np.log(r["p0_c_bu"] / past[1]))


def test_live_row_uses_latest_close_and_known_report(synthetic_wasde, synthetic_prices):
    v = build_vintages(synthetic_wasde)
    live = live_row(v, synthetic_prices)
    assert live["anchor_date"] == synthetic_prices.index.max()
    assert live["release_date"] <= live["anchor_date"]
    assert set(FEATURES) <= set(live.index)


def test_crop_roll_flag():
    rolls = crop_roll_dates(2020, 2021)
    assert crosses_crop_roll(pd.Timestamp("2020-07-01"), pd.Timestamp("2020-08-01"), rolls)
    assert not crosses_crop_roll(pd.Timestamp("2020-01-10"), pd.Timestamp("2020-04-10"), rolls)


def test_training_rows_were_realized_before_each_origin(
    synthetic_wasde, synthetic_prices, monkeypatch
):
    v = build_vintages(synthetic_wasde)
    df = build_dataset(v, synthetic_prices)
    seen = []

    def spy(train, history, x, h):
        seen.append((x["origin"], h, train[f"target_date_{h}"].max(), history["origin"].max()))
        return 0.0

    monkeypatch.setitem(bt_mod.MODELS, "spy", spy)
    run_backtest(df.iloc[-40:].pipe(lambda d: pd.concat([df.iloc[:-40], d])), models=("spy",))
    assert seen
    for origin, _h, last_target, last_hist in seen:
        assert pd.isna(last_target) or last_target <= origin
        assert last_hist <= origin


def test_eligible_filters_on_dates_not_rows(synthetic_wasde, synthetic_prices):
    df = build_dataset(build_vintages(synthetic_wasde), synthetic_prices)
    origin = df["origin"].iloc[100]
    e = eligible(df, origin, 6)
    assert (e["target_date_6"] <= origin).all()
    assert len(e) < 100  # about six reports are still unrealized at h=6


def test_intervals_use_only_realized_residuals():
    origins = pd.date_range("2015-01-10", periods=40, freq="MS")
    bt = pd.DataFrame(
        {
            "model": "m",
            "h": 3,
            "origin": origins,
            "target_date": origins + pd.DateOffset(months=3),
            "pred": 0.0,
            "y": np.r_[np.full(39, 0.01), 5.0],  # an outlier whose outcome is in the future
        }
    )
    out = add_intervals(bt)
    # the outlier (last row) is never part of any calibration set, so no upper band jumps
    assert out["q0.975"].max() < 1


@pytest.mark.slow
def test_end_to_end_random_walk_wins_on_a_random_walk(synthetic_wasde, synthetic_prices):
    df = build_dataset(build_vintages(synthetic_wasde), synthetic_prices)
    bt = run_backtest(df, models=("rw", "drift", "ridge"))
    metrics, champion, tests = summarize(bt)
    assert set(champion.values()) == {"rw"}
    cov = metrics[
        (metrics.subset == "all") & (metrics.split == "validation") & (metrics.model == "rw")
    ]
    assert cov["cover80"].between(0.6, 0.95).all()
    assert {"dm_p", "cw_p", "cw_p_holm"} <= set(tests.columns)


@pytest.mark.slow
def test_live_forecast_runs_for_every_model_as_champion(synthetic_wasde, synthetic_prices):
    from soyforecast.models.live import live_forecast

    v = build_vintages(synthetic_wasde)
    df = build_dataset(v, synthetic_prices)
    bt = run_backtest(df.iloc[-60:].pipe(lambda d: pd.concat([df.iloc[:-60], d])))
    live = live_row(v, synthetic_prices)
    for model in ("rw", "drift", "arima", "ridge"):
        out = live_forecast(df, live, bt, dict.fromkeys(HORIZONS, model))
        assert all(r["q025"] <= r["q975"] for r in out)


def test_validation_outcomes_end_before_the_holdout(synthetic_wasde, synthetic_prices):
    from soyforecast.config import HOLDOUT_START

    bt = run_backtest(
        build_dataset(build_vintages(synthetic_wasde), synthetic_prices), models=("rw",)
    )
    assert (bt.loc[bt["split"] == "validation", "target_date"] < HOLDOUT_START).all()
