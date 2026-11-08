"""Rolling-origin backtest, interval calibration, metrics and champion selection.

Purging rule (the one that matters): at origin t, a row s may be used for fitting, for
choosing a penalty or for calibrating an interval only if its target date is on or before
t, i.e. its outcome was already known. Origins are irregular (report dates), so the rule
is applied on dates, never on row counts.
"""

from __future__ import annotations

from typing import Any, cast

import numpy as np
import pandas as pd
from numpy.typing import ArrayLike
from scipy import stats as sps

from soyforecast.config import (
    BOOTSTRAP_DRAWS,
    BOOTSTRAP_SEED,
    CALIB_MIN,
    CALIB_WINDOW,
    CHAMPION_ALPHA,
    HOLDOUT_START,
    HORIZONS,
    INTERVAL_BASELINE,
    INTERVAL_CENTRINGS,
    MDE_ALPHA,
    MDE_POWER,
    OOS_START,
    QUANTILES,
    RANGE_BASELINE,
    RANGE_METHODS,
    TRADING_DAYS_PER_MONTH,
    VALIDATION_END,
    VALIDATION_START,
    VOL_REGIME_QUANTILES,
)
from soyforecast.evaluation.stats import (
    block_bootstrap_ci,
    clark_west,
    directional_test,
    dm_test,
    hac_se_mean,
    holm,
    mde,
    n_eff,
    subsample_median_p,
)
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
                        "roll_cross": bool(x.get(f"roll_cross_{h}", False)),
                        "vol_ewma": float(x.get("vol_ewma", np.nan)),
                        "vol_rv": float(x.get("vol_rv", np.nan)),
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


def horizon_scale(h: int) -> float:
    """sqrt(trading days in h months): daily vol -> h-month vol."""
    return float(np.sqrt(TRADING_DAYS_PER_MONTH * h))


def interval_offsets(
    past_resid: np.ndarray,
    past_vol: np.ndarray,
    vol_now: float,
    h: int,
    method: str = RANGE_BASELINE,
    centring: str = INTERVAL_BASELINE,
) -> dict[float, float]:
    """Quantile offsets (log-return units) around the model forecast for one range method.

    empirical    - empirical quantiles of the past errors (the baseline);
    ewma_fhs     - past errors standardised by the EWMA vol at their own origin, quantiles,
                   then rescaled by today's EWMA vol (filtered historical simulation);
    lognormal_rv - normal quantiles of the log return with sd = today's realized vol.
    See config.RANGE_METHODS; vols are daily and scaled by sqrt(trading days in h).
    """
    if method == "empirical":
        return residual_quantiles(past_resid, centring)
    nan = dict.fromkeys(QUANTILES, float("nan"))
    scale = horizon_scale(h)
    if method == "ewma_fhs":
        z = np.asarray(past_resid, float) / (np.asarray(past_vol, float) * scale)
        if not np.isfinite(vol_now) or not np.isfinite(z).all():
            return nan
        return {q: v * vol_now * scale for q, v in residual_quantiles(z, centring).items()}
    if method == "lognormal_rv":
        if not np.isfinite(vol_now):
            return nan
        return {q: float(sps.norm.ppf(q)) * vol_now * scale for q in QUANTILES}
    raise ValueError(f"unknown range method {method!r}; expected one of {RANGE_METHODS}")


