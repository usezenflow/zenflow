"""Prep sizing: how long and how early a prep plan starts, scaled by ``weak``.

A weaker student gets a longer plan that starts further ahead. Both values are
shared by every policy; only slot choice differs between them.
"""

from __future__ import annotations

from typing import Literal

PrepKind = Literal["EXAM", "ASSIGNMENT"]

SLOT_MINUTES = 15
MIN_PREP_MINUTES = 30

# Minutes at ``weak = 0.5``. ``weak`` moves the length by +/- 25 percent.
PREP_BASE_MINUTES: dict[str, int] = {"EXAM": 180, "ASSIGNMENT": 90}
PREP_LENGTH_SPREAD = 0.5

# Lead time in days before the deadline: ``base`` at ``weak = 0``, plus up to
# ``extra`` more at ``weak = 1``.
PREP_LEAD_DAYS: dict[str, tuple[int, int]] = {"EXAM": (2, 4), "ASSIGNMENT": (1, 2)}


def prep_minutes(kind: PrepKind, weak: float) -> int:
    """Length of one prep plan, a positive multiple of 15 minutes."""
    scale = 1 - PREP_LENGTH_SPREAD / 2 + PREP_LENGTH_SPREAD * _clamp(weak)
    raw = PREP_BASE_MINUTES[kind] * scale
    slots = round(raw / SLOT_MINUTES)
    return max(MIN_PREP_MINUTES, slots * SLOT_MINUTES)


def prep_lead_days(kind: PrepKind, weak: float) -> int:
    """Days before the deadline that the prep window opens."""
    base, extra = PREP_LEAD_DAYS[kind]
    return base + round(extra * _clamp(weak))


def _clamp(weak: float) -> float:
    return min(1.0, max(0.0, weak))
