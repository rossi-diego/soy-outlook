from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from soyforecast.features.vintages import LINES


def _wasde_rows(month: str, release: str, my_values: dict[str, dict[str, float]]) -> list[dict]:
    rows = []
    for name, line in LINES.items():
        for my, value in my_values[name].items():
            rows.append(
                {
                    "report_month": month,
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
    return rows


@pytest.fixture
def synthetic_wasde() -> pd.DataFrame:
    """Monthly reports 2010-07..2026-10; the projected MY rolls every May."""
    rng = np.random.default_rng(7)
    rows: list[dict] = []
    level = {name: 100.0 + i * 10 for i, name in enumerate(LINES)}
    for d in pd.date_range("2010-07-01", "2026-10-01", freq="MS"):
        start = d.year if d.month >= 5 else d.year - 1
        proj = f"{start}/{str(start + 1)[2:]}"
        prev = f"{start - 1}/{str(start)[2:]}"
        values = {}
        for name in LINES:
            level[name] += rng.normal(0, 1)
            values[name] = {prev: level[name] - 5, proj: level[name]}
        release = (d + pd.Timedelta(days=9)).date().isoformat()
        rows += _wasde_rows(d.strftime("%Y-%m"), release, values)
    return pd.DataFrame(rows)


@pytest.fixture
def synthetic_prices() -> pd.Series:
    """Business-day random walk in cents per bushel, 2004 to 2026-11-06."""
    rng = np.random.default_rng(11)
    idx = pd.bdate_range("2004-01-02", "2026-11-06")
    logp = np.log(1000) + np.cumsum(rng.normal(0, 0.015, len(idx)))
    return pd.Series(np.exp(logp), index=idx, name="close_c_bu")
