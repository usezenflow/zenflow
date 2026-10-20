"""Stage 1 mechanics: each signal moves the learned state the right way.

Deterministic, no population simulation. These checks answer "does the code
learn and adapt" before any offline eval (docs/scheduler/eval-strategy.md):

* a START raises the arm and the hour cell it was for;
* a MOVE lowers them;
* an ignored proposal (no event) changes nothing;
* the preference map decays with its half-life;
* when the student's preferred band changes, LinUCB finds the new band soon.
"""

from __future__ import annotations

import random
from typing import Any

import numpy as np
import pytest
from fastapi.testclient import TestClient

from src.api import app
from src.core.constants import DAY_MS, MS_PER_MINUTE, PREFERENCE_KEPT_WEIGHT
from src.core.preference import (
    decay_matrix,
    default_preference_matrix,
    matrix_index,
    reinforce_preference_cell,
    reinforce_preference_move,
)
from src.core.reward import drag_distance_reward
from src.core.slot import iso_weekday, local_date_str, local_midnight_ms
from src.models.linucb import LinUCB
from src.schemas import ARM_IDS
from tests.test_learning import ALPHA, DUR, RIDGE, _centre_start_ms
from tests.test_place import NOW, make_days, make_req, member

client = TestClient(app)
HOUR_MS = 60 * MS_PER_MINUTE
X = np.array([1.0, 0.0, 0.0])


def _model(alpha: float = 0.0) -> LinUCB:
    return LinUCB(n_features=3, alpha=alpha, ridge=RIDGE, rng=random.Random(0))


# --- LinUCB: arm estimates ---------------------------------------------------


def test_a_start_raises_that_arms_estimate() -> None:
    model = _model()
    before = model.theta("EVENING") @ X
    model.update("EVENING", X, 1.0)
    after = model.theta("EVENING") @ X
    assert after > before
    assert after > 0


def test_a_move_lowers_that_arms_estimate() -> None:
    model = _model()
    model.update("EVENING", X, 1.0)
    high = model.theta("EVENING") @ X
    model.update("EVENING", X, drag_distance_reward(240))  # full-scale drag: -1
    assert model.theta("EVENING") @ X < high


def test_a_started_arm_is_preferred_over_an_untried_arm() -> None:
    model = _model()
    model.update("EVENING", X, 1.0)
    assert model.select_arm({"EVENING": X, "MORNING": X}) == "EVENING"


def test_an_ignored_proposal_changes_nothing() -> None:
    """No event means no update. Selecting an arm must not learn anything."""
    model = _model(alpha=ALPHA)
    model.update("EVENING", X, 1.0)
    before = {arm: model.theta(arm).copy() for arm in ("EVENING", "MORNING")}
    for _ in range(20):
        model.select_arm({"EVENING": X, "MORNING": X})
    for arm, theta in before.items():
        np.testing.assert_array_equal(model.theta(arm), theta)


# --- Preference map ----------------------------------------------------------


def _day_at(hour: int) -> tuple[int, int, int]:
    """(ms of that hour today, weekday, hour cell index) for the test's day."""
    midnight = local_midnight_ms(local_date_str(NOW, "UTC"), "UTC")
    at = midnight + hour * HOUR_MS
    wd = iso_weekday(local_date_str(at, "UTC"))
    return at, wd, matrix_index(wd, hour)


def test_a_start_raises_its_hour_cell() -> None:
    m = default_preference_matrix()
    at, wd, cell = _day_at(19)
    out = reinforce_preference_cell(m, at, "UTC", PREFERENCE_KEPT_WEIGHT)
    assert out[cell] > m[cell]


def test_a_move_takes_weight_from_the_old_hour_to_the_new_one() -> None:
    m = default_preference_matrix()
    old_at, _, old_cell = _day_at(10)  # inside the default 9-11 band: 1.0
    new_at, _, new_cell = _day_at(15)  # outside it: 0.0
    out = reinforce_preference_move(m, old_at, new_at, "UTC", 300)
    assert out[old_cell] < m[old_cell]
    assert out[new_cell] > m[new_cell]


def test_the_map_halves_after_one_half_life() -> None:
    m = default_preference_matrix()
    np.testing.assert_allclose(decay_matrix(m, 21.0), m / 2)
    np.testing.assert_array_equal(decay_matrix(m, 0.0), m)


# --- Adaptation over placements, through the HTTP surface --------------------


def _run_shifting(bands: list[str]) -> list[str]:
    """One placement per day, the student wanting ``bands[k]`` on day ``k``.

    Mirrors ``test_learning.simulate``: a START (+1) when LinUCB's arm is the
    wanted band, otherwise a MOVE to the wanted band's centre. Returns the arm
    picked each day.
    """
    state: dict[str, dict[str, list[float]]] = {a: {"A": [], "b": []} for a in ARM_IDS}
    matrix = default_preference_matrix()
    picks: list[str] = []
    for k, want in enumerate(bands):
        now = local_midnight_ms(local_date_str(NOW + k * DAY_MS, "UTC"), "UTC")
        today = local_date_str(now, "UTC")
        body: dict[str, Any] = make_req(
            requestId=f"shift-{k}",
            nowMs=now,
            deadlineMs=now + DAY_MS,
            members=[member(policy="LINUCB", dur=DUR)],
            days=make_days(2, start_day=today),
            bandit={"alpha": ALPHA, "ridge": RIDGE, "state": state},
            user={"preferenceMatrix": matrix.tolist(), "observationCount": k},
        )
        res = client.post("/v1/place", json=body)
        assert res.status_code == 200, res.text
        lin = res.json()["results"][0]["linucb"]
        arm, start = lin["selectedArm"], lin["startMs"]
        picks.append(arm)

        day = local_date_str(start, "UTC")
        day_start = next(d["dayStartMs"] for d in body["days"] if d["dayStr"] == day)
        moved_to = _centre_start_ms(day_start, want)
        if arm == want:
            reward = 1.0
            matrix = reinforce_preference_cell(
                matrix, start, "UTC", PREFERENCE_KEPT_WEIGHT
            )
        else:
            drag = abs(moved_to - start) / MS_PER_MINUTE
            reward = drag_distance_reward(drag)
            matrix = reinforce_preference_move(matrix, start, moved_to, "UTC", drag)

        upd = client.post(
            "/v1/update",
            json={
                "ridge": RIDGE,
                "arm": arm,
                "x": lin["featureVector"],
                "reward": reward,
                "state": state[arm],
            },
        )
        assert upd.status_code == 200, upd.text
        state[arm] = upd.json()
    return picks


@pytest.mark.xfail(
    strict=True,
    reason=(
        "Known gap: after a preference shift LinUCB keeps the old arm. Its "
        "estimate stays above the drag-penalised new arms and the exploration "
        "bonus is too small to try them. Needs a non-stationary model "
        "(discounting or a window); see the eval strategy."
    ),
)
def test_finds_a_new_preferred_band_after_the_student_changes() -> None:
    """EVENING for 20 days, then MORNING. The new band must be picked within
    8 days of the change: the EVENING drags push LinUCB off it, and MORNING
    is tried through its exploration bonus."""
    shift_at, budget = 20, 8
    bands = ["EVENING"] * shift_at + ["MORNING"] * 25
    picks = _run_shifting(bands)
    after = picks[shift_at:]
    first_morning = after.index("MORNING")
    assert first_morning <= budget, f"MORNING first picked {first_morning} days after the change: {after[:12]}"
