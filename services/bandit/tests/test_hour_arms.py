"""Hour arms (L24N) in production, checked against the eval reference ``evalx.hourly``.

The reference implements the same arm (``L-hourly-K+N``) for the offline study. These
tests pin the production code to it: the prior, the kernel update and the slot choice.
"""

from collections.abc import Mapping

import numpy as np
import pytest

from evalx.hourly import HourlyArms
from src.core import matrix_prior as prior_module
from src.core.constants import MS_PER_MINUTE
from src.core.hour_arms import KERNEL_SD, hour_arm, kernel_update, unit_length
from src.core.linucb_best_slot import LinucbCandidateDay, best_linucb_slot
from src.core.matrix_prior import matrix_prior
from src.core.preference import default_preference_matrix
from src.models.schemas import ArmParams
from src.schemas import HOUR_ARM_IDS, ArmId

D = 7
RIDGE = 1.0
ALPHA = 0.15
DAY = 24 * 60 * MS_PER_MINUTE
MIDNIGHT = 1_789_948_800_000  # 2026-09-21 00:00 UTC


def _stack(arms: Mapping[ArmId, ArmParams]) -> tuple[np.ndarray, np.ndarray]:
    a = np.stack([arms[arm].A for arm in HOUR_ARM_IDS])
    b = np.stack([arms[arm].b for arm in HOUR_ARM_IDS])
    return a, b


def test_hour_arm_maps_local_minutes_to_their_hour() -> None:
    assert hour_arm(0) == "HOUR_00"
    assert hour_arm(59.9) == "HOUR_00"
    assert hour_arm(9 * 60 + 30) == "HOUR_09"
    assert hour_arm(1439) == "HOUR_23"


def test_unit_length_scales_to_norm_one_and_keeps_zero() -> None:
    x = unit_length([3.0, 4.0])
    assert np.linalg.norm(x) == pytest.approx(1.0)
    assert x.tolist() == pytest.approx([0.6, 0.8])
    assert unit_length([0.0, 0.0]).tolist() == [0.0, 0.0]


def test_prior_matches_the_reference_on_every_hour() -> None:
    matrix = default_preference_matrix()
    ours = matrix_prior(matrix, D, RIDGE)
    ref = HourlyArms(matrix, ALPHA, RIDGE, norm=True)
    a_ours, b_ours = _stack(ours)
    np.testing.assert_allclose(a_ours, ref.a, rtol=1e-12, atol=1e-12)
    np.testing.assert_allclose(b_ours, ref.b, rtol=1e-12, atol=1e-12)


def test_kernel_update_matches_the_reference_at_every_hour() -> None:
    matrix = default_preference_matrix()
    ours = matrix_prior(matrix, D, RIDGE)
    ref = HourlyArms(matrix, ALPHA, RIDGE, norm=True)
    x = unit_length(np.array([0.2, 0.5, -0.1, 0.4, 0.3, 0.9, 0.0]))
    reward, hour = -0.2, 17

    updated = kernel_update(ours, hour, x, reward, sd=KERNEL_SD)
    ref.update(hour, x, reward, KERNEL_SD)

    a_ours, b_ours = _stack(updated)
    np.testing.assert_allclose(a_ours, ref.a, rtol=1e-12, atol=1e-12)
    np.testing.assert_allclose(b_ours, ref.b, rtol=1e-12, atol=1e-12)


def test_kernel_update_centre_gets_weight_one_and_far_hours_almost_none() -> None:
    cold = {arm: ArmParams.cold(D, RIDGE) for arm in HOUR_ARM_IDS}
    x = np.array([1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0])
    out = kernel_update(cold, 9, x, 1.0, sd=KERNEL_SD)
    centre = out["HOUR_09"].A - RIDGE * np.eye(D)
    far = out["HOUR_21"].A - RIDGE * np.eye(D)
    assert centre[0, 0] == pytest.approx(1.0)
    assert abs(far[0, 0]) < 1e-6


def test_slot_is_scored_by_its_own_start_hour() -> None:
    """Only HOUR_10 has a score; the chosen slot must start in that hour."""
    scores = [0.0] * 24
    scores[10] = 1.0
    day = LinucbCandidateDay("d", MIDNIGHT, MIDNIGHT + DAY, [], [0.0] * D, scores)
    best = best_linucb_slot([day], 60, "UTC", MIDNIGHT, MIDNIGHT + DAY)
    assert best is not None
    assert best.hour == 10
    assert best.start_ms // (60 * MS_PER_MINUTE) % 24 == 10


def test_the_matrix_prior_is_the_default_when_the_prior_is_on() -> None:
    """With PRIOR_MATRIX set, a cold hour arm is its prior, not the bare ridge."""
    assert prior_module.PRIOR_MATRIX is not None
    from src.serialization import hydrate_arms

    cold = {arm: ArmParams.cold(D, RIDGE) for arm in HOUR_ARM_IDS}
    primed = hydrate_arms({}, D, RIDGE)
    assert not np.allclose(primed["HOUR_10"].b, cold["HOUR_10"].b)
