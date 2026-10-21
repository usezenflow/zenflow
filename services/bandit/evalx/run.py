"""Offline eval: does LinUCB beat the heuristic for simulated students?

The production placer and the production update run in-process (``tests/test_evalx.py``
pins the placer to ``/v1/place``). Every student gets the same tasks and random
draws under every arm (common random numbers), so arms differ only by placement.
Rewards follow ADR-0035: START +1, MOVE negative by drag, pairwise pick of
LinUCB's option +0.5, kept heuristic option over LinUCB's -0.2, no LAPSED.

Arms (``ARM_SPEC``)
  H0          heuristic, default preference map (a student who skipped onboarding)
  H1          heuristic, map seeded from the stated band. The fair control for S:
              it gets the same input as LinUCB's prior
  L0          LinUCB cold, no band
  S           LinUCB with the stated-band prior, as shipped
  S-gap       S with gap quality off
  S-deadline  S with the deadline term off
  S-tiebreak  S with the fixed tie order instead of the seeded one
  Oracle      the best in-band slot in the window (ceiling)
  Rand        a random day and hour in the task's window (floor)
  AB          the live protocol: 50/50 primary per event, both slots computed, a
              pairwise offer, the student may tap (see ``simulate_ab``)

S - L0 is the value of the band prior. S - S-gap, S - S-deadline and S - S-tiebreak
are the value of the other components. S - H1 is the headline.

Run:  uv run python -m evalx run --seeds 30 --students 20 --workers 8
Tuning seeds are 100 and up (``--seed-offset 100``); the held-out run uses 0 to 29.
Writes evalx/out/results.json and report.md.
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import platform
import random
import subprocess
import sys
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from dataclasses import replace
from pathlib import Path
from typing import Any

os.environ.setdefault("OTEL_SDK_DISABLED", "true")
os.environ.setdefault("LOG_LEVEL", "WARNING")  # the placer logs every request

import numpy as np  # noqa: E402

import src.core.linucb_best_slot as best_slot_module  # noqa: E402
import src.place as place_module  # noqa: E402
from evalx.world import (  # noqa: E402
    ARCHETYPES,
    HEADLINE_MIX,
    HOUR_MS,
    MIXES,
    Calendar,
    Student,
    Task,
    build_calendar,
    busy_minutes,
    day_str,
    feasible_start,
    in_band,
    make_tasks,
    open_chance,
    stated_for,
    stated_hours,
    style_of,
)
from src.api import update_arm  # noqa: E402
from src.core import constants as consts  # noqa: E402
from src.core.arms import TIE_BREAK_ARM_ORDER  # noqa: E402
from src.core.band_prior import FocusBand  # noqa: E402
from src.core.constants import (  # noqa: E402
    DAY_MS,
    MS_PER_MINUTE,
    PREFERENCE_KEPT_WEIGHT,
)
from src.core.preference import (  # noqa: E402
    default_preference_matrix,
    matrix_index,
    reinforce_preference_cell,
    reinforce_preference_move,
)
from src.core.reward import drag_distance_reward  # noqa: E402
from src.place import place as run_place  # noqa: E402
from src.schemas import ARM_IDS, UpdateRequest  # noqa: E402
from src.schemas_place import PLACEMENT_CONTRACT_VERSION, PlaceRequest  # noqa: E402

ALPHA = 0.15  # BANDIT_ALPHA, backend/src/scheduler/constants.ts
RIDGE = 1.0  # BANDIT_RIDGE
START_REWARD = 1.0  # a START
PAIRWISE_WIN_REWARD = 0.5  # backend/src/scheduler/constants.ts
PAIRWISE_LOSS_REWARD = -0.2
MIN_ALTERNATIVE_GAP_MINUTES = 60  # an offer needs two starts at least this far apart
PICK_SIGMA = 0.3  # assumed: noise in how a student perceives an option
KEEP_BIAS = 0.15  # assumed: pull toward the applied (primary) option
DELTA = 0.5  # non-inferiority margin, starts per student over the period
BOOTSTRAP = 2000
WEEKS = 4
TASKS_PER_WEEK = 3
ZERO_WORKLOAD: dict[str, dict[str, float]] = {
    t: {"hours": 0, "count": 0}
    for t in ("LECTURE", "ASSIGNMENT", "EXAM", "TASK", "DND")
}

ARM_SPEC: dict[str, dict[str, Any]] = {
    "H0": {"policy": "HEURISTIC", "band": False},
    "H1": {"policy": "HEURISTIC", "band": True},
    "L0": {"policy": "LINUCB", "band": False},
    "S": {"policy": "LINUCB", "band": True},
    "H1-deadline": {"policy": "HEURISTIC", "band": True, "deadline": False},
    "S-gap": {"policy": "LINUCB", "band": True, "gap": False},
    "S-deadline": {"policy": "LINUCB", "band": True, "deadline": False},
    "S-tiebreak": {"policy": "LINUCB", "band": True, "tiebreak": False},
    "S-plain": {"policy": "LINUCB", "band": True, "gap": False, "deadline": False},
    "S-min": {
        "policy": "LINUCB",
        "band": True,
        "gap": False,
        "deadline": False,
        "earliest": True,
    },
    "Oracle": {"policy": "ORACLE", "band": False},
    "Rand": {"policy": "RAND", "band": False},
}
START_ARMS = tuple(ARM_SPEC)
ARMS = (*START_ARMS, "AB")

# Per-process tunables for sweeps. ``None`` keeps the production constant.
CFG: dict[str, Any] = {
    "alpha": ALPHA,
    "ridge": RIDGE,
    "move_scale": float(consts.MOVE_REWARD_SCALE_MINUTES),
    "gap_weight": None,
    "deadline_weight": None,
    "mix": HEADLINE_MIX,
    "worlds": "all",  # "all" or "bands"
    # The heuristic's own knobs: table learning rate, weight of a kept slot, and the
    # table value outside the stated band for H1.
    "pref_rate": consts.PREFERENCE_LEARNING_RATE,
    "kept_weight": PREFERENCE_KEPT_WEIGHT,
    "outside": 0.2,
}
_PRODUCTION = {
    "gap": consts.LINUCB_GAP_WEIGHT,
    "deadline": consts.DEADLINE_PENALTY_WEIGHT,
}


def configure(cfg: dict[str, Any]) -> None:
    """Set this process's sweep config. Read at each placement, never global."""
    CFG.update(cfg)


