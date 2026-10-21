from datetime import datetime
from zoneinfo import ZoneInfo

from src.core.quiet_hours import quiet_intervals


def _ms(date: str, hh: int, mm: int, tz: str) -> int:
    y, m, d = (int(p) for p in date.split("-"))
    return int(datetime(y, m, d, hh, mm, tzinfo=ZoneInfo(tz)).timestamp() * 1000)


def test_default_window_covers_late_night_and_early_morning() -> None:
    got = quiet_intervals("2026-09-21", "UTC")

    assert got == [
        (_ms("2026-09-21", 0, 0, "UTC"), _ms("2026-09-21", 6, 0, "UTC")),
        (_ms("2026-09-21", 23, 0, "UTC"), _ms("2026-09-22", 0, 0, "UTC")),
    ]


def test_windows_keep_their_local_hours_on_a_dst_day() -> None:
    tz = "America/New_York"  # clocks go forward on 2026-03-08
    got = quiet_intervals("2026-03-08", tz)

    late_start = got[1][0]
    assert late_start == _ms("2026-03-08", 23, 0, tz)
    early_end = got[0][1]
    assert early_end == _ms("2026-03-08", 6, 0, tz)


def test_an_empty_window_blocks_nothing() -> None:
    assert quiet_intervals("2026-09-21", "UTC", start_min=0, end_min=0) == []


def test_a_window_inside_the_day_is_one_interval() -> None:
    got = quiet_intervals("2026-09-21", "UTC", start_min=2 * 60, end_min=9 * 60)

    assert got == [
        (_ms("2026-09-21", 2, 0, "UTC"), _ms("2026-09-21", 9, 0, "UTC")),
    ]
