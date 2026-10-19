"""Hybrid LinUCB v2: shared beta, cross features, marks and band priors, init route."""

from __future__ import annotations

import numpy as np
import pytest
from fastapi.testclient import TestClient

from src.api import app
from src.core.band_prior import reference_context
from src.core.constants import FEATURE_DIM
from src.core.hybrid import (
    EARLY_ARMS,
    Z_DIM,
    hybrid_update,
    shared_features,
    shared_prior,
    shared_tensor,
)
from src.core.init_state import init_state
from src.models.linucb import update
from src.schemas import ARM_IDS

client = TestClient(app)


def test_shared_tensor_matches_the_scalar_form_for_every_arm() -> None:
    days_left = np.array([[0.0, 3.0, 40.0]])
    lectures = np.array([[0.0, 4.0, 20.0]])
    z = shared_tensor(0.8, ["EXAM"], days_left, lectures)
    assert z.shape == (1, 3, len(ARM_IDS), Z_DIM)
    for j, dl in enumerate([0.0, 3.0, 40.0]):
        for k, arm in enumerate(ARM_IDS):
            want = shared_features(0.8, "EXAM", dl, arm, float(lectures[0, j]))
            np.testing.assert_allclose(z[0, j, k], want)


def test_weak_and_early_terms_only_for_early_arms() -> None:
    early = shared_features(1.0, "TASK", 10.0, "MORNING", 0.0)
    late = shared_features(1.0, "TASK", 10.0, "NIGHT", 0.0)
    assert early[1] == 1.0 and late[1] == 0.0
    assert "MORNING" in EARLY_ARMS and "NIGHT" not in EARLY_ARMS
    # a task has no kind weight, an exam keeps the full days-left term
    assert shared_features(0.0, "TASK", 10.0, "NIGHT", 0.0)[2] == 0.0
    assert shared_features(0.0, "EXAM", 10.0, "NIGHT", 0.0)[2] > 0.0


def test_no_cross_features_leaves_the_disjoint_update_unchanged() -> None:
    a = np.eye(FEATURE_DIM)
    b = np.zeros(FEATURE_DIM)
    x = np.arange(FEATURE_DIM, dtype=np.float64)
    shared_a, shared_b = shared_prior(1.0)
    (sa, sb), (new_a, new_b) = hybrid_update(
        shared_a, shared_b, a, b, x, np.zeros(Z_DIM), 0.7
    )
    want_a, want_b = update(a, b, x, 0.7)
    np.testing.assert_allclose(new_a, want_a)
    np.testing.assert_allclose(new_b, want_b)
    np.testing.assert_allclose(sa, shared_a)
    np.testing.assert_allclose(sb, shared_b)


def test_repeated_rewards_move_beta_toward_the_reward_sign() -> None:
    a = np.eye(FEATURE_DIM)
    b = np.zeros(FEATURE_DIM)
    x = np.ones(FEATURE_DIM) / FEATURE_DIM
    shared = (np.eye(Z_DIM), np.zeros(Z_DIM))
    z = np.array([1.0, 0.0, 0.0, 0.0])
    for _ in range(30):
        shared, (a, b) = hybrid_update(*shared, a, b, x, z, 1.0)
    beta = np.linalg.solve(shared[0], shared[1])
    assert beta[0] > 0.5
    assert beta[1:].tolist() == pytest.approx([0.0, 0.0, 0.0], abs=1e-12)


def test_marks_prior_pulls_weak_days_left_negative() -> None:
    a, b = shared_prior(1.0)
    beta = np.linalg.solve(a, b)
    assert beta[0] < 0.0
    assert beta[1:].tolist() == pytest.approx([0.0, 0.0, 0.0], abs=1e-12)


def test_init_state_without_marks_has_zero_shared_beta() -> None:
    state = init_state(1.0, None, has_marks=False)
    assert set(state.arms) == set(ARM_IDS)
    np.testing.assert_allclose(state.shared_b, np.zeros(Z_DIM))
    np.testing.assert_allclose(state.shared_a, np.eye(Z_DIM))


