"""Today's forecast from the champion of each horizon, and the WASDE evidence table."""

from __future__ import annotations

import numpy as np
import pandas as pd
import statsmodels.api as sm

from soyforecast.config import CALIB_WINDOW, FEATURES, HORIZONS, QUANTILES
from soyforecast.evaluation.backtest import eligible, residual_quantiles
from soyforecast.features.vintages import FEATURE_META
from soyforecast.models.ladder import MODELS
from soyforecast.units import c_bu_to_usd_t


def live_forecast(
    df: pd.DataFrame, live: pd.Series, bt: pd.DataFrame, champion: dict[int, str]
) -> list[dict[str, object]]:
    anchor = pd.Timestamp(live["anchor_date"])
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
        qs = residual_quantiles(resid)
        p0 = float(live["p0_c_bu"])
        row: dict[str, object] = {
            "h": h,
            "model": name,
            "target_date": (anchor + pd.DateOffset(months=h)).date().isoformat(),
            "mean_logret": pred,
            "calibration_n": len(resid),
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


def release_day_reaction(
    vintages: pd.DataFrame, prices: pd.Series, p_now_c_bu: float
) -> dict[str, object]:
    """Event study: CBOT move from the close before the report to the release-day close.

    Regressed on the revisions in that report (OLS, White errors; one row per report). This is
    what the market pays for a WASDE revision on the day, which is when it is priced in.
    """
    prices = prices.sort_index()
    rows = []
    prev_release: pd.Timestamp | None = None
    for _, v in vintages.iterrows():
        d = pd.Timestamp(v["release_date"])
        gap = None if prev_release is None else (d - prev_release).days
        prev_release = d
        if gap is None or gap > 45:
            continue  # first report, or a two-month revision after a shutdown
        d = pd.Timestamp(v["release_date"])
        i = prices.index.searchsorted(d, side="right") - 1
        if i < 1 or prices.index[i] != d:
            continue  # no session on the release day
        rows.append(
            {
                **{f: v[f] for f in REACTION_FEATURES},
                "may": v["may_rollover"],
                "r": float(np.log(prices.iloc[i] / prices.iloc[i - 1])),
            }
        )
    data = pd.DataFrame(rows)
    data = data[data["may"] == 0]  # revisions are undefined in May reports
    X = sm.add_constant(data[list(REACTION_FEATURES)].astype(float))
    res = sm.OLS(data["r"], X).fit(cov_type="HC1")
    usd_t_now = c_bu_to_usd_t(p_now_c_bu)
    items = []
    for f in REACTION_FEATURES:
        label, unit = FEATURE_META[f]
        items.append(
            {
                "feature": f,
                "label": label.replace("Revision: ", ""),
                "unit": unit,
                "usd_t_per_unit": round(float(res.params[f]) * usd_t_now, 2),
                "se_usd_t": round(float(res.bse[f]) * usd_t_now, 2),
                "p_value": round(float(res.pvalues[f]), 3),
            }
        )
    return {
        "n_reports": int(res.nobs),
        "r2": round(float(res.rsquared), 3),
        "abs_move_usd_t_median": round(float(np.median(np.abs(data["r"])) * usd_t_now), 2),
        "items": items,
    }


def evidence(df: pd.DataFrame, p_now_c_bu: float) -> list[dict[str, object]]:
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
