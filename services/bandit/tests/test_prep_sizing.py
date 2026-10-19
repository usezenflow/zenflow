import pytest

from src.core.prep_sizing import prep_lead_days, prep_minutes


@pytest.mark.parametrize("kind", ["EXAM", "ASSIGNMENT"])
@pytest.mark.parametrize("weak", [0.0, 0.3, 0.5, 0.9, 1.0])
def test_length_is_a_positive_multiple_of_15(kind: str, weak: float) -> None:
    minutes = prep_minutes(kind, weak)  # type: ignore[arg-type]
    assert minutes >= 30
    assert minutes % 15 == 0


def test_a_weaker_student_gets_longer_prep() -> None:
    assert prep_minutes("EXAM", 1.0) > prep_minutes("EXAM", 0.0)


def test_neutral_weak_gives_the_base_length() -> None:
    assert prep_minutes("EXAM", 0.5) == 180
    assert prep_minutes("ASSIGNMENT", 0.5) == 90


def test_out_of_range_weak_is_clamped() -> None:
    assert prep_minutes("EXAM", 5.0) == prep_minutes("EXAM", 1.0)
    assert prep_minutes("EXAM", -5.0) == prep_minutes("EXAM", 0.0)


def test_a_weaker_student_starts_earlier() -> None:
    assert prep_lead_days("EXAM", 1.0) > prep_lead_days("EXAM", 0.0)
    assert prep_lead_days("ASSIGNMENT", 1.0) > prep_lead_days("ASSIGNMENT", 0.0)


def test_lead_days_span_the_configured_range() -> None:
    assert prep_lead_days("EXAM", 0.0) == 2
    assert prep_lead_days("EXAM", 1.0) == 6
    assert prep_lead_days("ASSIGNMENT", 0.0) == 1
    assert prep_lead_days("ASSIGNMENT", 1.0) == 3
