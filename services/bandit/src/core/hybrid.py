"""Hybrid LinUCB shared features (level-up plan, LinUCB v2).

The score of arm ``a`` on day ``d`` is

    score = z[a, d]^T beta + x[d]^T theta_a + alpha * width_a(x[d])

``x`` is the disjoint 7-feature day context (:mod:`src.core.context_vector`),
``theta_a`` is that arm's own model, and ``beta`` is one model shared by every
arm. ``z`` holds cross features that must generalise across arms, so they live
in ``beta``: a student's weakness times the days left, the same for the early
arms, the plan kind times the days left, and the campus load of the day.

``beta`` is learned as a ridge regression on the residual of the arm model, and
each arm's ``theta_a`` on the residual of ``beta``. The two are updated together
(:func:`hybrid_update`), so a shared pattern is not learned twice.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Literal

import numpy as np
from numpy.typing import NDArray

from src.core.constants import DAY_MS, MAX_SCAN_DAYS
from src.core.marks import COHORT_WEAK_DEFAULT
from src.schemas import ARM_IDS, ArmId

PlanKind = Literal["EXAM", "ASSIGNMENT", "TASK"]

Z_DIM = 4
Z_LABELS = (
    "weak x days_left",
    "weak x is_early_arm",
    "plan_kind x days_left",
    "campus_day",
)

# A student with no marks yet gets the cohort mean (``marks.weak_score``).
DEFAULT_WEAK = COHORT_WEAK_DEFAULT
KIND_WEIGHT: dict[str, float] = {"EXAM": 1.0, "ASSIGNMENT": 0.5, "TASK": 0.0}
EARLY_ARMS = frozenset({"EARLY_MORNING", "MORNING"})
CAMPUS_HOURS_CAP = 12.0

# Marks prior on beta only: a small negative reward on weak x days_left, worth
# two pseudo-observations. An assumption, checked against live data.
MARKS_PRIOR_STRENGTH = 2.0
# Cohort warm start: the cohort's per-observation mean, worth this many
# observations of an average student (plan step 5, n_cohort = 5).
COHORT_WEIGHT = 5.0
MARKS_PRIOR_REWARD = -0.1


def days_left_norm(days_left: NDArray[np.float64]) -> NDArray[np.float64]:
    """Days to the deadline scaled to 0..1 over the scan horizon."""
    return np.clip(days_left / MAX_SCAN_DAYS, 0.0, 1.0)


def campus_norm(lecture_hours: NDArray[np.float64]) -> NDArray[np.float64]:
    return np.clip(lecture_hours / CAMPUS_HOURS_CAP, 0.0, 1.0)


def shared_tensor(
    weak: float,
    kinds: Sequence[str],
    days_left: NDArray[np.float64],
    lecture_hours: NDArray[np.float64],
) -> NDArray[np.float64]:
    """``z`` for every (member, day, arm): shape ``(M, N, len(ARM_IDS), Z_DIM)``.

    ``days_left`` and ``lecture_hours`` are ``(M, N)``; ``kinds`` has one plan
    kind per member. Padded day columns get finite values and are masked later.
    """
    m, n = days_left.shape
    dl = days_left_norm(days_left)
    kind = np.array([KIND_WEIGHT[k] for k in kinds], dtype=np.float64)
    early = np.array([1.0 if a in EARLY_ARMS else 0.0 for a in ARM_IDS])
    z = np.zeros((m, n, len(ARM_IDS), Z_DIM), dtype=np.float64)
    z[..., 0] = weak * dl[:, :, None]
    z[..., 1] = weak * early[None, None, :]
    z[..., 2] = kind[:, None, None] * dl[:, :, None]
    z[..., 3] = campus_norm(lecture_hours)[:, :, None]
    return z


def shared_features(
    weak: float, kind: PlanKind, days_left: float, arm: ArmId, lecture_hours: float
) -> NDArray[np.float64]:
    """``z`` for one (arm, day). The batch form is :func:`shared_tensor`."""
    dl = min(max(days_left / MAX_SCAN_DAYS, 0.0), 1.0)
    early = 1.0 if arm in EARLY_ARMS else 0.0
    return np.array(
        [
            weak * dl,
            weak * early,
            KIND_WEIGHT[kind] * dl,
            min(max(lecture_hours / CAMPUS_HOURS_CAP, 0.0), 1.0),
        ],
        dtype=np.float64,
    )


def days_left_on(deadline_ms: int, day_start_ms: int) -> float:
    """Whole days from a day's start to the deadline, never negative."""
    return float(max(0, (deadline_ms - day_start_ms) // DAY_MS))


def shared_prior(ridge: float) -> tuple[NDArray[np.float64], NDArray[np.float64]]:
    """``(A, b)`` of beta at the marks prior: a negative pull on weak x days left."""
    a = ridge * np.identity(Z_DIM)
    b = np.zeros(Z_DIM)
    ref = np.zeros(Z_DIM)
    ref[0] = 1.0
    a = a + MARKS_PRIOR_STRENGTH * np.outer(ref, ref)
    b = b + MARKS_PRIOR_STRENGTH * MARKS_PRIOR_REWARD * ref
    return a, b


def cohort_shared_prior(
    a_sum: NDArray[np.float64],
    b_sum: NDArray[np.float64],
    n_obs: int,
    ridge: float,
    n_cohort: float = COHORT_WEIGHT,
) -> tuple[NDArray[np.float64], NDArray[np.float64]]:
    """``(A, b)`` of beta seeded from the cohort's per-observation means.

    ``a_sum`` is the cohort's sum of ``z z^T`` and ``b_sum`` its sum of the
    residual-weighted ``z`` over ``n_obs`` observations. The prior is worth
    ``n_cohort`` observations of the average student, so it fades as the
    student's own data grows. No cohort data gives the ridge prior.
    """
    if n_obs <= 0:
        return ridge * np.identity(Z_DIM), np.zeros(Z_DIM)
    a = ridge * np.identity(Z_DIM) + n_cohort * (a_sum / n_obs)
    b = n_cohort * (b_sum / n_obs)
    return a, b


def hybrid_update(
    shared_a: NDArray[np.float64],
    shared_b: NDArray[np.float64],
    arm_a: NDArray[np.float64],
    arm_b: NDArray[np.float64],
    x: NDArray[np.float64],
    z: NDArray[np.float64],
    reward: float,
) -> tuple[
    tuple[NDArray[np.float64], NDArray[np.float64]],
    tuple[NDArray[np.float64], NDArray[np.float64]],
]:
    """Fold one observation into ``beta`` and the played arm's ``theta``.

    Both residuals use the state before this observation: ``beta`` learns
    ``reward - x^T theta_a`` and ``theta_a`` learns ``reward - z^T beta``.
    Returns ``((shared_a, shared_b), (arm_a, arm_b))`` as new arrays.
    """
    beta = np.linalg.solve(shared_a, shared_b)
    theta = np.linalg.solve(arm_a, arm_b)
    new_shared = (
        shared_a + np.outer(z, z),
        shared_b + (reward - float(x @ theta)) * z,
    )
    new_arm = (
        arm_a + np.outer(x, x),
        arm_b + (reward - float(z @ beta)) * x,
    )
    return new_shared, new_arm