class _EarliestOnly:
    """numpy for ``linucb_best_slot`` with a ``lexsort`` that ranks by score, then by
    the earlier start, skipping the band order and the distance from the band centre."""

    def __getattr__(self, name: str) -> Any:
        return getattr(np, name)

    @staticmethod
    def lexsort(keys: Any, *args: Any, **kwargs: Any) -> Any:
        return np.lexsort((keys[0], keys[-1]), *args, **kwargs)


@contextmanager
def _knobs(spec: dict[str, Any]) -> Iterator[None]:
    """Apply one arm's gap, deadline and tie-break settings around its placements."""
    gap = CFG["gap_weight"] if CFG["gap_weight"] is not None else _PRODUCTION["gap"]
    deadline = (
        CFG["deadline_weight"]
        if CFG["deadline_weight"] is not None
        else _PRODUCTION["deadline"]
    )
    saved_np = best_slot_module.np  # type: ignore[attr-defined]
    if spec.get("earliest"):
        best_slot_module.np = _EarliestOnly()  # type: ignore[attr-defined]
    saved = (
        consts.LINUCB_GAP_WEIGHT,
        consts.DEADLINE_PENALTY_WEIGHT,
        place_module.seeded_tie_break_order,  # type: ignore[attr-defined]
    )
    consts.LINUCB_GAP_WEIGHT = gap if spec.get("gap", True) else 0.0
    consts.DEADLINE_PENALTY_WEIGHT = deadline if spec.get("deadline", True) else 0.0
    if not spec.get("tiebreak", True):
        place_module.seeded_tie_break_order = lambda seed: TIE_BREAK_ARM_ORDER  # type: ignore[attr-defined]
    try:
        yield
    finally:
        best_slot_module.np = saved_np  # type: ignore[attr-defined]
        (
            consts.LINUCB_GAP_WEIGHT,
            consts.DEADLINE_PENALTY_WEIGHT,
            place_module.seeded_tie_break_order,  # type: ignore[attr-defined]
        ) = saved


# --- Worlds -------------------------------------------------------------------

BANDS = {
    "day_9_17": (9, 17),  # the default map's band, so H0 starts near its ceiling
    "morning_6_10": (6, 10),
    "afternoon_13_17": (13, 17),
    "evening_17_21": (17, 21),
    "night_21_24": (21, 24),
}


def worlds(kind: str = "all") -> dict[str, Student]:
    """Band grid with a correct and a wrong stated band, then the other checks.

    ``bands`` is the band grid alone. ``all`` adds an attention sweep, an absent
    student and a routine change, each with a correct stated band.
    """
    grid: dict[str, Student] = {}
    for name, band in BANDS.items():
        for cond in ("correct", "wrong"):
            grid[f"band_{name}/{cond}"] = Student(
                name, band, 0.5, 0.5, 0.3, stated=stated_for(band, cond)
            )
    if kind == "bands":
        return grid
    evening = stated_for((17, 21), "correct")
    for level in (0.05, 0.15, 0.3, 0.6, 0.9):
        grid[f"attention_{level}_evening/correct"] = Student(
            "evening", (17, 21), level, 0.5, 0.3, stated=evening
        )
    grid["absent_evening/correct"] = replace(
        ARCHETYPES["absent"].with_attention(0.02), band=(17, 21), stated=evening
    )
    # Routine changes after two weeks, evening to morning; the stated band goes stale.
    grid["shift_evening_to_morning/stale"] = Student(
        "shift",
        (17, 21),
        0.5,
        0.5,
        0.3,
        shift_at_ms=14 * DAY_MS,
        band_after=(6, 10),
        stated=evening,
    )
    return grid


# --- Placement ----------------------------------------------------------------


def _days(first_ms: int, last_ms: int, cal: Calendar) -> list[dict[str, Any]]:
    out = []
    ms = first_ms
    while ms <= last_ms:
        busy = busy_minutes(cal, ms)
        workload = {**ZERO_WORKLOAD}
        workload["LECTURE"] = {
            "hours": sum(b - a for a, b in busy) / 60,
            "count": len(busy),
        }
        out.append(
            {
                "dayStr": day_str(ms),
                "dayStartMs": ms,
                "dayEndMs": ms + DAY_MS,
                "occupied": [
                    {"startMs": ms + a * MS_PER_MINUTE, "endMs": ms + b * MS_PER_MINUTE}
                    for a, b in busy
                ],
                "workloadByType": workload,
            }
        )
        ms += DAY_MS
    return out


