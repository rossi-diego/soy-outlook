"""v2.1 U5: calibration statistics on overlapping hits (P4), range methods (P2), inference rule
v2 (P16), stress replay (P19) and the reference contract (P10)."""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from soyforecast.config import CHAMPION_ALPHA, HORIZONS, QUANTILES, STRESS_EPISODES
from soyforecast.evaluation.backtest import (
    choose_champion,
    hit_stats,
    interval_offsets,
    select_range_method,
)
from soyforecast.evaluation.stats import (
    block_bootstrap_ci,
    christoffersen_ind,
    directional_test,
    hac_se_mean,
    holm,
    kupiec_pof,
    mde,
    n_eff,
    subsample_median_p,
)
from soyforecast.features.contracts import crosses_roll, first_notice_day, reference_contract
from soyforecast.features.vol import ewma_vol, realized_vol, vol_at
from soyforecast.models.stress import episode_return, h_month_returns, stress_replay

Z80 = 1.2815515655446004


def ma_hits(n: int, h: int, rng: np.random.Generator) -> np.ndarray:
    """Inside-the-80%-band indicator of overlapping h-period sums: an MA(h-1) hit series."""
    e = rng.normal(size=n + h - 1)
    y = np.convolve(e, np.ones(h), mode="valid") / np.sqrt(h)
    return (np.abs(y) <= Z80).astype(float)


# ------------------------------------------------------------------ P4


def test_hac_se_and_n_eff_account_for_overlap():
    rng = np.random.default_rng(10)
    iid = ma_hits(3000, 1, rng)
    ma = ma_hits(3000, 6, rng)
    iid_se = np.sqrt(0.16 / 3000)
    assert hac_se_mean(iid, 0) == pytest.approx(iid_se, rel=0.1)
    # overlap inflates the SE and shrinks the effective sample, roughly by h
    assert hac_se_mean(ma, 5) > 1.5 * iid_se
    assert 3000 / 12 < n_eff(ma, 5) < 3000 / 2
    assert n_eff(iid, 0) == pytest.approx(3000, rel=0.1)
    assert n_eff(np.ones(60), 5) == pytest.approx(10.0)  # constant: one per window


def test_block_bootstrap_ci_covers_the_true_rate_on_ma_series():
    rng = np.random.default_rng(11)
    covered = 0
    sims = 150
    for i in range(sims):
        x = ma_hits(240, 6, rng)
        lo, hi = block_bootstrap_ci(x, 6, 400, seed=i)
        covered += lo <= 0.8 <= hi
    # a percentile block bootstrap undercovers somewhat at n = 240; an iid one would be far off
    assert covered / sims > 0.8
    lo, hi = block_bootstrap_ci(np.ones(30), 3, 200, seed=1)
    assert lo == hi == 1.0


def test_kupiec_and_christoffersen_detect_wrong_rate_and_clustering():
    rng = np.random.default_rng(12)
    good = rng.random(500) < 0.2
    assert kupiec_pof(good, 0.2) > 0.05
    assert kupiec_pof(rng.random(500) < 0.35, 0.2) < 0.001
    clustered = np.repeat(rng.random(100) < 0.2, 5)
    assert christoffersen_ind(clustered) < 0.001
    assert christoffersen_ind(good) > 0.01
    assert np.isnan(kupiec_pof(np.array([True]), 0.2))
    assert christoffersen_ind(np.zeros(50, bool)) == pytest.approx(1.0)


def test_subsample_tests_are_not_fooled_by_overlap():
    """On a correctly calibrated MA(5) hit series the non-overlapping subsamples rarely reject,
    while the full overlapping series looks clustered to the iid Christoffersen test."""
    rng = np.random.default_rng(13)
    rejections_sub, rejections_full = 0, 0
    sims = 100
    for _ in range(sims):
        misses = ma_hits(600, 6, rng) == 0
        rejections_sub += subsample_median_p(misses, 6, "christoffersen") < 0.05
        rejections_full += christoffersen_ind(misses) < 0.05
    assert rejections_sub / sims < 0.15
    assert rejections_full / sims > 0.5


def test_mde_shrinks_with_sample_size_and_is_relative():
    rng = np.random.default_rng(14)
    d_small, d_big = rng.normal(0, 5, 100), rng.normal(0, 5, 1600)
    assert mde(d_big, 50.0, 1, 0.05, 0.8) == pytest.approx(
        mde(d_small, 50.0, 1, 0.05, 0.8) / 4, rel=0.2
    )
    z = 1.6448536269514722 + 0.8416212335729143
    assert mde(d_big, 50.0, 1, 0.05, 0.8) == pytest.approx(z * 5 / 40 / 50, rel=0.1)
    assert np.isnan(mde(d_small[:5], 50.0, 1, 0.05, 0.8))


