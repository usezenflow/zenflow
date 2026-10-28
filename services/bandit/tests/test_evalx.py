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

import src.core.matrix_prior as prior_module
from evalx import run as harness
from evalx.world import (
    BANDS_PER_DAY_WEIGHTS,
    Student,
    build_calendar,
    is_weekend,
    make_tasks,
    open_chance,
)
from src.api import app
from src.core import constants as consts
from src.core.preference import default_preference_matrix
from src.place import place as run_place
from src.schemas import HOUR_ARM_IDS
from src.schemas_place import PlaceRequest

client = TestClient(app)


@pytest.fixture(autouse=True)
def _restore_cfg() -> Any:
    """A test that configures the harness never leaks into the next one."""
    saved = dict(harness.CFG)
    yield
    harness.CFG.clear()
    harness.CFG.update(saved)


BACKEND_CONSTANTS = (
    Path(__file__).parents[3] / "backend" / "src" / "scheduler" / "constants.ts"
)


def _ts_constant(name: str) -> float:
    text = BACKEND_CONSTANTS.read_text()
    match = re.search(rf"export const {name}\s*=\s*(-?[\d.]+);", text)
    assert match, f"{name} not found in constants.ts"
    return float(match.group(1))


@pytest.mark.parametrize("primary", ["HEURISTIC", "LINUCB"])
def test_harness_matches_the_http_placer(primary: str) -> None:
    tasks = make_tasks(random.Random("parity"), 4, 3)[:4]
    state: dict[str, Any] = {a: {"A": [], "b": []} for a in HOUR_ARM_IDS}
    matrix = default_preference_matrix()
    cal = build_calendar(random.Random("cal"), 4 * 7 + 10)
    for n, task in enumerate(tasks):
        body = harness.place_body(task, primary, state, matrix, n, cal)
        resp = client.post("/v1/place", json=body)
        assert resp.status_code == 200, resp.text
        http = resp.json()["result"]
        direct = run_place(PlaceRequest.model_validate(body), 0.0).model_dump(
            by_alias=True
        )["result"]
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
    assert _ts_constant("SESSION_KEPT_REWARD") == consts.KEPT_REWARD  # ADR-0042
    assert harness.CFG["move_scale"] == consts.MOVE_REWARD_SCALE_MINUTES


def test_a_seed_reruns_to_identical_output() -> None:
    harness.configure({"mode": "bands", "worlds": "bands"})
    arms = ("H", "L", "Oracle", "Rand", "AB")
    assert harness.run_seed(7, 2, arms) == harness.run_seed(7, 2, arms)


def test_identical_arms_give_identical_results() -> None:
    """A/A under common random numbers: an arm against itself differs by exactly 0."""
    harness.configure({"mode": "bands", "worlds": "bands"})
    student = harness.worlds("bands")["band_evening_17_21"]
    tasks = make_tasks(random.Random("aa"), 4, 3)
    cal = build_calendar(random.Random("cal"), 4 * 7 + 10)
    a = harness.simulate(student, tasks, "L", "drag", random.Random(1), cal)
    b = harness.simulate(student, tasks, "L", "drag", random.Random(2), cal)
    assert a == b


def test_no_arm_leaks_state_into_the_next_placement() -> None:
    before = (
        consts.LINUCB_GAP_WEIGHT,
        consts.DEADLINE_PENALTY_WEIGHT,
        prior_module.PRIOR_MATRIX,
    )
    with harness._knobs({"gap_weight": 0.0, "deadline": False, "prior": "cold"}):
        assert consts.LINUCB_GAP_WEIGHT == 0.0
        assert consts.DEADLINE_PENALTY_WEIGHT == 0.0
        assert prior_module.PRIOR_MATRIX is None
    assert before == (
        consts.LINUCB_GAP_WEIGHT,
        consts.DEADLINE_PENALTY_WEIGHT,
        prior_module.PRIOR_MATRIX,
    )


def test_the_cold_arm_has_no_prior() -> None:
    with harness._knobs(harness.ARM_SPEC["L-cold"]):
        assert prior_module.PRIOR_MATRIX is None
    assert prior_module.PRIOR_MATRIX is not None


def test_arms_share_the_broad_matrix() -> None:
    assert (harness._table() == prior_module.PRIOR_MATRIX).all()