def add_intervals(
    bt: pd.DataFrame, centring: str = INTERVAL_BASELINE, method: str = RANGE_BASELINE
) -> pd.DataFrame:
    """Interval quantiles from realized out-of-sample residuals (purged by date).

    Also records `calib_n`, the number of past errors behind each interval. Every method uses
    the same rows (those with at least CALIB_MIN known errors), so their scores compare like
    with like.
    """
    bt = bt.sort_values(["model", "h", "origin"]).copy()
    for q in QUANTILES:
        bt[f"q{q}"] = np.nan
    bt["calib_n"] = np.nan
    vol_col = "vol_rv" if method == "lognormal_rv" else "vol_ewma"
    for (_model, h), g in bt.groupby(["model", "h"]):
        resid = (g["y"] - g["pred"]).to_numpy()
        tdates = g["target_date"].to_numpy()
        vols = g[vol_col].to_numpy(dtype=float) if vol_col in g else np.full(len(g), np.nan)
        for i, (idx, r) in enumerate(g.iterrows()):
            known = (tdates[:i] <= np.datetime64(r["origin"])) & np.isfinite(resid[:i])
            past = resid[:i][known][-CALIB_WINDOW:]
            if len(past) < CALIB_MIN:
                continue
            bt.at[idx, "calib_n"] = len(past)
            past_vol = vols[:i][known][-CALIB_WINDOW:]
            offsets = interval_offsets(past, past_vol, vols[i], int(cast(int, h)), method, centring)
            for q, v in offsets.items():
                bt.at[idx, f"q{q}"] = r["pred"] + v
    return bt


def interval_score(y: ArrayLike, lo: ArrayLike, hi: ArrayLike, alpha: float) -> np.ndarray:
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


Q_COLS = ["q0.025", "q0.1", "q0.9", "q0.975"]


def _ratio_table(variants: dict[str, pd.DataFrame], baseline: str, label: str) -> pd.DataFrame:
    """Score ratio vs the baseline per candidate and split, averaged over model x horizon cells.

    Only rows where every candidate has an interval are scored, so the cells compare like with
    like. One row per candidate and split; `label` names the candidate column.
    """
    common: set[Any] | None = None
    for v in variants.values():
        ok = set(v.dropna(subset=["y", *Q_COLS]).index)
        common = ok if common is None else common & ok
    keep = sorted(common or set())
    rows = []
    for split in ("validation", "holdout"):
        scores: dict[str, dict[tuple[str, int], float]] = {}
        for c, v in variants.items():
            vv = v.loc[keep]
            scores[c] = {}
            for key, g in vv[vv["split"] == split].groupby(["model", "h"]):
                model, h = cast(tuple[str, int], key)
                scores[c][(str(model), int(h))] = _mean_interval_score(g)
        for c in variants:
            ratios = []
            for cell, b in scores[baseline].items():
                s_ = scores[c].get(cell, float("nan"))
                if np.isfinite(b) and b > 0 and np.isfinite(s_):
                    ratios.append(s_ / b)
            rows.append(
                {
                    label: c,
                    "split": split,
                    "score_ratio": float(np.mean(ratios)) if ratios else float("nan"),
                    "cells": len(ratios),
                }
            )
    return pd.DataFrame(rows)


def _choose(table: pd.DataFrame, label: str, baseline: str, order: tuple[str, ...]) -> str:
    """The lowest validation ratio wins if it is below 1 (the baseline's own ratio)."""
    val = table[table["split"] == "validation"].set_index(label)["score_ratio"]
    chosen = baseline
    for c in order:
        if c != baseline and np.isfinite(val[c]) and val[c] < min(1.0, val[chosen]):
            chosen = c
    return chosen


def select_centring(
    bt: pd.DataFrame,
) -> tuple[pd.DataFrame, str, pd.DataFrame]:
    """Apply the pre-registered interval-centring rule (config.INTERVAL_CENTRINGS).

    Every candidate is scored on the validation split only; the holdout score is computed for
    reporting and never used. Returns the backtest with the chosen intervals, the chosen
    centring and the comparison table (one row per candidate and split).
    """
    variants = {c: add_intervals(bt, c) for c in INTERVAL_CENTRINGS}
    table = _ratio_table(variants, INTERVAL_BASELINE, "centring")
    chosen = _choose(table, "centring", INTERVAL_BASELINE, INTERVAL_CENTRINGS)
    table["chosen"] = table["centring"] == chosen
    val = table[table["split"] == "validation"].set_index("centring")["score_ratio"]
    log.info("backtest.interval_centring", chosen=chosen, validation=val.round(4).to_dict())
    return variants[chosen], chosen, table


