"""Today's forecast from the champion of each horizon, and the WASDE evidence table."""

from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd
import statsmodels.api as sm
from pandas.tseries.offsets import BDay
from scipy import stats

from soyforecast.config import (
    CALIB_WINDOW,
    FEATURES,
    HORIZONS,
    INTERVAL_BASELINE,
    PLACEBO_LAG_SESSIONS,
    QUANTILES,
    RANGE_BASELINE,
    REACTION_ALPHA,
    REACTION_EXPECTED_SIGN,
    ROLL_EXCLUSION_BDAYS,
    SOY_CONTRACT_MONTHS,
    SPLIT_SAMPLE_BREAK,
)
from soyforecast.evaluation.backtest import eligible, interval_offsets
from soyforecast.evaluation.stats import holm
from soyforecast.features.contracts import crosses_roll, reference_contract
from soyforecast.features.dataset import crop_roll_dates, crosses_crop_roll
from soyforecast.features.vintages import FEATURE_META
from soyforecast.models.ladder import MODELS
from soyforecast.units import c_bu_to_usd_t


def live_forecast(
    df: pd.DataFrame,
    live: pd.Series,
    bt: pd.DataFrame,
    champion: dict[int, str],
    centring: str = INTERVAL_BASELINE,
    method: str = RANGE_BASELINE,
) -> list[dict[str, Any]]:
    """One row per horizon: the champion's mean, the published range method's quantiles,
    the calibration size and the reference contract (P10)."""
    anchor = pd.Timestamp(live["anchor_date"])
    rolls = crop_roll_dates(anchor.year - 1, anchor.year + 2)
    vol_col = "vol_rv" if method == "lognormal_rv" else "vol_ewma"
    history = pd.concat([df[df["origin"] < anchor], live.to_frame().T.infer_objects()])
    out = []
    for h in HORIZONS:
        name = champion[h]
        train = eligible(df, anchor, h)
        pred = MODELS[name](train, history, live, h)
        g = bt[(bt["model"] == name) & (bt["h"] == h) & (bt["target_date"] <= anchor)].dropna(
            subset=["y"]
        )
        g = g.sort_values("origin").tail(CALIB_WINDOW)
        resid = (g["y"] - g["pred"]).to_numpy()
        past_vol = g[vol_col].to_numpy(dtype=float) if vol_col in g else np.full(len(g), np.nan)
        qs = interval_offsets(resid, past_vol, float(live[vol_col]), h, method, centring)
        p0 = float(live["p0_c_bu"])
        target = anchor + pd.DateOffset(months=h)
        row: dict[str, Any] = {
            "h": h,
            "model": name,
            "target_date": target.date().isoformat(),
            "mean_logret": pred,
            "calibration_n": len(resid),
            # overlapping h-month windows: roughly one independent outcome per h origins
            "calibration_n_eff": round(len(resid) / h, 1),
            # expected number of past errors beyond each 95% bound
            "tail_obs_95": round(len(resid) * 0.025, 1),
            # The hedge contract for this horizon, and whether the continuous front month
            # rolls inside the window (the price then partly measures a calendar spread).
            "contract": {
                "origin": reference_contract(anchor)["code"],
                "reference": reference_contract(target),
                "crosses_roll": crosses_roll(anchor, target),
                "crosses_crop_roll": crosses_crop_roll(anchor, target, rolls),
                "series": "Yahoo continuous front month (ZS=F)",
            },
        }
        for q in QUANTILES:
            row[f"q{round(q * 1000):03d}"] = round(p0 * float(np.exp(pred + qs[q])), 2)
        out.append(row)
    return out


REACTION_FEATURES = (
    "rev_us_soy_stu",
    "rev_us_corn_stu",
    "rev_br_soy_prod",
    "rev_ar_soy_prod",
    "rev_cn_soy_imports",
    "rev_world_soy_es",
)


def contract_last_trading_days(start: int, end: int) -> pd.DatetimeIndex:
    """Business day before the 15th of every soybean contract month (F H K N Q U X)."""
    return pd.DatetimeIndex(
        [
            pd.Timestamp(y, m, 15) - BDay(1)
            for y in range(start, end + 1)
            for m in SOY_CONTRACT_MONTHS
        ]
    )


def near_roll(day: pd.Timestamp, ltds: pd.DatetimeIndex, bdays: int) -> bool:
    """True if a contract's last trading day lies within `bdays` business days of `day`."""
    d = np.datetime64(pd.Timestamp(day).date(), "D")
    gaps = np.abs(np.busday_count(d, ltds.to_numpy().astype("datetime64[D]")))
    return bool((gaps <= bdays).any())


