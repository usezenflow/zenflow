"""A 15-week semester: timetable, exam seasons and the tasks they spawn.

Students do not create tasks. LMS assignments and exam dates arrive on their own
and production sizes one prep plan for each (``src/core/prep_sizing.py``): a
block of ``prep_minutes`` that may start from ``deadline - prep_lead_days``. The
semester emits exactly those tasks, so the placer sees what Nest would send.
"""

from __future__ import annotations

import random
from dataclasses import dataclass

from evalx.world import (
    HOUR_MS,
    SEMESTER_BANDS,
    Calendar,
    Task,
    build_calendar,
)
from src.core.constants import DAY_MS
from src.core.prep_sizing import prep_lead_days, prep_minutes

WEEKS = 15
DAYS = WEEKS * 7
MIDTERM_WEEKS = (7, 8)
FINAL_WEEKS = (14, 15)
COURSES = (4, 6)
ASSIGNMENTS_PER_COURSE = (10, 15)
ASSIGNMENT_LEAD_DAYS = (5, 10)  # arrival before the due date
EXAMS = (4, 6)
EXAM_ANNOUNCE_DAYS = (14, 21)
DUE_HOUR = 23  # an assignment closes at 23:00, an exam starts at a band start
# Calendar days past the last week, so a late block still sees a free day.
TAIL_DAYS = 10


def week_of(day: int) -> int:
    """1-based week of absolute day ``day`` (day 0 is the first day of week 1)."""
    return day // 7 + 1


def season_of(day: int) -> str:
    """``regular``, ``midterm`` or ``final`` for an absolute day."""
    w = week_of(day)
    if w in MIDTERM_WEEKS:
        return "midterm"
    if w in FINAL_WEEKS:
        return "final"
    return "regular"


@dataclass(frozen=True)
class Semester:
    """One student's semester: lectures as busy time, and the tasks in order."""

    calendar: Calendar
    tasks: list[Task]
    weak: float  # 0 strong, 1 weak: scales prep length and lead


def _lectures(rng: random.Random) -> Calendar:
    """The weekly timetable, lightened in midterm weeks and empty in finals."""
    base = build_calendar(rng, DAYS + TAIL_DAYS)
    morning_end = SEMESTER_BANDS["MORNING"][1]
    busy: dict[int, list[tuple[int, int]]] = {}
    for day, blocks in base.busy.items():
        season = season_of(day)
        if season == "final":
            busy[day] = []
        elif season == "midterm":
            # Only morning lectures run: a lighter week, not none.
            kept = [b for b in blocks if b[0] < morning_end]
            busy[day] = kept
        else:
            busy[day] = blocks
    return Calendar(busy)


def _exam_days(rng: random.Random, n: int) -> list[int]:
    """Weekday dates spread over the midterm and final weeks, in order."""
    mids = [d for d in range(DAYS) if season_of(d) == "midterm" and d % 7 < 5]
    finals = [d for d in range(DAYS) if season_of(d) == "final" and d % 7 < 5]
    # Roughly a third of the exams are midterms; every course has a final.
    n_mid = max(1, n // 3)
    days = rng.sample(mids, n_mid) + rng.sample(finals, n - n_mid)
    return sorted(days)


def _task(
    rng: random.Random, arrival: int, deadline: int, minutes: int, kind: str
) -> Task:
    return Task(
        arrival,
        deadline,
        minutes,
        rng.random(),
        rng.random(),
        rng.random(),
        rng.random(),
        rng.gauss(0, 1),
        rng.gauss(0, 1),
        kind,
    )


def build_semester(rng: random.Random, weak: float | None = None) -> Semester:
    """A full semester for one student from ``rng``.

    ``weak`` (0 to 1) defaults to a draw; it lengthens prep and opens its window
    earlier, as production does for a student with weaker marks.
    """
    weak = rng.random() if weak is None else weak
    calendar = _lectures(rng)
    courses = rng.randint(*COURSES)
    tasks: list[Task] = []

    for _ in range(courses):
        for _ in range(rng.randint(*ASSIGNMENTS_PER_COURSE)):
            due = rng.randrange(ASSIGNMENT_LEAD_DAYS[1], 13 * 7)
            deadline = due * DAY_MS + DUE_HOUR * HOUR_MS
            announced = deadline - rng.randint(*ASSIGNMENT_LEAD_DAYS) * DAY_MS
            opens = deadline - prep_lead_days("ASSIGNMENT", weak) * DAY_MS
            tasks.append(
                _task(
                    rng,
                    max(announced, opens),
                    deadline,
                    prep_minutes("ASSIGNMENT", weak),
                    "ASSIGNMENT",
                )
            )

    starts = [h * 60 for h in (8, 13)]  # exam starts, minutes after midnight
    for day in _exam_days(rng, rng.randint(*EXAMS)):
        deadline = day * DAY_MS + rng.choice(starts) * 60_000
        announced = deadline - rng.randint(*EXAM_ANNOUNCE_DAYS) * DAY_MS
        opens = deadline - prep_lead_days("EXAM", weak) * DAY_MS
        tasks.append(
            _task(
                rng,
                max(announced, opens, 0),
                deadline,
                prep_minutes("EXAM", weak),
                "EXAM",
            )
        )

    tasks.sort(key=lambda t: (t.arrival_ms, t.deadline_ms))
    return Semester(calendar, tasks, weak)
