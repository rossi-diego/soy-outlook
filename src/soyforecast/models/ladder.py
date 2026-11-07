"""The model ladder. Every model predicts the mean h-month log return from one origin.

1. ``rw``     random walk: no change. The benchmark everything must beat.
2. ``drift``  the average h-month return seen so far.
3. ``arima``  ARIMA(0,1,1) on the log price at report dates (statsmodels SARIMAX), h steps.
4. ``ridge``  ridge regression of the h-month return on the pre-registered WASDE features
              and price momentum; standardised in-fold, penalty chosen on a purged inner split.

``train`` always holds only rows whose target was realized on or before the origin; the
backtest enforces that and a test checks it.
"""

from __future__ import annotations

import warnings
from collections.abc import Callable

import numpy as np
import pandas as pd
from sklearn.linear_model import Ridge
from sklearn.preprocessing import StandardScaler
from statsmodels.tsa.statespace.sarimax import SARIMAX

from soyforecast.config import FEATURES

ALPHAS = (0.1, 1.0, 3.0, 10.0, 30.0, 100.0, 300.0)
INNER_VALIDATION = 36

Model = Callable[[pd.DataFrame, pd.DataFrame, pd.Series, int], float]


def rw(train: pd.DataFrame, history: pd.DataFrame, x: pd.Series, h: int) -> float:
    return 0.0


def drift(train: pd.DataFrame, history: pd.DataFrame, x: pd.Series, h: int) -> float:
    y = train[f"y_{h}"].dropna()
    return float(y.mean()) if len(y) else 0.0


def arima(train: pd.DataFrame, history: pd.DataFrame, x: pd.Series, h: int) -> float:
    """``history``: every origin up to and including this one (prices are known)."""
    logp = np.log(history["p0_c_bu"].to_numpy(dtype=float))
    if len(logp) < 24:
        return 0.0
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        try:
            res = SARIMAX(logp, order=(0, 1, 1), trend="n").fit(disp=False)
            fc = res.forecast(steps=h)
        except (np.linalg.LinAlgError, ValueError):
            return 0.0
    return float(fc[-1] - logp[-1])


def _fit_ridge(X: pd.DataFrame, y: pd.Series, alpha: float) -> tuple[StandardScaler, Ridge]:
    scaler = StandardScaler().fit(X)
    model = Ridge(alpha=alpha).fit(scaler.transform(X), y)
    return scaler, model


def choose_alpha(train: pd.DataFrame, h: int) -> float:
    """Purged inner split: validate on the last rows, fit only on rows realized before them."""
    data = train.dropna(subset=[f"y_{h}"])
    if len(data) < INNER_VALIDATION + 36:
        return 10.0
    val = data.iloc[-INNER_VALIDATION:]
    inner = data[data[f"target_date_{h}"] <= val["origin"].iloc[0]]
    best, best_err = 10.0, np.inf
    for a in ALPHAS:
        scaler, m = _fit_ridge(inner[list(FEATURES)], inner[f"y_{h}"], a)
        err = float(
            np.mean(np.abs(m.predict(scaler.transform(val[list(FEATURES)])) - val[f"y_{h}"]))
        )
        if err < best_err:
            best, best_err = a, err
    return best


def ridge(train: pd.DataFrame, history: pd.DataFrame, x: pd.Series, h: int) -> float:
    data = train.dropna(subset=[f"y_{h}"])
    if len(data) < 36:
        return 0.0
    alpha = choose_alpha(data, h)
    scaler, m = _fit_ridge(data[list(FEATURES)], data[f"y_{h}"], alpha)
    row = pd.DataFrame([x[list(FEATURES)].astype(float)])
    return float(m.predict(scaler.transform(row))[0])


MODELS: dict[str, Model] = {"rw": rw, "drift": drift, "arima": arima, "ridge": ridge}

MODEL_LABELS = {
    "rw": "No change (random walk)",
    "drift": "Average past change",
    "arima": "ARIMA(0,1,1) on price",
    "ridge": "WASDE ridge regression",
}
