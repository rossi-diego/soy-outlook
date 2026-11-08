"""Silver: one row of point-in-time WASDE features per report.

Every value comes from the report as it was published that day. The marketing year (MY)
used is the projected one, taken as the latest MY in each report: the `proj` flag is
missing from the first reports of 2010, while the ranking always works. The projected MY
rolls forward in May, so levels jump then; revisions are computed only within the same
MY, and a `may_rollover` dummy marks the reports where the projected MY is new.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd


@dataclass(frozen=True)
class Line:
    table_id: str
    commodity_id: str
    region_id: str
    attribute_id: str


US_SOY = "us_soybeans_products"
US_CORN = "us_feed_grains_corn"
WORLD_SOY = "world_soybeans"

LINES: dict[str, Line] = {
    "us_soy_es": Line(US_SOY, "soybeans", "united_states", "ending_stocks"),
    "us_soy_use": Line(US_SOY, "soybeans", "united_states", "total_use"),
    "us_corn_es": Line(US_CORN, "corn", "united_states", "ending_stocks"),
    "us_corn_use": Line(US_CORN, "corn", "united_states", "total_use"),
    "br_soy_prod": Line(WORLD_SOY, "soybeans", "brazil", "production"),
    "ar_soy_prod": Line(WORLD_SOY, "soybeans", "argentina", "production"),
    "cn_soy_imports": Line(WORLD_SOY, "soybeans", "china", "imports"),
    "world_soy_es": Line(WORLD_SOY, "soybeans", "world", "ending_stocks"),
}

# Human labels and units for the published evidence table.
FEATURE_META: dict[str, tuple[str, str]] = {
    "us_soy_stu": ("US soybean stocks-to-use", "%"),
    "us_corn_stu": ("US corn stocks-to-use", "%"),
    "rev_us_soy_stu": ("Revision: US soybean stocks-to-use", "pp"),
    "rev_us_corn_stu": ("Revision: US corn stocks-to-use", "pp"),
    "rev_br_soy_prod": ("Revision: Brazil soybean crop", "Mt"),
    "rev_ar_soy_prod": ("Revision: Argentina soybean crop", "Mt"),
    "rev_cn_soy_imports": ("Revision: China soybean imports", "Mt"),
    "rev_world_soy_es": ("Revision: World soybean ending stocks", "Mt"),
    "mom_1m": ("CBOT soybeans, change over the past month", "log"),
    "mom_3m": ("CBOT soybeans, change over the past 3 months", "log"),
    "may_rollover": ("May report (new marketing year starts)", "0/1"),
}


def _line_panel(wasde: pd.DataFrame, line: Line) -> pd.DataFrame:
    """report_month x market_year matrix of one balance-sheet line."""
    x = wasde[
        (wasde["period"] == "annual")
        & (wasde["table_id"] == line.table_id)
        & (wasde["commodity_id"] == line.commodity_id)
        & (wasde["region_id"] == line.region_id)
        & (wasde["attribute_id"] == line.attribute_id)
    ]
    if "reliability_stat" in x.columns:
        x = x[x["reliability_stat"].isna() | (x["reliability_stat"] == "")]
    panel = x.pivot_table(
        index="report_month", columns="market_year", values="value", aggfunc="first"
    )
    return panel.sort_index()


def _proj_and_revision(panel: pd.DataFrame) -> pd.DataFrame:
    """Value of the projected (latest) MY in each report, and its change since the previous report."""
    rows: list[tuple[object, str | None, float, float]] = []
    prev: pd.Series | None = None
    for month, values in panel.iterrows():
        avail = values.dropna()
        if avail.empty:
            rows.append((month, None, np.nan, np.nan))
            prev = values
            continue
        my = str(max(avail.index))
        val = float(avail[my])
        before = prev.get(my, np.nan) if prev is not None else np.nan
        rows.append((month, my, val, val - before if pd.notna(before) else np.nan))
        prev = values
    return pd.DataFrame(rows, columns=["report_month", "proj_my", "value", "revision"]).set_index(
        "report_month"
    )


def build_vintages(wasde: pd.DataFrame) -> pd.DataFrame:
    """One row per WASDE report: release date, projected MY, levels and revisions."""
    releases = (
        wasde.groupby("report_month")["release_date"]
        .first()
        .pipe(pd.to_datetime)
        .rename("release_date")
    )
    parts = {name: _proj_and_revision(_line_panel(wasde, line)) for name, line in LINES.items()}
    out = pd.DataFrame(index=releases.index)
    out["release_date"] = releases
    out["proj_my"] = parts["us_soy_es"]["proj_my"]
    for name, part in parts.items():
        out[name] = part["value"]

    # Stocks-to-use is a ratio, so US bushel units cancel.
    for crop in ("soy", "corn"):
        es, use = parts[f"us_{crop}_es"], parts[f"us_{crop}_use"]
        stu = es["value"] / use["value"] * 100
        out[f"us_{crop}_stu"] = stu
        same_my = es["revision"].notna() & use["revision"].notna()
        prev_stu = (es["value"] - es["revision"]) / (use["value"] - use["revision"]) * 100
        out[f"rev_us_{crop}_stu"] = (stu - prev_stu).where(same_my)

    for name in ("br_soy_prod", "ar_soy_prod", "cn_soy_imports", "world_soy_es"):
        out[f"rev_{name}"] = parts[name]["revision"]

    out["may_rollover"] = (out["proj_my"] != out["proj_my"].shift(1)).astype(int)
    out.loc[out.index[0], "may_rollover"] = 0
    rev_cols = [c for c in out.columns if c.startswith("rev_")]
    # A revision is undefined when the projected MY is new; the dummy carries that report.
    out[rev_cols] = out[rev_cols].fillna(0.0)
    out = out.sort_values("release_date")
    out.index.name = "report_month"
    return out
