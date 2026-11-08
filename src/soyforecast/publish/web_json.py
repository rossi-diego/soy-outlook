"""Publish: static JSON for the Next.js site (web/public/data) plus CSV downloads.

All prices are stored in US cents per bushel (the CBOT quote); the site converts to USD/t
and BRL per 60 kg sack with the constants in meta.json, so there is one source of truth.
"""

from __future__ import annotations

import json
import math
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING, Any

import numpy as np
import pandas as pd

from soyforecast import __version__
from soyforecast.config import (
    CALIB_WINDOW,
    CHAMPION_ALPHA,
    COVERAGE_WARN_PP,
    FEATURES,
    HOLDOUT_START,
    HORIZONS,
    INTERVAL_BASELINE,
    INTERVAL_CENTRINGS,
    INTERVAL_METHOD,
    NOMINAL_LEVELS,
    OOS_START,
    STALE_PREMIUM_DAYS,
    VALIDATION_END,
    VALIDATION_START,
    Settings,
)
from soyforecast.features.vintages import FEATURE_META
from soyforecast.logs import get_logger
from soyforecast.models.ladder import MODEL_LABELS
from soyforecast.units import BUSHELS_PER_TONNE, SACK_KG

if TYPE_CHECKING:
    from soyforecast.pipeline import Artefacts

log = get_logger(__name__)
SCHEMA_VERSION = 2
TRACK_MODELS = ("rw", "arima", "ridge")


def _clean(x: Any) -> Any:
    """JSON-safe: NaN/inf -> None, numpy -> python, timestamps -> ISO dates."""
    if isinstance(x, dict):
        return {str(k): _clean(v) for k, v in x.items()}
    if isinstance(x, list | tuple):
        return [_clean(v) for v in x]
    if isinstance(x, pd.Timestamp):
        return x.date().isoformat()
    if isinstance(x, np.bool_ | bool):
        return bool(x)
    if isinstance(x, np.integer):
        return int(x)
    if isinstance(x, np.floating | float):
        f = float(x)
        return None if math.isnan(f) or math.isinf(f) else f
    return x