def release_day_events(
    vintages: pd.DataFrame, prices: pd.Series, lag_sessions: int = 0
) -> pd.DataFrame:
    """One row per usable report: its revisions and a one-session CBOT log return.

    lag_sessions = 0 is the release-day move (close before -> release-day close); a positive
    lag is the placebo window ending that many sessions before the release.
    """
    prices = prices.sort_index()
    ltds = contract_last_trading_days(prices.index.min().year, prices.index.max().year + 1)
    rows = []
    prev_release: pd.Timestamp | None = None
    for _, v in vintages.iterrows():
        d = pd.Timestamp(v["release_date"])
        gap = None if prev_release is None else (d - prev_release).days
        prev_release = d
        if gap is None or gap > 45:
            continue  # first report, or a two-month revision after a shutdown
        i = int(prices.index.searchsorted(d, side="right")) - 1
        if i < 1 or prices.index[i] != d:
            continue  # no session on the release day
        j = i - lag_sessions
        if j < 1:
            continue
        rows.append(
            {
                **{f: v[f] for f in REACTION_FEATURES},
                "may": v["may_rollover"],
                "release_date": d,
                "near_roll": near_roll(d, ltds, ROLL_EXCLUSION_BDAYS),
                "r": float(np.log(prices.iloc[j] / prices.iloc[j - 1])),
            }
        )
    data = pd.DataFrame(rows)
    return data[data["may"] == 0].reset_index(drop=True)  # revisions undefined in May reports


def _fit(data: pd.DataFrame) -> Any:
    X = sm.add_constant(data[list(REACTION_FEATURES)].astype(float))
    return sm.OLS(data["r"].astype(float), X).fit(cov_type="HC1")


def _joint_p(res: Any) -> float:
    """Wald test (HC1) that all six revision coefficients are zero."""
    k = len(REACTION_FEATURES)
    restriction = np.hstack([np.zeros((k, 1)), np.eye(k)])
    return float(res.f_test(restriction).pvalue)


def round_p(p: float) -> float:
    """Three decimals, but keep two significant digits below 0.001 so a tiny p is not 0.0."""
    return round(p, 3) if p >= 0.001 else float(f"{p:.2g}")


def _coef_items(res: Any, usd_t_now: float) -> list[dict[str, Any]]:
    p_holm = holm({f: float(res.pvalues[f]) for f in REACTION_FEATURES})
    return [
        {
            "feature": f,
            "usd_t_per_unit": round(float(res.params[f]) * usd_t_now, 2),
            "se_usd_t": round(float(res.bse[f]) * usd_t_now, 2),
            "p_value": round(float(res.pvalues[f]), 3),
            "p_holm": round(p_holm[f], 3),
        }
        for f in REACTION_FEATURES
    ]


def _years(d: pd.DataFrame) -> str:
    return f"{d['release_date'].min().year}-{d['release_date'].max().year}"


def _split_sample(data: pd.DataFrame, usd_t_now: float) -> dict[str, Any]:
    early_data = data[data["release_date"] < SPLIT_SAMPLE_BREAK]
    late_data = data[data["release_date"] >= SPLIT_SAMPLE_BREAK]
    early, late = _fit(early_data), _fit(late_data)
    items = []
    for f in REACTION_FEATURES:
        diff = float(early.params[f] - late.params[f])
        se = float(np.hypot(early.bse[f], late.bse[f]))
        items.append(
            {
                "feature": f,
                "early_usd_t": round(float(early.params[f]) * usd_t_now, 2),
                "early_se_usd_t": round(float(early.bse[f]) * usd_t_now, 2),
                "late_usd_t": round(float(late.params[f]) * usd_t_now, 2),
                "late_se_usd_t": round(float(late.bse[f]) * usd_t_now, 2),
                "diff_p": round(float(2 * stats.norm.sf(abs(diff / se))), 3),
            }
        )
    return {
        "break": SPLIT_SAMPLE_BREAK,
        "early": {"years": _years(early_data), "n_reports": int(early.nobs)},
        "late": {"years": _years(late_data), "n_reports": int(late.nobs)},
        "items": items,
    }


