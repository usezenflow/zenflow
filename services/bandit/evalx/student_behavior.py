"""A passive student: starts what is placed when it suits them, taps offers or not.

Students do not create tasks, drag blocks or tick boxes. Two signals reach the
learner: a START inside a placed block, and the keep or try pick on a pairwise
offer. Every number here is an assumption, drawn per student so the report shows
a spread rather than one tuned setting.

The chance to start a block is ``attention`` scaled by four factors:
  circadian   a bump around the chronotype's peak hour
  fatigue     lower right after a long run of lectures
  quiet       near zero overnight
  imminence   higher when the deadline is close
``drag`` is 0 for the headline; a positive value lets the student move a block
that starts at a poor hour, and exists only as an ablation.

Two reality knobs default to the headline student. ``timing`` (1 to 0) pulls the
circadian bump toward its daily mean, so the hour matters less to a lazy student
while the average start chance stays put. ``shifts``
moves the peak hour over the semester (routine drift).
"""

from __future__ import annotations

import math
import random
from dataclasses import dataclass, replace

from evalx.world import (
    HOUR_MS,
    Calendar,
    Task,
    busy_minutes,
    feasible_start,
    is_weekend,
)
from src.core.constants import DAY_MS, MS_PER_MINUTE

# Chronotype: (name, peak hour, share of students).
CHRONOTYPES: tuple[tuple[str, float, float], ...] = (
    ("lark", 9.0, 0.20),
    ("day", 14.0, 0.25),
    ("evening", 20.0, 0.40),
    ("owl", 21.5, 0.15),
)
CIRCADIAN_WIDTH_H = 2.5  # one standard deviation of the bump
CIRCADIAN_FLOOR = 0.05
WEEKEND_SHIFT_H = 1.5  # weekends peak later and are lazier
WEEKEND_ATTENTION = 0.7
TIMING_CENTRE = 0.3  # about the mean bump over a day, so ``timing`` keeps the average
SECOND_PEAK_WEIGHT = 0.8  # a second peak is a little lower than the first
QUIET = (23, 6)  # hours with almost no starts
QUIET_FACTOR = 0.1
FATIGUE_LOOKBACK_MIN = 300
FATIGUE_MAX_DROP = 0.5  # five hours of lectures halve the chance
FATIGUE_SCALE = 1.0  # a stress world scales the drop (set per run by evalx.semester)
CLOSE_DAYS = 2  # a deadline this close counts as imminent
ATTENTION_RANGE = (0.15, 0.7)
IGNORER_SHARE = 0.3  # students who never respond to an offer
RESPOND_RANGE = (0.4, 0.7)  # chance a responsive student acts on an offer
FIT_GOOD = 0.5  # a drag-capable student keeps a block whose circadian fit is this


