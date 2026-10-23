"""End-to-end route behaviour, driven through the FastAPI ``TestClient``.

Pure request-model validation (bad shapes, missing arms, mismatched ``d``) lives
in ``test_schemas.py``; this file exercises the running routes: the in-handler
finite guards, the kernel update, and the init prior.
"""

import json

import numpy as np
import pytest
from fastapi.testclient import TestClient

from src.api import app
from src.core import matrix_prior
from src.models.linucb import score
from src.schemas import HOUR_ARM_IDS, ArmId, ArmState
from src.serialization import hydrate_arms

client = TestClient(app)

D = 3
ALPHA = 0.15


@pytest.fixture
def cold_prior(monkeypatch: pytest.MonkeyPatch) -> None:
    """Cold arms are plain ridge, so update math can be checked by hand."""
    monkeypatch.setattr(matrix_prior, "PRIOR_MATRIX", None)


def cold_state() -> dict[ArmId, dict[str, list[float]]]:
    return {arm: {"A": [], "b": []} for arm in HOUR_ARM_IDS}


def update(
    arm: str,
    x: list[float],
    reward: float,
    arms: dict[ArmId, dict[str, list[float]]] | None = None,
) -> dict[ArmId, dict[str, list[float]]]:
    """POST one reward for ``arm`` and return all 24 updated arms."""
    resp = client.post(
        "/v1/update",
        json={
            "ridge": 1.0,
            "arm": arm,
            "x": x,
            "reward": reward,
            "arms": arms if arms is not None else cold_state(),
        },
    )
    assert resp.status_code == 200, resp.text
    payload: dict[ArmId, dict[str, list[float]]] = resp.json()["arms"]
    return payload


def _scores(
    state: dict[ArmId, dict[str, list[float]]], x: list[float]
) -> dict[ArmId, float]:
    """Score every arm the way /v1/place does: hydrate_arms + linucb.score."""
    arms = hydrate_arms(
        {a: ArmState(**st) for a, st in state.items()}, len(x), ridge=1.0
    )
    xv = np.asarray(x)
    return {a: float(score(p.A, p.b, xv, ALPHA)) for a, p in arms.items()}


def test_health():
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


def test_cold_arms_score_their_exploration_bonus(cold_prior):
    """Cold arm = ridge prior: θ̂ = 0, score = α·√(xᵀx/λ), equal across arms."""
    x = [0.1, 0.2, 0.3]
    bonus = ALPHA * float(np.sqrt(np.dot(x, x)))
    scores = _scores(cold_state(), x)
    assert set(scores) == set(HOUR_ARM_IDS)
    assert all(s == pytest.approx(bonus) for s in scores.values())


def test_update_returns_all_24_arms_of_length_d_squared_and_d(cold_prior):
    arms = update("HOUR_20", [1.0, 2.0, 3.0], -0.5)
    assert set(arms) == set(HOUR_ARM_IDS)
    for st in arms.values():
        assert len(st["A"]) == D * D
        assert len(st["b"]) == D


def test_update_centre_arm_gets_the_full_weight(cold_prior):
    """The played hour gains x xᵀ at weight 1, with x unit length."""
    raw = np.array([1.0, 2.0, 3.0])
    x = raw / np.linalg.norm(raw)
    reward = 0.75
    arms = update("HOUR_09", raw.tolist(), reward)

    centre = np.asarray(arms["HOUR_09"]["A"]).reshape(D, D)
    np.testing.assert_allclose(centre, np.identity(D) + np.outer(x, x))
    np.testing.assert_allclose(np.asarray(arms["HOUR_09"]["b"]), reward * x)


def test_update_spreads_less_to_far_hours(cold_prior):
    """Hours 12 away on the circle get almost none of the kernel."""
    arms = update("HOUR_09", [1.0, 2.0, 3.0], 1.0)
    far = np.asarray(arms["HOUR_21"]["A"]).reshape(D, D)
    np.testing.assert_allclose(far, np.identity(D), atol=1e-6)


def test_a_rewarded_hour_ranks_above_a_cold_one(cold_prior):
    x = [0.5, 0.5, 0.5]
    state = update("HOUR_20", x, 1.0)
    scores = _scores(state, x)
    assert scores["HOUR_20"] > scores["HOUR_04"]


def test_a_moved_hour_ranks_below_a_cold_one(cold_prior):
    """A warm hour whose placement was dragged must lose to an unexplored hour."""
    x = [0.5, 0.5, 0.5]
    state = update("HOUR_20", x, -0.25)  # a 60-min drag
    scores = _scores(state, x)
    assert scores["HOUR_20"] < scores["HOUR_04"]


def test_update_accepts_previously_updated_state(cold_prior):
    x = [0.4, 0.5, 0.6]
    first = update("HOUR_03", x, 1.0)
    second = update("HOUR_03", x, 1.0, arms=first)

    xv = np.asarray(x) / np.linalg.norm(x)
    np.testing.assert_allclose(
        np.asarray(second["HOUR_03"]["A"]).reshape(D, D),
        np.identity(D) + 2.0 * np.outer(xv, xv),
        atol=1e-9,
    )


@pytest.mark.parametrize(
    "body",
    [
        pytest.param(
            {
                "ridge": 0.0,
                "arm": "HOUR_08",
                "x": [0.1, 0.2, 0.3],
                "reward": 1.0,
                "arms": cold_state(),
            },
            id="non-positive-ridge-handler-guard",
        ),
        pytest.param(
            {
                "ridge": 1.0,
                "arm": "MORNING",
                "x": [0.1, 0.2, 0.3],
                "reward": 1.0,
                "arms": cold_state(),
            },
            id="six-band-arm-is-rejected",
        ),
        pytest.param(
            {
                "ridge": 1.0,
                "arm": "HOUR_08",
                "x": [0.1, 0.2, 0.3],
                "reward": 1.0,
                "arms": {"HOUR_08": {"A": [], "b": []}},
            },
            id="missing-hour-arms-are-rejected",
        ),
    ],
)
def test_update_route_rejects_malformed_bodies(body):
    assert client.post("/v1/update", json=body).status_code == 422


def test_update_rejects_a_non_finite_reward():
    body = {
        "ridge": 1.0,
        "arm": "HOUR_08",
        "x": [0.1, 0.2, 0.3],
        "reward": 1.0,
        "arms": cold_state(),
    }
    raw = json.dumps(body).replace('"reward": 1.0', '"reward": 1e400')
    resp = client.post(
        "/v1/update", content=raw, headers={"content-type": "application/json"}
    )
    assert resp.status_code == 422


def test_init_returns_the_matrix_prior_on_all_24_arms():
    resp = client.post("/v1/init", json={"ridge": 1.0})
    assert resp.status_code == 200
    arms = resp.json()["arms"]
    assert set(arms) == set(HOUR_ARM_IDS)
    # The prior is not the ridge alone: the reward term is warm at the peak.
    assert any(st["b"] and any(v != 0.0 for v in st["b"]) for st in arms.values())
