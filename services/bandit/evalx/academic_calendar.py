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


@dataclass(frozen=True)
class DndKind:
    """A recurring commitment a student keeps clear, as production's DND blocks do.

    Prevalence, timing and length are assumptions, not survey data. Each student
    draws whether they have it, which weekdays, and a habitual start and length.
    """

    name: str
    share: float  # chance the student has it at all
    days_per_week: tuple[int, int]
    weekdays: tuple[int, ...]  # eligible weekdays, Monday is 0
    starts: tuple[tuple[float, float], ...]  # habitual start windows, in hours
    minutes: tuple[int, int]
    skip: float = 0.1  # chance one occurrence does not happen


DND_KINDS = (
    DndKind("nap", 0.35, (7, 7), tuple(range(7)), ((12.0, 15.0),), (20, 45)),
    DndKind(
        "workout",
        0.5,
        (2, 4),
        tuple(range(7)),
        ((6.0, 8.0), (17.0, 19.5)),
        (45, 90),
    ),
    DndKind("weekend break", 0.6, (1, 1), (5, 6), ((10.0, 14.0),), (180, 360)),
    DndKind("part-time job", 0.15, (2, 3), (0, 1, 2, 3, 4), ((9.0, 13.0),), (240, 300)),
    DndKind("dinner", 0.8, (7, 7), tuple(range(7)), ((18.0, 19.5),), (45, 75)),
    DndKind(
        "club or society", 0.25, (1, 1), tuple(range(7)), ((17.0, 20.0),), (90, 120)
    ),
)


def _dnd(rng: random.Random, days: int) -> dict[int, list[tuple[int, int]]]:
    """The student's DND blocks per day, as minutes from midnight."""
    busy: dict[int, list[tuple[int, int]]] = {}
    for kind in DND_KINDS:
        if rng.random() >= kind.share:
            continue
        weekdays = set(rng.sample(kind.weekdays, rng.randint(*kind.days_per_week)))
        start_h = rng.uniform(*rng.choice(kind.starts))
        length = rng.randint(*kind.minutes)
        for day in range(days):
            if (day + 3) % 7 not in weekdays or rng.random() < kind.skip:
                continue
            begin = max(0, round(start_h * 60 + rng.gauss(0, 10)))
            end = min(24 * 60, begin + round(length * rng.uniform(0.9, 1.1)))
            if end > begin:
                busy.setdefault(day, []).append((begin, end))
    return {day: _merge(blocks) for day, blocks in busy.items()}


def _merge(blocks: list[tuple[int, int]]) -> list[tuple[int, int]]:
    merged: list[tuple[int, int]] = []
    for a, b in sorted(blocks):
        if merged and a <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], b))
        else:
            merged.append((a, b))
    return merged


def _union(
    a: dict[int, list[tuple[int, int]]], b: dict[int, list[tuple[int, int]]]
) -> dict[int, list[tuple[int, int]]]:
    return {d: _merge([*a.get(d, []), *b.get(d, [])]) for d in {*a, *b}}


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
    # Drawn last, so the timetable and tasks above are the same as without DND.
    dnd = _dnd(rng, DAYS + TAIL_DAYS)
    calendar = Calendar(_union(calendar.busy, dnd), lectures=calendar.busy, dnd=dnd)
    return Semester(calendar, tasks, weak)