def test_init_state_band_prior_favours_the_band_arms() -> None:
    state = init_state(1.0, "MORNING", has_marks=True)
    x_ref = reference_context()
    score = {
        arm: float(np.linalg.solve(p.A, p.b) @ x_ref) for arm, p in state.arms.items()
    }
    assert score["MORNING"] > score["NIGHT"]
    assert score["MORNING"] > score["EVENING"]


def test_init_route_returns_every_arm_and_the_shared_block() -> None:
    resp = client.post(
        "/v1/init",
        json={
            "ridge": 1.0,
            "focusBand": "EVENING",
            "marks": [{"letter": "D", "credits": 4}],
        },
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert set(body["arms"]) == set(ARM_IDS)
    assert len(body["arms"]["EVENING"]["A"]) == FEATURE_DIM**2
    assert len(body["shared"]["A"]) == Z_DIM**2
    assert len(body["shared"]["b"]) == Z_DIM


def test_init_route_rejects_a_non_positive_ridge() -> None:
    resp = client.post("/v1/init", json={"ridge": 0.0})
    assert resp.status_code == 422


def test_update_route_with_z_returns_the_shared_block() -> None:
    d = 3
    body = {
        "ridge": 1.0,
        "arm": "MORNING",
        "x": [0.2, -0.4, 1.0],
        "reward": 1.0,
        "state": {"A": [], "b": []},
        "z": [1.0, 0.0, 0.0, 0.0],
        "shared": {"A": [], "b": []},
    }
    resp = client.post("/v1/update", json=body)
    assert resp.status_code == 200, resp.text
    out = resp.json()
    assert len(out["A"]) == d * d
    assert len(out["shared"]["A"]) == Z_DIM * Z_DIM
    assert out["shared"]["b"][0] > 0.0


def test_update_route_rejects_a_z_of_the_wrong_length() -> None:
    resp = client.post(
        "/v1/update",
        json={
            "ridge": 1.0,
            "arm": "MORNING",
            "x": [0.2, -0.4, 1.0],
            "reward": 1.0,
            "state": {"A": [], "b": []},
            "z": [1.0, 0.0],
        },
    )
    assert resp.status_code == 422


def test_cohort_prior_is_the_per_observation_mean_worth_n_cohort_students() -> None:
    from src.core.hybrid import COHORT_WEIGHT, cohort_shared_prior

    a_sum = np.diag([4.0, 2.0, 2.0, 2.0])
    b_sum = np.array([8.0, 0.0, 0.0, 0.0])
    a, b = cohort_shared_prior(a_sum, b_sum, 4, ridge=1.0)
    np.testing.assert_allclose(
        a, np.eye(Z_DIM) + COHORT_WEIGHT * np.diag([1, 0.5, 0.5, 0.5])
    )
    np.testing.assert_allclose(b, [COHORT_WEIGHT * 2.0, 0, 0, 0])
    # an empty cohort is the ridge prior
    a0, b0 = cohort_shared_prior(a_sum, b_sum, 0, ridge=1.0)
    np.testing.assert_allclose(a0, np.eye(Z_DIM))
    np.testing.assert_allclose(b0, np.zeros(Z_DIM))


def test_leave_one_out_pool_removes_only_the_student_own_statistics() -> None:
    from src.simulation.engine import StudentResult
    from src.simulation.run import _others, _pooled

    def result(sid: int, scale: float) -> StudentResult:
        stats = (np.eye(Z_DIM) * scale, np.ones(Z_DIM) * scale, 2)
        return StudentResult(sid, "night_owl", "stable", {}, {"single|linucb": stats})

    students = [result(0, 1.0), result(1, 2.0), result(2, 3.0)]
    total = _pooled(students)
    a, b, n = total["single|linucb"]
    assert n == 6 and np.allclose(a, 6 * np.eye(Z_DIM))
    a_others, b_others, n_others = _others(total, students[1])["single|linucb"]
    assert n_others == 4
    np.testing.assert_allclose(a_others, 4 * np.eye(Z_DIM))
    np.testing.assert_allclose(b_others, np.ones(Z_DIM) * 4)
