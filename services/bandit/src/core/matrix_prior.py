"""Matrix prior for cold LinUCB arms.

A preference matrix seeds each arm with pseudo-observations at two reference
contexts, a weekday and a weekend, so a new student starts from typical study
hours instead of a flat model. Each real reward adds ``x x^T`` against
``N0_WEEKDAY + N0_WEEKEND`` pseudo-observations, so real data dominates after
roughly ten starts.

The prior needs no onboarding answer. It is the same for every student until a
cohort prior replaces it.
"""

from __future__ import annotations

import numpy as np
from numpy.typing import NDArray

from src.core.constants import FEATURE_DIM, MAX_SCAN_DAYS
from src.core.context_vector import build_context_vector
from src.core.preference import default_preference_matrix, matrix_index
from src.models.schemas import ArmParams
from src.schemas import HOUR_ARM_IDS, ArmId

N0_WEEKDAY = 0.5
N0_WEEKEND = 0.5
# Pseudo-reward ``BASE + SLOPE * share``: +0.5 for an arm at the matrix peak,
# -0.2 for an arm the matrix never rates.
PRIOR_BASE = -0.2
PRIOR_SLOPE = 0.7

# Mid-horizon day in the middle of the scan, 60 minute session, average loads.
REFERENCE_DURATION_MINUTES = 60
REFERENCE_ISO_WEEKDAY = 3
REFERENCE_ISO_WEEKEND = 6

# The matrix the shipped prior reads. ``None`` means no prior (cold arms). The
# eval harness swaps it to compare priors.
PRIOR_MATRIX: NDArray[np.float64] | None = default_preference_matrix()


def arm_share(
    matrix: NDArray[np.float64], weekend: bool, arm_start: int, arm_end: int
) -> float:
    """Mean liking over the arm's hours on weekdays or weekends, over the peak."""
    peak = float(matrix.max())
    if peak <= 0:
        return 0.0
    rows = (6, 7) if weekend else (1, 2, 3, 4, 5)
    hours = range(arm_start // 60, arm_end // 60)
    total = sum(matrix[matrix_index(wd, h)] for wd in rows for h in hours)
    return float(total / (len(rows) * len(hours)) / peak)


def reference_context(iso_weekday: int = REFERENCE_ISO_WEEKDAY) -> NDArray[np.float64]:
    """The unit-length ``x`` the pseudo-observations sit at; a mid-horizon day."""
    half = MAX_SCAN_DAYS / 2
    x = build_context_vector(
        remaining_days_until_deadline=half,
        duration_minutes=REFERENCE_DURATION_MINUTES,
        candidate_iso_weekday=iso_weekday,
        candidate_days_from_now=half,
    )
    norm = float(np.linalg.norm(x))
    return x / norm if norm > 0 else x


def matrix_prior(
    matrix: NDArray[np.float64], d: int, ridge: float
) -> dict[ArmId, ArmParams]:
    """``(A, b)`` for every hour arm, seeded from ``matrix``.

    Each arm gets the pseudo-observations of its hour: the share of the matrix over that
    hour, on weekdays for one reference context and on weekends for the other.
    """
    contexts = (
        (False, N0_WEEKDAY, reference_context(REFERENCE_ISO_WEEKDAY)),
        (True, N0_WEEKEND, reference_context(REFERENCE_ISO_WEEKEND)),
    )
    prior: dict[ArmId, ArmParams] = {}
    for hour, arm in enumerate(HOUR_ARM_IDS):
        a = ridge * np.eye(d)
        b = np.zeros(d)
        for weekend, n0, x in contexts:
            if x.shape != (d,):
                raise ValueError(
                    f"reference context has {x.size} features, expected {d}"
                )
            share = arm_share(matrix, weekend, hour * 60, (hour + 1) * 60)
            reward = PRIOR_BASE + PRIOR_SLOPE * share
            a = a + n0 * np.outer(x, x)
            b = b + n0 * reward * x
        prior[arm] = ArmParams(A=a, b=b)
    return prior


def default_prior(d: int, ridge: float) -> dict[ArmId, ArmParams]:
    """The prior a cold student starts from.

    Empty when ``PRIOR_MATRIX`` is ``None`` or ``d`` is not the feature dimension the
    reference contexts are built for.
    """
    if PRIOR_MATRIX is None or d != FEATURE_DIM:
        return {}
    return matrix_prior(PRIOR_MATRIX, d, ridge)
