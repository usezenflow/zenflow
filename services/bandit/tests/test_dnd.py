"""Student DND blocks in the semester simulator: they block starts, not fatigue."""

from __future__ import annotations

import random

from evalx.academic_calendar import DAYS, DND_KINDS, _lectures, build_semester
from evalx.student_behavior import fatigue
from evalx.world import Calendar


def test_every_dnd_block_is_busy() -> None:
    cal = build_semester(random.Random("dnd:1")).calendar
    assert cal.dnd
    for day, blocks in cal.dnd.items():
        for a, b in blocks:
            assert a < b
            assert any(x <= a and b <= y for x, y in cal.busy[day])


def test_timetable_is_unchanged_by_dnd() -> None:
    rng = random.Random("dnd:2")
    cal = build_semester(rng).calendar
    # build_semester draws the workload weight first, then the timetable.
    timetable_rng = random.Random("dnd:2")
    timetable_rng.random()
    assert cal.lectures == _lectures(timetable_rng).busy


def test_fatigue_ignores_dnd() -> None:
    cal = build_semester(random.Random("dnd:3")).calendar
    lectures_only = Calendar(busy=cal.lectures or cal.busy)
    for day in range(DAYS):
        at = day * 24 * 60 * 60_000 + 20 * 60 * 60_000
        assert fatigue(cal, at) == fatigue(lectures_only, at)


def test_students_differ_in_their_dnd() -> None:
    patterns = set()
    for i in range(300):
        cal = build_semester(random.Random(f"dnd-pop:{i}")).calendar
        patterns.add(
            tuple(sorted(d for d, blocks in (cal.dnd or {}).items() if blocks))
        )
    assert len({len(p) for p in patterns}) > 1
    assert len(patterns) > 200


def test_the_documented_activities_are_listed() -> None:
    assert [kind.name for kind in DND_KINDS] == [
        "nap",
        "workout",
        "weekend break",
        "part-time job",
        "dinner",
        "club or society",
    ]
