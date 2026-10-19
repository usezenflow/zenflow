"""Gap quality: how much breathing room a slot has inside its day.

Fixed formula, not learned, so the score can be explained and tuned in the
simulator. Used to choose the exact start inside a learned time band.
"""

from __future__ import annotations

from collections.abc import Sequence

import numpy as np
from numpy.typing import NDArray

GAP_CAP_MINUTES = 60


def gap_quality(
    slot_start: int,
    slot_end: int,
    busy: Sequence[tuple[int, int]],
    floor: int,
    ceiling: int,
) -> float:
    """0 to 1 for a slot ``[slot_start, slot_end)`` on one minute clock.

    ``busy`` are fixed events (lectures, exams, other plans) and must not overlap
    the slot. ``floor`` and ``ceiling`` are the day's usable edges, the quiet-hours
    boundaries: free time counts up to them. An hour each side scores 1; back to
    back scores 0.
    """
    before_edge = max([floor, *(e for _, e in busy if e <= slot_start)])
    after_edge = min([ceiling, *(s for s, _ in busy if s >= slot_end)])

    before = _capped(slot_start - before_edge)
    after = _capped(after_edge - slot_end)
    return 0.5 * before + 0.5 * after


def _capped(free_minutes: int) -> float:
    return min(max(free_minutes, 0), GAP_CAP_MINUTES) / GAP_CAP_MINUTES


def gap_quality_scores(
    starts: NDArray[np.int64],
    duration: int,
    busy: Sequence[tuple[int, int]],
    floor: int,
    ceiling: int,
) -> NDArray[np.float64]:
    """:func:`gap_quality` for every feasible start in ``starts``, one pass.

    Same clock and units as the scalar form. ``busy`` must not overlap any start
    in ``starts``, so the nearest neighbour on each side is the largest end at or
    before the start and the smallest begin at or after the slot's end.
    """
    if starts.size == 0:
        return np.zeros(0, dtype=np.float64)
    slot_ends = starts + duration
    ends = np.sort(np.array([e for _, e in busy], dtype=np.int64))
    begins = np.sort(np.array([s for s, _ in busy], dtype=np.int64))

    before_edge = np.full(starts.shape, floor, dtype=np.int64)
    if ends.size:
        idx = np.searchsorted(ends, starts, side="right") - 1
        prev = ends[np.clip(idx, 0, None)]
        before_edge = np.where(idx >= 0, np.maximum(prev, floor), floor)

    after_edge = np.full(starts.shape, ceiling, dtype=np.int64)
    if begins.size:
        idx = np.searchsorted(begins, slot_ends, side="left")
        nxt = begins[np.clip(idx, 0, begins.size - 1)]
        after_edge = np.where(idx < begins.size, np.minimum(nxt, ceiling), ceiling)

    before: NDArray[np.float64] = (
        np.clip(starts - before_edge, 0, GAP_CAP_MINUTES) / GAP_CAP_MINUTES
    )
    after: NDArray[np.float64] = (
        np.clip(after_edge - slot_ends, 0, GAP_CAP_MINUTES) / GAP_CAP_MINUTES
    )
    return 0.5 * before + 0.5 * after
