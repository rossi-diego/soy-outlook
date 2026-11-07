from __future__ import annotations

import json

import numpy as np
import pandas as pd
import pytest

from soyforecast.evaluation.stats import binomial_p, clark_west, dm_test, holm, long_run_variance
from soyforecast.publish.web_json import _clean


def test_long_run_variance_lag0_is_variance():
    x = np.arange(10, dtype=float)
    assert long_run_variance(x, 0) == pytest.approx(np.var(x))


def test_dm_detects_clearly_better_model():
    rng = np.random.default_rng(1)
    bench = np.abs(rng.normal(0, 2, 120))
    better = bench * 0.5
    t, p = dm_test(better, bench, h=1)
    assert t < 0 and p < 0.01


def test_clark_west_rewards_real_signal_not_noise():
    rng = np.random.default_rng(2)
    x = rng.normal(0, 1, 200)
    y = 0.5 * x + rng.normal(0, 1, 200)
    assert clark_west(y, 0.5 * x, h=1)[1] < 0.01
    noise = rng.normal(0, 1, 200)
    assert clark_west(y, 0.5 * noise, h=1)[1] > 0.1


def test_holm_adjustment_is_monotone_and_capped():
    adj = holm({1: 0.01, 3: 0.04, 6: 0.5})
    assert adj[1] == pytest.approx(0.03)
    assert adj[3] == pytest.approx(0.08)
    assert adj[6] == pytest.approx(0.5)
    assert np.isnan(holm({1: float("nan"), 3: 0.2})[1])


def test_binomial():
    assert binomial_p(9, 10) < 0.05
    assert np.isnan(binomial_p(0, 0))


def test_clean_makes_json_safe():
    obj = {
        "a": float("nan"),
        "b": np.float64(1.5),
        "c": pd.Timestamp("2026-01-02"),
        "d": np.bool_(True),
        "e": [np.int64(3)],
    }
    assert json.loads(json.dumps(_clean(obj))) == {
        "a": None,
        "b": 1.5,
        "c": "2026-01-02",
        "d": True,
        "e": [3],
    }
