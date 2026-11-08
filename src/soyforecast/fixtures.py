"""Synthetic bronze inputs for hermetic CI and tests (no network, no licensed data).

The WASDE balance sheets, CBOT closes and PTAX rates are generated from fixed seeds, so the
offline pipeline run in CI exercises every stage end to end without downloading anything
and without redistributing third-party data. The numbers mean nothing; only their shape
matches the real files. `soyforecast make-fixtures` writes them to tests/fixtures/bronze.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd

from soyforecast.features.vintages import LINES

FIXTURE_LAST_CLOSE = "2026-11-06"
FIXTURE_NEXT_RELEASE = "2026-11-10"


def synthetic_wasde(first: str = "2010-07-01", last: str = "2026-10-01") -> pd.DataFrame:
    """Monthly reports; the projected marketing year rolls every May."""
    rng = np.random.default_rng(7)
    rows: list[dict[str, object]] = []
    level = {name: 100.0 + i * 10 for i, name in enumerate(LINES)}
    for d in pd.date_range(first, last, freq="MS"):
        start = d.year if d.month >= 5 else d.year - 1
        proj = f"{start}/{str(start + 1)[2:]}"
        prev = f"{start - 1}/{str(start)[2:]}"
        release = (d + pd.Timedelta(days=9)).date().isoformat()
        for name, line in LINES.items():
            level[name] += rng.normal(0, 1)
            for my, value in ((prev, level[name] - 5), (proj, level[name])):
                rows.append(
                    {
                        "report_month": d.strftime("%Y-%m"),
                        "release_date": release,
                        "table_id": line.table_id,
                        "commodity_id": line.commodity_id,
                        "region_id": line.region_id,
                        "attribute_id": line.attribute_id,
                        "market_year": my,
                        "period": "annual",
                        "reliability_stat": None,
                        "value": value,
                        "unit_id": "mmt",
                    }
                )
    return pd.DataFrame(rows)


def synthetic_prices(last: str = FIXTURE_LAST_CLOSE) -> pd.Series:
    """Business-day random walk in cents per bushel, 2004 to `last`."""
    rng = np.random.default_rng(11)
    idx = pd.bdate_range("2004-01-02", last)
    logp = np.log(1000) + np.cumsum(rng.normal(0, 0.015, len(idx)))
    s = pd.Series(np.exp(logp), index=idx, name="close_c_bu")
    s.index.name = "date"
    return s


def synthetic_ptax(last: str = FIXTURE_LAST_CLOSE) -> pd.Series:
    """Business-day random walk in BRL per USD, 2016 to `last`."""
    rng = np.random.default_rng(13)
    idx = pd.bdate_range("2016-01-04", last)
    logp = np.log(4.0) + np.cumsum(rng.normal(0, 0.006, len(idx)))
    s = pd.Series(np.round(np.exp(logp), 4), index=idx, name="brl_per_usd")
    s.index.name = "date"
    return s


def write_fixtures(bronze: Path) -> list[Path]:
    """Write the three bronze parquet files and a WASDE manifest into `bronze`."""
    bronze.mkdir(parents=True, exist_ok=True)
    wasde = synthetic_wasde()
    paths = [
        bronze / "wasde_full.parquet",
        bronze / "zs_daily.parquet",
        bronze / "ptax_daily.parquet",
    ]
    wasde.to_parquet(paths[0], index=False)
    synthetic_prices().to_frame().to_parquet(paths[1])
    synthetic_ptax().to_frame().to_parquet(paths[2])
    manifest = {
        "release_tag": "fixture",
        "next_release": FIXTURE_NEXT_RELEASE,
        "source": "synthetic (soyforecast.fixtures)",
        "sha256": None,
        "bytes": None,
        "reports": int(wasde["report_month"].nunique()),
        "latest_report": str(wasde["report_month"].max()),
        "fetched_at": None,
    }
    manifest_path = bronze / "wasde_manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    return [*paths, manifest_path]
