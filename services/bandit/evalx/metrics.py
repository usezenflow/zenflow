"""Outcome metrics and statistics for the offline eval.

Pure functions over arrays: no I/O, no placer, no simulator state. Every
resampling function takes a seed so a rerun reproduces its intervals.
"""

from __future__ import annotations

import numpy as np

BOOTSTRAP = 2000
HOUR_MS = 3_600_000
DAY_H = 24.0


def done_rate(completed: np.ndarray) -> float:
    """Share of placed blocks the student completed. NaN when nothing was placed."""
    return float(completed.mean()) if len(completed) else float("nan")


def deadline_margin_h(end_ms: np.ndarray, deadline_ms: np.ndarray) -> np.ndarray:
    """Hours from the end of each block to its deadline."""
    margin: np.ndarray = (deadline_ms - end_ms) / HOUR_MS
    return margin


def last_day_share(margin_h: np.ndarray) -> float:
    """Share of blocks that end inside the last 24 hours before the deadline."""
    return float((margin_h < DAY_H).mean()) if len(margin_h) else float("nan")


def conflict_free_rate(
    starts_ms: np.ndarray, ends_ms: np.ndarray, busy: list[tuple[int, int]]
) -> float:
    """Share of blocks that overlap neither a busy interval nor another block."""
    if not len(starts_ms):
        return float("nan")
    clear = 0
    order = np.argsort(starts_ms)
    s, e = starts_ms[order], ends_ms[order]
    for i in range(len(s)):
        hit = any(s[i] < b1 and b0 < e[i] for b0, b1 in busy)
        hit = hit or (i > 0 and s[i] < e[i - 1]) or (i + 1 < len(s) and s[i + 1] < e[i])
        clear += not hit
    return clear / len(s)


def burden(starts: np.ndarray, taps: np.ndarray, moves: np.ndarray) -> float:
    """Interaction events per student: starts, offer taps and drags."""
    return float(starts.sum() + taps.sum() + moves.sum())


def cumulative_regret(oracle: np.ndarray, arm: np.ndarray) -> np.ndarray:
    """Running sum of per-task oracle minus arm outcome, averaged over students.

    Both inputs are (students, tasks), paired by student and task index. The
    result has one value per task index.
    """
    regret: np.ndarray = (oracle - arm).mean(axis=0).cumsum()
    return regret


def learning_curve(started: np.ndarray, window: int = 30) -> np.ndarray:
    """Adherence over the first ``window`` tasks, one value per task index."""
    return started[:, :window].mean(axis=0)


def _resample(n: int, seed: int) -> np.ndarray:
    return np.random.default_rng(seed).integers(0, n, size=(BOOTSTRAP, n))


def bootstrap_ci(
    values: np.ndarray, seed: int = 0, alpha: float = 0.05
) -> tuple[float, float]:
    """Percentile interval of the mean, resampling students."""
    means = values[_resample(len(values), seed)].mean(axis=1)
    return (
        float(np.quantile(means, alpha / 2)),
        float(np.quantile(means, 1 - alpha / 2)),
    )


def cluster_rate(num: np.ndarray, den: np.ndarray, seed: int = 0) -> dict[str, float]:
    """Ratio of sums with a student-cluster bootstrap interval."""
    total = float(den.sum())
    rate = float(num.sum() / total) if total else float("nan")
    idx = _resample(len(num), seed)
    n, d = num[idx].sum(axis=1), den[idx].sum(axis=1)
    ok = d > 0
    if not ok.any():
        return {"rate": rate, "ci_lo": float("nan"), "ci_hi": float("nan"), "n": total}
    r = n[ok] / d[ok]
    return {
        "rate": rate,
        "ci_lo": float(np.quantile(r, 0.025)),
        "ci_hi": float(np.quantile(r, 0.975)),
        "n": total,
    }


def sign_flip_p(diff: np.ndarray, seed: int = 0) -> float:
    """Two-sided paired randomisation p-value for a mean difference of zero.

    Each paired difference keeps its size and takes a random sign. The +1 terms
    keep the estimate away from an impossible p of zero.
    """
    if not len(diff) or not np.any(diff):
        return 1.0
    signs = np.random.default_rng(seed).choice((-1.0, 1.0), size=(BOOTSTRAP, len(diff)))
    null = (signs * diff).mean(axis=1)
    hits = int((np.abs(null) >= abs(diff.mean()) - 1e-12).sum())
    return (hits + 1) / (BOOTSTRAP + 1)


def holm(p_values: list[float]) -> list[float]:
    """Holm step-down adjustment, returned in the input order."""
    m = len(p_values)
    order = sorted(range(m), key=lambda i: p_values[i])
    adjusted = [0.0] * m
    running = 0.0
    for rank, i in enumerate(order):
        running = max(running, min(1.0, (m - rank) * p_values[i]))
        adjusted[i] = running
    return adjusted


def contrast(diff: np.ndarray, seeds: int, seed: int = 0) -> dict[str, float]:
    """Mean of paired differences (seed-major) with intervals and a p-value.

    ``ci`` resamples students; ``seed_ci`` resamples the per-seed means, so it
    covers run-to-run variation in the student draws and in the learners.
    """
    lo, hi = bootstrap_ci(diff, seed)
    per_seed = diff.reshape(seeds, -1).mean(axis=1)
    slo, shi = bootstrap_ci(per_seed, seed + 1) if seeds > 1 else (float("nan"),) * 2
    return {
        "mean": float(diff.mean()),
        "ci_lo": lo,
        "ci_hi": hi,
        "seed_sd": float(per_seed.std(ddof=1)) if seeds > 1 else 0.0,
        "seed_lo": slo,
        "seed_hi": shi,
        "p": sign_flip_p(diff, seed + 2),
        "share_better": float((diff > 0).mean()),
        "share_worse": float((diff < 0).mean()),
    }