def test_hit_stats_split_misses_by_tail():
    iv = pd.DataFrame(
        {
            "y": [-3.0, 0.0, 0.0, 3.0, 3.0, 0.0, 0.0, 0.0, 0.0, 0.0],
            "q0.1": -1.0,
            "q0.9": 1.0,
            "q0.025": -2.0,
            "q0.975": 2.0,
        }
    )
    s = hit_stats(iv, 1)
    assert s["miss_lo80"] == pytest.approx(0.1)
    assert s["miss_hi80"] == pytest.approx(0.2)
    assert s["miss_lo95"] == pytest.approx(0.1)
    assert s["miss_hi95"] == pytest.approx(0.2)
    assert s["cover80_ci_lo"] <= 0.7 <= s["cover80_ci_hi"]


# ------------------------------------------------------------------ P16


def test_directional_test_power_size_and_degenerate_cases():
    rng = np.random.default_rng(15)
    x = rng.normal(size=300)
    y = x + rng.normal(size=300)
    assert directional_test(y, x, 1)[1] < 0.001
    assert directional_test(rng.normal(size=300), x, 1)[1] > 0.01
    assert np.isnan(directional_test(y, np.abs(x) + 0.1, 1)[1])  # always "up"
    # overlapping 6-month outcomes and persistent forecasts, no real signal: HAC keeps the size
    rejections = 0
    for _ in range(200):
        e, f = rng.normal(size=305), rng.normal(size=305)
        yy = np.convolve(e, np.ones(6), "valid")
        ff = np.convolve(f, np.ones(6), "valid")
        rejections += directional_test(yy, ff, 6)[1] < 0.05
    assert rejections / 200 < 0.12


def _frames(cand_loss: float, cw_holm: float) -> tuple[pd.DataFrame, pd.DataFrame]:
    rows = [
        {"subset": "all", "split": "validation", "model": m, "h": h, "mse_logret": loss}
        for h in HORIZONS
        for m, loss in (("rw", 0.010), ("ridge", cand_loss))
    ]
    tests = pd.DataFrame([{"model": "ridge", "h": h, "cw_p_holm": cw_holm} for h in HORIZONS])
    return pd.DataFrame(rows), tests


def test_champion_never_has_higher_primary_loss_than_random_walk():
    # significant Clark-West but a higher squared log-return error: stays with no change
    assert set(choose_champion(*_frames(0.011, 0.001)).values()) == {"rw"}
    # lower loss but not significant after Holm: stays with no change
    assert set(choose_champion(*_frames(0.009, CHAMPION_ALPHA)).values()) == {"rw"}
    assert set(choose_champion(*_frames(0.009, 0.01)).values()) == {"ridge"}


def test_pipeline_applies_rule_v2(fixture_run):
    a, _ = fixture_run
    t = a.tests
    assert len(t) == 9
    family = holm({(r.model, r.h): r.cw_p for r in t.itertuples()})
    for r in t.itertuples():
        assert r.cw_p_holm == pytest.approx(family[(r.model, r.h)], nan_ok=True)
    vm = a.metrics[(a.metrics["subset"] == "all") & (a.metrics["split"] == "validation")]
    for h, model in a.champion.items():
        loss = vm.set_index(["model", "h"])["mse_logret"]
        assert loss[(model, h)] <= loss[("rw", h)]
    assert {"dm_mae_p", "dm_p"} <= set(t.columns)


# ------------------------------------------------------------------ P2


def test_interval_offsets_methods():
    past = np.linspace(-0.1, 0.1, 60)
    vol = np.full(60, 0.01)
    emp = interval_offsets(past, vol, 0.02, 1, "empirical", "raw")
    fhs = interval_offsets(past, vol, 0.02, 1, "ewma_fhs", "raw")
    # today's vol is twice the past vol: FHS doubles every offset
    for q in QUANTILES:
        assert fhs[q] == pytest.approx(2 * emp[q])
    ln = interval_offsets(past, vol, 0.01, 3, "lognormal_rv")
    sd = 0.01 * np.sqrt(63)
    assert ln[0.9] == pytest.approx(Z80 * sd)
    assert ln[0.1] == pytest.approx(-ln[0.9])
    assert all(np.isnan(v) for v in interval_offsets(past, vol, np.nan, 1, "ewma_fhs").values())
    with pytest.raises(ValueError):
        interval_offsets(past, vol, 0.01, 1, "garch")