@dataclass(frozen=True)
class PassiveStudent:
    name: str
    chronotype: str
    peak_h: float
    attention: float  # base chance to start a well-timed block, 0..1
    imminence: float  # extra factor when the deadline is close, 0..1
    respond: float  # chance to act on a pairwise offer, 0 for an ignorer
    drag: float = 0.0
    timing: float = 1.0  # 1 the hour fully matters, 0 it does not matter
    shifts: tuple[tuple[int, float], ...] = ()  # (from day, peak offset in hours)
    # Shapes the learner was not built around (misspecification worlds).
    second_offset_h: float = 0.0  # a second peak this far from the first, 0 for none
    weekday_shift: tuple[float, ...] = ()  # peak offset per weekday, Monday first

    def at(self, ms: int) -> PassiveStudent:
        """The student at instant ``ms``. Routines do not change in a semester."""
        return self

    def with_drag(self, drag: float) -> PassiveStudent:
        return replace(self, drag=drag)

    def peak_on(self, day: int) -> float:
        """The peak hour on absolute day ``day``, after any routine drift."""
        offset = 0.0
        for from_day, shift in self.shifts:
            if day >= from_day:
                offset = shift
        return self.peak_h + offset

    def fit(self, start_ms: int) -> float:
        """How well the hour suits the student, 0..1: bump times quiet factor."""
        day = start_ms // DAY_MS
        peak = self.peak_on(day) + (WEEKEND_SHIFT_H if is_weekend(day) else 0)
        if self.weekday_shift:
            peak += self.weekday_shift[(day + 3) % 7]
        h = (start_ms % DAY_MS) / HOUR_MS
        bump = max(CIRCADIAN_FLOOR, _bump(h, peak))
        if self.second_offset_h:
            bump = max(bump, SECOND_PEAK_WEIGHT * _bump(h, peak + self.second_offset_h))
        bump = TIMING_CENTRE + self.timing * (bump - TIMING_CENTRE)
        quiet = h >= QUIET[0] or h < QUIET[1]
        return bump * (QUIET_FACTOR if quiet else 1.0)

    def start_chance(self, task: Task, start_ms: int, cal: Calendar) -> float:
        """Chance the student starts a block that begins at ``start_ms``."""
        p = self.attention * self.fit(start_ms)
        if is_weekend(start_ms // DAY_MS):
            p *= WEEKEND_ATTENTION
        if (task.deadline_ms - start_ms) / DAY_MS <= CLOSE_DAYS:
            p *= 1 + self.imminence
        return min(1.0, p * fatigue(cal, start_ms))

    def utility(self, start_ms: int) -> float:
        """How good a start looks, -1..1: what the student sees on an offer."""
        return 2 * self.fit(start_ms) - 1

    def sees_offer(self, task: Task) -> bool:
        """Whether the student opens and acts on a pairwise offer."""
        return task.u_see < self.respond

    def react(
        self, task: Task, start_ms: int, cal: Calendar
    ) -> tuple[bool, str | None, int, float]:
        """(started, signal, applied start, start chance) for a block at ``start_ms``.

        A START needs the draw to fall under ``start_chance``. A student with
        drag first moves a poorly timed block to a better free hour that day;
        the signal is then MOVE, as in production, even if they also start.
        """
        applied, signal = start_ms, None
        if self.drag > 0 and task.u_drag < self.drag and self.fit(start_ms) < FIT_GOOD:
            moved = self._better_start(task, start_ms, cal)
            if moved is not None:
                applied, signal = moved, "MOVE"
        p = self.start_chance(task, applied, cal)
        started = task.u_open < p
        return started, signal or ("START" if started else None), applied, p

    def _better_start(self, task: Task, start_ms: int, cal: Calendar) -> int | None:
        midnight = (start_ms // DAY_MS) * DAY_MS
        hours = (round(self.peak_h) - 2, round(self.peak_h) + 3)
        hours = (max(6, hours[0]), min(23, hours[1]))
        minute = feasible_start(hours, busy_minutes(cal, midnight), task.duration_min)
        return None if minute is None else midnight + minute * MS_PER_MINUTE

    def oracle_start(
        self,
        task: Task,
        cal: Calendar,
        placed: dict[int, list[tuple[int, int]]] | None = None,
    ) -> int | None:
        """The free slot in the window with the best chance of a start.

        Free means clear of lectures and of blocks already ``placed``.
        """
        best: tuple[float, int] | None = None
        for d in range(task.arrival_ms // DAY_MS, (task.deadline_ms - 1) // DAY_MS + 1):
            busy = [*cal.busy.get(d, []), *(placed or {}).get(d, [])]
            for m in range(6 * 60, 24 * 60 - task.duration_min + 1, 15):
                start = d * DAY_MS + m * MS_PER_MINUTE
                end = start + task.duration_min * MS_PER_MINUTE
                if start < task.arrival_ms or end > task.deadline_ms:
                    continue
                if any(m < be and m + task.duration_min > bs for bs, be in busy):
                    continue
                p = self.start_chance(task, start, cal)
                if best is None or p > best[0] + 1e-12:
                    best = (p, start)
        return best[1] if best else None


def _bump(h: float, peak: float) -> float:
    gap = abs(h - peak) % 24
    gap = min(gap, 24 - gap)
    return math.exp(-0.5 * (gap / CIRCADIAN_WIDTH_H) ** 2)


def fatigue(cal: Calendar, start_ms: int) -> float:
    """1 with no recent lectures, falling to ``1 - FATIGUE_MAX_DROP`` at five hours."""
    day = start_ms // DAY_MS
    minute = (start_ms % DAY_MS) // MS_PER_MINUTE
    lo = minute - FATIGUE_LOOKBACK_MIN
    taught = sum(max(0, min(b, minute) - max(a, lo)) for a, b in cal.busy.get(day, []))
    drop = FATIGUE_MAX_DROP * FATIGUE_SCALE
    return 1 - drop * min(1.0, taught / FATIGUE_LOOKBACK_MIN)


CHRONOTYPE_MIXES: dict[str, tuple[float, ...]] = {
    "shipped": tuple(c[2] for c in CHRONOTYPES),
    "uniform": (0.25, 0.25, 0.25, 0.25),
    "lark heavy": (0.50, 0.30, 0.15, 0.05),
    "owl heavy": (0.05, 0.15, 0.40, 0.40),
}


def sample_student(
    rng: random.Random, idx: int = 0, mix: str = "shipped"
) -> PassiveStudent:
    """One student from the population: chronotype, attention, imminence, response.

    ``mix`` reweights the chronotypes only; every other draw is the same.
    """
    u = rng.random()
    acc = 0.0
    name, peak = CHRONOTYPES[-1][:2]
    for (n, p, _), share in zip(CHRONOTYPES, CHRONOTYPE_MIXES[mix], strict=True):
        acc += share
        if u < acc:
            name, peak = n, p
            break
    respond = 0.0 if rng.random() < IGNORER_SHARE else rng.uniform(*RESPOND_RANGE)
    return PassiveStudent(
        f"{name}-{idx}",
        name,
        peak + rng.gauss(0, 0.5),
        rng.uniform(*ATTENTION_RANGE),
        rng.random(),
        respond,
    )


DRIFT_STEP_DAYS = (14, 91)  # a one-off shift lands in this day range
DRIFT_WALK_DAYS = 14  # a walking peak moves every two weeks


def sample_shifts(
    rng: random.Random, kind: str, hours: float, days: int = 105
) -> tuple[tuple[int, float], ...]:
    """Routine drift as (from day, peak offset) steps.

    ``step``: one shift of ``hours``, either way, on a random day.
    ``walk``: every two weeks the offset moves by a normal draw with sd ``hours``.
    """
    if not hours:
        return ()
    if kind == "step":
        day = rng.randint(*DRIFT_STEP_DAYS)
        return ((day, hours if rng.random() < 0.5 else -hours),)
    offset, out = 0.0, []
    for day in range(DRIFT_WALK_DAYS, days, DRIFT_WALK_DAYS):
        offset += rng.gauss(0, hours)
        out.append((day, offset))
    return tuple(out)


# --- App opens (plan step 2) ----------------------------------------------------

OPEN_SD_H = 3.5  # wider than the start curve: an open is a looser signal
OPENS_PER_WEEK = (8, 20)
OPEN_FLOOR = 0.05


def sample_opens(
    s: PassiveStudent,
    rng: random.Random,
    end_ms: int,
    shift_h: float = 0.0,
    uninformative: bool = False,
) -> list[int]:
    """Organic app opens (UTC ms) over the semester, sorted.

    A week holds ``OPENS_PER_WEEK`` opens, each on a random day, its hour drawn from
    a circadian curve of width ``OPEN_SD_H`` around the student's peak. ``shift_h``
    moves that curve (a stress world); ``uninformative`` draws the hour uniformly.
    Push-driven opens are not generated: they reflect our send time, not the student.
    """
    opens: list[int] = []
    weeks = max(1, math.ceil(end_ms / (7 * DAY_MS)))
    centres = [h + 0.5 for h in range(24)]
    for week in range(weeks):
        for _ in range(rng.randint(*OPENS_PER_WEEK)):
            day = week * 7 + rng.randrange(7)
            if day * DAY_MS >= end_ms:
                continue
            if uninformative:
                hour = rng.randrange(24)
            else:
                peak = s.peak_on(day) + shift_h
                weights = []
                for c in centres:
                    d = (c - peak + 12) % 24 - 12
                    weights.append(
                        max(OPEN_FLOOR, math.exp(-(d * d) / (2 * OPEN_SD_H**2)))
                    )
                hour = rng.choices(range(24), weights=weights)[0]
            minute = rng.randrange(60)
            opens.append(day * DAY_MS + hour * HOUR_MS + minute * MS_PER_MINUTE)
    return sorted(opens)
