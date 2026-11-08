"""Forecast comparison tests for overlapping multi-step forecasts.

* Diebold-Mariano with the Harvey-Leybourne-Newbold small-sample correction, Bartlett
  (Newey-West) long-run variance with lag h-1, Student t with n-1 degrees of freedom.
* Clark-West for a model that nests the random walk (all of ours do): the adjusted
  squared-error differential, one-sided (H1: the model is better).
* Holm step-down adjustment for one family of tests.
* Calibration of overlapping hit series (P4): HAC SE, moving-block bootstrap CI, n_eff,
  Kupiec / Christoffersen on non-overlapping subsamples, minimum detectable effect.
* Direction (P16): Pesaran-Timmermann in regression form with a HAC t statistic.
"""

from __future__ import annotations

from collections.abc import Hashable, Mapping
from typing import TypeVar

import numpy as np
from scipy import stats
from scipy.special import xlog1py, xlogy


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


K = TypeVar("K", bound=Hashable)


def holm(pvalues: Mapping[K, float]) -> dict[K, float]:
    """Holm-adjusted p-values for one family (keys: horizons, features, ...). NaN stays NaN."""
    valid = sorted(((p, k) for k, p in pvalues.items() if np.isfinite(p)), key=lambda t: t[0])
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


# ------------------------------------------------------------------ calibration (P4)


def hac_se_mean(x: np.ndarray, lag: int) -> float:
    """HAC (Bartlett, Newey-West) standard error of the mean of a serially correlated series."""
    x = np.asarray(x, float)
    if len(x) < 2:
        return float("nan")
    return float(np.sqrt(long_run_variance(x, lag) / len(x)))


def n_eff(x: np.ndarray, lag: int) -> float:
    """Effective number of independent observations: n * var / long-run variance, capped at n.

    For a constant series (every outcome inside, or every one outside) the dependence cannot
    be estimated; n / (lag + 1) is returned, one outcome per non-overlapping window.
    """
    x = np.asarray(x, float)
    n = len(x)
    if n == 0:
        return float("nan")
    var = float(np.var(x))
    if var <= 0:
        return n / (lag + 1)
    return float(min(n, n * var / long_run_variance(x, lag)))


def block_bootstrap_ci(
    x: np.ndarray, block: int, draws: int, seed: int, level: float = 0.95
) -> tuple[float, float]:
    """Moving-block bootstrap percentile CI for the mean (block = h keeps the MA(h-1) overlap)."""
    x = np.asarray(x, float)
    n = len(x)
    if n < 2:
        return float("nan"), float("nan")
    block = max(1, min(block, n))
    rng = np.random.default_rng(seed)
    k = -(-n // block)  # blocks per resample
    starts = rng.integers(0, n - block + 1, size=(draws, k))
    idx = (starts[:, :, None] + np.arange(block)[None, None, :]).reshape(draws, -1)[:, :n]
    means = x[idx].mean(axis=1)
    a = (1 - level) / 2
    return float(np.quantile(means, a)), float(np.quantile(means, 1 - a))


def _ll(k: float, n: float, p: float) -> float:
    """Bernoulli log likelihood of k events in n trials at rate p, with 0 log 0 = 0."""
    return float(xlogy(k, p) + xlog1py(n - k, -p))


def kupiec_pof(misses: np.ndarray, rate: float) -> float:
    """Kupiec proportion-of-failures LR test p-value (H0: miss rate equals `rate`)."""
    m = np.asarray(misses, bool)
    n, x = len(m), int(m.sum())
    if n < 2:
        return float("nan")
    lr = -2 * (_ll(x, n, rate) - _ll(x, n, x / n))
    return float(stats.chi2.sf(max(lr, 0.0), 1))


def christoffersen_ind(misses: np.ndarray) -> float:
    """Christoffersen independence LR test p-value (H0: a miss does not predict the next)."""
    m = np.asarray(misses, bool).astype(int)
    if len(m) < 3:
        return float("nan")
    prev, cur = m[:-1], m[1:]
    n01 = int(((prev == 0) & (cur == 1)).sum())
    n00 = int(((prev == 0) & (cur == 0)).sum())
    n11 = int(((prev == 1) & (cur == 1)).sum())
    n10 = int(((prev == 1) & (cur == 0)).sum())
    pi = (n01 + n11) / (n00 + n01 + n10 + n11)
    pi0 = n01 / (n00 + n01) if n00 + n01 else 0.0
    pi1 = n11 / (n10 + n11) if n10 + n11 else 0.0
    l0 = _ll(n01 + n11, n00 + n01 + n10 + n11, pi)
    l1 = _ll(n01, n00 + n01, pi0) + _ll(n11, n10 + n11, pi1)
    return float(stats.chi2.sf(max(-2 * (l0 - l1), 0.0), 1))


def subsample_median_p(misses: np.ndarray, h: int, test: str, rate: float = 0.0) -> float:
    """Median p-value of a VaR backtest over the h non-overlapping subsamples (every h-th row).

    Overlapping h-month windows make consecutive hits dependent by construction; every h-th
    origin gives (approximately) non-overlapping windows on which the iid tests are valid.
    """
    m = np.asarray(misses, bool)
    ps = []
    for k in range(max(h, 1)):
        sub = m[k :: max(h, 1)]
        p = kupiec_pof(sub, rate) if test == "kupiec" else christoffersen_ind(sub)
        if np.isfinite(p):
            ps.append(p)
    return float(np.median(ps)) if ps else float("nan")


def mde(loss_diff: np.ndarray, bench_loss_mean: float, h: int, alpha: float, power: float) -> float:
    """Minimum detectable relative improvement over the benchmark for a one-sided test.

    (z_{1-alpha} + z_{power}) x HAC-SE of the mean loss differential, over the benchmark's mean
    loss: improvements smaller than this would usually go unnoticed.
    """
    d = np.asarray(loss_diff, float)
    if len(d) < 8 or not np.isfinite(bench_loss_mean) or bench_loss_mean <= 0:
        return float("nan")
    z = float(stats.norm.ppf(1 - alpha) + stats.norm.ppf(power))
    return z * hac_se_mean(d, h - 1) / bench_loss_mean


# ------------------------------------------------------------------ direction (P16)


def directional_test(y: np.ndarray, pred: np.ndarray, h: int) -> tuple[float, float]:
    """Pesaran-Timmermann in regression form with a HAC t statistic, one-sided.

    Regress 1[y > 0] on 1[pred > 0]; a positive slope means the forecast sign carries
    information about the outcome sign. Bartlett lag h - 1 handles the overlap that makes the
    iid binomial test invalid for h > 1. Returns (t, p); NaN when either sign never varies
    (a forecast that is always up or always down cannot be tested for direction).
    """
    a = (np.asarray(y, float) > 0).astype(float)
    b = (np.asarray(pred, float) > 0).astype(float)
    n = len(a)
    if n < 8 or np.var(a) == 0 or np.var(b) == 0:
        return float("nan"), float("nan")
    bc = b - b.mean()
    beta = float(bc @ (a - a.mean()) / (bc @ bc))
    u = a - a.mean() - beta * bc
    omega = long_run_variance(bc * u, max(h - 1, 0))
    se = float(np.sqrt(n * omega) / (bc @ bc))
    t = beta / se
    return float(t), float(stats.norm.sf(t))
