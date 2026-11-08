"""Rolling-origin backtest, interval calibration, metrics and champion selection.

Purging rule (the one that matters): at origin t, a row s may be used for fitting, for
choosing a penalty or for calibrating an interval only if its target date is on or before
t, i.e. its outcome was already known. Origins are irregular (report dates), so the rule
is applied on dates, never on row counts.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from soyforecast.config import (
    CALIB_MIN,
    CALIB_WINDOW,
    CHAMPION_ALPHA,
    HOLDOUT_START,
    HORIZONS,
    INTERVAL_BASELINE,
    INTERVAL_CENTRINGS,
    OOS_START,
    QUANTILES,
    VALIDATION_END,
    VALIDATION_START,
)
from soyforecast.evaluation.stats import binomial_p, clark_west, dm_test, holm
from soyforecast.logs import get_logger
from soyforecast.models.ladder import MODELS
from soyforecast.units import c_bu_to_usd_t

log = get_logger(__name__)


def eligible(df: pd.DataFrame, origin: pd.Timestamp, h: int) -> pd.DataFrame:
    """Rows whose h-month outcome was known at `origin`."""
    return df[(df[f"target_date_{h}"] <= origin) & df[f"y_{h}"].notna()]


def split_of(origin: pd.Timestamp, target_date: pd.Timestamp) -> str:
    """Validation rows must also have their outcome before the holdout starts (no overlap)."""
    if origin >= HOLDOUT_START:
        return "holdout"
    if VALIDATION_START <= origin <= VALIDATION_END and target_date < HOLDOUT_START:
        return "validation"
    return "burn_in"


def run_backtest(
    df: pd.DataFrame,
    models: tuple[str, ...] = tuple(MODELS),
    centring: str = INTERVAL_BASELINE,
) -> pd.DataFrame:
    """Out-of-sample mean forecasts for every origin from OOS_START, model and horizon."""
    rows = []
    origins = df[df["origin"] >= OOS_START]
    for month, x in origins.iterrows():
        origin = x["origin"]
        history = df[df["origin"] <= origin]
        for h in HORIZONS:
            train = eligible(df, origin, h)
            for name in models:
                pred = MODELS[name](train, history, x, h)
                rows.append(
                    {
                        "report_month": month,
                        "origin": origin,
                        "h": h,
                        "model": name,
                        "pred": pred,
                        "y": x[f"y_{h}"],
                        "target_date": x[f"target_date_{h}"],
                        "p0_c_bu": x["p0_c_bu"],
                        "pT_c_bu": x[f"pT_c_bu_{h}"],
                        "crop_roll": bool(x[f"crop_roll_{h}"]),
                        "split": split_of(origin, x[f"target_date_{h}"]),
                    }
                )
        log.debug("backtest.origin", origin=str(origin.date()))
    out = pd.DataFrame(rows)
    log.info("backtest.done", forecasts=len(out), origins=out["origin"].nunique())
    return add_intervals(out, centring)


def residual_quantiles(
    residuals: np.ndarray, centring: str = INTERVAL_BASELINE
) -> dict[float, float]:
    """Empirical quantiles of past errors (linear interpolation), optionally median-centred.

    Not split-conformal (see config.INTERVAL_METHOD): with overlapping windows the residuals
    are not exchangeable, so no finite-sample guarantee is claimed.
    """
    r = np.asarray(residuals, dtype=float)
    if centring == "median":
        r = r - np.median(r)
    elif centring != "raw":
        raise ValueError(f"unknown centring {centring!r}; expected one of {INTERVAL_CENTRINGS}")
    return {q: float(np.quantile(r, q)) for q in QUANTILES}


def add_intervals(bt: pd.DataFrame, centring: str = INTERVAL_BASELINE) -> pd.DataFrame:
    """Interval quantiles from realized out-of-sample residuals (purged by date).

    Also records `calib_n`, the number of past errors behind each interval.
    """
    bt = bt.sort_values(["model", "h", "origin"]).copy()
    for q in QUANTILES:
        bt[f"q{q}"] = np.nan
    bt["calib_n"] = np.nan
    for (_model, _h), g in bt.groupby(["model", "h"]):
        resid = (g["y"] - g["pred"]).to_numpy()
        tdates = g["target_date"].to_numpy()
        for i, (idx, r) in enumerate(g.iterrows()):
            known = (tdates[:i] <= np.datetime64(r["origin"])) & np.isfinite(resid[:i])
            past = resid[:i][known][-CALIB_WINDOW:]
            if len(past) < CALIB_MIN:
                continue
            bt.at[idx, "calib_n"] = len(past)
            for q, v in residual_quantiles(past, centring).items():
                bt.at[idx, f"q{q}"] = r["pred"] + v
    return bt


def interval_score(y: np.ndarray, lo: np.ndarray, hi: np.ndarray, alpha: float) -> np.ndarray:
    """Gneiting-Raftery interval score of a central (1 - alpha) interval; lower is better."""
    y, lo, hi = (np.asarray(a, dtype=float) for a in (y, lo, hi))
    return (hi - lo) + (2 / alpha) * (lo - y) * (y < lo) + (2 / alpha) * (y - hi) * (y > hi)


def _mean_interval_score(g: pd.DataFrame) -> float:
    """Mean of the 80% plus the 95% interval score over rows with an interval and an outcome."""
    g = g.dropna(subset=["y", "q0.1", "q0.9", "q0.025", "q0.975"])
    if g.empty:
        return float("nan")
    s80 = interval_score(g["y"], g["q0.1"], g["q0.9"], 0.2)
    s95 = interval_score(g["y"], g["q0.025"], g["q0.975"], 0.05)
    return float(np.mean(s80 + s95))


def select_centring(
    bt: pd.DataFrame,
) -> tuple[pd.DataFrame, str, pd.DataFrame]:
    """Apply the pre-registered interval-centring rule (config.INTERVAL_CENTRINGS).

    Every candidate is scored on the validation split only; the holdout score is computed for
    reporting and never used. Returns the backtest with the chosen intervals, the chosen
    centring and the comparison table (one row per candidate and split).
    """
    variants = {c: add_intervals(bt, c) for c in INTERVAL_CENTRINGS}
    rows = []
    for split in ("validation", "holdout"):
        base: dict[tuple[str, int], float] = {}
        for (model, h), g in variants[INTERVAL_BASELINE][
            variants[INTERVAL_BASELINE]["split"] == split
        ].groupby(["model", "h"]):
            base[(str(model), int(h))] = _mean_interval_score(g)
        for c, v in variants.items():
            ratios = []
            for (model, h), g in v[v["split"] == split].groupby(["model", "h"]):
                b = base.get((str(model), int(h)), float("nan"))
                s_ = _mean_interval_score(g)
                if np.isfinite(b) and b > 0 and np.isfinite(s_):
                    ratios.append(s_ / b)
            rows.append(
                {
                    "centring": c,
                    "split": split,
                    "score_ratio": float(np.mean(ratios)) if ratios else float("nan"),
                    "cells": len(ratios),
                }
            )
    table = pd.DataFrame(rows)
    val = table[table["split"] == "validation"].set_index("centring")["score_ratio"]
    chosen = INTERVAL_BASELINE
    for c in INTERVAL_CENTRINGS:
        if c != INTERVAL_BASELINE and np.isfinite(val[c]) and val[c] < min(1.0, val[chosen]):
            chosen = c
    table["chosen"] = table["centring"] == chosen
    log.info("backtest.interval_centring", chosen=chosen, validation=val.round(4).to_dict())
    return variants[chosen], chosen, table


def _metrics(g: pd.DataFrame, rw: pd.DataFrame) -> dict[str, float]:
    g = g.dropna(subset=["y"])
    f_price = c_bu_to_usd_t(1) * g["p0_c_bu"] * np.exp(g["pred"])
    a_price = c_bu_to_usd_t(1) * g["pT_c_bu"]
    err = f_price - a_price
    rw_g = rw.loc[g.index.intersection(rw.index)] if rw is not None else None
    mae = float(err.abs().mean())
    out: dict[str, float] = {
        "n": len(g),
        "mae_usd_t": mae,
        "rmse_usd_t": float(np.sqrt((err**2).mean())),
        "mape_pct": float((err.abs() / a_price).mean() * 100),
    }
    if rw_g is not None and len(rw_g):
        rw_err = (c_bu_to_usd_t(1) * rw_g["p0_c_bu"] - c_bu_to_usd_t(1) * rw_g["pT_c_bu"]).abs()
        out["mase"] = mae / float(rw_err.mean())
    moving = g[g["pred"] != 0]
    if len(moving):
        hits = int((np.sign(moving["pred"]) == np.sign(moving["y"])).sum())
        out["dir_acc"] = hits / len(moving)
        out["dir_p"] = binomial_p(hits, len(moving))
    iv = g.dropna(subset=["q0.1", "q0.9"])
    if len(iv):
        out["n_interval"] = len(iv)
        out["cover80"] = float(((iv["y"] >= iv["q0.1"]) & (iv["y"] <= iv["q0.9"])).mean())
        out["cover95"] = float(((iv["y"] >= iv["q0.025"]) & (iv["y"] <= iv["q0.975"])).mean())
        pin = []
        for q in (0.1, 0.5, 0.9):
            u = iv["y"] - iv[f"q{q}"]
            pin.append(np.maximum(q * u, (q - 1) * u).mean())
        out["pinball"] = float(np.mean(pin))
        out["iscore80"] = float(interval_score(iv["y"], iv["q0.1"], iv["q0.9"], 0.2).mean())
        out["iscore95"] = float(interval_score(iv["y"], iv["q0.025"], iv["q0.975"], 0.05).mean())
    if "calib_n" in g and g["calib_n"].notna().any():
        h = int(g.index.get_level_values("h")[0])
        out["calibration_n"] = float(g["calib_n"].median())
        # Overlapping h-month windows: about one independent outcome per h monthly origins.
        out["calibration_n_eff"] = out["calibration_n"] / h
    return out


def summarize(bt: pd.DataFrame) -> tuple[pd.DataFrame, dict[int, str], pd.DataFrame]:
    """Metrics per split/model/horizon, the champion per horizon and the test table."""
    key = ["report_month", "h"]
    rw = bt[bt["model"] == "rw"].set_index(key)
    metric_rows = []
    for subset in ("all", "no_crop_roll"):
        data = bt if subset == "all" else bt[~bt["crop_roll"]]
        for (split, model, h), g in data.groupby(["split", "model", "h"]):
            if split == "burn_in":
                continue
            m = _metrics(g.set_index(key), rw)
            metric_rows.append({"subset": subset, "split": split, "model": model, "h": h, **m})
    metrics = pd.DataFrame(metric_rows)

    # Tests on the validation split only; the holdout is never used to choose.
    tests = []
    val = bt[(bt["split"] == "validation")].dropna(subset=["y"])
    for model in [m for m in bt["model"].unique() if m != "rw"]:
        cw_p: dict[int, float] = {}
        for h in HORIZONS:
            g = val[(val["model"] == model) & (val["h"] == h)].sort_values("origin")
            r = (
                val[(val["model"] == "rw") & (val["h"] == h)]
                .set_index("report_month")
                .loc[g["report_month"]]
            )
            e_m = np.abs(
                c_bu_to_usd_t(1)
                * (g["p0_c_bu"].to_numpy() * np.exp(g["pred"].to_numpy()) - g["pT_c_bu"].to_numpy())
            )
            e_r = np.abs(c_bu_to_usd_t(1) * (r["p0_c_bu"].to_numpy() - r["pT_c_bu"].to_numpy()))
            dm_t, dm_p = dm_test(e_m, e_r, h)
            cw_t, p = clark_west(g["y"].to_numpy(), g["pred"].to_numpy(), h)
            cw_p[h] = p
            tests.append(
                {
                    "model": model,
                    "h": h,
                    "n": len(g),
                    "dm_t": dm_t,
                    "dm_p": dm_p,
                    "cw_t": cw_t,
                    "cw_p": p,
                }
            )
        for h, adj in holm(cw_p).items():
            for t in tests:
                if t["model"] == model and t["h"] == h:
                    t["cw_p_holm"] = adj
    tests_df = pd.DataFrame(tests)

    champion: dict[int, str] = {}
    vm = metrics[(metrics["subset"] == "all") & (metrics["split"] == "validation")]
    for h in HORIZONS:
        best, best_mae = (
            "rw",
            float(vm[(vm["model"] == "rw") & (vm["h"] == h)]["mae_usd_t"].iloc[0]),
        )
        for _, t in tests_df[tests_df["h"] == h].iterrows():
            mae = float(vm[(vm["model"] == t["model"]) & (vm["h"] == h)]["mae_usd_t"].iloc[0])
            if t["cw_p_holm"] < CHAMPION_ALPHA and mae < best_mae:
                best, best_mae = t["model"], mae
        champion[h] = best
    log.info("backtest.champion", **{f"h{h}": m for h, m in champion.items()})
    return metrics, champion, tests_df


def fob_illustrative(
    bt: pd.DataFrame, premium: pd.Series, champion: dict[int, str]
) -> pd.DataFrame:
    """Paranaguá FOB backtest where the premium seed exists: premium held at its origin value."""
    prem = premium.sort_index()

    def prem_at(d: pd.Timestamp) -> float:
        i = prem.index.searchsorted(d, side="right") - 1
        if i < 0 or (d - prem.index[i]).days > 7:
            return np.nan
        return float(prem.iloc[i])

    rows = []
    for h, model in champion.items():
        for name in sorted({model, "rw"}):
            g = bt[(bt["model"] == name) & (bt["h"] == h) & (bt["split"] != "burn_in")].dropna(
                subset=["y"]
            )
            for _, r in g.iterrows():
                p0, pT = prem_at(r["origin"]), prem_at(r["target_date"])
                if np.isnan(p0) or np.isnan(pT):
                    continue
                f = c_bu_to_usd_t(r["p0_c_bu"] * np.exp(r["pred"]) + p0)
                a = c_bu_to_usd_t(r["pT_c_bu"] + pT)
                rows.append({"h": h, "model": name, "split": r["split"], "err": f - a, "actual": a})
    df = pd.DataFrame(rows)
    if df.empty:
        return df
    return (
        df.groupby(["split", "model", "h"])
        .apply(
            lambda g: pd.Series(
                {
                    "n": len(g),
                    "mae_usd_t": g["err"].abs().mean(),
                    "mape_pct": (g["err"].abs() / g["actual"]).mean() * 100,
                }
            ),
            include_groups=False,
        )
        .reset_index()
    )
