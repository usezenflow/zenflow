"""Stated-focus-band seeds: band shares, the LinUCB prior and where it applies."""

from __future__ import annotations

import numpy as np
import pytest

from src.core.arms import ARM_BANDS
from src.core.band_prior import (
    BAND_MINUTES,
    N0,
    PRIOR_BASE,
    PRIOR_SLOPE,
    band_prior,
    band_share,
    reference_context,
)
from src.core.constants import FEATURE_DIM
from src.core.init_state import init_state
from src.core.quiet_hours import quiet_window
from src.models.schemas import ArmParams
from src.serialization import hydrate_arms

ARM_SPANS = {name: (start, end) for name, start, end in ARM_BANDS}


def _reward(prior: dict[str, ArmParams], arm: str) -> float:
    """The pseudo-reward a prior arm was seeded with, read back from ``b``."""
    x = reference_context()
    return float(prior[arm].b @ x / (N0 * (x @ x)))


@pytest.mark.parametrize(
    ("band", "arm", "share"),
    [
        ("MORNING", "MORNING", 1.0),
        ("MORNING", "MIDDAY", 60 / 180),
        ("AFTERNOON", "MIDDAY", 120 / 180),
        ("EVENING", "NIGHT", 60 / 240),
    ],
)
def test_band_share_is_the_fraction_of_the_arm_inside_the_band(
    band: str, arm: str, share: float
) -> None:
    start, end = ARM_SPANS[arm]
    assert band_share(start, end, band) == pytest.approx(share)  # type: ignore[arg-type]


def test_late_night_share_counts_the_part_after_midnight() -> None:
    # LATE_NIGHT covers 00:00 to 02:00 as well as 21:00 to 24:00.
    start, end = ARM_SPANS["EARLY_MORNING"]
    assert band_share(start, end, "LATE_NIGHT") == pytest.approx(120 / 480)
    assert BAND_MINUTES["LATE_NIGHT"] == ((21 * 60, 24 * 60), (0, 2 * 60))


def test_prior_rewards_follow_the_band_share() -> None:
    prior = band_prior("MORNING", FEATURE_DIM, ridge=1.0)
    assert _reward(prior, "MORNING") == pytest.approx(PRIOR_BASE + PRIOR_SLOPE)
    assert _reward(prior, "NIGHT") == pytest.approx(PRIOR_BASE)


def test_prior_pseudo_observations_weigh_n0() -> None:
    prior = band_prior("AFTERNOON", FEATURE_DIM, ridge=1.0)
    x = reference_context()
    np.testing.assert_allclose(
        prior["MIDDAY"].A, np.identity(FEATURE_DIM) + N0 * np.outer(x, x)
    )


def test_cold_arms_hydrate_from_the_prior_and_warm_arms_keep_state() -> None:
    state: dict = {}
    hydrated = hydrate_arms(state, FEATURE_DIM, 1.0, "EVENING")
    prior = band_prior("EVENING", FEATURE_DIM, 1.0)
    np.testing.assert_allclose(hydrated["EVENING"].b, prior["EVENING"].b)


def test_no_band_means_no_prior() -> None:
    state = init_state(1.0, None, has_marks=False)
    for arm in state.arms.values():
        np.testing.assert_allclose(arm.b, np.zeros(FEATURE_DIM))
        np.testing.assert_allclose(arm.A, np.identity(FEATURE_DIM))


def test_band_drives_the_quiet_window_only_for_late_night() -> None:
    assert quiet_window(None) == (23 * 60, 6 * 60)
    assert quiet_window("MORNING") == (23 * 60, 6 * 60)
    assert quiet_window("LATE_NIGHT") == (2 * 60, 9 * 60)
