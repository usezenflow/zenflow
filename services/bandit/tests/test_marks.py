import pytest

from src.core.marks import COHORT_WEAK_DEFAULT, weak_score


def test_no_marks_gets_the_cohort_default() -> None:
    assert weak_score([], None) == COHORT_WEAK_DEFAULT


def test_a_strong_record_is_near_zero() -> None:
    assert weak_score([("A", 3), ("A", 3)], 4.0) == pytest.approx(0.0)


def test_a_failing_record_is_one() -> None:
    assert weak_score([("F", 3), ("D", 3)], 0.0) == pytest.approx(1.0)


def test_stored_gpa_is_used_when_present() -> None:
    # gpa4 2.0 gives 0.25 from the GPA half; no D or F credits.
    assert weak_score([("A", 3)], 2.0) == pytest.approx(0.25)


def test_gpa_falls_back_to_credit_weighted_letters() -> None:
    # Letters average 2.0 on credits (4 * 3 + 0 * 3) / 6 = 2.0, so the GPA half is 0.25.
    assert weak_score([("A", 3), ("F", 3)], None) == pytest.approx(
        0.5 * (1 - 2.0 / 4) + 0.5 * 0.5
    )


def test_credits_weight_the_failing_share() -> None:
    # One failed 1-credit course among 4 credits: failing share 0.25.
    got = weak_score([("A", 3), ("F", 1)], 3.0)
    assert got == pytest.approx(0.5 * (1 - 3.0 / 4) + 0.5 * 0.25)


def test_plus_and_minus_grades_read_as_their_letter() -> None:
    assert weak_score([("B+", 3)], None) == weak_score([("B", 3)], None)


def test_unknown_letters_and_zero_credits_are_ignored() -> None:
    assert weak_score([("P", 3), ("A", 0)], None) == COHORT_WEAK_DEFAULT
    assert weak_score([(None, 3), ("A", 3)], 4.0) == weak_score([("A", 3)], 4.0)


def test_result_is_clamped_to_unit_interval() -> None:
    assert 0.0 <= weak_score([("A", 3)], 9.0) <= 1.0
    assert 0.0 <= weak_score([("F", 3)], -1.0) <= 1.0