def release_day_reaction(
    vintages: pd.DataFrame, prices: pd.Series, p_now_c_bu: float
) -> dict[str, Any]:
    """Event study: CBOT move from the close before the report to the release-day close.

    Regressed on the revisions in that report (OLS, White HC1 errors; one row per report). The
    six coefficients are one Holm family. Exported for the what-if: the HC1 covariance and the
    residual sd (both in USD/t at today's price), so a prediction interval for a user's
    revisions m is sqrt(m'Vm + sd^2). Robustness checks (placebo window, split sample, release
    days near a contract roll excluded) are reported next to the main fit, never instead of it.
    Weak or wrong-sign coefficients are flagged but stay in the total: dropping them would be
    post-hoc selection.
    """
    data = release_day_events(vintages, prices)
    res = _fit(data)
    usd_t_now = c_bu_to_usd_t(p_now_c_bu)
    items = []
    for it in _coef_items(res, usd_t_now):
        f = str(it["feature"])
        label, unit = FEATURE_META[f]
        expected = REACTION_EXPECTED_SIGN[f]
        sign = int(np.sign(float(res.params[f])))
        items.append(
            {
                **it,
                "label": label.replace("Revision: ", ""),
                "unit": unit,
                "expected_sign": expected,
                "wrong_sign": sign not in (0, expected),
                "weak": bool(it["p_holm"] >= REACTION_ALPHA),
            }
        )
    surviving = [it for it in items if not it["weak"] and not it["wrong_sign"]]
    headline = min(surviving, key=lambda it: it["p_holm"])["feature"] if surviving else None
    feats = list(REACTION_FEATURES)
    cov = res.cov_params().loc[feats, feats].to_numpy()
    abs_r = np.abs(data["r"].to_numpy())

    placebo = _fit(release_day_events(vintages, prices, PLACEBO_LAG_SESSIONS))
    no_roll = _fit(data[~data["near_roll"]])
    return {
        "n_reports": int(res.nobs),
        "years": _years(data),
        "r2": round(float(res.rsquared), 3),
        "joint_p": round_p(_joint_p(res)),
        "abs_move_usd_t_median": round(float(np.median(abs_r) * usd_t_now), 2),
        "alpha": REACTION_ALPHA,
        "adjustment": "Holm across the six revision coefficients",
        "headline_feature": headline,
        "items": items,
        "features": feats,
        "cov_usd_t": [[round(float(c) * usd_t_now**2, 5) for c in row] for row in cov],
        "resid_sd_usd_t": round(float(np.sqrt(res.scale)) * usd_t_now, 3),
        "release_move": {
            "n": len(abs_r),
            "typical_usd_t": round(float(np.median(abs_r)) * usd_t_now, 1),
            "one_in_ten_usd_t": round(float(np.quantile(abs_r, 0.9)) * usd_t_now, 1),
        },
        "robustness": {
            "placebo": {
                "lag_sessions": PLACEBO_LAG_SESSIONS,
                "n_reports": int(placebo.nobs),
                "r2": round(float(placebo.rsquared), 3),
                "joint_p": round_p(_joint_p(placebo)),
                "items": _coef_items(placebo, usd_t_now),
            },
            "split_sample": _split_sample(data, usd_t_now),
            "roll_excluded": {
                "bdays": ROLL_EXCLUSION_BDAYS,
                "n_excluded": int(data["near_roll"].sum()),
                "n_reports": int(no_roll.nobs),
                "r2": round(float(no_roll.rsquared), 3),
                "joint_p": round_p(_joint_p(no_roll)),
                "items": _coef_items(no_roll, usd_t_now),
            },
        },
    }


def evidence(df: pd.DataFrame, p_now_c_bu: float) -> list[dict[str, Any]]:
    """OLS with HAC errors of each h-month return on the feature set (full realized sample).

    Shown as weak evidence: it is in-sample and the features did not earn a place in the
    champion unless the backtest says so.
    """
    usd_t_now = c_bu_to_usd_t(p_now_c_bu)
    rows = []
    for h in HORIZONS:
        data = df.dropna(subset=[f"y_{h}"])
        X = sm.add_constant(data[list(FEATURES)].astype(float))
        res = sm.OLS(data[f"y_{h}"].astype(float), X).fit(
            cov_type="HAC", cov_kwds={"maxlags": max(h - 1, 0) + 1}
        )
        for f in FEATURES:
            if not f.startswith("rev_") and not f.endswith("_stu"):
                continue
            label, unit = FEATURE_META[f]
            rows.append(
                {
                    "h": h,
                    "feature": f,
                    "label": label,
                    "unit": unit,
                    "usd_t_per_unit": round(float(res.params[f]) * usd_t_now, 2),
                    "se_usd_t": round(float(res.bse[f]) * usd_t_now, 2),
                    "p_value": round(float(res.pvalues[f]), 3),
                    "n": int(res.nobs),
                }
            )
    return rows
