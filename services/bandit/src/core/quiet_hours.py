"""Quiet hours: a hard constraint on every placement, not a soft preference.

A plan never starts or runs inside the window, so a learned slot can never
land at 02:00. The window wraps midnight; for one local date it is the part
before the end minute and the part from the start minute on.
"""

from __future__ import annotations

from datetime import datetime, timedelta

from src.core.slot import _zone, add_days_str

QUIET_START_MIN = 23 * 60
QUIET_END_MIN = 6 * 60


def _local_ms(date_str: str, minute: int, timezone: str) -> int:
    """UTC epoch ms of local ``minute`` past midnight on ``date_str``.

    Adds the offset to a wall-clock datetime, so a DST day keeps its real
    local hour instead of drifting by an hour.
    """
    year, month, day = (int(p) for p in date_str.split("-"))
    midnight = datetime(year, month, day, tzinfo=_zone(timezone))
    return int((midnight + timedelta(minutes=minute)).timestamp() * 1000)


def quiet_intervals(
    date_str: str,
    timezone: str,
    start_min: int = QUIET_START_MIN,
    end_min: int = QUIET_END_MIN,
) -> list[tuple[int, int]]:
    """Quiet windows that overlap local ``date_str``, as ``[start, end)`` UTC ms.

    A window with ``start_min < end_min`` stays inside the day. Otherwise it
    wraps midnight and yields the early-morning part and the late part.
    Returns nothing when the window is empty (``start_min == end_min``).
    """
    if start_min == end_min:
        return []
    if start_min < end_min:
        start = _local_ms(date_str, start_min, timezone)
        return [(start, _local_ms(date_str, end_min, timezone))]
    day_start = _local_ms(date_str, 0, timezone)
    next_start = _local_ms(add_days_str(date_str, 1), 0, timezone)
    early = (day_start, _local_ms(date_str, end_min, timezone))
    late = (_local_ms(date_str, start_min, timezone), next_start)
    return [early, late]
