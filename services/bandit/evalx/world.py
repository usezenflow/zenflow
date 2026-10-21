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
    # Weekends can differ: a later band and a lower chance to open the app.
    weekend_band: tuple[int, int] | None = None
    weekend_attention: float | None = None

    def band_on(self, day: int) -> tuple[int, int]:
        """The preferred start hours on absolute day ``day``."""
        if self.weekend_band is not None and is_weekend(day):
            return self.weekend_band
        return self.band

    def attention_on(self, day: int) -> float:
        if self.weekend_attention is not None and is_weekend(day):
            return self.weekend_attention
        return self.attention

    def with_attention(self, attention: float) -> Student:
        return replace(self, attention=attention)

    def at(self, ms: int) -> Student:
        """The student as they are at instant ``ms`` (after any routine change)."""
        if self.shift_at_ms is not None and self.band_after and ms >= self.shift_at_ms:
            return replace(
                self, band=self.band_after, shift_at_ms=None, band_after=None
            )
        return self


def is_weekend(day: int) -> bool:
    """Absolute day 0 is 1970-01-01, a Thursday."""
    return (day + 3) % 7 >= 5


ARCHETYPES: dict[str, Student] = {
    "deadline_viewer": Student("deadline_viewer", (9, 17), 0.15, 1.0, 0.05),
    "planner": Student("planner", (9, 17), 0.7, 0.0, 0.5),
    "night_owl": Student("night_owl", (20, 24), 0.4, 0.3, 0.3),
    "absent": Student("absent", (9, 17), 0.02, 0.0, 0.05),
}


# What a student does with a proposal: drag it, tap an offer, or ignore both. A mix is
# the share of each. The paper's lazy-student mix is ``tap_heavy``.
MIXES: dict[str, tuple[float, float, float]] = {
    "drag_only": (1.0, 0.0, 0.0),
    "move_heavy": (0.6, 0.1, 0.3),
    "tap_heavy": (0.1, 0.6, 0.3),
    "ignore_heavy": (0.1, 0.2, 0.7),
}
HEADLINE_MIX = "tap_heavy"


def style_of(mix: str, u: float) -> str:
    """``drag``, ``tap`` or ``ignore`` for a uniform draw ``u``."""
    drag, tap, _ = MIXES[mix]
    return "drag" if u < drag else "tap" if u < drag + tap else "ignore"


def open_chance(s: Student, days_to_deadline: float, start_ms: int = 0) -> float:
    """Chance the student opens the app inside the slot starting at ``start_ms``."""
    attention = s.attention_on(start_ms // DAY_MS)
    close = days_to_deadline <= CLOSE_DAYS
    p = attention * (1 + s.imminence) if close else attention
    return min(1.0, p)


def hour_of(start_ms: int, midnight_ms: int) -> float:
    return (start_ms - midnight_ms) / HOUR_MS


def in_band(s: Student, start_ms: int, midnight_ms: int) -> bool:
    lo, hi = s.band_on(midnight_ms // DAY_MS)
    return lo <= hour_of(start_ms, midnight_ms) < hi


@dataclass(frozen=True)
class Task:
    """One task as the student's calendar sees it: arrival, deadline and two
    common random numbers reused by every arm, so arms differ only in placement."""

    arrival_ms: int
    deadline_ms: int
    duration_min: int
    u_open: float
    u_drag: float
    u_coin: float = 0.5  # pairwise run: which policy is primary
    u_see: float = 0.5  # pairwise run: whether the offer is seen
    eps_primary: float = 0.0  # pairwise run: perception noise on each option
    eps_alt: float = 0.0


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
        tasks.append(
            Task(
                arrival,
                deadline,
                duration_min,
                rng.random(),
                rng.random(),
                rng.random(),
                rng.random(),
                rng.gauss(0, 1),
                rng.gauss(0, 1),
            )
        )
    tasks.sort(key=lambda t: t.arrival_ms)
    return tasks


def day_str(ms: int) -> str:
    return local_date_str(ms, "UTC")


# Lecture timetable. Every weekday keeps the same bands all period, so crowding is
# constant. There are no exams, study blocks or assignments.
SEMESTER_BANDS: dict[str, tuple[int, int]] = {
    "MORNING": (7 * 60 + 30, 11 * 60 + 15),
    "AFTERNOON": (13 * 60, 16 * 60 + 30),
    "NIGHT": (16 * 60 + 45, 20 * 60),
}
PERIODS_PER_BAND = 4
PERIOD_MIN = 50
WEEKDAYS = 5
BANDS_PER_DAY_WEIGHTS = {1: 0.2, 2: 0.6, 3: 0.2}
# Hours no policy may start a block in: the overlap of both quiet windows. The
# ceiling and a student's own moves are bounded by it, not by one arm's window.
CEILING_QUIET = (2 * 60, 6 * 60)


@dataclass(frozen=True)
class Calendar:
    """Busy minutes of each absolute day (day 0 is 1970-01-01, a Thursday)."""

    busy: dict[int, list[tuple[int, int]]]


def build_calendar(rng: random.Random, days: int) -> Calendar:
    names = list(SEMESTER_BANDS)
    counts = list(BANDS_PER_DAY_WEIGHTS)
    weights = [BANDS_PER_DAY_WEIGHTS[k] for k in counts]
    bands_on = {
        wd: rng.sample(names, rng.choices(counts, weights=weights)[0])
        for wd in range(WEEKDAYS)
    }
    busy: dict[int, list[tuple[int, int]]] = {}
    for d in range(days):
        wd = (d + 3) % 7
        blocks: list[tuple[int, int]] = []
        for band in bands_on.get(wd, []):
            start, end = SEMESTER_BANDS[band]
            stride = (end - start - PERIOD_MIN) // (PERIODS_PER_BAND - 1)
            blocks += [
                (start + i * stride, start + i * stride + PERIOD_MIN)
                for i in range(PERIODS_PER_BAND)
            ]
        merged: list[tuple[int, int]] = []
        for a, b in sorted(blocks):
            if merged and a <= merged[-1][1]:
                merged[-1] = (merged[-1][0], max(merged[-1][1], b))
            else:
                merged.append((a, b))
        busy[d] = merged
    return Calendar(busy)


def busy_minutes(cal: Calendar, midnight_ms: int) -> list[tuple[int, int]]:
    return cal.busy.get(midnight_ms // DAY_MS, [])


def feasible_start(
    hours: tuple[int, int],
    busy: list[tuple[int, int]],
    duration_min: int,
    window: tuple[int, int] = CEILING_QUIET,
) -> int | None:
    """The start minute in ``hours`` nearest its centre whose block avoids busy time
    and the quiet ``window``; ``None`` when there is none."""
    centre = (hours[0] + hours[1]) / 2 * 60
    best: int | None = None
    for m in range(hours[0] * 60, hours[1] * 60 - duration_min + 1, 15):
        if any(m < be and m + duration_min > bs for bs, be in busy):
            continue
        if any(window[0] <= x % 1440 < window[1] for x in range(m, m + duration_min)):
            continue
        if best is None or abs(m + duration_min / 2 - centre) < abs(
            best + duration_min / 2 - centre
        ):
            best = m
    return best