def select_range_method(
    bt: pd.DataFrame, centring: str
) -> tuple[pd.DataFrame, str, pd.DataFrame, dict[str, pd.DataFrame]]:
    """Apply the pre-registered range-method rule (config.RANGE_METHODS, P2).

    The baseline, the EWMA-FHS challenger and the naive lognormal vol band are scored with the
    same interval-score ratio as the centring rule, on validation only. Returns the backtest
    with the winner's intervals, the winner, the comparison table and every variant (for the
    diagnostics, which never choose).
    """
    variants = {m: add_intervals(bt, centring, m) for m in RANGE_METHODS}
    table = _ratio_table(variants, RANGE_BASELINE, "method")
    chosen = _choose(table, "method", RANGE_BASELINE, RANGE_METHODS)
    table["chosen"] = table["method"] == chosen
    val = table[table["split"] == "validation"].set_index("method")["score_ratio"]
    log.info("backtest.range_method", chosen=chosen, validation=val.round(4).to_dict())
    return variants[chosen], chosen, table, variants


def _pinball(iv: pd.DataFrame) -> float:
    pin = []
    for q in (0.1, 0.5, 0.9):
        u = iv["y"] - iv[f"q{q}"]
        pin.append(np.maximum(q * u, (q - 1) * u).mean())
    return float(np.mean(pin))


def hit_stats(iv: pd.DataFrame, h: int) -> dict[str, float]:
    """P4 calibration statistics of the 80% and 95% bands; `iv` must be sorted by origin."""
    out: dict[str, float] = {}
    for lvl, lo, hi in ((80, "q0.1", "q0.9"), (95, "q0.025", "q0.975")):
        below = (iv["y"] < iv[lo]).to_numpy()
        above = (iv["y"] > iv[hi]).to_numpy()
        inside = (~below & ~above).astype(float)
        ci_lo, ci_hi = block_bootstrap_ci(inside, h, BOOTSTRAP_DRAWS, BOOTSTRAP_SEED)
        out[f"cover{lvl}_se"] = hac_se_mean(inside, h - 1)
        out[f"cover{lvl}_ci_lo"] = ci_lo
        out[f"cover{lvl}_ci_hi"] = ci_hi
        out[f"cover{lvl}_n_eff"] = n_eff(inside, h - 1)
        out[f"miss_lo{lvl}"] = float(below.mean())
        out[f"miss_hi{lvl}"] = float(above.mean())
        rate = 1 - lvl / 100
        out[f"kupiec{lvl}_p"] = subsample_median_p(inside == 0, h, "kupiec", rate)
        out[f"christ{lvl}_p"] = subsample_median_p(inside == 0, h, "christoffersen")
    return out


