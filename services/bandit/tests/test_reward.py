"""Graded MOVE reward (ADR-0001, ADR-0042)."""

import pytest

from src.core.reward import drag_distance_reward


@pytest.mark.parametrize(
    ("drag", "expected"),
    [(0, 0.0), (120, -0.5), (-120, -0.5), (240, -1.0), (960, -1.0)],
)
def test_drag_distance_reward(drag: float, expected: float) -> None:
    assert drag_distance_reward(drag) == pytest.approx(expected)
