"""Graded MOVE reward and answer outcomes: a port of ``reward.ts`` (ADR-0001, ADR-0035)."""

from .constants import DONE_REWARD, DONE_WINDOW_MS, MOVE_REWARD_SCALE_MINUTES, SKIP_REWARD


def drag_distance_reward(
    drag_distance_minutes: float,
    scale_minutes: float = MOVE_REWARD_SCALE_MINUTES,
) -> float:
    if drag_distance_minutes == 0:
        return 0.0
    return -min(1.0, abs(drag_distance_minutes) / scale_minutes)


def answer_outcome(
    start_ms: int,
    end_ms: int,
    done_at_ms: int | None,
    skip_at_ms: int | None,
    now_ms: int,
    window_ms: int = DONE_WINDOW_MS,
) -> str:
    """Classify the student's response to a placed block.

    ``DONE`` when the student completes the block inside the grace window,
    ``SKIP`` when they decline it, ``SILENT`` when they never answer.
    """
    if done_at_ms is not None and start_ms <= done_at_ms <= min(end_ms + window_ms, now_ms):
        return "DONE"
    if skip_at_ms is not None and skip_at_ms <= now_ms:
        return "SKIP"
    return "SILENT"


def answer_reward(outcome: str) -> float | None:
    """The LinUCB reward for an answer: ``1.0`` for DONE, ``-1.0`` for SKIP,
    ``None`` for SILENT (no update, preserving partial-feedback dynamics)."""
    if outcome == "DONE":
        return DONE_REWARD
    if outcome == "SKIP":
        return SKIP_REWARD
    return None