def range_diagnostics(
    variants: dict[str, pd.DataFrame], champion: dict[int, str]
) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Diagnostics of each range method for the champion of each horizon (never used to choose).

    Returns (per method x split x horizon: coverage, misses, pinball, interval scores, Kupiec /
    Christoffersen, median width; per method x split x horizon x vol regime: coverage). Vol
    regimes are terciles of the EWMA vol at the origin, cut on the validation origins.
    """
    any_v = next(iter(variants.values()))
    val_vol = any_v[any_v["split"] == "validation"].drop_duplicates("origin")["vol_ewma"]
    cuts = [float(val_vol.quantile(q)) for q in VOL_REGIME_QUANTILES]
    rows, regime_rows = [], []
    for method, v in variants.items():
        for h, model in champion.items():
            for split in ("validation", "holdout"):
                g = v[(v["model"] == model) & (v["h"] == h) & (v["split"] == split)]
                iv = g.dropna(subset=["y", *Q_COLS]).sort_values("origin")
                if iv.empty:
                    continue
                inside80 = ((iv["y"] >= iv["q0.1"]) & (iv["y"] <= iv["q0.9"])).to_numpy()
                inside95 = ((iv["y"] >= iv["q0.025"]) & (iv["y"] <= iv["q0.975"])).to_numpy()
                s80 = interval_score(iv["y"], iv["q0.1"], iv["q0.9"], 0.2)
                s95 = interval_score(iv["y"], iv["q0.025"], iv["q0.975"], 0.05)
                rows.append(
                    {
                        "method": method,
                        "split": split,
                        "h": h,
                        "model": model,
                        "n": len(iv),
                        "cover80": float(inside80.mean()),
                        "cover95": float(inside95.mean()),
                        "pinball": _pinball(iv),
                        "iscore80": float(s80.mean()),
                        "iscore95": float(s95.mean()),
                        "width80_median": float((iv["q0.9"] - iv["q0.1"]).median()),
                        **hit_stats(iv, h),
                    }
                )
                regime = np.digitize(iv["vol_ewma"].to_numpy(dtype=float), cuts)
                for k, name in enumerate(("low", "mid", "high")):
                    sel = regime == k
                    regime_rows.append(
                        {
                            "method": method,
                            "split": split,
                            "h": h,
                            "regime": name,
                            "n": int(sel.sum()),
                            "cover80": float(inside80[sel].mean()) if sel.any() else None,
                            "cover95": float(inside95[sel].mean()) if sel.any() else None,
                        }
                    )
    return pd.DataFrame(rows), pd.DataFrame(regime_rows)


def _usd_t_errors(g: pd.DataFrame) -> pd.Series:
    """Forecast minus actual CBOT price, USD/t (the secondary loss is its absolute value)."""
    f_price = c_bu_to_usd_t(1) * g["p0_c_bu"] * np.exp(g["pred"])
    return f_price - c_bu_to_usd_t(1) * g["pT_c_bu"]


def _metrics(g: pd.DataFrame, rw: pd.DataFrame) -> dict[str, float]:
    g = g.dropna(subset=["y"]).sort_values("origin")
    h = int(g.index.get_level_values("h")[0])
    a_price = c_bu_to_usd_t(1) * g["pT_c_bu"]
    err = _usd_t_errors(g)
    mae = float(err.abs().mean())
    out: dict[str, float] = {
        "n": len(g),
        # primary loss (inference rule v2): squared log-return error
        "mse_logret": float(((g["y"] - g["pred"]) ** 2).mean()),
        "mae_usd_t": mae,
        "rmse_usd_t": float(np.sqrt((err**2).mean())),
        "mape_pct": float((err.abs() / a_price).mean() * 100),
    }
    rw_g = rw.loc[g.index.intersection(rw.index)]
    if len(rw_g):
        rw_abs = _usd_t_errors(rw_g).abs()
        out["mase"] = mae / float(rw_abs.mean())
        if str(g["model"].iloc[0]) != "rw":
            common = g.index.intersection(rw_g.index)
            d = (err.loc[common].abs() - rw_abs.loc[common]).to_numpy()
            out["mde_mae"] = mde(d, float(rw_abs.loc[common].mean()), h, MDE_ALPHA, MDE_POWER)
    moving = g[g["pred"] != 0]
    if len(moving):
        hits = int((np.sign(moving["pred"]) == np.sign(moving["y"])).sum())
        out["dir_acc"] = hits / len(moving)
        # v2: Pesaran-Timmermann (regression form, HAC); NaN if the forecast sign never varies
        out["dir_p"] = directional_test(moving["y"].to_numpy(), moving["pred"].to_numpy(), h)[1]
    iv = g.dropna(subset=["q0.1", "q0.9"])
    if len(iv):
        out["n_interval"] = len(iv)
        out["cover80"] = float(((iv["y"] >= iv["q0.1"]) & (iv["y"] <= iv["q0.9"])).mean())
        out["cover95"] = float(((iv["y"] >= iv["q0.025"]) & (iv["y"] <= iv["q0.975"])).mean())
        out["pinball"] = _pinball(iv)
        out["iscore80"] = float(interval_score(iv["y"], iv["q0.1"], iv["q0.9"], 0.2).mean())
        out["iscore95"] = float(interval_score(iv["y"], iv["q0.025"], iv["q0.975"], 0.05).mean())
        out.update(hit_stats(iv, h))
    if "calib_n" in g and g["calib_n"].notna().any():
        out["calibration_n"] = float(g["calib_n"].median())
        # Overlapping h-month windows: about one independent outcome per h monthly origins.
        out["calibration_n_eff"] = out["calibration_n"] / h
    return out


def summarize(bt: pd.DataFrame) -> tuple[pd.DataFrame, dict[int, str], pd.DataFrame]:
    """Metrics per split/model/horizon, the champion per horizon and the test table.

    Inference rule v2 (config.INFERENCE_RULE_VERSION): DM on the primary loss (squared
    log-return error) and, secondary, on the absolute USD/t error; Clark-West Holm-adjusted
    across the whole family of challenger x horizon tests; the champion must beat the random
    walk on the primary loss.
    """
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
        for h in HORIZONS:
            g = val[(val["model"] == model) & (val["h"] == h)].sort_values("origin")
            r = (
                val[(val["model"] == "rw") & (val["h"] == h)]
                .set_index("report_month")
                .loc[g["report_month"]]
            )
            y = g["y"].to_numpy()
            sq_m = (y - g["pred"].to_numpy()) ** 2
            sq_r = (r["y"].to_numpy() - r["pred"].to_numpy()) ** 2
            dm_t, dm_p = dm_test(sq_m, sq_r, h)
            e_m = np.abs(_usd_t_errors(g).to_numpy())
            e_r = np.abs(_usd_t_errors(r).to_numpy())
            dm_mae_t, dm_mae_p = dm_test(e_m, e_r, h)
            cw_t, p = clark_west(y, g["pred"].to_numpy(), h)
            tests.append(
                {
                    "model": model,
                    "h": h,
                    "n": len(g),
                    "dm_t": dm_t,
                    "dm_p": dm_p,
                    "dm_mae_t": dm_mae_t,
                    "dm_mae_p": dm_mae_p,
                    "cw_t": cw_t,
                    "cw_p": p,
                }
            )
    family = holm({(t["model"], t["h"]): t["cw_p"] for t in tests})
    for t in tests:
        t["cw_p_holm"] = family[(t["model"], t["h"])]
    tests_df = pd.DataFrame(tests)
    champion = choose_champion(metrics, tests_df)
    log.info("backtest.champion", **{f"h{h}": m for h, m in champion.items()})
    return metrics, champion, tests_df


def choose_champion(metrics: pd.DataFrame, tests: pd.DataFrame) -> dict[int, str]:
    """v2 rule: a challenger replaces the random walk at h only if its family-wide Holm p is
    below CHAMPION_ALPHA and its validation primary loss is lower; among those, the lowest
    primary loss wins. The champion therefore never has a higher primary loss than the RW."""
    vm = metrics[(metrics["subset"] == "all") & (metrics["split"] == "validation")]

    def loss(model: str, h: int) -> float:
        return float(vm[(vm["model"] == model) & (vm["h"] == h)]["mse_logret"].iloc[0])

    champion: dict[int, str] = {}
    for h in HORIZONS:
        best, best_loss = "rw", loss("rw", h)
        for _, row in tests[tests["h"] == h].iterrows():
            cand = loss(str(row["model"]), h)
            if row["cw_p_holm"] < CHAMPION_ALPHA and cand < best_loss:
                best, best_loss = str(row["model"]), cand
        champion[h] = best
    return champion


def fob_illustrative(
    bt: pd.DataFrame, premium: pd.Series, champion: dict[int, str]
) -> pd.DataFrame:
    """Paranaguá FOB backtest where the premium seed exists: premium held at its origin value."""
    prem = premium.sort_index()

    def prem_at(d: pd.Timestamp) -> float:
        i = int(prem.index.searchsorted(d, side="right")) - 1
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
    # cast: pandas-stubs does not know apply's include_groups keyword (pandas >= 2.2).
    grouped = cast(Any, df.groupby(["split", "model", "h"]))
    return grouped.apply(
        lambda g: pd.Series(
            {
                "n": len(g),
                "mae_usd_t": g["err"].abs().mean(),
                "mape_pct": (g["err"].abs() / g["actual"]).mean() * 100,
            }
        ),
        include_groups=False,
    ).reset_index()
