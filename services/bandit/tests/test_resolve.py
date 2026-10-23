"""Resolve: flexible sessions that overlap an anchor move; the anchor never does."""

from __future__ import annotations

from collections.abc import Sequence

from src.core.constants import DAY_MS, HOUR_MS, MS_PER_MINUTE
from src.core.displacement import FlexibleTask
from src.resolve import resolve
from src.schemas_place import ResolveRequest
from tests.test_displacement import MIDNIGHT

NOW = MIDNIGHT + 8 * HOUR_MS  # aligned to the 15-minute slot grid
HORIZON_END = NOW + 3 * DAY_MS
UNIFORM = [0.0] * 168


def _request(
    anchor_start: int,
    anchor_minutes: int,
    flexible: list[FlexibleTask],
    fixed: Sequence[tuple[int, int]] = (),
) -> ResolveRequest:
    anchor_end = anchor_start + anchor_minutes * MS_PER_MINUTE
    return ResolveRequest.model_validate(
        {
            "contractVersion": 4,
            "requestId": "r1",
            "nowMs": NOW,
            "timezone": "UTC",
            "horizonEndMs": HORIZON_END,
            "anchor": {"startMs": anchor_start, "endMs": anchor_end},
            "flexible": [
                {
                    "id": f.id,
                    "durationMinutes": f.duration_minutes,
                    "deadlineMs": f.deadline_ms,
                    "startMs": f.start_ms,
                }
                for f in flexible
            ],
            "fixed": [{"startMs": s, "endMs": e} for s, e in fixed],
            "horizonOccupied": [],
            "preferenceMatrix": UNIFORM,
        }
    )


def test_overlapping_flexible_task_moves_off_the_anchor() -> None:
    anchor = NOW + 2 * HOUR_MS
    blocker = FlexibleTask("b", 60, HORIZON_END, anchor + 30 * MS_PER_MINUTE)
    res = resolve(_request(anchor, 60, [blocker]))

    assert res.outcome == "RESOLVED"
    assert res.late_ids == []
    assert len(res.moves) == 1
    move = res.moves[0]
    assert move.id == "b"
    assert (
        move.to_ms >= anchor + 60 * MS_PER_MINUTE
        or move.to_ms + 60 * MS_PER_MINUTE <= anchor
    )


def test_fixed_obstacle_is_not_moved() -> None:
    anchor = NOW + 2 * HOUR_MS
    blocker = FlexibleTask("b", 60, HORIZON_END, anchor)
    fixed = [(NOW + 3 * HOUR_MS, NOW + 4 * HOUR_MS)]
    res = resolve(_request(anchor, 60, [blocker], fixed))

    assert res.outcome == "RESOLVED"
    for move in res.moves:
        assert not (
            move.to_ms < fixed[0][1] and move.to_ms + 60 * MS_PER_MINUTE > fixed[0][0]
        )


def test_no_layout_is_infeasible() -> None:
    anchor = NOW + 2 * HOUR_MS
    # A 60 minute blocker with a deadline already passed and the whole horizon
    # blocked by fixed time: nothing can host it.
    blocker = FlexibleTask("b", 60, NOW + HOUR_MS, anchor)
    fixed = [(NOW, HORIZON_END)]
    res = resolve(_request(anchor, 60, [blocker], fixed))

    assert res.outcome == "INFEASIBLE"
    assert res.moves == []
