"""Pre-registered v2.1 methods: interval centring and score, Holm families, event study."""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from soyforecast.config import INTERVAL_BASELINE, QUANTILES
from soyforecast.evaluation.backtest import (
    add_intervals,
    interval_score,
    residual_quantiles,
    select_centring,
)
from soyforecast.evaluation.stats import holm
from soyforecast.features.vintages import build_vintages
from soyforecast.models.live import (
    REACTION_FEATURES,
    contract_last_trading_days,
    near_roll,
    release_day_events,
    release_day_reaction,
    round_p,
)


def test_residual_quantiles_raw_vs_median_centred():
    r = np.linspace(-0.1, 0.1, 61) + 0.03  # drift of +3%
    raw = residual_quantiles(r, "raw")
    centred = residual_quantiles(r, "median")
    assert raw[0.5] == pytest.approx(0.03)
    assert centred[0.5] == pytest.approx(0.0)
    # centring shifts, never reshapes
    for q in QUANTILES:
        assert raw[q] - centred[q] == pytest.approx(0.03)
    with pytest.raises(ValueError):
        residual_quantiles(r, "mean")


def test_interval_score_known_values():
    y = np.array([0.0, 2.0, -1.0])
    s = interval_score(y, np.full(3, -0.5), np.full(3, 0.5), alpha=0.2)
    # inside: width 1; above by 1.5: 1 + 10 * 1.5; below by 0.5: 1 + 10 * 0.5
    assert list(s) == pytest.approx([1.0, 16.0, 6.0])


def _bt(drift: float, n: int = 120) -> pd.DataFrame:
    rng = np.random.default_rng(4)
    origins = pd.date_range("2010-01-10", periods=n, freq="MS")
    split = np.where(origins < pd.Timestamp("2016-01-01"), "burn_in", "validation")
    split[origins >= pd.Timestamp("2018-06-01")] = "holdout"
    return pd.DataFrame(
        {
            "model": "m",
            "h": 1,
            "origin": origins,
            "target_date": origins + pd.DateOffset(months=1),
            "pred": 0.0,
            "y": rng.normal(0, 0.05, n) + drift,
            "split": split,
        }
    )


def test_add_intervals_records_calibration_size():
    out = add_intervals(_bt(0.0))
    assert out["calib_n"].dropna().min() >= 24
    assert out["calib_n"].max() == 60


def test_select_centring_keeps_baseline_without_evidence_and_uses_validation_only():
    bt = _bt(0.0)
    _, chosen, table = select_centring(bt)
    assert set(table["split"]) == {"validation", "holdout"}
    base = table[(table["centring"] == INTERVAL_BASELINE) & (table["split"] == "validation")]
    assert base["score_ratio"].iloc[0] == pytest.approx(1.0)
    val = table[table["split"] == "validation"].set_index("centring")["score_ratio"]
    assert chosen == ("median" if val["median"] < 1 else INTERVAL_BASELINE)
    # changing only the holdout outcomes can never change the choice
    bt2 = bt.copy()
    bt2.loc[bt2["split"] == "holdout", "y"] += 0.5
    assert select_centring(bt2)[1] == chosen


def test_holm_accepts_named_hypotheses():
    adj = holm({"a": 0.01, "b": 0.02, "c": 0.04, "d": 0.5, "e": 0.3, "f": 0.2})
    assert adj["a"] == pytest.approx(0.06)
    assert adj["b"] == pytest.approx(0.10)
    assert adj["c"] == pytest.approx(0.16)
    assert adj["d"] == pytest.approx(0.6)  # step-down keeps the adjusted p monotone
    assert all(adj[k] >= p for k, p in {"a": 0.01, "d": 0.5}.items())


def test_round_p_never_publishes_a_tiny_p_as_zero():
    assert round_p(0.1234) == 0.123
    assert round_p(0.001) == 0.001
    assert round_p(2.3456e-10) == pytest.approx(2.3e-10)
    assert round_p(2.3456e-10) > 0


def test_near_roll_uses_contract_last_trading_days():
    ltds = contract_last_trading_days(2020, 2020)
    assert pd.Timestamp("2020-07-14") in ltds  # July contract, business day before the 15th
    assert near_roll(pd.Timestamp("2020-07-10"), ltds, 3)
    assert not near_roll(pd.Timestamp("2020-07-06"), ltds, 3)
    assert not near_roll(pd.Timestamp("2020-06-10"), ltds, 3)  # no June contract


