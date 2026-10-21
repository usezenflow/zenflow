"""Preference matrix helpers + decay (port of ``preference.ts`` / ``matrix-decay.ts``).

The matrix is a flat 168-float array: 7 ISO weekdays x 24 hour buckets.
"""

from __future__ import annotations

import numpy as np
from numpy.typing import ArrayLike, NDArray

from .constants import (
    MATRIX_HALF_LIFE_DAYS,
    PREFERENCE_LEARNING_RATE,
    PREFERENCE_MATRIX_LENGTH,
    PREFERENCE_SLOTS_PER_DAY,
)
from .reward import drag_distance_reward
from .slot import iso_weekday, local_date_str, utc_to_minutes


def matrix_index(iso_weekday_num: int, hour: int) -> int:
    return (iso_weekday_num - 1) * PREFERENCE_SLOTS_PER_DAY + hour


# Weekday liking by clock hour: a late morning hump, a post-lunch dip, an afternoon
# shoulder and an evening hump. Hours not listed are 0. Assumed, not measured.
# Mirrors ``defaultPreferenceMatrix`` in ``backend/src/scheduler/core/preference.ts``.
_WEEKDAY_HOURLY: dict[int, float] = {
    6: 0.2,
    7: 0.2,
    8: 0.4,
    9: 0.8,
    10: 0.8,
    11: 0.8,
    12: 0.4,
    13: 0.3,
    14: 0.3,
    15: 0.6,
    16: 0.6,
    17: 0.5,
    18: 0.5,
    19: 0.8,
    20: 0.8,
    21: 0.8,
    22: 0.4,
}
# Weekends are lazier and later: the weekday curve scaled and shifted.
WEEKEND_SCALE = 0.7
WEEKEND_SHIFT_HOURS = 1


def default_preference_matrix() -> NDArray[np.float64]:
    """7 x 24 cold-start liking: two humps per weekday, a lazier and later weekend."""
    m = np.zeros(PREFERENCE_MATRIX_LENGTH)
    for wd in range(1, 8):
        for h in range(24):
            if wd <= 5:
                v = _WEEKDAY_HOURLY.get(h, 0.0)
            else:
                v = WEEKEND_SCALE * _WEEKDAY_HOURLY.get(
                    (h - WEEKEND_SHIFT_HOURS) % 24, 0.0
                )
            m[matrix_index(wd, h)] = v
    return m


def effective_preference_matrix(pref: ArrayLike) -> NDArray[np.float64]:
    arr = np.asarray(pref, dtype=np.float64)
    if arr.shape == (PREFERENCE_MATRIX_LENGTH,):
        return arr
    return default_preference_matrix()


def cell_index_at(at_ms: int, timezone: str) -> int:
    return matrix_index(
        iso_weekday(local_date_str(at_ms, timezone)),
        utc_to_minutes(at_ms, timezone) // 60,
    )


def preference_score_at(matrix: ArrayLike, at_ms: int, timezone: str) -> float:
    return float(np.asarray(matrix)[cell_index_at(at_ms, timezone)])


def reinforce_preference_cell(
    matrix: ArrayLike,
    at_ms: int,
    timezone: str,
    delta: float,
    rate: float = PREFERENCE_LEARNING_RATE,
) -> NDArray[np.float64]:
    nxt = effective_preference_matrix(matrix).copy()
    idx = cell_index_at(at_ms, timezone)
    nxt[idx] = min(max(nxt[idx] + rate * delta, -1.0), 1.0)
    return nxt


def reinforce_preference_move(
    matrix: ArrayLike,
    old_start_ms: int,
    new_start_ms: int,
    timezone: str,
    drag_distance_minutes: float,
    rate: float = PREFERENCE_LEARNING_RATE,
) -> NDArray[np.float64]:
    grade = -drag_distance_reward(drag_distance_minutes)
    same = cell_index_at(old_start_ms, timezone) == cell_index_at(
        new_start_ms, timezone
    )
    if grade == 0 or same:
        return effective_preference_matrix(matrix).copy()
    lowered = reinforce_preference_cell(matrix, old_start_ms, timezone, -grade, rate)
    return reinforce_preference_cell(lowered, new_start_ms, timezone, grade, rate)


def decay_matrix(
    matrix: ArrayLike,
    delta_days: float,
    half_life_days: float = MATRIX_HALF_LIFE_DAYS,
) -> NDArray[np.float64]:
    arr = np.asarray(matrix, dtype=np.float64)
    if not delta_days > 0 or not half_life_days > 0:
        return arr.copy()
    return np.asarray(arr * 2.0 ** (-delta_days / half_life_days), dtype=np.float64)