def _dump(obj: Any, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(_clean(obj), ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
    )


def _r(x: float, d: int = 2) -> float | None:
    return None if x is None or not np.isfinite(x) else round(float(x), d)


def _premium_source(a: Artefacts) -> dict[str, Any]:
    """What the site needs to label the premium default honestly (P8/P9)."""
    anchor = pd.Timestamp(a.live["anchor_date"])
    card = a.premium.card
    return {
        "kind": "derived monthly table",
        "name": card["name"],
        "unit": card["unit"],
        "contract_convention": card["contract_convention"],
        "method": card["method"],
        "licence": card["licence"],
        "first": card["series"]["first"],
        "last": card["series"]["last"],
        "valid_until": card["valid_until"],
        "days_since_last": int((anchor - a.premium.last_date).days),
        "stale_after_days": STALE_PREMIUM_DAYS,
        "stale": a.premium.is_stale(anchor),
    }


def build_meta(a: Artefacts) -> dict[str, Any]:
    anchor = pd.Timestamp(a.live["anchor_date"])
    release = pd.Timestamp(a.live["release_date"])
    return {
        "schema_version": SCHEMA_VERSION,
        "version": __version__,
        "generated_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "as_of_close": anchor,
        "latest_wasde": {"month": a.live["report_month"], "release_date": a.live["release_date"]},
        # Ranges are calibrated at release-day origins; the live forecast is issued from the
        # latest close, this many days after the report (P15).
        "days_since_report": int((anchor - release).days),
        "origin_note": "Ranges are calibrated on forecasts made at the close of WASDE release days.",
        "next_wasde": a.wasde_manifest.get("next_release"),
        "wasde_source": {
            "tag": a.wasde_manifest.get("release_tag"),
            "sha256": a.wasde_manifest.get("sha256"),
            "reports": a.wasde_manifest.get("reports"),
        },
        "consts": {"bu_per_t": BUSHELS_PER_TONNE, "sack_kg": SACK_KG},
        "fx_default": {
            "value": float(a.ptax.iloc[-1]),
            "date": a.ptax.index[-1],
            "source": "Banco Central do Brasil, PTAX selling rate (SGS 1)",
        },
        "premium_source": _premium_source(a),
        "splits": {
            "oos_start": OOS_START,
            "validation": [VALIDATION_START, VALIDATION_END],
            "holdout_start": HOLDOUT_START,
        },
        "champion": {str(h): m for h, m in a.champion.items()},
        "champion_alpha": CHAMPION_ALPHA,
        "calibration_window": CALIB_WINDOW,
        "intervals": {
            "method": INTERVAL_METHOD,
            "centring": a.centring,
            "candidates": list(INTERVAL_CENTRINGS),
            "baseline": INTERVAL_BASELINE,
            "rule": (
                "Chosen on validation only: mean 80% + 95% interval score relative to the "
                "baseline, averaged over models and horizons; the holdout is reported."
            ),
            "nominal_levels": list(NOMINAL_LEVELS),
            "coverage_warn_pp": COVERAGE_WARN_PP,
        },
        "models": MODEL_LABELS,
        "features": [
            {"id": f, "label": FEATURE_META[f][0], "unit": FEATURE_META[f][1]} for f in FEATURES
        ],
    }


def _coverage(a: Artefacts, model: str, h: int) -> dict[str, Any]:
    """Realized hit rates of the champion's bands per split, next to the nominal levels (P5)."""
    m = a.metrics[(a.metrics["subset"] == "all") & (a.metrics["model"] == model)]
    m = m[m["h"] == h]
    out: dict[str, Any] = {"nominal": {"80": NOMINAL_LEVELS[0], "95": NOMINAL_LEVELS[1]}}
    for split, years in (
        ("validation", f"{VALIDATION_START.year}-{str(VALIDATION_END.year)[2:]}"),
        ("holdout", f"{HOLDOUT_START.year}+"),
    ):
        row = m[m["split"] == split]
        if row.empty or pd.isna(row["cover80"].iloc[0]):
            out[split] = None
            continue
        r = row.iloc[0]
        out[split] = {
            "years": years,
            "n": int(r["n_interval"]),
            "cover80": _r(r["cover80"], 3),
            "cover95": _r(r["cover95"], 3),
            "calibration_n_eff": _r(r.get("calibration_n_eff", np.nan), 1),
        }
    val = out.get("validation")
    out["warn80"] = bool(val and val["cover80"] < NOMINAL_LEVELS[0] - COVERAGE_WARN_PP)
    out["warn95"] = bool(val and val["cover95"] < NOMINAL_LEVELS[1] - COVERAGE_WARN_PP)
    return out


def _premium_row(a: Artefacts, month: int) -> dict[str, Any]:
    p = a.premium.profile.loc[month]
    return {
        "month": month,
        "median": _r(p["median"], 0),
        "p10": _r(p["p10"], 0),
        "p90": _r(p["p90"], 0),
        "years": a.premium.years_label(month),
        "n_years": int(p["n_years"]),
    }


def build_outlook(a: Artefacts) -> dict[str, Any]:
    anchor = pd.Timestamp(a.live["anchor_date"])
    horizons = []
    for row in a.forecast:
        target = pd.Timestamp(row["target_date"])  # type: ignore[arg-type]
        h = int(row["h"])  # type: ignore[call-overload]
        horizons.append(
            {
                **row,
                "central": _r(float(a.live["p0_c_bu"]) * math.exp(float(row["mean_logret"]))),  # type: ignore[arg-type]
                "coverage": _coverage(a, str(row["model"]), h),
                # Reference text only: the default premium is held flat at premium_now_default.
                "premium_reference": {
                    **_premium_row(a, int(target.month)),
                    "note": "historical median, not validated",
                },
            }
        )
    weekly = a.prices[a.prices.index >= "2016-01-01"].resample("W-FRI").last().dropna()
    return {
        "as_of_close": anchor,
        "last": {"date": anchor, "c_bu": _r(float(a.live["p0_c_bu"]))},
        "horizons": horizons,
        "history": [{"date": d, "c_bu": _r(v)} for d, v in weekly.items()],
        "premium_last": {"date": a.premium.last_date, "c_bu": _r(a.premium.last_c_bu, 0)},
        # One premium for the headline and every horizon (P6): with CBOT unchanged, FOB
        # changes only through the premium the user enters.
        "premium_now_default": {
            **_premium_row(a, int(anchor.month)),
            "basis": "calendar-month median",
            "source_last": a.premium.last_date,
            "stale": a.premium.is_stale(anchor),
            "illustrative": True,
        },
    }


def build_track_record(a: Artefacts) -> dict[str, Any]:
    m = a.metrics.copy()
    metric_rows = m.replace({np.nan: None}).to_dict(orient="records")
    paths: dict[str, dict[str, list[dict[str, Any]]]] = {}
    bt = a.backtest[a.backtest["split"] != "burn_in"]
    for h in HORIZONS:
        paths[str(h)] = {}
        for model in TRACK_MODELS:
            g = bt[(bt["model"] == model) & (bt["h"] == h)].sort_values("origin")
            rows = []
            for _, r in g.iterrows():
                p0 = r["p0_c_bu"]
                rows.append(
                    {
                        "origin": r["origin"],
                        "target_date": r["target_date"],
                        "split": r["split"],
                        "crop_roll": r["crop_roll"],
                        "p0": _r(p0),
                        "actual": _r(r["pT_c_bu"]),
                        "forecast": _r(p0 * math.exp(r["pred"])),
                        "q025": _r(p0 * math.exp(r["q0.025"])),
                        "q10": _r(p0 * math.exp(r["q0.1"])),
                        "q90": _r(p0 * math.exp(r["q0.9"])),
                        "q975": _r(p0 * math.exp(r["q0.975"])),
                    }
                )
            paths[str(h)][model] = rows
    return {
        "metrics": metric_rows,
        "tests": a.tests.replace({np.nan: None}).to_dict(orient="records"),
        "fob_illustrative": a.premium.card.get("fob_illustrative_frozen", {}).get("rows", []),
        "fob_illustrative_note": a.premium.card.get("fob_illustrative_frozen", {}).get("note"),
        "interval_choice": a.interval_choice.replace({np.nan: None}).to_dict(orient="records"),
        "paths": paths,
    }


WASDE_LINES = (
    ("us_soy_stu", "US soybean stocks-to-use", "%"),
    ("us_corn_stu", "US corn stocks-to-use", "%"),
    ("br_soy_prod", "Brazil soybean crop", "Mt"),
    ("ar_soy_prod", "Argentina soybean crop", "Mt"),
    ("cn_soy_imports", "China soybean imports", "Mt"),
    ("world_soy_es", "World soybean ending stocks", "Mt"),
)


def build_wasde(a: Artefacts) -> dict[str, Any]:
    v = a.vintages
    last, prev = v.iloc[-1], v.iloc[-2]
    same_my = last["proj_my"] == prev["proj_my"]
    lines = []
    for key, label, unit in WASDE_LINES:
        lines.append(
            {
                "id": key,
                "label": label,
                "unit": unit,
                "value": _r(last[key]),
                "previous": _r(prev[key]) if same_my else None,
                "change": _r(last[key] - prev[key]) if same_my else None,
            }
        )
    return {
        "report_month": v.index[-1],
        "release_date": last["release_date"],
        "previous_month": v.index[-2],
        "market_year": last["proj_my"],
        "lines": lines,
        "reaction": a.reaction,
        "next_release": a.wasde_manifest.get("next_release"),
        "forward": a.evidence,
    }


def publish(a: Artefacts, settings: Settings) -> None:
    out = settings.web_data_dir
    _dump(build_meta(a), out / "meta.json")
    _dump(build_outlook(a), out / "outlook.json")
    _dump(build_track_record(a), out / "track_record.json")
    _dump(build_wasde(a), out / "wasde.json")
    cols = [
        "report_month",
        "origin",
        "h",
        "model",
        "split",
        "target_date",
        "p0_c_bu",
        "pT_c_bu",
        "pred",
        "y",
        "q0.025",
        "q0.1",
        "q0.5",
        "q0.9",
        "q0.975",
        "crop_roll",
    ]
    a.backtest[cols].to_csv(out / "backtest.csv", index=False, float_format="%.6g")
    a.metrics.to_csv(out / "metrics.csv", index=False, float_format="%.6g")
    log.info("publish.done", path=str(out), files=sorted(p.name for p in out.iterdir()))
