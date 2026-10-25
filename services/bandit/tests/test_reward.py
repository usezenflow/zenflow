"""Graded MOVE reward and answer outcomes (ADR-0001, ADR-0035)."""

import pytest

from src.core.reward import answer_outcome, answer_reward, drag_distance_reward


@pytest.mark.parametrize(
    ("drag", "expected"),
    [(0, 0.0), (120, -0.5), (-120, -0.5), (240, -1.0), (960, -1.0)],
)
def test_drag_distance_reward(drag: float, expected: float) -> None:
    assert drag_distance_reward(drag) == pytest.approx(expected)


@pytest.mark.parametrize(
    ("start_ms", "end_ms", "done_at", "skip_at", "now_ms", "expected"),
    [
        # DONE inside the block and within the window.
        (9 * 3_600_000, 10 * 3_600_000, 9 * 3_600_000 + 30 * 60_000, None, 10 * 3_600_000, "DONE"),
        # DONE after the block ends but still inside the grace window.
        (9 * 3_600_000, 10 * 3_600_000, 10 * 3_600_000 + 30 * 60_000, None, 11 * 3_600_000, "DONE"),
        # DONE after the grace window has closed -> silent.
        (9 * 3_600_000, 10 * 3_600_000, 10 * 3_600_000 + 90 * 60_000, None, 11 * 3_600_000, "SILENT"),
        # DONE before the block starts -> silent.
        (9 * 3_600_000, 10 * 3_600_000, 8 * 3_600_000, None, 11 * 3_600_000, "SILENT"),
        # DONE in the future relative to now -> silent.
        (9 * 3_600_000, 10 * 3_600_000, 11 * 3_600_000, None, 10 * 3_600_000, "SILENT"),
        # SKIP is answered regardless of the block's window.
        (9 * 3_600_000, 10 * 3_600_000, None, 9 * 3_600_000 + 30 * 60_000, 11 * 3_600_000, "SKIP"),
        # No answer at all -> silent.
        (9 * 3_600_000, 10 * 3_600_000, None, None, 11 * 3_600_000, "SILENT"),
        # DONE takes precedence over SKIP when both are present.
        (9 * 3_600_000, 10 * 3_600_000, 9 * 3_600_000 + 30 * 60_000, 9 * 3_600_000 + 15 * 60_000, 11 * 3_600_000, "DONE"),
    ],
)
def test_answer_outcome(
    start_ms: int, end_ms: int, done_at: int | None, skip_at: int | None,
    now_ms: int, expected: str,
) -> None:
    assert answer_outcome(start_ms, end_ms, done_at, skip_at, now_ms) == expected


def test_answer_outcome_uses_default_window() -> None:
    start_ms = 9 * 3_600_000
    end_ms = 10 * 3_600_000
    one_hour_later = end_ms + 60 * 60_000
    assert answer_outcome(start_ms, end_ms, one_hour_later, None, one_hour_later) == "DONE"
    one_hour_and_one_minute_later = end_ms + 61 * 60_000
    assert answer_outcome(start_ms, end_ms, one_hour_and_one_minute_later, None, one_hour_and_one_minute_later) == "SILENT"


@pytest.mark.parametrize(
    ("outcome", "expected"),
    [("DONE", 1.0), ("SKIP", -1.0), ("SILENT", None), ("", None)],
)
def test_answer_reward(outcome: str, expected: float | None) -> None:
    assert answer_reward(outcome) == expected
