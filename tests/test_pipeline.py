"""End-to-end on synthetic data: pipeline -> published JSON contract the site relies on."""

from __future__ import annotations

import json

import numpy as np
import pandas as pd

from soyforecast import pipeline
from soyforecast.config import HORIZONS, Settings
from soyforecast.ingest.premium import (
    build_card,
    derive_monthly_table,
    load_premium_table,
    write_premium_table,
)
from soyforecast.publish.web_json import SCHEMA_VERSION, publish


def test_pipeline_publishes_the_site_contract(
    tmp_path, monkeypatch, synthetic_wasde, synthetic_prices
):
    ptax = pd.Series([5.4, 5.5], index=pd.to_datetime(["2026-11-05", "2026-11-06"]))
    prem_idx = pd.bdate_range("2010-01-01", "2025-06-18")
    raw = pd.Series(np.random.default_rng(3).normal(50, 30, len(prem_idx)), index=prem_idx)
    table = derive_monthly_table(raw)
    card = build_card(
        raw, table, raw_sha256="x", derived_at=pd.Timestamp("2026-11-07"), fob_frozen=[]
    )
    write_premium_table(table, card, tmp_path / "seed" / "prem.csv")
    premium = load_premium_table(tmp_path / "seed" / "prem.csv")
    manifest = {
        "release_tag": "data-test",
        "next_release": "2026-11-10",
        "sha256": "x",
        "reports": 196,
    }

    def fake_ingest(settings, sources=None):
        settings.ensure()
        return synthetic_wasde, synthetic_prices, ptax, premium, manifest

    monkeypatch.setattr(pipeline, "ingest", fake_ingest)
    settings = Settings(data_dir=tmp_path / "data", web_data_dir=tmp_path / "web")
    artefacts = pipeline.run(settings)
    publish(artefacts, settings)

    out = settings.web_data_dir
    meta = json.loads((out / "meta.json").read_text(encoding="utf-8"))
    assert meta["schema_version"] == SCHEMA_VERSION
    assert meta["next_wasde"] == "2026-11-10"
    assert set(meta["champion"]) == {str(h) for h in HORIZONS}
    assert meta["consts"]["bu_per_t"] > 36.7
    assert (
        meta["days_since_report"] == (pd.Timestamp("2026-11-06") - pd.Timestamp("2026-10-10")).days
    )
    assert meta["premium_source"]["stale"] is True
    assert meta["premium_source"]["last"] == "2025-06-18"
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
        assert "premium_default" not in h  # no per-horizon default: the premium is held flat
        assert h["premium_reference"]["note"] == "historical median, not validated"
        assert h["calibration_n_eff"] == round(h["calibration_n"] / h["h"], 1)
        cov = h["coverage"]
        assert cov["nominal"] == {"80": 0.8, "95": 0.95}
        assert 0 <= cov["validation"]["cover80"] <= 1
        assert cov["warn80"] == (cov["validation"]["cover80"] < 0.75)
    assert outlook["last"]["date"] == "2026-11-06"
    now = outlook["premium_now_default"]
    assert now["month"] == 11 and now["stale"] is True and now["illustrative"] is True
    assert now["years"] == "2015-2024"  # derived from the data: November 2025 is not in it
    assert outlook["premium_last"] == {"date": "2025-06-18", "c_bu": round(raw.iloc[-1])}

    track = json.loads((out / "track_record.json").read_text(encoding="utf-8"))
    assert {m["split"] for m in track["metrics"]} == {"validation", "holdout"}
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
    assert wasde["next_release"] == "2026-11-10"
    assert (out / "backtest.csv").exists()
