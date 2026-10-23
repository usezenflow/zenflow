"""L-hourly: 24 hour arms with a kernel-weighted update (eval only)."""

from __future__ import annotations

import datetime as dt

import numpy as np
import pytest

from evalx.hourly import HOURS, HourlyArms
from src.core.constants import FEATURE_DIM, HOUR_MS
from src.core.preference import default_preference_matrix

DAY0_MS = int(dt.datetime(2026, 10, 19, tzinfo=dt.UTC).timestamp() * 1000)
X = np.array([0.3, -0.2, 0.1, 1.0, 0.0, 0.0, 1.0])


def _arms(alpha: float = 0.0) -> HourlyArms:
    return HourlyArms(default_preference_matrix(), alpha, 1.0)


def test_no_kernel_updates_only_the_chosen_hour() -> None:
    arms = _arms()
    before_a, before_b = arms.a.copy(), arms.b.copy()
    arms.update(20, X, 1.0, 0.0)
    changed = [h for h in range(HOURS) if not np.allclose(arms.a[h], before_a[h])]
    assert changed == [20]
    assert np.allclose(arms.b[np.arange(HOURS) != 20], before_b[np.arange(HOURS) != 20])


def test_kernel_spreads_the_update_to_neighbouring_hours() -> None:
    arms = _arms()
    before = arms.b.copy()
    arms.update(20, X, 1.0, 1.0)
    gain = arms.b - before
    np.testing.assert_allclose(gain[21], np.exp(-0.5) * gain[20])
    np.testing.assert_allclose(gain[19], np.exp(-0.5) * gain[20])
    assert np.allclose(gain[5], 0.0)


def test_kernel_wraps_past_midnight() -> None:
    arms = _arms()
    before = arms.b.copy()
    arms.update(0, X, 1.0, 1.0)
    gain = arms.b - before
    np.testing.assert_allclose(gain[23], np.exp(-0.5) * gain[0])


def test_prior_follows_the_matrix_peak() -> None:
    arms = _arms()
    theta = np.linalg.solve(arms.a, arms.b[..., None])[..., 0]
    evening = theta @ X
    assert evening[20] > evening[3]  # the matrix rates 20:00 above 03:00


def test_pick_is_a_free_start_inside_the_window() -> None:
    arms = _arms()
    day_start = DAY0_MS
    body = {
        "nowMs": day_start,
        "deadlineMs": day_start + 3 * 24 * HOUR_MS,
        "member": {"durationMinutes": 60},
        "days": [
            {
                "dayStr": "2026-10-19",
                "dayStartMs": day_start,
                "dayEndMs": day_start + 24 * HOUR_MS,
                "occupied": [{"startMs": day_start, "endMs": day_start + 19 * HOUR_MS}],
                "workloadByType": {},
            }
        ],
    }
    pick = arms.pick(body, [], None)
    assert pick is not None
    assert pick.start_ms >= day_start + 19 * HOUR_MS
    assert pick.vector.shape == (FEATURE_DIM,)
    assert pick.hour == (pick.start_ms - day_start) // HOUR_MS


def test_pick_is_none_without_room() -> None:
    body = {
        "nowMs": DAY0_MS,
        "deadlineMs": DAY0_MS + HOUR_MS,
        "member": {"durationMinutes": 120},
        "days": [],
    }
    assert _arms().pick(body, [], None) is None


def test_norm_makes_the_context_unit_length() -> None:
    arms = HourlyArms(default_preference_matrix(), 0.15, 1.0, norm=True)
    x = arms._context(X * 3.0)
    assert np.linalg.norm(x) == pytest.approx(1.0)


def test_membership_is_a_distribution_and_the_dims_match() -> None:
    arms = HourlyArms(
        default_preference_matrix(), 0.15, 1.0, posterior=True, membership="replace"
    )
    arms.observe_open(20)
    assert arms.post.sum() == pytest.approx(1.0)
    assert arms.dim == 6
    assert arms.a.shape == (HOURS, 6, 6)
    assert arms._context(X).shape == (6,)
    append = HourlyArms(
        default_preference_matrix(), 0.15, 1.0, posterior=True, membership="append"
    )
    assert append._context(X).shape == (FEATURE_DIM + 5,)


def test_prior_stays_positive_definite_with_membership() -> None:
    arms = HourlyArms(
        default_preference_matrix(), 0.15, 1.0, posterior=True, membership="append"
    )
    for h in (9, 20, 20):
        arms.observe_start(h)
    assert all(np.linalg.eigvalsh(arms.a[h]).min() > 0 for h in range(HOURS))
