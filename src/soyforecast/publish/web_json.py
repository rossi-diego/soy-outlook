"""Publish: static JSON for the Next.js site (web/public/data) plus CSV downloads.

All prices are stored in US cents per bushel (the CBOT quote); the site converts to USD/t
and BRL per 60 kg sack with the constants in meta.json, so there is one source of truth.
"""

from __future__ import annotations

import json
import math
import os
import shutil
import tempfile
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING, Any

import numpy as np
import pandas as pd
from pydantic import ValidationError

from soyforecast import __version__
from soyforecast.config import (
    BOOTSTRAP_DRAWS,
    CALIB_MIN,
    CALIB_WINDOW,
    CHAMPION_ALPHA,
    COVERAGE_WARN_PP,
    EWMA_LAMBDA,
    FEATURES,
    HOLDOUT_START,
    HORIZONS,
    INFERENCE_RULE_VERSION,
    INTERVAL_BASELINE,
    INTERVAL_CENTRINGS,
    INTERVAL_METHOD,
    MDE_ALPHA,
    MDE_POWER,
    NOMINAL_LEVELS,
    OOS_START,
    PRIMARY_LOSS,
    RANGE_BASELINE,
    RANGE_METHODS,
    RV_WINDOW,
    SECONDARY_LOSS,
    STALE_PREMIUM_DAYS,
    VALIDATION_END,
    VALIDATION_START,
    Settings,
)
from soyforecast.errors import ContractError
from soyforecast.features.vintages import FEATURE_META
from soyforecast.freshness import freshness_block
from soyforecast.logs import get_logger
from soyforecast.models.ladder import MODEL_LABELS
from soyforecast.publish.archive import publish_archive
from soyforecast.publish.lineage import build_run_manifest
from soyforecast.publish.schema import SCHEMA_VERSION, dump, validate_payload
from soyforecast.publish.validate import check_deltas, check_shape
from soyforecast.units import BUSHELS_PER_TONNE, SACK_KG

if TYPE_CHECKING:
    from soyforecast.pipeline import Artefacts

log = get_logger(__name__)
TRACK_MODELS = ("rw", "arima", "ridge")

RANGE_METHOD_LABELS = {
    "empirical": INTERVAL_METHOD,
    "ewma_fhs": f"EWMA filtered historical simulation (lambda {EWMA_LAMBDA})",
    "lognormal_rv": f"plain volatility band (lognormal, {RV_WINDOW}-session realized vol)",
}


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


