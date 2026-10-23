"""Repack: an urgent task re-solves the whole horizon, so slack tasks move to
another day. Frozen tasks never move; the objective is fewest late tasks first."""

from __future__ import annotations

import pytest

import src.core.constants as consts
import src.place as place_mod
from src.core.constants import DAY_MS, HOUR_MS, MS_PER_MINUTE
from src.core.displacement import DisplacementPlan, FlexibleTask, plan_repack
from tests.test_displacement import MIDNIGHT, _body, _chill
from tests.test_place import NOW as PLACE_NOW
from tests.test_place import ok

NOW = 1_789_200_000_000  # aligned to the 15-minute slot grid
FROZEN_ID = "frozen"


def _task(id_: str, start: int, minutes: int, deadline: int) -> FlexibleTask:
    return FlexibleTask(id_, minutes, deadline, start)


def _layout(
    flexible: list[FlexibleTask],
    moves: tuple,
    new_id: str,
    new_start: int | None,
    new_minutes: int,
) -> dict[str, tuple[int, int]]:
    """Final ``id -> (start, end)`` after the moves, for overlap checks."""
    to = {m.id: m.to_ms for m in moves}
    out = {}
    for f in flexible:
        s = to.get(f.id, f.start_ms)
        out[f.id] = (s, s + f.duration_minutes * MS_PER_MINUTE)
    assert new_start is not None
    out[new_id] = (new_start, new_start + new_minutes * MS_PER_MINUTE)
    return out


def _assert_no_overlap(layout: dict[str, tuple[int, int]]) -> None:
    spans = sorted(layout.values())
    for (_, a_end), (b_start, _) in zip(spans, spans[1:], strict=False):
        assert a_end <= b_start


def test_urgent_task_moves_a_slack_task_to_another_day() -> None:
    """Day one is full. The frozen task is untouchable. A 60m task due in 6h
    must go on time: the day shifts a little and one block spills to the free
    day, which is cheaper than moving every block."""
    frozen = _task(FROZEN_ID, NOW, 120, NOW + DAY_MS)
    movable = [
        _task(f"m{i}", NOW + 2 * HOUR_MS + i * 4 * HOUR_MS, 240, NOW + 3 * DAY_MS)
        for i in range(5)
    ]
    flexible = [frozen, *movable]
    new_deadline = NOW + 6 * HOUR_MS

    plan = plan_repack("new", 60, new_deadline, flexible, [], NOW, NOW + 3 * DAY_MS)

    assert plan.kind == "placed"
    assert plan.late == ()
    assert plan.start_ms is not None
    assert plan.start_ms + 60 * MS_PER_MINUTE <= new_deadline
    assert FROZEN_ID not in {m.id for m in plan.moves}
    assert plan.moves
    assert any(m.to_ms >= NOW + DAY_MS for m in plan.moves)
    _assert_no_overlap(_layout(flexible, plan.moves, "new", plan.start_ms, 60))


def test_move_cap_places_late_instead_of_moving() -> None:
    """With no moves allowed the urgent task still gets a slot, past its
    deadline. Lateness is counted; an overlap is never used."""
    frozen = _task(FROZEN_ID, NOW, 120, NOW + DAY_MS)
    movable = [
        _task(f"m{i}", NOW + 2 * HOUR_MS + i * 4 * HOUR_MS, 240, NOW + 3 * DAY_MS)
        for i in range(5)
    ]
    new_deadline = NOW + 6 * HOUR_MS

    plan = plan_repack(
        "new",
        60,
        new_deadline,
        [frozen, *movable],
        [],
        NOW,
        NOW + 3 * DAY_MS,
        max_moves=0,
    )

    assert plan.kind == "placed"
    assert plan.moves == ()
    assert plan.late == ("new",)


def test_capacity_shortfall_leaves_exactly_one_task_late() -> None:
    """Five hours of work in a four-hour horizon. One task has to be late, and
    the placed ones must not overlap."""
    movable = [_task("m", NOW + 2 * HOUR_MS, 120, NOW + 4 * HOUR_MS)]

    plan = plan_repack(
        "new", 180, NOW + 4 * HOUR_MS, movable, [], NOW, NOW + 2 * DAY_MS
    )

    assert plan.kind == "placed"
    assert len(plan.late) == 1
    assert plan.start_ms is not None
    _assert_no_overlap(_layout(movable, plan.moves, "new", plan.start_ms, 180))


def test_fixed_sessions_are_never_overlapped() -> None:
    fixed = [(NOW, NOW + 6 * HOUR_MS)]

    plan = plan_repack("new", 60, NOW + 8 * HOUR_MS, [], fixed, NOW, NOW + 2 * DAY_MS)

    assert plan.kind == "placed"
    assert plan.start_ms is not None
    assert plan.start_ms >= NOW + 6 * HOUR_MS


def test_placer_falls_back_to_repack_when_the_cascade_finds_nothing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Flag on, cascade forced to fail: the same request places through repack."""
    monkeypatch.setattr(consts, "REPACK_ENABLED", True)
    monkeypatch.setattr(
        place_mod,
        "plan_displacement",
        lambda *args, **kwargs: DisplacementPlan("infeasible"),
    )
    week = PLACE_NOW + 7 * DAY_MS
    flex = _chill("a", PLACE_NOW, MIDNIGHT + DAY_MS, week) + _chill(
        "b", MIDNIGHT + DAY_MS, MIDNIGHT + 2 * DAY_MS, week
    )
    deadline = MIDNIGHT + 18 * HOUR_MS

    r = ok(_body(flex, [], deadline))["result"]

    assert r["outcome"] == "DISPLACED"
    assert r["late"] is False
    assert r["startMs"] + 60 * MS_PER_MINUTE <= deadline
    assert r["moves"]


def test_placer_ignores_repack_while_the_flag_is_off(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(consts, "REPACK_ENABLED", False)
    monkeypatch.setattr(
        place_mod,
        "plan_displacement",
        lambda *args, **kwargs: DisplacementPlan("infeasible"),
    )
    week = PLACE_NOW + 7 * DAY_MS
    flex = _chill("a", PLACE_NOW, MIDNIGHT + DAY_MS, week) + _chill(
        "b", MIDNIGHT + DAY_MS, MIDNIGHT + 2 * DAY_MS, week
    )

    r = ok(_body(flex, [], MIDNIGHT + 18 * HOUR_MS))["result"]

    assert r["outcome"] != "DISPLACED"
