"""End-to-end on synthetic data: pipeline -> published JSON contract the site relies on."""

from __future__ import annotations

import json

import numpy as np
import pandas as pd

from soyforecast import pipeline
from soyforecast.config import HORIZONS, Settings
from soyforecast.publish.web_json import SCHEMA_VERSION, publish


def test_pipeline_publishes_the_site_contract(
    tmp_path, monkeypatch, synthetic_wasde, synthetic_prices
):
    ptax = pd.Series([5.4, 5.5], index=pd.to_datetime(["2026-11-05", "2026-11-06"]))
    prem_idx = pd.bdate_range("2010-01-01", "2025-06-18")
    premium = pd.Series(np.random.default_rng(3).normal(50, 30, len(prem_idx)), index=prem_idx)
    manifest = {
        "release_tag": "data-test",
        "next_release": "2026-11-10",
        "sha256": "x",
        "reports": 196,
    }

    def fake_ingest(settings):
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

    outlook = json.loads((out / "outlook.json").read_text(encoding="utf-8"))
    assert [h["h"] for h in outlook["horizons"]] == list(HORIZONS)
    for h in outlook["horizons"]:
        assert h["q025"] <= h["q100"] <= h["q900"] <= h["q975"]
        assert h["premium_default"]["median"] is not None
    assert outlook["last"]["date"] == "2026-11-06"

    track = json.loads((out / "track_record.json").read_text(encoding="utf-8"))
    assert {m["split"] for m in track["metrics"]} == {"validation", "holdout"}
    assert set(track["paths"]["1"]) == {"rw", "arima", "ridge"}

    wasde = json.loads((out / "wasde.json").read_text(encoding="utf-8"))
    assert len(wasde["lines"]) == 6
    assert wasde["reaction"]["n_reports"] > 100
    assert (out / "backtest.csv").exists()
