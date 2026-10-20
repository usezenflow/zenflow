"""Completion outcome and reward (ADR-0023, ADR-0025) and the graded MOVE reward."""

import pytest

from src.core.constants import CHECK_OFF_GRACE_MS, MISS_CUTOFF_MS
from src.core.reward import completion_outcome, completion_reward, drag_distance_reward

MIN = 60_000
START = 10_000 * MIN
END = START + 60 * MIN
SETTLE = END + CHECK_OFF_GRACE_MS
CUTOFF = END + MISS_CUTOFF_MS


@pytest.mark.parametrize(
    ("drag", "expected"),
    [(0, 0.0), (120, -0.5), (-120, -0.5), (240, -1.0), (960, -1.0)],
)
def test_drag_distance_reward(drag: float, expected: float) -> None:
    assert drag_distance_reward(drag) == pytest.approx(expected)


def test_start_in_slot_is_positive_at_settle() -> None:
    assert completion_reward(START, END, START + 5 * MIN, SETTLE) == 1.0


def test_start_in_slot_is_unsettled_before_grace() -> None:
    assert completion_reward(START, END, START + 5 * MIN, SETTLE - 1) is None


def test_start_at_the_exact_start_counts() -> None:
    assert completion_outcome(START, END, START, SETTLE) == "STARTED"


def test_start_at_the_end_does_not_count() -> None:
    assert completion_outcome(START, END, END, CUTOFF) == "LAPSED"


def test_start_before_the_slot_does_not_count() -> None:
    early = START - 5 * MIN
    assert completion_reward(START, END, early, SETTLE) is None
    assert completion_reward(START, END, early, CUTOFF) == -0.25


def test_no_start_is_unsettled_until_the_cutoff() -> None:
    assert completion_reward(START, END, None, SETTLE) is None
    assert completion_reward(START, END, None, CUTOFF - 1) is None


def test_no_start_lapses_at_the_cutoff() -> None:
    assert completion_outcome(START, END, None, CUTOFF) == "LAPSED"
    assert completion_reward(START, END, None, CUTOFF) == -0.25