def test_weekend_students_differ_on_weekends_only() -> None:
    s = Student(
        "w", (17, 21), 0.5, 0.0, 0.3, weekend_band=(19, 23), weekend_attention=0.2
    )
    sat = next(d for d in range(14) if is_weekend(d))
    mon = next(d for d in range(14) if not is_weekend(d))
    assert s.band_on(mon) == (17, 21) and s.band_on(sat) == (19, 23)
    assert open_chance(s, 9, mon * consts.DAY_MS) == 0.5
    assert open_chance(s, 9, sat * consts.DAY_MS) == 0.2


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
    """Oracle is at least every arm and Rand at most L, pooled over the band worlds."""
    harness.configure({"mode": "bands", "worlds": "bands"})
    arms = ("H", "L", "L-cold", "Oracle", "Rand")
    parts = [harness.run_seed(s, 12, arms) for s in range(3)]
    by_world: dict[str, dict[str, list[float]]] = {}
    for p in parts:
        for world, per in p["worlds"].items():
            for arm, rows in per.items():
                by_world.setdefault(world, {}).setdefault(arm, []).extend(
                    r[0] for r in rows
                )
    for world, per in by_world.items():
        means = {a: float(np.mean(v)) for a, v in per.items()}
        for arm in ("H", "L", "L-cold"):
            assert means["Oracle"] + 0.05 >= means[arm], (world, arm, means)
    pooled = {a: np.mean([np.mean(w[a]) for w in by_world.values()]) for a in arms}
    assert pooled["Rand"] < pooled["L"]


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


# --- Semester ------------------------------------------------------------------


