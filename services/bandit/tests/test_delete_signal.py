"""Delete scoring in the simulator (ADR-0043): the student, the learner's
reward and the heuristic's matrix update."""

from __future__ import annotations

from dataclasses import replace

import numpy as np

from evalx import run as harness
from evalx.semester import DELETE_ARMS, EXTRA_SPEC
from evalx.student_behavior import PassiveStudent
from evalx.world import HOUR_MS, Calendar, Task
from src.core.constants import PREFERENCE_KEPT_WEIGHT
from src.core.preference import (
    cell_index_at,
    default_preference_matrix,
    reinforce_preference_smooth,
)

DAY0 = 0  # the tests compare hours within one day

student = PassiveStudent(
    name="s",
    chronotype="lark",
    peak_h=10.0,
    attention=0.8,
    imminence=0.0,
    respond=0.0,
)


def task(kind: str = "TASK") -> Task:
    return Task(
        arrival_ms=0,
        deadline_ms=5 * 24 * HOUR_MS,
        duration_min=60,
        u_open=0.0,
        u_drag=1.0,
        kind=kind,
    )


def empty_calendar() -> Calendar:
    return Calendar(busy={})


def test_delete_chance_grows_with_a_poor_slot() -> None:
    s = replace(student, delete_slot=0.5)
    best = s.delete_chance(DAY0 + 10 * HOUR_MS)
    worst = s.delete_chance(DAY0 + 22 * HOUR_MS)
    assert best < worst
    assert worst <= 0.5


def test_delete_noise_applies_in_every_slot() -> None:
    s = replace(student, delete_noise=0.2)
    assert s.delete_chance(DAY0 + 10 * HOUR_MS) == 0.2
    assert s.delete_chance(DAY0 + 22 * HOUR_MS) == 0.2


def test_react_deletes_a_task_the_draw_selects() -> None:
    s = replace(student, delete_noise=0.5)
    done, signal, applied, _ = s.react(
        task(), DAY0 + 10 * HOUR_MS, empty_calendar(), 0.1
    )
    assert (done, signal, applied) == (False, "DELETE", DAY0 + 10 * HOUR_MS)


def test_react_keeps_a_block_without_the_knob() -> None:
    assert (
        student.react(task(), DAY0 + 10 * HOUR_MS, empty_calendar(), 0.0)[1] == "KEPT"
    )


def test_react_deletes_exam_prep_as_a_plan() -> None:
    s = replace(student, delete_noise=1.0)
    for kind in ("EXAM", "ASSIGNMENT"):
        assert (
            s.react(task(kind), DAY0 + 10 * HOUR_MS, empty_calendar(), 0.0)[1]
            == "DELETE"
        )


def test_a_negative_weight_lowers_the_cell_and_clamps_at_minus_one() -> None:
    matrix = default_preference_matrix()
    at = DAY0 + 10 * HOUR_MS
    idx = cell_index_at(at, "UTC")
    once = reinforce_preference_smooth(matrix, at, "UTC", -0.25, 0.2)
    assert once[idx] < matrix[idx]
    pushed = matrix
    for _ in range(200):
        pushed = reinforce_preference_smooth(pushed, at, "UTC", -1.0, 1.0)
    assert np.isclose(pushed[idx], -1.0)


def test_matrix_arms_weigh_the_delete_by_the_kept_weight() -> None:
    assert (
        DELETE_ARMS["H+M-0.03125"]["delete_weight"] == PREFERENCE_KEPT_WEIGHT * -0.125
    )
    assert DELETE_ARMS["H+M-0.0625"]["delete_weight"] == PREFERENCE_KEPT_WEIGHT * -0.25
    assert DELETE_ARMS["H+M-0.125"]["delete_weight"] == PREFERENCE_KEPT_WEIGHT * -0.5
    assert DELETE_ARMS["H+K+M-0.0625"]["kernel"] is True
    assert EXTRA_SPEC["L+D-0.25"]["delete_reward"] == -0.25


def test_deletes_are_off_by_default() -> None:
    assert harness.CFG["delete_noise"] == 0.0
    assert harness.CFG["delete_slot"] == 0.0
