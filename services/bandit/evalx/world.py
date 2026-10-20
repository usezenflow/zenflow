"""Simulated students: a few measurable traits, and what they do with a placed block.

The traits follow docs/scheduler/eval-strategy.md: preferred hours, attention,
imminence sensitivity and drag tendency. Every value is an assumption; the
report varies them rather than trusting one setting.
"""

from __future__ import annotations

import random
from dataclasses import dataclass, replace

from src.core.constants import DAY_MS, MS_PER_MINUTE
from src.core.slot import local_date_str

HOUR_MS = 60 * MS_PER_MINUTE
CLOSE_DAYS = 2  # a deadline this close counts as imminent


@dataclass(frozen=True)
class Student:
    """One simulated student. ``band`` is the preferred start hours, [start, end)."""

    name: str
    band: tuple[int, int]
    attention: float  # chance to open the app in a good slot, 0..1
    imminence: float  # extra attention factor when the deadline is close, 0..1
    drag: float  # chance of moving a block that starts outside the band
    # Optional change of routine: from ``shift_at_ms`` the band becomes ``band_after``.
    shift_at_ms: int | None = None
    band_after: tuple[int, int] | None = None

    def with_attention(self, attention: float) -> Student:
        return replace(self, attention=attention)

    def at(self, ms: int) -> Student:
        """The student as they are at instant ``ms`` (after any routine change)."""
        if self.shift_at_ms is not None and self.band_after and ms >= self.shift_at_ms:
            return replace(
                self, band=self.band_after, shift_at_ms=None, band_after=None
            )
        return self


ARCHETYPES: dict[str, Student] = {
    "deadline_viewer": Student("deadline_viewer", (9, 17), 0.15, 1.0, 0.05),
    "planner": Student("planner", (9, 17), 0.7, 0.0, 0.5),
    "night_owl": Student("night_owl", (20, 24), 0.4, 0.3, 0.3),
    "absent": Student("absent", (9, 17), 0.02, 0.0, 0.05),
}


def open_chance(s: Student, days_to_deadline: float) -> float:
    """Chance the student opens the app inside the slot."""
    close = days_to_deadline <= CLOSE_DAYS
    p = s.attention * (1 + s.imminence) if close else s.attention
    return min(1.0, p)


def hour_of(start_ms: int, midnight_ms: int) -> float:
    return (start_ms - midnight_ms) / HOUR_MS


def in_band(s: Student, start_ms: int, midnight_ms: int) -> bool:
    h = hour_of(start_ms, midnight_ms)
    return s.band[0] <= h < s.band[1]


def band_centre_ms(s: Student, midnight_ms: int, duration_min: int) -> int:
    mid = (s.band[0] + s.band[1]) / 2
    return midnight_ms + int(mid * 60 - duration_min / 2) * MS_PER_MINUTE


@dataclass(frozen=True)
class Task:
    """One task as the student's calendar sees it: arrival, deadline and two
    common random numbers reused by every arm, so arms differ only in placement."""

    arrival_ms: int
    deadline_ms: int
    duration_min: int
    u_open: float
    u_drag: float


def make_tasks(
    rng: random.Random,
    weeks: int,
    tasks_per_week: int,
    duration_min: int = 60,
    base_day_ms: int = 0,
) -> list[Task]:
    """Tasks arriving on random days; deadlines 1 to 7 days out."""
    tasks: list[Task] = []
    for _ in range(weeks * tasks_per_week):
        day = rng.randrange(weeks * 7)
        arrival = base_day_ms + day * DAY_MS + 8 * HOUR_MS
        deadline = arrival + rng.choice([1, 2, 3, 5, 7]) * DAY_MS
        tasks.append(Task(arrival, deadline, duration_min, rng.random(), rng.random()))
    tasks.sort(key=lambda t: t.arrival_ms)
    return tasks


def day_str(ms: int) -> str:
    return local_date_str(ms, "UTC")
