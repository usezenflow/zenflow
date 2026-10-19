"""Prep window (level-up Phase 1): sizing from marks, window opening, route contract."""

from fastapi.testclient import TestClient

from src.api import app
from src.core.constants import DAY_MS
from src.core.prep import prep_window

client = TestClient(app)

NOW = 1_800_000_000_000
DEADLINE = NOW + 10 * DAY_MS
HOUR_MS = 60 * 60_000


def test_a_strong_student_opens_the_window_at_the_base_lead() -> None:
    got = prep_window("EXAM", [("A", 3)], 4.0, NOW, DEADLINE)

    assert got.duration_minutes == 135
    assert got.window_start_ms == DEADLINE - 2 * DAY_MS
    assert got.feasible


def test_a_weak_student_opens_earlier_and_gets_longer_prep() -> None:
    weak = prep_window("EXAM", [("F", 3)], 0.0, NOW, DEADLINE)
    strong = prep_window("EXAM", [("A", 3)], 4.0, NOW, DEADLINE)

    assert weak.duration_minutes > strong.duration_minutes
    assert weak.window_start_ms < strong.window_start_ms


def test_the_window_never_starts_before_now() -> None:
    late_deadline = NOW + DAY_MS
    got = prep_window("EXAM", [("F", 3)], 0.0, NOW, late_deadline)

    assert got.window_start_ms == NOW
    assert got.feasible


def test_a_plan_that_cannot_fit_before_the_deadline_is_not_feasible() -> None:
    got = prep_window("ASSIGNMENT", [], None, NOW, NOW + HOUR_MS)

    assert got.duration_minutes == 90
    assert not got.feasible


def test_no_marks_uses_the_cohort_default() -> None:
    got = prep_window("ASSIGNMENT", [], None, NOW, DEADLINE)

    assert got.weak == 0.5
    assert got.duration_minutes == 90


def test_prep_size_route_returns_the_window() -> None:
    res = client.post(
        "/v1/prep/size",
        json={
            "kind": "EXAM",
            "nowMs": NOW,
            "deadlineMs": DEADLINE,
            "marks": [{"letter": "F", "credits": 3}],
            "avgGpa4": 0.0,
        },
    )

    assert res.status_code == 200
    body = res.json()
    assert body["durationMinutes"] == 225
    assert body["windowStartMs"] == DEADLINE - 6 * DAY_MS
    assert body["deadlineMs"] == DEADLINE
    assert body["feasible"] is True
    assert body["weak"] == 1.0


def test_prep_size_route_rejects_unknown_fields() -> None:
    res = client.post(
        "/v1/prep/size",
        json={"kind": "EXAM", "nowMs": NOW, "deadlineMs": DEADLINE, "extra": 1},
    )

    assert res.status_code == 422


def test_prep_size_route_rejects_an_unknown_kind() -> None:
    res = client.post(
        "/v1/prep/size",
        json={"kind": "LECTURE", "nowMs": NOW, "deadlineMs": DEADLINE},
    )

    assert res.status_code == 422