def test_semester_is_deterministic_and_shaped() -> None:
    from evalx.academic_calendar import (
        ASSIGNMENT_LEAD_DAYS,
        DAYS,
        EXAMS,
        build_semester,
        season_of,
    )

    a = build_semester(random.Random("sem:1"))
    b = build_semester(random.Random("sem:1"))
    assert a.tasks == b.tasks and a.calendar == b.calendar
    exams = [t for t in a.tasks if t.kind == "EXAM"]
    assert EXAMS[0] <= len(exams) <= EXAMS[1]
    assert all(t.kind in ("EXAM", "ASSIGNMENT") for t in a.tasks)
    assert [t.arrival_ms for t in a.tasks] == sorted(t.arrival_ms for t in a.tasks)
    for t in a.tasks:
        assert 0 <= t.arrival_ms < t.deadline_ms <= DAYS * consts.DAY_MS
        if t.kind == "ASSIGNMENT":
            lead = (t.deadline_ms - t.arrival_ms) / consts.DAY_MS
            assert lead <= ASSIGNMENT_LEAD_DAYS[1]
        else:
            assert season_of((t.deadline_ms - 1) // consts.DAY_MS) != "regular"


def test_semester_prep_matches_production_sizing() -> None:
    from evalx.academic_calendar import build_semester
    from src.core.prep_sizing import prep_lead_days, prep_minutes

    sem = build_semester(random.Random("sem:2"), weak=1.0)
    for t in sem.tasks:
        assert t.duration_min == prep_minutes(t.kind, 1.0)  # type: ignore[arg-type]
        lead = (t.deadline_ms - t.arrival_ms) / consts.DAY_MS
        assert lead <= prep_lead_days(t.kind, 1.0)  # type: ignore[arg-type]


def test_semester_lectures_follow_the_season() -> None:
    from evalx.academic_calendar import DAYS, build_semester, season_of

    cal = build_semester(random.Random("sem:3")).calendar
    assert all(
        not cal.lecture_blocks(d) for d in range(DAYS) if season_of(d) == "final"
    )
    assert all(
        end <= 11 * 60 + 15
        for d in range(DAYS)
        if season_of(d) == "midterm"
        for _, end in cal.lecture_blocks(d)
    )


# --- Passive student -----------------------------------------------------------


def _passive(**kw: Any) -> Any:
    from evalx.student_behavior import PassiveStudent

    base: dict[str, Any] = {
        "name": "t",
        "chronotype": "evening",
        "peak_h": 20.0,
        "attention": 0.5,
        "imminence": 0.0,
        "respond": 0.5,
    }
    return PassiveStudent(**{**base, **kw})


def test_passive_start_chance_follows_the_clock() -> None:
    from evalx.world import Calendar

    s, cal = _passive(), Calendar({})
    t = make_tasks(random.Random(1), 1, 1)[0]
    day = 10 * consts.DAY_MS
    evening = s.done_chance(t, day + 20 * 3_600_000, cal)
    morning = s.done_chance(t, day + 9 * 3_600_000, cal)
    night = s.done_chance(t, day + 3 * 3_600_000, cal)
    assert evening > morning > night
    assert night <= 0.1 * s.attention


def test_passive_fatigue_lowers_the_chance_after_lectures() -> None:
    from evalx.student_behavior import fatigue
    from evalx.world import Calendar

    cal = Calendar({10: [(8 * 60, 13 * 60)]})
    start = 10 * consts.DAY_MS + 13 * 3_600_000
    assert fatigue(Calendar({}), start) == 1.0
    assert fatigue(cal, start) == 0.5


def test_passive_zero_drag_never_moves() -> None:
    from evalx.world import Calendar

    s = _passive(drag=0.0)
    for i, t in enumerate(make_tasks(random.Random(2), 4, 3)):
        start = t.arrival_ms + (i % 24) * 3_600_000
        _, signal, applied, _ = s.react(t, start, Calendar({}))
        assert signal in (None, "KEPT") and applied == start


def test_passive_population_is_seeded_and_mixed() -> None:
    from evalx.student_behavior import sample_student

    a = [sample_student(random.Random(f"s:{i}"), i) for i in range(200)]
    b = [sample_student(random.Random(f"s:{i}"), i) for i in range(200)]
    assert a == b
    assert {s.chronotype for s in a} == {"lark", "day", "evening", "owl"}
    ignorers = sum(s.respond == 0 for s in a) / len(a)
    assert 0.15 < ignorers < 0.45
    assert all(0.4 <= s.respond <= 0.7 for s in a if s.respond)


def test_passive_oracle_beats_a_fixed_slot() -> None:
    from evalx.world import Calendar

    s, cal = _passive(), Calendar({})
    t = make_tasks(random.Random(3), 1, 1)[0]
    best = s.oracle_start(t, cal)
    assert best is not None
    worst = t.arrival_ms - (t.arrival_ms % consts.DAY_MS) + 3 * 3_600_000
    assert s.done_chance(t, best, cal) > s.done_chance(t, worst, cal)


# --- Semester arms -------------------------------------------------------------


def _semester_run(seed: int = 0, students: int = 6) -> Any:
    from evalx import semester

    harness.configure({"mode": "semester", "drag": 0.0})
    return semester.run_seed(seed, students, semester.SEMESTER_ARMS)


def test_semester_seed_is_deterministic() -> None:
    assert _semester_run(1, 3) == _semester_run(1, 3)


def test_semester_placed_blocks_never_clash() -> None:
    from evalx import semester

    sem = __import__("evalx.academic_calendar", fromlist=["x"]).build_semester(
        random.Random("clash")
    )
    s = __import__("evalx.student_behavior", fromlist=["x"]).sample_student(
        random.Random("clash"), 0
    )
    for arm in ("H", "L", "Fixed", "Oracle"):
        rows = semester.simulate_arm(s, sem, arm, random.Random(0))
        flags = [r["c"] for r in rows if r["c"] is not None]
        assert flags and all(f == 1.0 for f in flags), arm


def test_semester_fixed_prefers_seven_pm_the_day_before() -> None:
    from evalx import semester
    from evalx.world import Calendar

    t = make_tasks(random.Random(4), 1, 1)[0]
    t = task_with(t, arrival=0, deadline=5 * consts.DAY_MS)
    start = semester.fixed_start(t, Calendar({}), {})
    assert start == 3 * consts.DAY_MS + 19 * 3_600_000
    busy = Calendar({3: [(18 * 60, 20 * 60)]})
    later = semester.fixed_start(t, busy, {})
    assert later is not None and later < start
    assert semester._clear(later, t.duration_min, busy, {})


def task_with(task: Any, arrival: int, deadline: int) -> Any:
    from dataclasses import replace

    return replace(task, arrival_ms=arrival, deadline_ms=deadline)


def test_semester_zero_drag_has_no_moves_and_ab_taps_only_offers() -> None:
    part = _semester_run()
    for st in part["students"]:
        for arm, rows in st["arms"].items():
            assert all(not r.get("mov") for r in rows), arm
        for r in st["arms"]["AB"]:
            assert not r.get("tap") or r.get("off")


def test_semester_oracle_is_the_ceiling_and_rand_the_floor() -> None:
    from evalx import semester

    part = _semester_run(0, 10)
    res = semester.merge([part], semester.SEMESTER_ARMS, {})
    a = {k: v["done_rate"]["mean"] for k, v in res["arms"].items()}
    assert a["Oracle"] > a["L"] > a["Rand"]
    assert a["Oracle"] > a["H"] > a["Rand"]
    assert set(res["regret"]) == set(semester.SEMESTER_ARMS) - {"Oracle"}


def test_arm_names_set_reach_weight_and_restore_defaults() -> None:
    import src.core.slot_score as slot_score
    from evalx import semester

    spec = semester.parse_arm("H:72:0.1:hr")
    assert spec == {
        "policy": "HEURISTIC",
        "deadline_weight": 0.1,
        "per_hour": True,
        "heuristic_horizon": 72.0,
    }
    assert semester.parse_arm("L:24:0.2")["deadline_horizon"] == 24.0
    before = slot_score.deadline_penalty_scores.__defaults__
    weight = consts.DEADLINE_PENALTY_WEIGHT
    with harness._knobs(spec):
        assert slot_score.deadline_penalty_scores.__defaults__ == (72.0,)
        assert consts.DEADLINE_PENALTY_WEIGHT == 0.1
    assert slot_score.deadline_penalty_scores.__defaults__ == before
    assert weight == consts.DEADLINE_PENALTY_WEIGHT


# --- Reality knobs -------------------------------------------------------------


def _reset_reality() -> None:
    harness.configure(
        {
            "timing": 1.0,
            "detect": 1.0,
            "false_start": 0.0,
            "delay": 0,
            "tap_scale": 1.0,
            "drift": None,
            "discount": 1.0,
        }
    )


def test_timing_flattens_the_hour_and_defaults_to_the_headline() -> None:
    s = _passive()
    day = 10 * consts.DAY_MS
    hours = [day + h * 3_600_000 for h in (9, 14, 20)]
    assert s.fit(hours[2]) == _passive(timing=1.0).fit(hours[2])
    flat = _passive(timing=0.0)
    assert len({flat.fit(t) for t in hours}) == 1  # the hour no longer matters
    half = _passive(timing=0.5)
    assert s.fit(hours[0]) < half.fit(hours[0]) < flat.fit(hours[0])  # off peak rises
    assert s.fit(hours[2]) > half.fit(hours[2]) > flat.fit(hours[2])  # peak falls
    assert half.fit(day + 3 * 3_600_000) <= 0.1  # quiet hours stay quiet


def test_drift_moves_the_peak_from_its_day_only() -> None:
    from evalx.student_behavior import sample_shifts

    s = _passive(shifts=((20, 3.0),))
    assert s.peak_on(19) == s.peak_h and s.peak_on(20) == s.peak_h + 3.0
    day = 25 * consts.DAY_MS
    late = day + int((s.peak_h + 3.0) * 3_600_000)
    assert s.fit(late) > _passive().fit(late)
    a = sample_shifts(random.Random(1), "walk", 1.0)
    assert a == sample_shifts(random.Random(1), "walk", 1.0) and len(a) > 3
    assert len(sample_shifts(random.Random(1), "step", 3.0)) == 1
    assert sample_shifts(random.Random(1), "walk", 0.0) == ()


def test_feedback_gates_delays_and_defaults_to_passthrough() -> None:
    from evalx.semester import Feedback

    try:
        feed = Feedback([(0.5, 0.5)])
        assert feed.seen(0, "KEPT") == "KEPT" and feed.seen(0, None) is None
        harness.configure({"detect": 0.4})
        assert feed.seen(0, "KEPT") is None
        harness.configure({"detect": 1.0, "false_start": 0.6})
        assert feed.seen(0, "MOVE") == "MOVE"
        harness.configure({"false_start": 0.0, "delay": 2})
        hits: list[int] = []
        feed.defer(0, lambda: hits.append(0))
        feed.flush(1)
        assert hits == []
        feed.flush(2)
        assert hits == [0]
    finally:
        _reset_reality()


def test_forget_shrinks_every_warm_arm_and_skips_cold_ones() -> None:
    d = 3
    a = (2 * np.eye(d) + np.outer([1, 0, 0], [1, 0, 0])).reshape(-1).tolist()
    state: dict[str, Any] = {arm: {"A": [], "b": []} for arm in HOUR_ARM_IDS}
    state["HOUR_08"] = {"A": a, "b": [1.0, 0.0, 0.0]}
    harness.configure({"ridge": 1.0})
    harness._forget(state, 0.5)
    ridge = harness.CFG["ridge"]
    new_a = np.asarray(state["HOUR_08"]["A"]).reshape(d, d)
    # the evidence shrinks toward the ridge by gamma
    assert new_a[0, 0] == pytest.approx(ridge + 0.5 * (3 - ridge))
    assert new_a[1, 1] == pytest.approx(ridge + 0.5 * (2 - ridge))
    assert state["HOUR_08"]["b"] == pytest.approx([0.5, 0.0, 0.0])
    assert state["HOUR_09"] == {"A": [], "b": []}


def test_reality_defaults_reproduce_the_headline_run() -> None:
    _reset_reality()
    base = _semester_run(3, 3)
    harness.configure({"detect": 1.0, "delay": 0, "timing": 1.0, "drift": None})
    assert _semester_run(3, 3) == base


def test_a_blind_learner_does_not_move_a_cold_l() -> None:
    from evalx import semester

    try:
        harness.configure({"mode": "semester", "detect": 0.0})
        blind = semester.run_seed(5, 4, ("L-cold",))
        harness.configure({"detect": 1.0})
        sees = semester.run_seed(5, 4, ("L-cold",))
    finally:
        _reset_reality()
    assert blind != sees


def test_second_peak_and_weekday_shapes_differ_from_one_bump() -> None:
    day = 10 * consts.DAY_MS
    one = _passive()
    two = _passive(second_offset_h=10.0)
    far = day + int(((one.peak_h + 10.0) % 24) * 3_600_000)
    assert two.fit(far) > one.fit(far)
    assert two.fit(day + int(one.peak_h * 3_600_000)) == one.fit(
        day + int(one.peak_h * 3_600_000)
    )
    shifted = _passive(weekday_shift=(2.0, 0, 0, 0, 0, 0, 0))
    monday = next(d for d in range(10, 20) if (d + 3) % 7 == 0)
    at = monday * consts.DAY_MS + int(one.peak_h * 3_600_000)
    assert shifted.fit(at) < one.fit(at)


def test_chronotype_mix_changes_only_the_chronotype() -> None:
    from evalx.student_behavior import sample_student

    a = sample_student(random.Random("m:1"), 1, "shipped")
    b = sample_student(random.Random("m:1"), 1, "owl heavy")
    assert (a.attention, a.imminence, a.respond) == (
        b.attention,
        b.imminence,
        b.respond,
    )
    owls = [
        sample_student(random.Random(f"m:{i}"), i, "owl heavy").chronotype
        for i in range(300)
    ]
    assert owls.count("owl") > 90


def test_asap_places_the_earliest_free_start_inside_waking_hours() -> None:
    from evalx.semester import asap_start
    from evalx.world import Calendar

    t = make_tasks(random.Random(4), 1, 1)[0]
    cal = Calendar({})
    got = asap_start(t, cal, {})
    assert got is not None and got >= t.arrival_ms
    assert (got % consts.DAY_MS) // 60_000 >= 6 * 60
    end = got + t.duration_min * 60_000
    assert end <= t.deadline_ms and (end % consts.DAY_MS) // 60_000 <= 23 * 60
    day = got // consts.DAY_MS
    blocked = {day: [(0, (got % consts.DAY_MS) // 60_000 + 15)]}
    later = asap_start(t, Calendar(blocked), {})
    assert later is not None and later > got


def test_frozen_h_never_changes_its_table_and_flat_l_sees_only_the_bias() -> None:
    from evalx import semester

    try:
        harness.configure({"mode": "semester"})
        run = semester.run_seed(2, 3, ("H", "H-frozen", "L", "L-flat", "ASAP"))
    finally:
        _reset_reality()
    arms = run["students"][0]["arms"]
    assert arms["H-frozen"] != arms["H"] and arms["L-flat"] != arms["L"]
    assert all(r["c"] in (None, 1.0) for r in arms["ASAP"])
    x = harness._bias_only()
    assert x[-1] == 1.0 and not x[:-1].any() and len(x) == consts.FEATURE_DIM


def test_knobs_restore_the_context_builder() -> None:
    import src.place as place_module

    before = place_module.build_context_vector
    with harness._knobs({"policy": "LINUCB", "context": "none"}):
        assert place_module.build_context_vector is harness._bias_only
    assert place_module.build_context_vector is before


def test_groups_cover_every_student_once_per_axis() -> None:
    from evalx import semester

    try:
        harness.configure({"mode": "semester"})
        part = semester.run_seed(1, 12, ("H", "L"))
        res = semester.merge([part], ("H", "L"), {"weeks": 15})
    finally:
        _reset_reality()
    g = res["groups"]
    assert sum(g[c]["n"] for c in ("lark", "day", "evening", "owl")) == 12
    assert sum(g[k]["n"] for k in g if k.endswith("attention")) == 12
    assert g["never answers offers"]["n"] + g["answers offers"]["n"] == 12
    c = res["contrasts"]["L_minus_H"]
    assert {"rel_lift", "share_better", "share_worse"} <= set(c)
