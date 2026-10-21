"""Matrix prior: arm shares, the LinUCB seed and where it applies."""

from __future__ import annotations

from collections.abc import Mapping

import numpy as np
import pytest

from src.core import matrix_prior as mp
from src.core.arms import ARM_BANDS
from src.core.constants import FEATURE_DIM
from src.core.init_state import init_state
from src.core.matrix_prior import (
    N0_WEEKDAY,
    N0_WEEKEND,
    PRIOR_BASE,
    PRIOR_SLOPE,
    arm_share,
    default_prior,
    matrix_prior,
    reference_context,
)
from src.core.preference import default_preference_matrix, matrix_index
from src.models.schemas import ArmParams
from src.schemas import ArmId
from src.serialization import hydrate_arms

ARM_SPANS = {name: (start, end) for name, start, end in ARM_BANDS}


def _reward(prior: Mapping[ArmId, ArmParams], arm: ArmId, weekend: bool) -> float:
    """The pseudo-reward an arm was seeded with at one reference context.

    ``b`` mixes two contexts, so solve for the pair of rewards from ``b`` and ``A``.
    """
    xw, xe = reference_context(3), reference_context(6)
    basis = np.stack([N0_WEEKDAY * xw, N0_WEEKEND * xe], axis=1)
    coef, *_ = np.linalg.lstsq(basis, prior[arm].b, rcond=None)
    return float(coef[1] if weekend else coef[0])


def test_broad_matrix_has_two_humps_and_no_flat_zero_midday() -> None:
    m = default_preference_matrix()
    wd = lambda h: m[matrix_index(3, h)]  # noqa: E731
    assert wd(10) > wd(13) < wd(20)  # late morning and evening beat the post-lunch dip
    assert wd(12) > 0 and wd(17) > 0  # nothing is excluded between 06:00 and 23:00
    assert wd(3) == 0 and wd(23) == 0  # quiet hours stay unrated


def test_weekends_are_lazier_and_later() -> None:
    m = default_preference_matrix()
    weekday = [m[matrix_index(3, h)] for h in range(24)]
    weekend = [m[matrix_index(6, h)] for h in range(24)]
    assert max(weekend) == pytest.approx(0.7 * max(weekday))
    assert int(np.argmax(weekend)) > int(np.argmax(weekday))


@pytest.mark.parametrize(
    ("arm", "weekend", "share"),
    [
        ("MORNING", False, (0.4 + 0.8 + 0.8) / 3 / 0.8),
        ("EARLY_MORNING", False, (0.2 + 0.2) / 8 / 0.8),
        ("NIGHT", False, (0.8 + 0.8 + 0.4 + 0.0) / 4 / 0.8),
    ],
)
def test_arm_share_is_mean_liking_over_the_matrix_peak(
    arm: str, weekend: bool, share: float
) -> None:
    start, end = ARM_SPANS[arm]
    assert arm_share(default_preference_matrix(), weekend, start, end) == pytest.approx(
        share
    )


def test_a_matrix_of_zeros_gives_the_floor_reward() -> None:
    prior = matrix_prior(np.zeros(168), FEATURE_DIM, 1.0)
    assert _reward(prior, "MORNING", False) == pytest.approx(PRIOR_BASE)


def test_prior_rewards_follow_the_share() -> None:
    m = default_preference_matrix()
    prior = matrix_prior(m, FEATURE_DIM, ridge=1.0)
    for arm, (start, end) in ARM_SPANS.items():
        for weekend in (False, True):
            want = PRIOR_BASE + PRIOR_SLOPE * arm_share(m, weekend, start, end)
            assert _reward(prior, arm, weekend) == pytest.approx(want)  # type: ignore[arg-type]


def test_prior_pseudo_observations_weigh_n0() -> None:
    prior = matrix_prior(default_preference_matrix(), FEATURE_DIM, ridge=1.0)
    xw, xe = reference_context(3), reference_context(6)
    np.testing.assert_allclose(
        prior["MIDDAY"].A,
        np.identity(FEATURE_DIM)
        + N0_WEEKDAY * np.outer(xw, xw)
        + N0_WEEKEND * np.outer(xe, xe),
    )


def test_cold_arms_hydrate_from_the_prior_and_warm_arms_keep_state() -> None:
    hydrated = hydrate_arms({}, FEATURE_DIM, 1.0)
    prior = default_prior(FEATURE_DIM, 1.0)
    np.testing.assert_allclose(hydrated["EVENING"].b, prior["EVENING"].b)


def test_init_state_uses_the_prior() -> None:
    state = init_state(1.0, has_marks=False)
    prior = default_prior(FEATURE_DIM, 1.0)
    for arm, params in state.arms.items():
        np.testing.assert_allclose(params.A, prior[arm].A)


def test_no_prior_matrix_means_cold_arms(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(mp, "PRIOR_MATRIX", None)
    state = init_state(1.0, has_marks=False)
    for arm in state.arms.values():
        np.testing.assert_allclose(arm.b, np.zeros(FEATURE_DIM))
        np.testing.assert_allclose(arm.A, np.identity(FEATURE_DIM))
