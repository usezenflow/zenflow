"""Stated-focus-band seeds for the simulator: band mapping, heuristic and prior."""

from __future__ import annotations

import numpy as np
import pytest

from src.core.band_prior import BAND_MINUTES, band_for_hour, band_prior
from src.core.constants import FEATURE_DIM
from src.core.preference import matrix_index
from src.simulation.learner import (
    LinUCBState,
    PreferenceMatrix,
    focus_preference_matrix,
)
from src.simulation.run import variant_kwargs


@pytest.mark.parametrize(
    ("hour", "band"),
    [
        (7.0, "MORNING"),
        (10.0, "MORNING"),
        (13.0, "AFTERNOON"),
        (18.5, "EVENING"),
        (22.0, "LATE_NIGHT"),
        (1.0, "LATE_NIGHT"),
        (23.9, "LATE_NIGHT"),
    ],
)
def test_band_for_hour_picks_the_nearest_band(hour: float, band: str) -> None:
    assert band_for_hour(hour) == band


def test_focus_matrix_is_one_on_band_hours_and_zero_elsewhere() -> None:
    m = focus_preference_matrix("EVENING")
    for wd in range(1, 8):
        for hour in range(24):
            in_band = 17 <= hour < 21
            assert m[matrix_index(wd, hour)] == (1.0 if in_band else 0.0)


def test_late_night_matrix_wraps_past_midnight() -> None:
    assert BAND_MINUTES["LATE_NIGHT"] == ((21 * 60, 24 * 60), (0, 2 * 60))
    m = focus_preference_matrix("LATE_NIGHT")
    assert m[matrix_index(3, 0)] == 1.0
    assert m[matrix_index(3, 1)] == 1.0
    assert m[matrix_index(3, 2)] == 0.0


def test_heuristic_matrix_only_seeded_when_a_band_is_given() -> None:
    default = PreferenceMatrix("UTC").matrix
    seeded = PreferenceMatrix("UTC", "MORNING").matrix
    assert default[matrix_index(1, 10)] == 1.0
    assert default[matrix_index(1, 15)] == 0.5
    assert seeded[matrix_index(1, 15)] == 0.0
    assert seeded[matrix_index(1, 10)] == 1.0


def test_linucb_arm_prior_replaces_the_ridge_start() -> None:
    prior = band_prior("AFTERNOON", FEATURE_DIM, ridge=1.0)
    state = LinUCBState(0.15, 1.0, arm_prior=prior)
    arm = next(iter(prior))
    np.testing.assert_allclose(state.a[arm], prior[arm].A)
    np.testing.assert_allclose(state.b[arm], prior[arm].b)
    assert not np.allclose(state.b[arm], 0.0)


def test_linucb_without_prior_starts_at_ridge() -> None:
    state = LinUCBState(0.15, 1.0)
    for arm in state.a:
        np.testing.assert_allclose(state.a[arm], np.identity(FEATURE_DIM))
        np.testing.assert_allclose(state.b[arm], np.zeros(FEATURE_DIM))


def test_prior_knobs_reach_the_band_prior() -> None:
    weak = band_prior("MORNING", FEATURE_DIM, ridge=1.0, n0=1.0, slope=0.35)
    strong = band_prior("MORNING", FEATURE_DIM, ridge=1.0, n0=6.0, slope=1.0)
    arm = next(iter(weak))
    assert np.linalg.norm(strong[arm].A) > np.linalg.norm(weak[arm].A)
    assert not np.allclose(strong[arm].b, weak[arm].b)


def test_variant_kwargs_maps_the_ablation_flags() -> None:
    import argparse

    ns = argparse.Namespace(
        focus_prior=True,
        focus_heuristic=True,
        prior_n0=None,
        prior_slope=None,
        no_gap_quality=True,
        no_hybrid=False,
        no_deadline_penalty=True,
    )
    assert variant_kwargs(ns) == {
        "focus_prior": True,
        "focus_heuristic": True,
        "gap_weight": 0.0,
        "deadline_weight": 0.0,
    }
