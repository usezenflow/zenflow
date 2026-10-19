"""Delayed rewards: graded MOVE (port of ``reward.ts``) and completion (ADR-0023)."""

from typing import Literal

from .constants import (
    CHECK_OFF_GRACE_MS,
    COMPLETED_REWARD,
    LAPSED_REWARD,
    MISS_CUTOFF_MS,
    MOVE_REWARD_SCALE_MINUTES,
    SKIPPED_REWARD,
    STARTED_REWARD,
    WRONG_TIME_REWARD,
)

CompletionOutcome = Literal["DONE", "STARTED", "SKIPPED", "WRONG_TIME", "LAPSED"]

OUTCOME_REWARD: dict[str, float] = {
    "DONE": COMPLETED_REWARD,
    "STARTED": STARTED_REWARD,
    "SKIPPED": SKIPPED_REWARD,
    "WRONG_TIME": WRONG_TIME_REWARD,
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
    completed_at_ms: int | None,
    skipped: bool,
    now_ms: int,
    started_at_ms: int | None = None,
    grace_ms: int = CHECK_OFF_GRACE_MS,
    cutoff_ms: int = MISS_CUTOFF_MS,
) -> CompletionOutcome | None:
    """Outcome of an unmoved placement, or ``None`` while it is not settled.

    Skip, done, and started settle at ``end + grace``. A start counts when it
    falls in ``[start, end)``; a check-off counts from ``start`` on. A check-off
    before ``start`` is WRONG_TIME, and no start or check-off is LAPSED; both
    settle at ``end + cutoff``.
    """
    if now_ms < end_ms + grace_ms:
        return None
    if skipped:
        return "SKIPPED"
    if completed_at_ms is not None and completed_at_ms >= start_ms:
        return "DONE"
    if started_at_ms is not None and start_ms <= started_at_ms < end_ms:
        return "STARTED"
    if now_ms < end_ms + cutoff_ms:
        return None
    if completed_at_ms is not None:
        return "WRONG_TIME"
    return "LAPSED"


def completion_reward(
    start_ms: int,
    end_ms: int,
    completed_at_ms: int | None,
    skipped: bool,
    now_ms: int,
    grace_ms: int = CHECK_OFF_GRACE_MS,
    cutoff_ms: int = MISS_CUTOFF_MS,
) -> float | None:
    """Reward of the settled outcome from :func:`completion_outcome`."""
    outcome = completion_outcome(
        start_ms, end_ms, completed_at_ms, skipped, now_ms, None, grace_ms, cutoff_ms
    )
    return None if outcome is None else OUTCOME_REWARD[outcome]
