"""Prep window: when and how long a prep plan for one exam or assignment is.

The window ends at the deadline and opens ``prep_lead_days`` earlier, never
before ``now``. Nest places the plan inside it by passing ``windowStartMs`` as
the placement ``nowMs``, so the placer's scan covers only the window.
"""

from __future__ import annotations

from dataclasses import dataclass

from src.core.constants import DAY_MS
from src.core.marks import weak_score
from src.core.prep_sizing import PrepKind, prep_lead_days, prep_minutes


@dataclass(frozen=True)
class PrepWindow:
    weak: float
    duration_minutes: int
    window_start_ms: int
    deadline_ms: int

    @property
    def feasible(self) -> bool:
        """The plan fits before the deadline once it starts at the window start."""
        return self.window_start_ms + self.duration_minutes * 60_000 <= self.deadline_ms


def prep_window(
    kind: PrepKind,
    marks: list[tuple[str | None, int]],
    avg_gpa4: float | None,
    now_ms: int,
    deadline_ms: int,
) -> PrepWindow:
    """Size and place the window for one prep plan from the student's marks."""
    weak = weak_score(marks, avg_gpa4)
    opens = deadline_ms - prep_lead_days(kind, weak) * DAY_MS
    return PrepWindow(
        weak=weak,
        duration_minutes=prep_minutes(kind, weak),
        window_start_ms=max(now_ms, opens),
        deadline_ms=deadline_ms,
    )
