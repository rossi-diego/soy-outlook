"""U7: the finer quantile grid behind the decision panel (P18) and the release-day move band
with its out-of-sample hit rate (P14)."""

from __future__ import annotations

import itertools
import json

import numpy as np
import pandas as pd
import pytest
from pydantic import ValidationError

from soyforecast.config import (
    QUANTILE_GRID,
    QUANTILES,
    RELEASE_MOVE_MIN_PAST,
    VALIDATION_START,
)
from soyforecast.evaluation.backtest import interval_offsets
from soyforecast.models.live import release_move_band, release_move_hits, wilson
from soyforecast.publish import schema


def test_grid_is_five_to_ninety_five_by_five():
    assert QUANTILE_GRID[0] == 0.05 and QUANTILE_GRID[-1] == 0.95 and len(QUANTILE_GRID) == 19
    assert np.allclose(np.diff(QUANTILE_GRID), 0.05)


@pytest.mark.parametrize("method", ["empirical", "ewma_fhs", "lognormal_rv"])
def test_grid_is_the_same_method_as_the_headline_quantiles(method):
    rng = np.random.default_rng(7)
    past = rng.normal(0, 0.05, 60)
    vol = np.full(60, 0.015)
    head = interval_offsets(past, vol, 0.02, 3, method, "median")
    grid = interval_offsets(past, vol, 0.02, 3, method, "median", QUANTILE_GRID)
    for q in (0.1, 0.5, 0.9):
        assert q in QUANTILES
        assert grid[q] == pytest.approx(head[q])
    values = [grid[q] for q in QUANTILE_GRID]
    assert all(a <= b for a, b in itertools.pairwise(values))
    assert head[0.025] <= values[0] and values[-1] <= head[0.975]


def test_wilson_interval():
    lo, hi = wilson(45, 50)
    assert lo == pytest.approx(0.7864, abs=1e-3) and hi == pytest.approx(0.9565, abs=1e-3)
    lo, hi = wilson(0, 10)
    assert lo == pytest.approx(0.0, abs=1e-9) and 0.2 < hi < 0.35
    assert all(np.isnan(x) for x in wilson(0, 0))


def _events(n: int = 190, seed: int = 3) -> pd.DataFrame:
    days = pd.bdate_range("2010-07-12", periods=n, freq="30D")
    r = np.random.default_rng(seed).normal(0, 0.012, n)
    return pd.DataFrame({"release_date": days, "r": r})


def test_release_move_hits_use_only_earlier_reports():
    data = _events()
    scored = release_move_hits(data)
    assert (scored["release_date"] >= VALIDATION_START).all()
    first = data.index[pd.to_datetime(data["release_date"]) == scored["release_date"].iloc[0]][0]
    assert first >= RELEASE_MOVE_MIN_PAST
    # Each band is the quantile of strictly earlier |r| ...
    abs_r = data["r"].abs().to_numpy()
    for _, row in scored.head(5).iterrows():
        i = int(data.index[data["release_date"] == row["release_date"]][0])
        assert row["band_90"] == pytest.approx(np.quantile(abs_r[:i], 0.9))
        assert row["hit_90"] == (abs_r[i] <= row["band_90"])
    # ... so an extreme later report cannot change an earlier band (no look-ahead).
    shocked = data.copy()
    shocked.loc[shocked.index[-1], "r"] = 0.5
    again = release_move_hits(shocked)
    pd.testing.assert_series_equal(scored["band_90"].iloc[:-1], again["band_90"].iloc[:-1])
    assert scored["band_90"].iloc[-1] == again["band_90"].iloc[-1]


def test_release_move_band_reports_hit_rates_by_split():
    data = _events()
    out = release_move_band(data, usd_t_now=400.0)
    abs_r = data["r"].abs().to_numpy()
    assert out["typical_usd_t"] == pytest.approx(round(np.median(abs_r) * 400, 1))
    assert out["one_in_ten_usd_t"] >= out["typical_usd_t"]
    hr = out["hit_rate"]
    assert hr["validation"]["n"] + hr["holdout"]["n"] == hr["all"]["n"] > 0
    for split in hr.values():
        lo, hi = split["ci90"]
        assert lo <= split["hit90"] <= hi
    schema.ReleaseMove.model_validate(out)


def test_contract_checks_the_grid(published):
    outlook = json.loads((published / "outlook.json").read_text(encoding="utf-8"))
    schema.validate_payload("outlook.json", outlook)
    bad = json.loads(json.dumps(outlook))
    g = bad["horizons"][0]["grid"]["c_bu"]
    g[3], g[4] = g[4] + 1, g[3]
    with pytest.raises(ValidationError, match="not monotone"):
        schema.validate_payload("outlook.json", bad)
    off = json.loads(json.dumps(outlook))
    off["horizons"][1]["grid"]["c_bu"][1] += 5  # the 0.10 level must equal q100
    with pytest.raises(ValidationError, match="differs from q100"):
        schema.validate_payload("outlook.json", off)
    short = json.loads(json.dumps(outlook))
    short["horizons"][2]["grid"]["levels"] = short["horizons"][2]["grid"]["levels"][:-1]
    with pytest.raises(ValidationError, match="grid levels"):
        schema.validate_payload("outlook.json", short)
