"""Hour kernel and weekday pooling of the preference matrix update."""

from __future__ import annotations

import datetime as dt

import numpy as np
import pytest

from evalx import run as harness
from src.core.preference import (
    default_preference_matrix,
    kernel_hour_weights,
    matrix_index,
    reinforce_preference_cell,
    reinforce_preference_move,
    reinforce_preference_smooth,
)

# Monday 2026-10-19 00:00 UTC; ISO weekday 1.
MONDAY_MS = int(dt.datetime(2026, 10, 19, tzinfo=dt.UTC).timestamp() * 1000)
HOUR_MS = 3_600_000
DELTA = 0.1
RATE = 0.2


def _at(weekday: int, hour: int) -> int:
    """UTC ms for ``hour`` on ISO ``weekday`` (1 = Monday) of the reference week."""
    return MONDAY_MS + (weekday - 1) * 24 * HOUR_MS + hour * HOUR_MS


def test_kernel_is_one_hot_at_zero_width() -> None:
    w = kernel_hour_weights(0.0, 20)
    assert w[20] == 1.0
    assert w.sum() == 1.0


def test_kernel_is_gaussian_and_wraps_around_midnight() -> None:
    w = kernel_hour_weights(1.0, 0)
    assert w[0] == pytest.approx(1.0)
    assert w[1] == pytest.approx(np.exp(-0.5))
    assert w[23] == pytest.approx(np.exp(-0.5))
    assert w[12] == pytest.approx(np.exp(-72.0), rel=1e-6)


def test_zero_kernel_and_pool_is_the_cell_update() -> None:
    m = default_preference_matrix()
    at = _at(2, 20)
    np.testing.assert_array_equal(
        reinforce_preference_smooth(m, at, "UTC", 0.5, RATE, 0.0, 0.0),
        reinforce_preference_cell(m, at, "UTC", 0.5, RATE),
    )


def test_centre_cell_moves_as_before() -> None:
    m = default_preference_matrix()
    at = _at(2, 20)
    smooth = reinforce_preference_smooth(m, at, "UTC", DELTA, RATE, 1.0, 0.5)
    cell = reinforce_preference_cell(m, at, "UTC", DELTA, RATE)
    assert smooth[matrix_index(2, 20)] == pytest.approx(cell[matrix_index(2, 20)])


def test_neighbouring_hours_move_by_the_kernel_weight() -> None:
    m = default_preference_matrix()
    at = _at(2, 20)
    out = reinforce_preference_smooth(m, at, "UTC", DELTA, RATE, 1.0, 0.0)
    step = RATE * DELTA * np.exp(-0.5)
    assert out[matrix_index(2, 21)] - m[matrix_index(2, 21)] == pytest.approx(step)
    assert out[matrix_index(2, 19)] - m[matrix_index(2, 19)] == pytest.approx(step)
    assert out[matrix_index(2, 15)] == pytest.approx(m[matrix_index(2, 15)])


def test_no_pooling_leaves_other_weekdays_alone() -> None:
    m = default_preference_matrix()
    out = reinforce_preference_smooth(m, _at(2, 20), "UTC", DELTA, RATE, 1.0, 0.0)
    other = [matrix_index(d, 20) for d in (1, 3, 4, 5, 6, 7)]
    np.testing.assert_array_equal(out[other], m[other])


def test_pooling_moves_the_same_group_at_the_pool_weight() -> None:
    m = default_preference_matrix()
    out = reinforce_preference_smooth(m, _at(2, 20), "UTC", DELTA, RATE, 0.0, 0.5)
    step = 0.5 * RATE * DELTA
    for wd in (1, 3, 4, 5):
        cell = matrix_index(wd, 20)
        assert out[cell] - m[cell] == pytest.approx(step)
    for wd in (6, 7):
        cell = matrix_index(wd, 20)
        assert out[cell] == pytest.approx(m[cell])


def test_weekend_days_pool_together() -> None:
    m = default_preference_matrix()
    out = reinforce_preference_smooth(m, _at(6, 10), "UTC", DELTA, RATE, 0.0, 1.0)
    assert out[matrix_index(7, 10)] - m[matrix_index(7, 10)] == pytest.approx(
        RATE * DELTA
    )
    assert out[matrix_index(1, 10)] == pytest.approx(m[matrix_index(1, 10)])


def test_cells_stay_in_the_unit_interval() -> None:
    m = np.ones_like(default_preference_matrix())
    out = reinforce_preference_smooth(m, _at(2, 20), "UTC", 5.0, 1.0, 1.0, 1.0)
    assert out.max() <= 1.0


def test_move_with_kernel_takes_weight_off_the_old_hour() -> None:
    m = default_preference_matrix()
    old, new = _at(3, 10), _at(3, 15)
    out = reinforce_preference_move(m, old, new, "UTC", 300, RATE, 1.0, 0.5)
    assert out[matrix_index(3, 10)] < m[matrix_index(3, 10)]
    assert out[matrix_index(3, 15)] > m[matrix_index(3, 15)]


def test_move_without_kernel_is_the_plain_move() -> None:
    m = default_preference_matrix()
    old, new = _at(3, 10), _at(3, 15)
    np.testing.assert_array_equal(
        reinforce_preference_move(m, old, new, "UTC", 300, RATE, 0.0, 0.0),
        reinforce_preference_move(m, old, new, "UTC", 300, RATE),
    )


def test_harness_kernel_is_off_unless_the_arm_asks() -> None:
    assert harness.kernel_of({"policy": "LINUCB"}) == harness.NO_KERNEL
    assert harness.kernel_of({"policy": "LINUCB", "kernel": True}) == (
        harness.CFG["kernel_sd"],
        harness.CFG["kernel_pool"],
    )