def _bt_vol(n: int = 140) -> pd.DataFrame:
    rng = np.random.default_rng(16)
    origins = pd.date_range("2008-01-10", periods=n, freq="MS")
    split = np.where(origins < pd.Timestamp("2013-01-01"), "burn_in", "validation")
    split[origins >= pd.Timestamp("2017-06-01")] = "holdout"
    vol = 0.01 * np.exp(np.cumsum(rng.normal(0, 0.1, n)))
    return pd.DataFrame(
        {
            "model": "m",
            "h": 1,
            "origin": origins,
            "target_date": origins + pd.DateOffset(months=1),
            "pred": 0.0,
            "y": rng.normal(0, 1, n) * vol * np.sqrt(21),
            "split": split,
            "vol_ewma": vol,
            "vol_rv": vol,
        }
    )


def test_range_method_choice_uses_validation_only():
    bt = _bt_vol()
    _, chosen, table, variants = select_range_method(bt, "raw")
    assert set(variants) == {"empirical", "ewma_fhs", "lognormal_rv"}
    assert table["chosen"].sum() == 2  # one flag per split, same method
    val = table[table["split"] == "validation"].set_index("method")["score_ratio"]
    assert val["empirical"] == pytest.approx(1.0)
    # vol-driven outcomes: the vol-scaled methods should beat the unconditional band
    assert chosen != "empirical"
    shocked = bt.copy()
    shocked.loc[shocked["split"] == "holdout", "y"] *= 10
    assert select_range_method(shocked, "raw")[1] == chosen


def test_vol_series_never_look_ahead(synthetic_prices):
    full_e, full_r = ewma_vol(synthetic_prices), realized_vol(synthetic_prices)
    cut = synthetic_prices.index[3000]
    part = synthetic_prices[synthetic_prices.index <= cut]
    assert vol_at(ewma_vol(part), cut) == pytest.approx(vol_at(full_e, cut))
    assert vol_at(realized_vol(part), cut) == pytest.approx(vol_at(full_r, cut))
    assert full_e.iloc[:58].isna().all() and np.isfinite(full_e.iloc[59])


# ------------------------------------------------------------------ P10


def test_reference_contract_by_first_notice_day():
    assert first_notice_day(2027, 3) == pd.Timestamp("2027-02-26")
    codes = [
        reference_contract(pd.Timestamp(d))["code"]
        for d in ("2026-12-06", "2027-02-06", "2027-05-06", "2027-06-30", "2027-10-30")
    ]
    assert codes == ["F27", "H27", "N27", "Q27", "F28"]
    assert not crosses_roll(pd.Timestamp("2026-11-06"), pd.Timestamp("2026-12-06"))
    assert crosses_roll(pd.Timestamp("2026-11-06"), pd.Timestamp("2027-02-06"))


# ------------------------------------------------------------------ P19


def test_stress_uses_only_realized_returns(synthetic_prices):
    month = STRESS_EPISODES[0][0]
    ep = episode_return(synthetic_prices, month, 3)
    assert ep is not None
    start, end = ep["start"], ep["end"]
    expected = np.log(synthetic_prices.loc[end] / synthetic_prices.loc[start])
    assert ep["logret"] == pytest.approx(expected)
    # prices after the window cannot change the outcome ...
    upto = synthetic_prices[synthetic_prices.index <= start + pd.DateOffset(months=3, days=7)]
    assert episode_return(upto, month, 3) == ep
    # ... and a window that has not fully happened is not replayed
    short = synthetic_prices[synthetic_prices.index < start + pd.DateOffset(months=2)]
    assert episode_return(short, month, 3) is None
    assert episode_return(synthetic_prices, "1990-01", 1) is None


def test_stress_replay_applies_returns_to_todays_price(synthetic_prices):
    out = stress_replay(synthetic_prices, 1000.0, 5.0)
    assert out["label"] == "illustrative scenarios, not probabilities"
    assert [h["h"] for h in out["horizons"]] == list(HORIZONS)
    for hz in out["horizons"]:
        dist = hz["distribution"]
        assert sum(dist["counts"]) == dist["n"] == len(h_month_returns(synthetic_prices, hz["h"]))
        for ep in hz["episodes"]:
            assert ep["c_bu"] == pytest.approx(1000 * np.exp(ep["logret"]), rel=1e-3)
            assert 0 <= ep["percentile"] <= 100