def _plant(synthetic_wasde, synthetic_prices, beta: float):
    """Prices whose release-day return is beta x the US soybean stocks-to-use revision."""
    v = build_vintages(synthetic_wasde)
    logp = np.log(synthetic_prices.copy())
    for _, row in v.iterrows():
        d = pd.Timestamp(row["release_date"])
        if d in logp.index and row["may_rollover"] == 0:
            logp[logp.index >= d] += beta * row["rev_us_soy_stu"]
    return v, np.exp(logp)


def test_event_study_finds_a_planted_effect_and_placebo_does_not(synthetic_wasde, synthetic_prices):
    v, prices = _plant(synthetic_wasde, synthetic_prices, beta=-0.01)
    out = release_day_reaction(v, prices, p_now_c_bu=1000)
    items = {it["feature"]: it for it in out["items"]}
    soy = items["rev_us_soy_stu"]
    assert soy["usd_t_per_unit"] < 0 and soy["p_holm"] < 0.05 and not soy["weak"]
    assert not soy["wrong_sign"]
    assert out["headline_feature"] == "rev_us_soy_stu"
    assert out["features"] == list(REACTION_FEATURES)
    cov = np.array(out["cov_usd_t"])
    assert cov.shape == (6, 6) and np.allclose(cov, cov.T) and (np.diag(cov) > 0).all()
    assert np.sqrt(cov[0, 0]) == pytest.approx(soy["se_usd_t"], rel=0.02)
    placebo = {it["feature"]: it for it in out["robustness"]["placebo"]["items"]}
    assert placebo["rev_us_soy_stu"]["p_holm"] > 0.05
    split = out["robustness"]["split_sample"]
    assert split["early"]["n_reports"] + split["late"]["n_reports"] == out["n_reports"]
    roll = out["robustness"]["roll_excluded"]
    assert roll["n_reports"] + roll["n_excluded"] == out["n_reports"]
    assert out["release_move"]["one_in_ten_usd_t"] >= out["release_move"]["typical_usd_t"]


def test_event_study_flags_but_keeps_wrong_sign_coefficients(synthetic_wasde, synthetic_prices):
    v, prices = _plant(synthetic_wasde, synthetic_prices, beta=0.01)  # "wrong" sign
    out = release_day_reaction(v, prices, p_now_c_bu=1000)
    soy = next(it for it in out["items"] if it["feature"] == "rev_us_soy_stu")
    assert soy["wrong_sign"]
    assert len(out["items"]) == len(REACTION_FEATURES)  # nothing dropped
    assert out["headline_feature"] != "rev_us_soy_stu"


def test_placebo_window_is_strictly_before_the_release(synthetic_wasde, synthetic_prices):
    v = build_vintages(synthetic_wasde)
    main = release_day_events(v, synthetic_prices)
    placebo = release_day_events(v, synthetic_prices, lag_sessions=5)
    assert len(placebo) == len(main)
    d = main["release_date"].iloc[10]
    i = synthetic_prices.index.get_loc(d)
    expected = np.log(synthetic_prices.iloc[i - 5] / synthetic_prices.iloc[i - 6])
    assert placebo["r"].iloc[10] == pytest.approx(expected)


def test_revision_profile_is_descriptive_and_uses_the_latest_report(
    synthetic_wasde, synthetic_prices
):
    from soyforecast.models.live import revision_profile

    v = build_vintages(synthetic_wasde)
    data = release_day_events(v, synthetic_prices)
    data = data[data["may"] == 0]
    prof = revision_profile(v, data)
    last = v.sort_values("release_date").iloc[-1]
    assert prof["month"] == str(v.sort_values("release_date").index[-1])
    for f in REACTION_FEATURES:
        row = prof["by_feature"][f]
        assert row["median_abs"] == pytest.approx(float(np.median(np.abs(data[f]))), abs=0.01)
        assert row["p90_abs"] >= row["median_abs"] >= 0
        if prof["may"]:
            assert row["latest"] is None
        else:
            assert row["latest"] == pytest.approx(float(last[f]), abs=0.01)
    out = release_day_reaction(v, synthetic_prices, p_now_c_bu=1000)
    assert out["latest_revisions"]["month"] == prof["month"]
    assert all("median_abs_rev" in it and "latest_rev" in it for it in out["items"])
