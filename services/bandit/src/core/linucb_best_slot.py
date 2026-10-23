"""Slot-first LinUCB search over 24 start-hour arms.

Every feasible 15-min start on every candidate day is scored

    score = armScore[day][hour(slot)]
          + wG * gap(slot)
          + wD * deadline(slot)
          + wS * stability(prevStart, slot)

where ``armScore[day][h]`` is the UCB of hour arm ``h`` for that day's context
(:mod:`src.core.hour_arms`), ``wG`` and ``wD`` are the gap and deadline weights, and
``wS`` = :func:`~.slot_score.stability_weight` (strong for a task about to start,
fading for distant ones). The best score wins across all days. Exact ties (within
1e-9) go to the earlier start.

Returns the hour, not the arm id: the caller maps it to ``HOUR_ARM_IDS``.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any

import numpy as np
from numpy.typing import NDArray

from .constants import (
    DEADLINE_PENALTY_HORIZON_HOURS,
    MS_PER_MINUTE,
    SLOT_MS,
)
from .gap_quality import gap_quality_scores
from .slot import Intervals, ceil_to_slot, utc_to_minutes
from .slot_score import (
    deadline_penalty_scores,
    free_start_mask,
    proximity_stability_scores,
    stability_weight,
)

_TIE_DECIMALS = 9
HOURS = 24


@dataclass(frozen=True)
class LinucbCandidateDay:
    day_str: str
    day_start_ms: int
    day_end_ms: int
    occupied: Intervals
    vector: list[float]
    #: UCB of each of the 24 hour arms for this day, index = local start hour.
    arm_scores: Sequence[float]


@dataclass(frozen=True)
class BestLinucbSlot:
    start_ms: int
    score: float
    hour: int
    vector: list[float]
    stability_weight: float  # wS actually applied (0 without a prev start)


def best_linucb_slot(
    days: Sequence[LinucbCandidateDay],
    duration_minutes: int,
    timezone: str,
    next_ms: int,
    deadline_ms: int,
    prev_start_ms: int | None = None,
    gap_weight: float = 0.0,
    deadline_weight: float = 0.0,
    deadline_horizon_hours: float = DEADLINE_PENALTY_HORIZON_HOURS,
) -> BestLinucbSlot | None:
    w_s = stability_weight(prev_start_ms, next_ms) if prev_start_ms is not None else 0.0
    duration_ms = duration_minutes * MS_PER_MINUTE
    overhang = duration_ms - SLOT_MS

    scores: list[NDArray[np.float64]] = []
    hours_all: list[NDArray[np.int64]] = []
    starts_all: list[NDArray[np.int64]] = []
    day_idx: list[NDArray[np.int64]] = []

    for di, day in enumerate(days):
        lower = max(ceil_to_slot(day.day_start_ms), next_ms)
        upper = min(day.day_end_ms + overhang, deadline_ms)
        if lower + duration_ms > upper:
            continue
        n = (upper - duration_ms - lower) // SLOT_MS + 1
        mask = free_start_mask(lower, n, duration_ms, day.occupied)
        if not mask.any():
            continue
        starts = lower + np.arange(n, dtype=np.int64)[mask] * SLOT_MS
        arm_vec = np.asarray(day.arm_scores, dtype=np.float64)
        if arm_vec.shape != (HOURS,):
            raise ValueError(f"arm_scores must hold {HOURS} hour arms")

        if day.day_end_ms - day.day_start_ms == 1440 * MS_PER_MINUTE:
            local_min = np.floor((starts - day.day_start_ms) / MS_PER_MINUTE) % 1440
        else:  # DST day: exact timezone-aware path, scalar
            local_min = np.array(
                [utc_to_minutes(int(s), timezone) for s in starts], dtype=np.float64
            )
        hours = (local_min // 60).astype(np.int64)
        total = arm_vec[hours]
        if gap_weight:
            # Quiet hours are already in ``occupied``, so the day edges are the
            # plain day bounds.
            busy = day.occupied
            gaps = gap_quality_scores(
                (starts - day.day_start_ms) // MS_PER_MINUTE,
                duration_minutes,
                [
                    (
                        (s - day.day_start_ms) // MS_PER_MINUTE,
                        (e - day.day_start_ms) // MS_PER_MINUTE,
                    )
                    for s, e in busy
                ],
                0,
                (day.day_end_ms - day.day_start_ms) // MS_PER_MINUTE,
            )
            total = total + gap_weight * gaps
        if deadline_weight:
            total = total + deadline_penalty_scores(
                starts + duration_ms,
                deadline_ms,
                deadline_weight,
                deadline_horizon_hours,
            )
        if prev_start_ms is not None:
            total = total + proximity_stability_scores(prev_start_ms, starts, next_ms)
        scores.append(total)
        hours_all.append(hours)
        starts_all.append(starts)
        day_idx.append(np.full(starts.size, di, dtype=np.int64))

    if not scores:
        return None
    sc = np.concatenate(scores)
    hh = np.concatenate(hours_all)
    st = np.concatenate(starts_all)
    di_all = np.concatenate(day_idx)
    order = np.lexsort((st, -np.round(sc, _TIE_DECIMALS)))
    i = int(order[0])
    return BestLinucbSlot(
        start_ms=int(st[i]),
        score=float(sc[i]),
        hour=int(hh[i]),
        vector=list(days[int(di_all[i])].vector),
        stability_weight=w_s,
    )


def days_from_dicts(raw: Sequence[Mapping[str, Any]]) -> list[LinucbCandidateDay]:
    """Build days from the golden-fixture / TS JSON shape."""
    return [
        LinucbCandidateDay(
            day_str=d["dayStr"],
            day_start_ms=d["dayStartMs"],
            day_end_ms=d["dayEndMs"],
            occupied=[(o["start"], o["end"]) for o in d["occupied"]],
            vector=list(d["vector"]),
            arm_scores=list(d["armScores"]),
        )
        for d in raw
    ]
