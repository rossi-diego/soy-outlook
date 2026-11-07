"""Forecast comparison tests for overlapping multi-step forecasts.

* Diebold-Mariano with the Harvey-Leybourne-Newbold small-sample correction, Bartlett
  (Newey-West) long-run variance with lag h-1, Student t with n-1 degrees of freedom.
* Clark-West for a model that nests the random walk (all of ours do): the adjusted
  squared-error differential, one-sided (H1: the model is better).
* Holm step-down adjustment across horizons.
"""

from __future__ import annotations

import numpy as np
from scipy import stats


def long_run_variance(d: np.ndarray, lag: int, kernel: str = "bartlett") -> float:
    """Long-run variance with Bartlett (Newey-West) or uniform (original DM) weights.

    A uniform-kernel estimate can be negative; it then falls back to Bartlett.
    """
    d = d - d.mean()
    n = len(d)
    var = float(d @ d) / n
    for k in range(1, lag + 1):
        w = 1.0 if kernel == "uniform" else 1 - k / (lag + 1)
        var += 2 * w * float(d[k:] @ d[:-k]) / n
    if var <= 0 and kernel == "uniform":
        return long_run_variance(d, lag, "bartlett")
    return max(var, 1e-18)


def dm_test(loss_model: np.ndarray, loss_bench: np.ndarray, h: int) -> tuple[float, float]:
    """Two-sided DM-HLN test on loss differentials. Negative t: the model has lower loss."""
    d = np.asarray(loss_model, float) - np.asarray(loss_bench, float)
    n = len(d)
    if n < 8:
        return float("nan"), float("nan")
    t = d.mean() / np.sqrt(long_run_variance(d, h - 1, "uniform") / n)
    hln = np.sqrt((n + 1 - 2 * h + h * (h - 1) / n) / n)
    t *= hln
    p = 2 * stats.t.sf(abs(t), df=n - 1)
    return float(t), float(p)


def clark_west(
    y: np.ndarray, pred_model: np.ndarray, h: int, pred_bench: np.ndarray | None = None
) -> tuple[float, float]:
    """One-sided Clark-West test of a nesting model against the benchmark (default: zero)."""
    y = np.asarray(y, float)
    f1 = np.zeros_like(y) if pred_bench is None else np.asarray(pred_bench, float)
    f2 = np.asarray(pred_model, float)
    adj = (y - f1) ** 2 - ((y - f2) ** 2 - (f1 - f2) ** 2)
    n = len(adj)
    if n < 8:
        return float("nan"), float("nan")
    t = adj.mean() / np.sqrt(long_run_variance(adj, h - 1) / n)
    return float(t), float(stats.t.sf(t, df=n - 1))


def holm(pvalues: dict[int, float]) -> dict[int, float]:
    """Holm-adjusted p-values (keys are horizons). NaN stays NaN."""
    valid = sorted(((p, k) for k, p in pvalues.items() if np.isfinite(p)))
    m = len(valid)
    out = {k: float("nan") for k in pvalues}
    running = 0.0
    for i, (p, k) in enumerate(valid):
        running = max(running, min(1.0, (m - i) * p))
        out[k] = running
    return out


def binomial_p(successes: int, n: int) -> float:
    """One-sided p-value that the hit rate exceeds one half."""
    if n == 0:
        return float("nan")
    return float(stats.binomtest(successes, n, 0.5, alternative="greater").pvalue)