def place_body(
    task: Task,
    primary: str,
    state: dict[str, Any],
    matrix: Any,
    n: int,
    band: FocusBand | None,
    cal: Calendar,
    both: bool = False,
) -> dict[str, Any]:
    """The ``/v1/place`` request the harness sends for one task."""
    first = (task.arrival_ms // DAY_MS) * DAY_MS
    last = ((task.deadline_ms - 1) // DAY_MS) * DAY_MS
    user: dict[str, Any] = {"preferenceMatrix": matrix.tolist(), "observationCount": n}
    if band is not None:
        user["focusBand"] = band
    body: dict[str, Any] = {
        "contractVersion": PLACEMENT_CONTRACT_VERSION,
        "requestId": f"eval-{n}",
        "mode": "PLACE",
        "nowMs": task.arrival_ms,
        "timezone": "UTC",
        "deadlineMs": task.deadline_ms,
        "maxScanDays": 30,
        "members": [
            {
                "id": "t",
                "durationMinutes": task.duration_min,
                "primaryPolicy": primary,
                "computeBoth": both,
            }
        ],
        "fixedOccupied": [],
        "days": _days(first, last, cal),
        "user": user,
    }
    if primary == "LINUCB" or both:
        body["bandit"] = {"alpha": CFG["alpha"], "ridge": CFG["ridge"], "state": state}
    return body


def _place(
    task: Task,
    primary: str,
    state: dict[str, Any],
    matrix: Any,
    n: int,
    band: FocusBand | None,
    cal: Calendar,
    both: bool = False,
) -> dict[str, Any] | None:
    """One placement through the production placer, in-process."""
    body = place_body(task, primary, state, matrix, n, band, cal, both)
    res = run_place(PlaceRequest.model_validate(body), 0.0).model_dump(by_alias=True)
    r = res["results"][0]
    return r if r["outcome"] == "PLACED" else None


def _kept(matrix: Any, start: int) -> Any:
    """The heuristic's table after the student keeps or starts a slot."""
    return reinforce_preference_cell(
        matrix, start, "UTC", CFG["kept_weight"], CFG["pref_rate"]
    )


def _moved(matrix: Any, old: int, new: int, drag: float) -> Any:
    """The heuristic's table after the student moves a slot."""
    return reinforce_preference_move(matrix, old, new, "UTC", drag, CFG["pref_rate"])


def _band_map(band: FocusBand) -> Any:
    """Heuristic map seeded from a stated band: 1.0 inside it, 0.2 outside."""
    m = default_preference_matrix() * 0.0
    inside = set(stated_hours(band))
    for wd in range(1, 8):
        for h in range(24):
            m[matrix_index(wd, h)] = 1.0 if h in inside else CFG["outside"]
    return m


def _learn(
    state: dict[str, Any],
    arm_id: str,
    x: list[float],
    reward: float,
    band: FocusBand | None,
) -> None:
    upd = update_arm(
        UpdateRequest.model_validate(
            {
                "ridge": CFG["ridge"],
                "arm": arm_id,
                "x": x,
                "reward": reward,
                "state": state[arm_id],
                "focus_band": band,
            }
        )
    )
    state[arm_id] = {"A": upd.A, "b": upd.b}


# --- Student reaction ----------------------------------------------------------


def react(
    s: Student, task: Task, start: int, style: str, cal: Calendar
) -> tuple[bool, str | None, float | None, int]:
    """(done, signal, reward, new_start) for a block at ``start``.

    START inside the band when the student opens the app. Outside it only a
    ``drag`` style student moves the block, to the free start nearest the band
    centre (a MOVE); with none free, it stays.
    """
    midnight = (start // DAY_MS) * DAY_MS
    p = open_chance(s, (task.deadline_ms - start) / DAY_MS)
    if in_band(s, start, midnight):
        if task.u_open < p:
            return True, "START", START_REWARD, start
        return False, None, None, start  # ignored: no signal
    if style == "drag" and task.u_drag < s.drag:
        minute = feasible_start(s.band, busy_minutes(cal, midnight), task.duration_min)
        if minute is None:
            return False, None, None, start
        moved = midnight + minute * MS_PER_MINUTE
        drag = abs(moved - start) / MS_PER_MINUTE
        return (
            task.u_open < p,
            "MOVE",
            drag_distance_reward(drag, CFG["move_scale"]),
            moved,
        )
    return False, None, None, start


def utility(s: Student, start: int) -> float:
    """How good a start looks to the student: 1 in their band, falling outside it."""
    h = (start % DAY_MS) / HOUR_MS
    lo, hi = s.band
    if lo <= h < hi:
        return 1.0
    return -min(1.0, min(abs(h - lo), abs(h - hi)) / 6)


def pick_alternative(
    u_primary: float,
    u_alt: float,
    eps_primary: float,
    eps_alt: float,
    bias: float = KEEP_BIAS,
    sigma: float = PICK_SIGMA,
) -> bool:
    """Whether a student who tapped the offer takes the alternative."""
    return u_alt + sigma * eps_alt > u_primary + bias + sigma * eps_primary


def oracle_start(s: Student, task: Task, cal: Calendar) -> int | None:
    """The free in-band slot with the best chance of a start, inside the window.

    Ties go to the earliest day. This is the ceiling for the reaction model.
    """
    best: tuple[float, int] | None = None
    for d in range(task.arrival_ms // DAY_MS, (task.deadline_ms - 1) // DAY_MS + 1):
        busy = cal.busy.get(d, [])
        lo, hi = s.band
        for m in range(lo * 60, hi * 60 - task.duration_min + 1, 15):
            start = d * DAY_MS + m * MS_PER_MINUTE
            end = start + task.duration_min * MS_PER_MINUTE
            if start < task.arrival_ms or end > task.deadline_ms:
                continue
            if any(m < be and m + task.duration_min > bs for bs, be in busy):
                continue
            if 2 * 60 <= m % 1440 < 6 * 60:
                continue
            p = open_chance(s, (task.deadline_ms - start) / DAY_MS)
            if best is None or p > best[0] + 1e-12:
                best = (p, start)
    return best[1] if best else None


# --- One student ---------------------------------------------------------------


def simulate(
    s: Student,
    tasks: list[Task],
    arm: str,
    style: str,
    rng: random.Random,
    cal: Calendar,
) -> dict[str, Any]:
    """One student through one single-policy arm."""
    spec = ARM_SPEC[arm]
    band = s.stated if spec["band"] else None
    policy = spec["policy"]
    state: dict[str, dict[str, list[float]]] = {a: {"A": [], "b": []} for a in ARM_IDS}
    matrix = (
        _band_map(band)
        if policy == "HEURISTIC" and band
        else default_preference_matrix()
    )
    done = starts = moves = placed = 0
    for n, task in enumerate(tasks):
        st = s.at(task.arrival_ms)
        lin = None
        if policy in ("HEURISTIC", "LINUCB"):
            with _knobs(spec):
                res = _place(task, policy, state, matrix, n, band, cal)
            if res is None:
                continue
            lin = res.get("linucb") if res.get("appliedPolicy") == "LINUCB" else None
            start = lin["startMs"] if lin else res["startMs"]
        elif policy == "ORACLE":
            oracle = oracle_start(st, task, cal)
            if oracle is None:
                continue
            start = oracle
        else:  # RAND: a day in the window, a start hour between 08:00 and 22:00
            days = max(1, (task.deadline_ms - task.arrival_ms) // DAY_MS)
            midnight = (task.arrival_ms // DAY_MS) * DAY_MS
            start = midnight + rng.randrange(int(days)) * DAY_MS
            start += rng.randrange(8, 22) * HOUR_MS
        placed += 1
        ok, signal, reward, new_start = react(st, task, start, style, cal)
        done += ok
        if signal == "START":
            starts += 1
            matrix = _kept(matrix, start)
        elif signal == "MOVE":
            moves += 1
            drag = abs(new_start - start) / MS_PER_MINUTE
            matrix = _moved(matrix, start, new_start, drag)
        if lin and reward is not None:
            _learn(state, lin["selectedArm"], lin["featureVector"], reward, band)
    return {"done": done, "starts": starts, "moves": moves, "placed": placed}


def simulate_ab(
    s: Student, tasks: list[Task], style: str, cal: Calendar
) -> dict[str, int]:
    """One student under the live protocol.

    Each event: a seeded 50/50 primary, both policies' slots computed, an offer when
    they are at least ``MIN_ALTERNATIVE_GAP_MINUTES`` apart. Only a ``tap`` style
    student who sees it responds; closing the offer keeps the primary. Learning
    follows ``slot-pick.service.ts`` and ``scheduling-feedback.service.ts``:
      alternative is LinUCB's           +0.5 to LinUCB's arm
      primary LinUCB kept               +0.5
      primary heuristic kept            -0.2, and the kept cell is reinforced
      heuristic taken over LinUCB       the MOVE reward by distance
    A START or MOVE on the applied slot rewards LinUCB only when that slot is LinUCB's.
    """
    band = s.stated
    state: dict[str, dict[str, list[float]]] = {a: {"A": [], "b": []} for a in ARM_IDS}
    matrix = _band_map(band) if band else default_preference_matrix()
    out = {
        k: 0
        for k in (
            "events",
            "offered",
            "tapped",
            "picked_linucb",
            "done",
            "events_linucb",
            "done_linucb",
            "events_heuristic",
            "done_heuristic",
            "infeasible",
        )
    }
    for n, task in enumerate(tasks):
        st = s.at(task.arrival_ms)
        primary = "LINUCB" if task.u_coin < 0.5 else "HEURISTIC"
        res = _place(task, primary, state, matrix, n, band, cal, both=True)
        if res is None or not res.get("linucb") or not res.get("heuristic"):
            out["infeasible"] += 1
            continue
        lin, heu = res["linucb"], res["heuristic"]
        ls, hs = lin["startMs"], heu["startMs"]
        prim, alt = (ls, hs) if primary == "LINUCB" else (hs, ls)
        alt_policy = "HEURISTIC" if primary == "LINUCB" else "LINUCB"
        offered = abs(hs - ls) >= MIN_ALTERNATIVE_GAP_MINUTES * MS_PER_MINUTE
        p_see = open_chance(st, (task.deadline_ms - prim) / DAY_MS)
        tapped = offered and style == "tap" and task.u_see < p_see
        applied, applied_policy = prim, primary
        x, arm_id = lin["featureVector"], lin["selectedArm"]
        if tapped:
            if pick_alternative(
                utility(st, prim), utility(st, alt), task.eps_primary, task.eps_alt
            ):
                applied, applied_policy = alt, alt_policy
            if applied_policy == "LINUCB":
                _learn(state, arm_id, x, PAIRWISE_WIN_REWARD, band)
            elif primary == "HEURISTIC":
                _learn(state, arm_id, x, PAIRWISE_LOSS_REWARD, band)
                matrix = _kept(matrix, applied)
            else:
                drag = abs(hs - ls) / MS_PER_MINUTE
                _learn(
                    state,
                    arm_id,
                    x,
                    drag_distance_reward(drag, CFG["move_scale"]),
                    band,
                )
                matrix = _moved(matrix, ls, hs, drag)
        ok, signal, reward, new_start = react(st, task, applied, style, cal)
        if signal == "START":
            matrix = _kept(matrix, applied)
        elif signal == "MOVE":
            drag = abs(new_start - applied) / MS_PER_MINUTE
            matrix = _moved(matrix, applied, new_start, drag)
        if signal and applied_policy == "LINUCB" and reward is not None:
            _learn(state, arm_id, x, reward, band)
        out["events"] += 1
        out["offered"] += offered
        out["tapped"] += tapped
        out["picked_linucb"] += tapped and applied_policy == "LINUCB"
        out["done"] += ok
        key = primary.lower()
        out[f"events_{key}"] += 1
        out[f"done_{key}"] += ok
    return out


def run_seed(seed: int, students: int, arms: tuple[str, ...]) -> dict[str, Any]:
    """Every world and student, every arm, for one seed.

    Every draw depends only on the seed, student index and arm, so a rerun
    reproduces the part byte for byte.
    """
    out: dict[str, Any] = {"seed": seed, "worlds": {}}
    for name, student in worlds(CFG["worlds"]).items():
        per: dict[str, list[Any]] = {a: [] for a in arms}
        for idx in range(students):
            tasks = make_tasks(
                random.Random(f"tasks:{seed}:{idx}"), WEEKS, TASKS_PER_WEEK
            )
            style = style_of(CFG["mix"], random.Random(f"style:{seed}:{idx}").random())
            cal = build_calendar(
                random.Random(f"calendar:{seed}:{idx}"), WEEKS * 7 + 10
            )
            for arm in arms:
                if arm == "AB":
                    per[arm].append(simulate_ab(student, tasks, style, cal))
                    continue
                arm_rng = random.Random(f"rand:{seed}:{idx}:{arm}")
                row = simulate(student, tasks, arm, style, arm_rng, cal)
                per[arm].append(row["done"])
        out["worlds"][name] = per
    return out


# --- Statistics ---------------------------------------------------------------


def _boot_means(values: np.ndarray, seed: int) -> np.ndarray:
    rng = np.random.default_rng(seed)
    idx = rng.integers(0, len(values), size=(BOOTSTRAP, len(values)))
    return values[idx].mean(axis=1)


def _interval(values: np.ndarray, seed: int) -> tuple[float, float]:
    means = _boot_means(values, seed)
    return float(np.quantile(means, 0.025)), float(np.quantile(means, 0.975))


def contrast(diff: np.ndarray, seeds: int, seed: int = 0) -> dict[str, float]:
    """Mean of paired differences (seed-major) with two intervals.

    ``ci`` resamples students; ``seed_ci`` resamples the per-seed means, so it covers
    run-to-run variation in the student draws and in the learners.
    """
    lo, hi = _interval(diff, seed)
    per_seed = diff.reshape(seeds, -1).mean(axis=1)
    slo, shi = _interval(per_seed, seed + 1) if seeds > 1 else (float("nan"),) * 2
    return {
        "mean": float(diff.mean()),
        "ci_lo": lo,
        "ci_hi": hi,
        "seed_sd": float(per_seed.std(ddof=1)) if seeds > 1 else 0.0,
        "seed_lo": slo,
        "seed_hi": shi,
        "share_better": float((diff > 0).mean()),
        "share_worse": float((diff < 0).mean()),
    }


PAIRS: dict[str, tuple[str, str]] = {
    "S_minus_H1": ("S", "H1"),
    "S_minus_H0": ("S", "H0"),
    "H1_minus_H0": ("H1", "H0"),
    "prior": ("S", "L0"),
    "gap": ("S", "S-gap"),
    "deadline": ("S", "S-deadline"),
    "tiebreak": ("S", "S-tiebreak"),
    "S_deadline_minus_H1_deadline": ("S-deadline", "H1-deadline"),
    "Smin_minus_H1": ("S-min", "H1"),
    "Smin_minus_S": ("S-min", "S"),
    "Smin_minus_H0": ("S-min", "H0"),
    "Smin_minus_L0": ("S-min", "L0"),
    "Splain_minus_H1": ("S-plain", "H1"),
    "Splain_minus_S": ("S-plain", "S"),
}


def _group(name: str) -> str:
    return name.rsplit("/", 1)[1]


def _rate(num: np.ndarray, den: np.ndarray) -> float:
    return float(num.sum() / den.sum()) if den.sum() else float("nan")


def _cluster_rate(num: np.ndarray, den: np.ndarray, seed: int) -> dict[str, float]:
    """Ratio of sums with a student-cluster bootstrap interval."""
    rng = np.random.default_rng(seed)
    idx = rng.integers(0, len(num), size=(BOOTSTRAP, len(num)))
    n, d = num[idx].sum(axis=1), den[idx].sum(axis=1)
    ok = d > 0
    rates = n[ok] / d[ok]
    return {
        "rate": _rate(num, den),
        "ci_lo": float(np.quantile(rates, 0.025)) if ok.any() else float("nan"),
        "ci_hi": float(np.quantile(rates, 0.975)) if ok.any() else float("nan"),
        "n": float(den.sum()),
    }


def _ab_cols(rows: list[dict[str, int]]) -> dict[str, np.ndarray]:
    return {k: np.asarray([r[k] for r in rows], dtype=float) for k in rows[0]}


def _ab_summary(cols: dict[str, np.ndarray], seed: int) -> dict[str, Any]:
    rate = _cluster_rate
    return {
        "offered": rate(cols["offered"], cols["events"], seed),
        "tapped": rate(cols["tapped"], cols["offered"], seed),
        "pick_linucb": rate(cols["picked_linucb"], cols["tapped"], seed),
        "start_linucb_primary": rate(cols["done_linucb"], cols["events_linucb"], seed),
        "start_heuristic_primary": rate(
            cols["done_heuristic"], cols["events_heuristic"], seed
        ),
    }


def merge(
    parts: list[dict[str, Any]], arms: tuple[str, ...], config: dict[str, Any]
) -> dict[str, Any]:
    """Pool every seed's students per world and compute the contrasts."""
    n_seeds = len(parts)
    results: dict[str, Any] = {"config": config, "worlds": {}, "pooled": {}}
    done: dict[str, dict[str, np.ndarray]] = {}
    ab: dict[str, dict[str, np.ndarray]] = {}
    for name in parts[0]["worlds"]:
        done[name] = {}
        for arm in arms:
            rows = [r for p in parts for r in p["worlds"][name][arm]]
            if arm == "AB":
                ab[name] = _ab_cols(rows)
            else:
                done[name][arm] = np.asarray(rows, dtype=float)
        entry: dict[str, Any] = {
            "arms": {
                a: {
                    "mean": float(v.mean()),
                    "ci": list(_interval(v, 1)),
                    "per_seed_sd": float(v.reshape(n_seeds, -1).mean(1).std(ddof=1))
                    if n_seeds > 1
                    else 0.0,
                }
                for a, v in done[name].items()
            },
            "contrasts": {},
        }
        for label, (a, b) in PAIRS.items():
            if a in done[name] and b in done[name]:
                entry["contrasts"][label] = contrast(
                    done[name][a] - done[name][b], n_seeds, seed=2
                )
        if name in ab:
            entry["ab"] = _ab_summary(ab[name], 3)
        results["worlds"][name] = entry
    for group in ("correct", "wrong", "all"):
        names = [n for n in done if group == "all" or _group(n) == group]
        if not names:
            continue
        pooled: dict[str, Any] = {"worlds": len(names), "contrasts": {}}
        for label, (a, b) in PAIRS.items():
            if all(a in done[n] and b in done[n] for n in names):
                diff = np.mean([done[n][a] - done[n][b] for n in names], axis=0)
                pooled["contrasts"][label] = contrast(diff, n_seeds, seed=4)
        if all(n in ab for n in names):
            merged = {
                k: np.concatenate([ab[n][k] for n in names]) for k in ab[names[0]]
            }
            pooled["ab"] = _ab_summary(merged, 5)
        results["pooled"][group] = pooled
    for entry in results["worlds"].values():
        c = entry["contrasts"].get("S_minus_H1")
        entry["non_inferior"] = (
            bool(min(c["ci_lo"], c["seed_lo"]) > -DELTA) if c else None
        )
    return results


# --- Driver --------------------------------------------------------------------


def _git(*args: str) -> str:
    out = subprocess.run(
        ["git", *args],
        cwd=Path(__file__).parent,
        capture_output=True,
        text=True,
        check=True,
    )
    return out.stdout.strip()


def _code_sha() -> str:
    """Short commit, with ``+dirty`` when the bandit tree has uncommitted changes."""
    try:
        sha = _git("rev-parse", "--short", "HEAD")
        dirty = _git("status", "--porcelain", "--", ".")
    except (OSError, subprocess.CalledProcessError):
        return "unknown"
    return f"{sha}+dirty" if dirty else sha


def _source_digest() -> str:
    """Hash of every evalx and src file, so a cached part never outlives its code."""
    root = Path(__file__).parent.parent
    files = sorted([*root.glob("evalx/*.py"), *root.glob("src/**/*.py")])
    h = hashlib.sha256()
    for f in files:
        h.update(f.relative_to(root).as_posix().encode())
        h.update(f.read_bytes())
    return h.hexdigest()[:16]


def _config_hash(payload: dict[str, Any]) -> str:
    return hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()[:16]


def run_all(
    seeds: int,
    students: int,
    arms: tuple[str, ...],
    workers: int,
    out: Path,
    offset: int = 0,
    cfg: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Seeds ``offset`` .. ``offset + seeds - 1``, each in its own process.

    Parts live under a folder named by a hash of the config, arms, student count
    and source, so a finished seed is reused only when all of them match.
    """
    run_cfg = {**CFG, **(cfg or {})}
    digest = _config_hash(
        {
            "cfg": run_cfg,
            "students": students,
            "arms": list(arms),
            "source": _source_digest(),
        }
    )
    parts = out / "parts" / digest
    parts.mkdir(parents=True, exist_ok=True)
    env = dict(os.environ, OMP_NUM_THREADS="1", OPENBLAS_NUM_THREADS="1")
    seed_ids = list(range(offset, offset + seeds))

    def launch(seed: int) -> None:
        part = parts / f"seed-{seed:03d}.json"
        if part.exists():
            return
        cmd = [
            sys.executable,
            "-m",
            "evalx",
            "seed",
            "--seed",
            str(seed),
            "--students",
            str(students),
            "--arms",
            ",".join(arms),
            "--config",
            json.dumps(run_cfg),
            "--part",
            str(part),
        ]
        subprocess.run(
            cmd,
            check=True,
            env=env,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )

    with ThreadPoolExecutor(max_workers=workers) as pool:
        list(pool.map(launch, seed_ids))
    loaded = [json.loads((parts / f"seed-{s:03d}.json").read_text()) for s in seed_ids]
    config = {
        "seeds": seeds,
        "seed_offset": offset,
        "students_per_seed": students,
        "weeks": WEEKS,
        "tasks_per_week": TASKS_PER_WEEK,
        "arms": list(arms),
        "delta": DELTA,
        "cfg": run_cfg,
    }
    results = merge(loaded, arms, config)
    results["manifest"] = {
        "code_sha": _code_sha(),
        "config_hash": digest,
        "generated": dt.datetime.now(tz=dt.UTC).isoformat(timespec="seconds"),
        "python": platform.python_version(),
        "numpy": np.__version__,
    }
    return results


# --- Sensitivity ----------------------------------------------------------------

SENSITIVITY: dict[str, dict[str, Any]] = {
    "production": {},
    **{f"mix: {m}": {"mix": m} for m in MIXES if m != HEADLINE_MIX},
    "alpha 0.05": {"alpha": 0.05},
    "alpha 0.5": {"alpha": 0.5},
    "heuristic rate 0.05": {"pref_rate": 0.05},
    "heuristic rate 0.5": {"pref_rate": 0.5},
    "heuristic rate 2": {"pref_rate": 2.0},
    "heuristic kept weight 0": {"kept_weight": 0.0},
    "heuristic kept weight 1": {"kept_weight": 1.0},
    "heuristic outside 0": {"outside": 0.0},
    "heuristic outside 0.5": {"outside": 0.5},
    "heuristic outside 0.8": {"outside": 0.8},
    "heuristic outside 1 (flat)": {"outside": 1.0},
    "gap weight 0": {"gap_weight": 0.0},
    "deadline weight 0": {"deadline_weight": 0.0},
}


def sensitivity(out: Path, seeds: int, students: int, workers: int) -> dict[str, Any]:
    """S minus H1 and the pick rate under each assumption, on tuning seeds."""
    rows: dict[str, Any] = {}
    for name, cfg in SENSITIVITY.items():
        res = run_all(
            seeds,
            students,
            ("H1", "S", "AB"),
            workers,
            out / "sensitivity",
            100,
            {**cfg, "worlds": "bands"},
        )
        pooled = res["pooled"]
        rows[name] = {
            group: {
                "S_minus_H1": pooled[group]["contrasts"]["S_minus_H1"],
                "pick_linucb": pooled[group]["ab"]["pick_linucb"],
            }
            for group in ("correct", "wrong")
        }
    (out / "sensitivity.json").write_text(json.dumps(rows, indent=2) + "\n")
    return rows


# --- Report --------------------------------------------------------------------


def _fmt(c: dict[str, float]) -> str:
    return (
        f"{c['mean']:+.2f} [{c['ci_lo']:+.2f}, {c['ci_hi']:+.2f}] "
        f"/ [{c['seed_lo']:+.2f}, {c['seed_hi']:+.2f}]"
    )


def _pct(d: dict[str, float]) -> str:
    if d["rate"] != d["rate"]:
        return "n/a"
    return f"{100 * d['rate']:.0f}% [{100 * d['ci_lo']:.0f}, {100 * d['ci_hi']:.0f}]"


def verdict(c: dict[str, float]) -> str:
    """Read S - H1 from both intervals, taking the wider on each side."""
    lo, hi = min(c["ci_lo"], c["seed_lo"]), max(c["ci_hi"], c["seed_hi"])
    if lo > 0:
        return "S better"
    if hi < 0:
        return "S worse" if lo < -DELTA else "S slightly worse"
    return "level"


def render(res: dict[str, Any]) -> str:
    cfg, man = res["config"], res["manifest"]
    n = cfg["seeds"] * cfg["students_per_seed"]
    lines = [
        "# Eval: heuristic vs LinUCB",
        "",
        "**Simulated students only.** Their traits (band, attention, drag, tap "
        "behaviour) are the authors' assumptions. The results show how the two "
        "policies behave in those worlds, not that real students will start more.",
        "",
        f"Seeds {cfg['seed_offset']} to {cfg['seed_offset'] + cfg['seeds'] - 1}, "
        f"{n} students per world, {cfg['weeks']} weeks of {cfg['tasks_per_week']} "
        f"tasks, reaction mix `{cfg['cfg']['mix']}`. Code `{man['code_sha']}`, "
        f"config `{man['config_hash']}`, {man['generated']}.",
        "",
        "Effects are starts per student over the period. Each reads "
        "`mean [95% CI over students] / [95% CI over seeds]`.",
        "",
        "## Headline: LinUCB (S) against a heuristic with the same band (H1)",
        "",
        f"Margin: {DELTA} starts. Verdict uses the wider of the two intervals. Worlds "
        "are not weighted into one average, since their mix is a choice, not a "
        "population.",
        "",
        "| World | H1 | S | S − H1 | Verdict |",
        "|---|---|---|---|---|",
    ]
    for name, w in res["worlds"].items():
        a = w["arms"]
        c = w["contrasts"]["S_minus_H1"]
        lines.append(
            f"| {name} | {a['H1']['mean']:.2f} | {a['S']['mean']:.2f} "
            f"| {_fmt(c)} | {verdict(c)} |"
        )
    lines += [
        "",
        "## Against the default heuristic (H0) and the controls",
        "",
        "| World | H0 | L0 | Oracle | Rand | S − H0 |",
        "|---|---|---|---|---|---|",
    ]
    for name, w in res["worlds"].items():
        a = w["arms"]
        lines.append(
            f"| {name} | {a['H0']['mean']:.2f} | {a['L0']['mean']:.2f} "
            f"| {a['Oracle']['mean']:.2f} | {a['Rand']['mean']:.2f} "
            f"| {_fmt(w['contrasts']['S_minus_H0'])} |"
        )
    lines += [
        "",
        "## Ablation: what each part of S adds",
        "",
        "| World | Prior (S − L0) | Gap quality | Deadline term | Tie-break |",
        "|---|---|---|---|---|",
    ]
    for name, w in res["worlds"].items():
        c = w["contrasts"]
        lines.append(
            f"| {name} | {_fmt(c['prior'])} | {_fmt(c['gap'])} "
            f"| {_fmt(c['deadline'])} | {_fmt(c['tiebreak'])} |"
        )
    lines += [
        "",
        "## Deadline term off on both sides",
        "",
        "| World | H1-deadline | S-deadline | S-deadline − H1-deadline | Verdict |",
        "|---|---|---|---|---|",
    ]
    for name, w in res["worlds"].items():
        a = w["arms"]
        c = w["contrasts"]["S_deadline_minus_H1_deadline"]
        lines.append(
            f"| {name} | {a['H1-deadline']['mean']:.2f} "
            f"| {a['S-deadline']['mean']:.2f} | {_fmt(c)} | {verdict(c)} |"
        )
    lines += [
        "",
        "## Pairwise offer (live protocol)",
        "",
        "Cluster bootstrap by student. A pick rate of 50% is no preference.",
        "",
        "| World | Offered | Tapped | LinUCB pick rate "
        "| Start, LinUCB primary | Start, heuristic primary |",
        "|---|---|---|---|---|---|",
    ]
    for name, w in res["worlds"].items():
        a = w["ab"]
        lines.append(
            f"| {name} | {_pct(a['offered'])} | {_pct(a['tapped'])} "
            f"| {_pct(a['pick_linucb'])} | {_pct(a['start_linucb_primary'])} "
            f"| {_pct(a['start_heuristic_primary'])} |"
        )
    lines += [
        "",
        "## Limits",
        "",
        "- Simulated students only; traits are assumptions, not calibrated.",
        "- The result depends on the reaction mix; see the sensitivity table.",
        "- Lectures fill the calendar; placed tasks do not.",
        "- The stated band is four bands; true bands are single ranges.",
        "- The pick model (noise "
        f"{PICK_SIGMA}, keep bias {KEEP_BIAS}) is assumed until classroom labels "
        "exist.",
        "- Hybrid LinUCB is not in these arms.",
    ]
    return "\n".join(lines) + "\n"


def render_sensitivity(rows: dict[str, Any]) -> str:
    lines = [
        "# Sensitivity (tuning seeds 100 and up, band worlds)",
        "",
        "| Assumption | S − H1, correct band | S − H1, wrong band "
        "| Pick rate, correct | Pick rate, wrong |",
        "|---|---|---|---|---|",
    ]
    for name, r in rows.items():
        lines.append(
            f"| {name} | {_fmt(r['correct']['S_minus_H1'])} "
            f"| {_fmt(r['wrong']['S_minus_H1'])} "
            f"| {_pct(r['correct']['pick_linucb'])} "
            f"| {_pct(r['wrong']['pick_linucb'])} |"
        )
    return "\n".join(lines) + "\n"


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="evalx")
    sub = ap.add_subparsers(dest="cmd", required=True)
    one = sub.add_parser("seed", help="run one seed and write its part file")
    one.add_argument("--seed", type=int, required=True)
    one.add_argument("--students", type=int, required=True)
    one.add_argument("--arms", required=True)
    one.add_argument("--part", type=Path, required=True)
    one.add_argument("--config", default="{}")
    run = sub.add_parser("run", help="run every seed, write results.json and report.md")
    run.add_argument("--seeds", type=int, default=30)
    run.add_argument("--students", type=int, default=20)
    run.add_argument("--workers", type=int, default=8)
    run.add_argument("--arms", default=",".join(ARMS))
    run.add_argument("--out", type=Path, default=Path(__file__).parent / "out")
    run.add_argument("--seed-offset", type=int, default=0)
    run.add_argument("--config", default="{}")
    sens = sub.add_parser(
        "sensitivity", help="reaction mixes, alpha and component weights"
    )
    sens.add_argument("--seeds", type=int, default=10)
    sens.add_argument("--students", type=int, default=20)
    sens.add_argument("--workers", type=int, default=8)
    sens.add_argument("--out", type=Path, default=Path(__file__).parent / "out")
    args = ap.parse_args(argv)

    if args.cmd == "sensitivity":
        args.out.mkdir(parents=True, exist_ok=True)
        rows = sensitivity(args.out, args.seeds, args.students, args.workers)
        text = render_sensitivity(rows)
        (args.out / "sensitivity.md").write_text(text)
        print(text)
        return 0

    arms = tuple(a.strip() for a in args.arms.split(",") if a.strip())
    if args.cmd == "seed":
        configure(json.loads(args.config))
        part = run_seed(args.seed, args.students, arms)
        args.part.parent.mkdir(parents=True, exist_ok=True)
        args.part.write_text(json.dumps(part))
        return 0

    res = run_all(
        args.seeds,
        args.students,
        arms,
        args.workers,
        args.out,
        args.seed_offset,
        json.loads(args.config),
    )
    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / "results.json").write_text(json.dumps(res, indent=2) + "\n")
    if {"H0", "H1", "L0", "S", "Oracle", "Rand", "AB"} <= set(arms):
        (args.out / "report.md").write_text(render(res))
        print(render(res))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