def build_meta(a: Artefacts, now: datetime | None = None) -> dict[str, Any]:
    anchor = pd.Timestamp(a.live["anchor_date"])
    release = pd.Timestamp(a.live["release_date"])
    now = now or datetime.now(UTC)
    return {
        "schema_version": SCHEMA_VERSION,
        "version": __version__,
        "generated_at": now.isoformat(timespec="seconds"),
        "as_of_close": anchor,
        "latest_wasde": {"month": a.live["report_month"], "release_date": a.live["release_date"]},
        # Ranges are calibrated at release-day origins; the live forecast is issued from the
        # latest close, this many days after the report (P15).
        "days_since_report": int((anchor - release).days),
        "origin_note": "Ranges are calibrated on forecasts made at the close of WASDE release days.",
        "next_wasde": a.wasde_manifest.get("next_release"),
        # Where each input came from and how old it is (P23): the site's stale banner and
        # the refresh workflow's validation gate read this block.
        "freshness": freshness_block(
            anchor, now, a.wasde_manifest.get("next_release"), a.sources, a.offline
        ),
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
        "calib_min": CALIB_MIN,
        "intervals": {
            "method": RANGE_METHOD_LABELS[a.range_method],
            "range_method": a.range_method,
            "range_candidates": list(RANGE_METHODS),
            "range_baseline": RANGE_BASELINE,
            "range_rule": (
                "Pre-registered 2026-11-08: baseline, one EWMA(0.94) FHS challenger and a "
                "naive lognormal vol band, chosen on validation only by the same interval-score "
                "ratio; only the winner is published, the holdout is reported."
            ),
            "range_labels": RANGE_METHOD_LABELS,
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
        "inference_rule": {
            "version": INFERENCE_RULE_VERSION,
            "registered": "2026-11-08",
            "primary_loss": PRIMARY_LOSS,
            "secondary_loss": SECONDARY_LOSS,
            "adjustment": "Holm across all 9 Clark-West tests (3 challengers x 3 horizons)",
            "champion": (
                "Replace no change only if Holm-adjusted CW p < champion_alpha and the "
                "validation primary loss is lower than the random walk's"
            ),
            "direction_test": "Pesaran-Timmermann, regression form, HAC (Bartlett, lag h-1)",
            "calibration": (
                f"HAC SE (Bartlett, lag h-1); moving-block bootstrap 95% CI (block h, "
                f"{BOOTSTRAP_DRAWS} draws); n_eff = n p(1-p) / long-run variance; Kupiec and "
                "Christoffersen on the h non-overlapping subsamples (median p); "
                f"MDE at {MDE_ALPHA:.0%} one-sided, {MDE_POWER:.0%} power, MAE units"
            ),
            "v1": (
                "DM on absolute USD/t errors, CW on squared log-return errors, Holm across the "
                "three horizons of each model, champion tie-break on MAE, iid binomial direction test"
            ),
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
            # P4: plain-words uncertainty of each hit rate for the cards
            "ci80": [_r(r["cover80_ci_lo"], 3), _r(r["cover80_ci_hi"], 3)],
            "ci95": [_r(r["cover95_ci_lo"], 3), _r(r["cover95_ci_hi"], 3)],
            "n_eff80": _r(r["cover80_n_eff"], 0),
            "n_eff95": _r(r["cover95_n_eff"], 0),
        }
    val = out.get("validation")
    out["warn80"] = bool(val and val["cover80"] < NOMINAL_LEVELS[0] - COVERAGE_WARN_PP)
    out["warn95"] = bool(val and val["cover95"] < NOMINAL_LEVELS[1] - COVERAGE_WARN_PP)
    return out


def _premium_row(a: Artefacts, month: int) -> dict[str, Any]:
    stat = a.premium.stat
    return {
        "month": month,
        "median": _r(stat(month, "median"), 0),
        "p10": _r(stat(month, "p10"), 0),
        "p90": _r(stat(month, "p90"), 0),
        "years": a.premium.years_label(month),
        "n_years": int(stat(month, "n_years")),
    }


def build_outlook(a: Artefacts) -> dict[str, Any]:
    anchor = pd.Timestamp(a.live["anchor_date"])
    horizons = []
    for row in a.forecast:
        target = pd.Timestamp(row["target_date"])
        h = int(row["h"])
        horizons.append(
            {
                **row,
                "central": _r(float(a.live["p0_c_bu"]) * math.exp(float(row["mean_logret"]))),
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
        "stress": a.stress,
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


def _records(df: pd.DataFrame) -> list[dict[str, Any]]:
    return [_clean(r) for r in df.to_dict(orient="records")]


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
                        "roll_cross": bool(r.get("roll_cross", False)),
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
        # P2: the three pre-registered range methods; only `chosen` is published as the range.
        "range_choice": _records(a.range_choice),
        "range_diagnostics": _records(a.range_diagnostics),
        "range_regimes": _records(a.range_regimes),
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


BACKTEST_COLUMNS = [
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
    "roll_cross",
]


def build_payloads(a: Artefacts, settings: Settings, now: datetime) -> dict[str, Any]:
    """Every JSON file, validated against its model in publish/schema.py (P25).

    Raises ContractError listing every violation; nothing has been written at that point.
    """
    raw = {
        "meta.json": build_meta(a, now),
        "outlook.json": build_outlook(a),
        "track_record.json": build_track_record(a),
        "wasde.json": build_wasde(a),
        "run_manifest.json": build_run_manifest(a, settings, now),
    }
    out: dict[str, Any] = {}
    problems: list[str] = []
    for name, payload in raw.items():
        try:
            out[name] = dump(validate_payload(name, _clean(payload)))
        except ValidationError as exc:
            problems += [f"{name}: {_loc(e['loc'])}: {e['msg']}" for e in exc.errors()]
    if problems:
        raise ContractError(f"{len(problems)} contract violations: {problems[:20]}")
    return out


def _loc(loc: tuple[Any, ...]) -> str:
    return ".".join(str(p) for p in loc) or "(root)"


def _stage(out: Path) -> Path:
    """A sibling temp folder seeded with the current publish (archive, any extra files)."""
    out.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix=f".{out.name}.staging-", dir=out.parent))
    if out.exists():
        shutil.copytree(out, staging, dirs_exist_ok=True)
    return staging


def _swap(staging: Path, out: Path) -> None:
    """Replace `out` with `staging` by renames (os.replace), keeping the old copy until done.

    Directory renames are atomic per call; between the two calls `out` is briefly absent. If
    the folder cannot be renamed (on Windows, a dev server holding a handle in it), each file
    is moved in with its own os.replace instead, so no reader ever sees a half-written file.
    """
    backup = out.parent / f"{staging.name.replace('staging', 'previous')}"
    try:
        if out.exists():
            os.replace(out, backup)
    except PermissionError as exc:
        log.warning("publish.swap_per_file", reason=str(exc))
        for src in sorted(p for p in staging.rglob("*") if p.is_file()):
            dst = out / src.relative_to(staging)
            dst.parent.mkdir(parents=True, exist_ok=True)
            os.replace(src, dst)
        return
    try:
        os.replace(staging, out)
    except OSError:
        if backup.exists():
            os.replace(backup, out)
        raise
    shutil.rmtree(backup, ignore_errors=True)


def publish(a: Artefacts, settings: Settings, now: datetime | None = None) -> None:
    """Validate, write everything into a staging folder, check it, then swap it in.

    The post-publish assertions run on the staging folder against the live one: every file
    re-validates (monotone quantiles, no nulls in horizons, schema_version), and the as-of close
    and latest WASDE never go backwards. On any failure the published data is left untouched.
    """
    out = settings.web_data_dir
    now = now or datetime.now(UTC)
    payloads = build_payloads(a, settings, now)
    staging = _stage(out)
    try:
        for name, content in payloads.items():
            _dump(content, staging / name)
        a.backtest[BACKTEST_COLUMNS].to_csv(
            staging / "backtest.csv", index=False, float_format="%.6g"
        )
        a.metrics.to_csv(staging / "metrics.csv", index=False, float_format="%.6g")
        publish_archive(payloads["meta.json"], payloads["outlook.json"], a.prices, staging)
        problems = check_shape(staging, SCHEMA_VERSION)
        if (out / "meta.json").exists():
            problems += check_deltas(staging, out)
        if problems:
            raise ContractError(f"post-publish checks failed: {problems}")
        _swap(staging, out)
    finally:
        shutil.rmtree(staging, ignore_errors=True)
    log.info("publish.done", path=str(out), files=sorted(p.name for p in out.iterdir()))
