"""Pure Pydantic-model validation — no FastAPI route, no TestClient.

Covers the cross-field ``model_validator`` dimension checks and the field-level
constraints (``min_length``, the ``ArmId`` Literal, the full set of 24 hour arms).
Route-level behaviour (the in-handler finite guards) lives in ``test_api.py``.
"""

import pytest
from pydantic import ValidationError

from src.schemas import HOUR_ARM_IDS, UpdateRequest


def _arms(**overrides: dict[str, list[float]]) -> dict[str, dict[str, list[float]]]:
    arms: dict[str, dict[str, list[float]]] = {
        arm: {"A": [], "b": []} for arm in HOUR_ARM_IDS
    }
    arms.update(overrides)
    return arms


def valid_update_body() -> dict[str, object]:
    return {
        "ridge": 1.0,
        "arm": "HOUR_20",
        "x": [0.1, 0.2, 0.3],
        "reward": -0.5,
        "arms": _arms(),
    }


class TestUpdateRequest:
    def test_accepts_a_well_formed_body(self):
        req = UpdateRequest.model_validate(valid_update_body())
        assert req.arm == "HOUR_20"
        assert len(req.arms) == 24

    def test_accepts_a_hydrated_state_of_the_right_width(self):
        body = valid_update_body()
        body["arms"] = _arms(HOUR_20={"A": [1.0] * 9, "b": [0.0] * 3})
        req = UpdateRequest.model_validate(body)
        assert len(req.arms["HOUR_20"].A) == 9

    @pytest.mark.parametrize(
        "body",
        [
            pytest.param(
                {**valid_update_body(), "arm": "EVENING"},
                id="six-band-arm-not-canonical",
            ),
            pytest.param(
                {**valid_update_body(), "arm": "HOUR_24"},
                id="hour-out-of-range",
            ),
            pytest.param(
                {**valid_update_body(), "x": []},
                id="empty-x",
            ),
            pytest.param(
                {**valid_update_body(), "arms": {"HOUR_20": {"A": [], "b": []}}},
                id="missing-hour-arms",
            ),
            pytest.param(
                {
                    **valid_update_body(),
                    "arms": _arms(HOUR_20={"A": [1.0, 2.0], "b": []}),
                },
                id="A-not-d-squared",
            ),
            pytest.param(
                {**valid_update_body(), "arms": _arms(HOUR_20={"A": [], "b": [1.0]})},
                id="b-not-length-d",
            ),
        ],
    )
    def test_rejects_malformed_bodies(self, body):
        with pytest.raises(ValidationError):
            UpdateRequest.model_validate(body)
