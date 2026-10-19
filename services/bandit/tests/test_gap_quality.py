import pytest

from src.core.gap_quality import gap_quality

# Minutes on one clock. A day with quiet hours ending at 06:00 (360) and starting
# at 23:00 (1380).
FLOOR = 6 * 60
CEILING = 23 * 60


def test_an_hour_of_room_each_side_scores_one() -> None:
    assert gap_quality(600, 660, [(480, 540), (720, 780)], FLOOR, CEILING) == 1.0


def test_back_to_back_scores_zero() -> None:
    assert gap_quality(600, 660, [(540, 600), (660, 720)], FLOOR, CEILING) == 0.0


def test_one_side_counts_half() -> None:
    # 30 free minutes before, back to back after.
    got = gap_quality(570, 630, [(480, 540), (630, 690)], FLOOR, CEILING)
    assert got == pytest.approx(0.5 * 0.5)


def test_free_time_stops_at_the_quiet_edges() -> None:
    # Slot at 06:00 with nothing before: the floor is the quiet boundary, so no room.
    assert gap_quality(FLOOR, FLOOR + 60, [], FLOOR, CEILING) == pytest.approx(0.5)


def test_an_empty_day_is_full_quality_away_from_the_edges() -> None:
    assert gap_quality(600, 660, [], FLOOR, CEILING) == 1.0


def test_room_beyond_an_hour_does_not_add_more() -> None:
    # Before: 59 free minutes; after: 1 free minute.
    near = gap_quality(600, 660, [(540, 541), (661, 662)], FLOOR, CEILING)
    assert near == pytest.approx(0.5 * 59 / 60 + 0.5 * 1 / 60)
    far = gap_quality(600, 660, [(0, 1), (1200, 1201)], FLOOR, CEILING)
    assert far == 1.0


def test_only_the_nearest_neighbours_count() -> None:
    busy = [(300, 320), (480, 500), (900, 910), (1000, 1010)]
    # Nearest before slot 600 is 500 (100 min free, capped); nearest after is 900.
    assert gap_quality(600, 660, busy, FLOOR, CEILING) == pytest.approx(
        0.5 * 1.0 + 0.5 * 1.0
    )


def test_vectorised_form_matches_the_scalar_form() -> None:
    import numpy as np

    from src.core.gap_quality import gap_quality_scores

    busy = [(300, 330), (480, 540), (700, 760), (1200, 1260), (1500, 1510)]
    duration = 60
    floor, ceiling = 360, 1380
    starts = np.arange(360, 1380 - duration + 1, 15, dtype=np.int64)
    free = [s for s in starts if all(s + duration <= b0 or s >= b1 for b0, b1 in busy)]
    starts = np.array(free, dtype=np.int64)

    got = gap_quality_scores(starts, duration, busy, floor, ceiling)
    want = [
        gap_quality(int(s), int(s) + duration, busy, floor, ceiling) for s in starts
    ]
    assert got == pytest.approx(want)


def test_vectorised_form_with_no_busy_time_uses_the_edges() -> None:
    import numpy as np

    from src.core.gap_quality import gap_quality_scores

    starts = np.array([360, 600], dtype=np.int64)
    got = gap_quality_scores(starts, 60, [], FLOOR, CEILING)
    assert got == pytest.approx([0.5, 1.0])
