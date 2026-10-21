"""The offline eval is trustworthy before any result is read.

* the harness places exactly what ``/v1/place`` places for the same request;
* the harness rewards match the backend constants and the ADRs;
* a seed reruns to identical output, and identical arms give identical results;
* per-arm knobs apply inside a placement and are restored after it;
* the ceiling is a ceiling and the floor is a floor.
"""

from __future__ import annotations

import random
import re
from pathlib import Path
from typing import Any

import numpy as np
import pytest
from fastapi.testclient import TestClient

import src.place as place_module
from evalx import run as harness
from evalx.world import (
    BANDS_PER_DAY_WEIGHTS,
    build_calendar,
    make_tasks,
    stated_for,
)
from src.api import app
from src.core import constants as consts
from src.core.arms import TIE_BREAK_ARM_ORDER
from src.core.preference import default_preference_matrix
from src.place import place as run_place
from src.schemas import ARM_IDS
from src.schemas_place import PlaceRequest

client = TestClient(app)
BACKEND_CONSTANTS = (
    Path(__file__).parents[3] / "backend" / "src" / "scheduler" / "constants.ts"
)


def _ts_constant(name: str) -> float:
    text = BACKEND_CONSTANTS.read_text()
    match = re.search(rf"export const {name}\s*=\s*(-?[\d.]+);", text)
    assert match, f"{name} not found in constants.ts"
    return float(match.group(1))


@pytest.mark.parametrize("primary", ["HEURISTIC", "LINUCB"])
@pytest.mark.parametrize("band", [None, "MORNING", "LATE_NIGHT"])
def test_harness_matches_the_http_placer(primary: str, band: str | None) -> None:
    tasks = make_tasks(random.Random("parity"), 4, 3)[:4]
    state: dict[str, Any] = {a: {"A": [], "b": []} for a in ARM_IDS}
    matrix = default_preference_matrix()
    cal = build_calendar(random.Random("cal"), 4 * 7 + 10)
    for n, task in enumerate(tasks):
        body = harness.place_body(task, primary, state, matrix, n, band, cal)  # type: ignore[arg-type]
        resp = client.post("/v1/place", json=body)
        assert resp.status_code == 200, resp.text
        http = resp.json()["results"][0]
        direct = run_place(PlaceRequest.model_validate(body), 0.0).model_dump(
            by_alias=True
        )["results"][0]
        assert direct["outcome"] == http["outcome"]
        assert direct["startMs"] == http["startMs"]


def test_rewards_match_the_backend() -> None:
    assert _ts_constant("PAIRWISE_WIN_REWARD") == harness.PAIRWISE_WIN_REWARD
    assert _ts_constant("PAIRWISE_LOSS_REWARD") == harness.PAIRWISE_LOSS_REWARD
    assert _ts_constant("MOVE_REWARD_SCALE_MINUTES") == consts.MOVE_REWARD_SCALE_MINUTES
    assert _ts_constant("BANDIT_ALPHA") == harness.ALPHA
    assert _ts_constant("BANDIT_RIDGE") == harness.RIDGE
    assert (
        _ts_constant("MIN_ALTERNATIVE_GAP_MINUTES")
        == harness.MIN_ALTERNATIVE_GAP_MINUTES
    )
    assert harness.START_REWARD == 1.0  # ADR-0035
    assert harness.CFG["move_scale"] == consts.MOVE_REWARD_SCALE_MINUTES


def test_a_seed_reruns_to_identical_output() -> None:
    harness.configure({"worlds": "bands"})
    arms = ("H1", "S", "Oracle", "Rand", "AB")
    assert harness.run_seed(7, 2, arms) == harness.run_seed(7, 2, arms)


def test_identical_arms_give_identical_results() -> None:
    """A/A under common random numbers: an arm against itself differs by exactly 0."""
    harness.configure({"worlds": "bands"})
    student = harness.worlds("bands")["band_evening_17_21/correct"]
    tasks = make_tasks(random.Random("aa"), 4, 3)
    cal = build_calendar(random.Random("cal"), 4 * 7 + 10)
    a = harness.simulate(student, tasks, "S", "drag", random.Random(1), cal)
    b = harness.simulate(student, tasks, "S", "drag", random.Random(2), cal)
    assert a == b


