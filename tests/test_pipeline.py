"""End-to-end on synthetic data: pipeline -> published JSON contract the site relies on."""

from __future__ import annotations

import json
from datetime import UTC, datetime

import pandas as pd
import pytest

from soyforecast import pipeline
from soyforecast.config import HORIZONS, WHATIF_DEFAULT_FIT, Settings
from soyforecast.publish.web_json import SCHEMA_VERSION, publish


@pytest.mark.slow
def test_pipeline_publishes_the_site_contract(
    tmp_path, monkeypatch, synthetic_wasde, synthetic_prices
):
    ptax = pd.Series([5.4, 5.5], index=pd.to_datetime(["2026-11-05", "2026-11-06"]))
    manifest = {
        "release_tag": "data-test",
        "next_release": "2026-11-10",
        "sha256": "x",
        "reports": 196,
    }

    def fake_ingest(settings, sources=None, **kw):
        settings.ensure()
        return synthetic_wasde, synthetic_prices, ptax, manifest

    monkeypatch.setattr(pipeline, "ingest", fake_ingest)
    settings = Settings(data_dir=tmp_path / "data", web_data_dir=tmp_path / "web")
    artefacts = pipeline.run(settings)
    # Pin the build clock to the synthetic close (15:00 Chicago): the archive skips outlooks built
    # more than ARCHIVE_MAX_LAG_BDAYS after their close, so the wall clock would break this test.
    publish(artefacts, settings, now=datetime(2026, 11, 6, 21, 0, tzinfo=UTC))

    out = settings.web_data_dir
    meta = json.loads((out / "meta.json").read_text(encoding="utf-8"))
    assert meta["schema_version"] == SCHEMA_VERSION
    assert meta["next_wasde"] == "2026-11-10"
    assert set(meta["champion"]) == {str(h) for h in HORIZONS}
    assert meta["consts"]["bu_per_t"] > 36.7
    assert (
        meta["days_since_report"] == (pd.Timestamp("2026-11-06") - pd.Timestamp("2026-10-10")).days
    )
    assert not any("premium" in k for k in meta)  # owner decision: user input only
    assert meta["intervals"]["centring"] in meta["intervals"]["candidates"]
    fresh = meta["freshness"]
    assert fresh["as_of_close"] == meta["as_of_close"] == "2026-11-06"
    assert fresh["stale_after_bdays"] == 3 and fresh["next_wasde"] == "2026-11-10"
    archive = json.loads((out / "archive" / "index.json").read_text(encoding="utf-8"))
    assert archive["n_outlooks"] == 1 and archive["n_resolved"] == 0
    assert (out / "archive" / "2026-11-06.json").exists()

    outlook = json.loads((out / "outlook.json").read_text(encoding="utf-8"))
    assert [h["h"] for h in outlook["horizons"]] == list(HORIZONS)
    for h in outlook["horizons"]:
        assert h["q025"] <= h["q100"] <= h["q900"] <= h["q975"]
        assert not any("premium" in k for k in h)
        assert h["calibration_n_eff"] == round(h["calibration_n"] / h["h"], 1)
        cov = h["coverage"]
        assert cov["nominal"] == {"80": 0.8, "95": 0.95}
        assert 0 <= cov["validation"]["cover80"] <= 1
        assert cov["warn80"] == (cov["validation"]["cover80"] < 0.75)
        # Unit B display rule: a side's 80% tail is flagged above 10% one-tail nominal + 5 pp
        val = cov["validation"]
        assert 0 <= val["miss_lo80"] + val["miss_hi80"] <= 1
        assert abs(val["miss_lo80"] + val["miss_hi80"] + val["cover80"] - 1) < 0.01
        assert cov["tail_warn_lo80"] == (val["miss_lo80"] > 0.15)
        assert cov["tail_warn_hi80"] == (val["miss_hi80"] > 0.15)
    assert outlook["last"]["date"] == "2026-11-06"
    assert not any("premium" in k for k in outlook)
    assert "premium" not in json.dumps(outlook["stress"]["horizons"])

    track = json.loads((out / "track_record.json").read_text(encoding="utf-8"))
    assert {m["split"] for m in track["metrics"]} == {"validation", "holdout"}
    assert not any("fob" in k for k in track)  # the frozen FOB backtest is gone
    assert set(track["paths"]["1"]) == {"rw", "arima", "ridge"}
    choice = track["interval_choice"]
    assert {r["split"] for r in choice} == {"validation", "holdout"}
    assert sum(r["chosen"] for r in choice) == 2  # one centring, flagged on both splits

    wasde = json.loads((out / "wasde.json").read_text(encoding="utf-8"))
    assert len(wasde["lines"]) == 6
    reaction = wasde["reaction"]
    assert reaction["n_reports"] > 100
    k = len(reaction["features"])
    assert len(reaction["cov_usd_t"]) == k and all(len(r) == k for r in reaction["cov_usd_t"])
    assert reaction["resid_sd_usd_t"] > 0
    assert all(it["p_holm"] >= it["p_value"] for it in reaction["items"])
    assert set(reaction["robustness"]) == {"placebo", "split_sample", "roll_excluded"}
    # Display rule (unit D): the what-if's recent fit carries its own covariance and residual sd.
    assert reaction["whatif_default_fit"] == WHATIF_DEFAULT_FIT
    late = reaction["robustness"]["split_sample"]["late"]
    assert [it["feature"] for it in late["items"]] == reaction["features"]
    assert len(late["cov_usd_t"]) == k and all(len(r) == k for r in late["cov_usd_t"])
    assert late["resid_sd_usd_t"] > 0
    assert all(late["cov_usd_t"][i][i] >= 0 for i in range(k))
    assert 0 <= reaction["robustness"]["split_sample"]["early"]["joint_p"] <= 1
    assert wasde["next_release"] == "2026-11-10"
    assert (out / "backtest.csv").exists()
    run = json.loads((out / "run_manifest.json").read_text(encoding="utf-8"))
    assert set(run["inputs"]) == {"wasde", "prices", "ptax"}
    assert not [p for p in out.rglob("*") if "premium" in p.name.lower()]
