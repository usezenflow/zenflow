"""Delayed rewards: graded MOVE (port of ``reward.ts``) and completion.

See ADR-0023 and ADR-0025.
"""

from typing import Literal

from .constants import (
    CHECK_OFF_GRACE_MS,
    LAPSED_REWARD,
    MISS_CUTOFF_MS,
    MOVE_REWARD_SCALE_MINUTES,
    STARTED_REWARD,
)

CompletionOutcome = Literal["STARTED", "LAPSED"]

OUTCOME_REWARD: dict[str, float] = {
    "STARTED": STARTED_REWARD,
    "LAPSED": LAPSED_REWARD,
}


def drag_distance_reward(
    drag_distance_minutes: float,
    scale_minutes: float = MOVE_REWARD_SCALE_MINUTES,
) -> float:
    if drag_distance_minutes == 0:
        return 0.0
    return -min(1.0, abs(drag_distance_minutes) / scale_minutes)


def completion_outcome(
    start_ms: int,
    end_ms: int,
    started_at_ms: int | None,
    now_ms: int,
    grace_ms: int = CHECK_OFF_GRACE_MS,
    cutoff_ms: int = MISS_CUTOFF_MS,
) -> CompletionOutcome | None:
    """Outcome of an unmoved placement, or ``None`` while it is not settled.

    A start counts when it falls in ``[start, end)`` and settles at ``end + grace``.
    No start settles as LAPSED at ``end + cutoff``.
    """
    if now_ms < end_ms + grace_ms:
        return None
    if started_at_ms is not None and start_ms <= started_at_ms < end_ms:
        return "STARTED"
    if now_ms < end_ms + cutoff_ms:
        return None
    return "LAPSED"


def completion_reward(
    start_ms: int,
    end_ms: int,
    started_at_ms: int | None,
    now_ms: int,
    grace_ms: int = CHECK_OFF_GRACE_MS,
    cutoff_ms: int = MISS_CUTOFF_MS,
) -> float | None:
    """Reward of the settled outcome from :func:`completion_outcome`."""
    outcome = completion_outcome(
        start_ms, end_ms, started_at_ms, now_ms, grace_ms, cutoff_ms
    )
    return None if outcome is None else OUTCOME_REWARD[outcome]