def test_no_arm_leaks_state_into_the_next_placement() -> None:
    before = (consts.LINUCB_GAP_WEIGHT, consts.DEADLINE_PENALTY_WEIGHT)
    with harness._knobs({"gap": False, "deadline": False, "tiebreak": False}):
        assert consts.LINUCB_GAP_WEIGHT == 0.0
        assert consts.DEADLINE_PENALTY_WEIGHT == 0.0
        tie_break = place_module.seeded_tie_break_order  # type: ignore[attr-defined]
        assert tie_break("x") == TIE_BREAK_ARM_ORDER
    assert before == (consts.LINUCB_GAP_WEIGHT, consts.DEADLINE_PENALTY_WEIGHT)


def test_stated_band_follows_the_condition() -> None:
    assert stated_for((17, 21), "correct") == "EVENING"
    assert stated_for((6, 10), "correct") == "MORNING"
    assert stated_for((17, 21), "wrong") == "MORNING"


def test_calendar_is_weekday_only_and_stable() -> None:
    cal = build_calendar(random.Random("c"), 28)
    assert {d for d, b in cal.busy.items() if b and (d + 3) % 7 >= 5} == set()
    assert any(cal.busy.values())
    assert set(BANDS_PER_DAY_WEIGHTS) == {1, 2, 3}


def test_pick_is_label_neutral_without_a_bias() -> None:
    rng = random.Random(0)
    n = 4000
    alt = sum(
        harness.pick_alternative(0.3, 0.3, rng.gauss(0, 1), rng.gauss(0, 1), bias=0.0)
        for _ in range(n)
    )
    assert abs(alt / n - 0.5) < 0.03


def test_keep_bias_favours_the_primary() -> None:
    rng = random.Random(0)
    n = 4000
    alt = sum(
        harness.pick_alternative(0.3, 0.3, rng.gauss(0, 1), rng.gauss(0, 1))
        for _ in range(n)
    )
    assert alt / n < 0.45


def test_ceiling_and_floor_hold() -> None:
    """Oracle is at least every arm and Rand at most S, pooled over the band worlds."""
    harness.configure({"worlds": "bands"})
    arms = ("H0", "H1", "L0", "S", "Oracle", "Rand")
    parts = [harness.run_seed(s, 12, arms) for s in range(3)]
    by_world: dict[str, dict[str, list[float]]] = {}
    for p in parts:
        for world, per in p["worlds"].items():
            for arm, rows in per.items():
                by_world.setdefault(world, {}).setdefault(arm, []).extend(rows)
    for world, per in by_world.items():
        means = {a: float(np.mean(v)) for a, v in per.items()}
        for arm in ("H0", "H1", "L0", "S"):
            assert means["Oracle"] + 0.05 >= means[arm], (world, arm, means)
    pooled = {a: np.mean([np.mean(w[a]) for w in by_world.values()]) for a in arms}
    assert pooled["Rand"] < pooled["S"]


def test_heuristic_knobs_default_to_production() -> None:
    assert harness.CFG["pref_rate"] == consts.PREFERENCE_LEARNING_RATE
    assert harness.CFG["kept_weight"] == consts.PREFERENCE_KEPT_WEIGHT


def test_a_zero_rate_freezes_the_heuristic_table() -> None:
    saved = dict(harness.CFG)
    try:
        harness.configure({"pref_rate": 0.0})
        m = default_preference_matrix()
        assert (harness._kept(m, 9 * 3_600_000) == m).all()
        assert (harness._moved(m, 9 * 3_600_000, 15 * 3_600_000, 120) == m).all()
    finally:
        harness.configure(saved)


def test_the_earliest_start_arm_restores_the_ranking() -> None:
    from src.core import linucb_best_slot

    before = linucb_best_slot.np  # type: ignore[attr-defined]
    with harness._knobs(harness.ARM_SPEC["S-min"]):
        assert linucb_best_slot.np is not before  # type: ignore[attr-defined]
    assert linucb_best_slot.np is before  # type: ignore[attr-defined]
