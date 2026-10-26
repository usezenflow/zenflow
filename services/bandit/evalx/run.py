"""Offline eval: does a matrix-seeded LinUCB beat the heuristic for simulated students?

The production placer and the production update run in-process (``tests/test_evalx.py``
pins the placer to ``/v1/place``). Every student gets the same tasks and random
draws under every arm (common random numbers), so arms differ only by placement.
Rewards follow ADR-0035: KEPT +1, MOVE negative by drag, pairwise pick of
LinUCB's option +0.5, kept heuristic option over LinUCB's -0.2, no LAPSED.

Arms (``ARM_SPEC``)
  H            heuristic on the default two-hump matrix: the control
  H-deadline   H with the deadline term off
  L            LinUCB seeded from the same matrix, as shipped
  L-cold       LinUCB with no prior
  L-deadline   L with the deadline term off
  L-nogap      L with the gap term off
  L-nogap-deadline  gap and deadline terms both off
  Oracle       the best in-band slot in the window (ceiling)
  Rand         a random day and hour in the task's window (floor)
  AB           the live protocol: 50/50 primary per event, both slots computed, a
               pairwise offer, the student may tap (see ``simulate_ab``)

L - L-cold is the value of the prior, L - L-deadline the value of the deadline term
and L - L-nogap the value of the gap term. Every arm also reports the hours between a
block's end and its deadline.

Run:  uv run python -m evalx run --seeds 100 --students 100 --workers 8
Tuning seeds are 100 and up (``--seed-offset 100``); the held-out run uses 0 to 99.
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

import src.core.matrix_prior as prior_module  # noqa: E402
import src.core.slot_score as slot_score  # noqa: E402
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
    style_of,
)
from src.api import update_arm  # noqa: E402
from src.core import constants as consts  # noqa: E402
from src.core.constants import (  # noqa: E402
    DAY_MS,
    KEPT_REWARD,
    MS_PER_MINUTE,
    PREFERENCE_KEPT_WEIGHT,
)
from src.core.preference import (  # noqa: E402
    default_preference_matrix,
    reinforce_preference_move,
    reinforce_preference_smooth,
)
from src.core.reward import drag_distance_reward  # noqa: E402
from src.place import place as run_place  # noqa: E402
from src.schemas import HOUR_ARM_IDS, UpdateRequest  # noqa: E402
from src.schemas_place import PLACEMENT_CONTRACT_VERSION, PlaceRequest  # noqa: E402

ALPHA = 0.15  # BANDIT_ALPHA, backend/src/scheduler/constants.ts
RIDGE = 1.0  # BANDIT_RIDGE
# KEPT_REWARD comes from src.core.constants (mirror of the backend).
PAIRWISE_WIN_REWARD = 0.5  # backend/src/scheduler/constants.ts
PAIRWISE_LOSS_REWARD = -0.2
MIN_ALTERNATIVE_GAP_MINUTES = 60  # an offer needs two starts at least this far apart
PICK_SIGMA = 0.3  # assumed: noise in how a student perceives an option
KEEP_BIAS = 0.15  # assumed: pull toward the applied (primary) option
CLOSE_HOURS = 24  # a block ending this close to its deadline hugs it
LONG_WINDOW_DAYS = 3  # tasks with at least this long to deadline can avoid it
DELTA = 0.5  # non-inferiority margin, starts per student over the period
BOOTSTRAP = 2000
WEEKS = 4
TASKS_PER_WEEK = 3
ZERO_WORKLOAD: dict[str, dict[str, float]] = {
    t: {"hours": 0, "count": 0}
    for t in ("LECTURE", "ASSIGNMENT", "EXAM", "TASK", "DND")
}

ARM_SPEC: dict[str, dict[str, Any]] = {
    "H": {"policy": "HEURISTIC"},
    "H-deadline": {"policy": "HEURISTIC", "deadline": False},
    "L": {"policy": "LINUCB"},
    "L-cold": {"policy": "LINUCB", "prior": "cold"},
    "L-deadline": {"policy": "LINUCB", "deadline": False},
    "L-nogap": {"policy": "LINUCB", "gap_weight": 0.0},
    "L-nogap-deadline": {"policy": "LINUCB", "gap_weight": 0.0, "deadline": False},
    "Oracle": {"policy": "ORACLE"},
    "Rand": {"policy": "RAND"},
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
    "deadline_horizon": None,  # LinUCB penalty reach in hours; None ships
    "n0": None,  # (weekday, weekend) pseudo-observations of the prior; None ships
    "mix": HEADLINE_MIX,
    "mode": "semester",  # "semester" (sampled students) or "bands" (fixed worlds)
    "drag": 0.0,  # semester: share of students who move a poorly timed block
    "imminence": 1.0,  # semester: scale on how much students start near a deadline
    "worlds": "all",  # "all" or "bands"
    # Reality knobs (semester). The defaults are the headline student and signal.
    "timing": 1.0,  # how much the hour matters to a student, 1 to 0
    "detect": 1.0,  # chance a kept slot reaches the learner
    "delay": 0,  # tasks between a start and its reward
    "tap_scale": 1.0,  # scale on the chance a student answers an offer
    "drift": None,  # {"kind": "step" or "walk", "hours": n}: the peak hour moves
    "discount": 1.0,  # L forgets: evidence kept per update of the played arm
    "shape": None,  # None, "bimodal" or "weekday": a start curve L was not built for
    "chrono": "shipped",  # chronotype mix: shipped, uniform, lark heavy, owl heavy
    "attention_scale": 1.0,  # scale on every student's willingness to start
    "opens_shift": 0.0,  # hours the app-open curve is shifted from the start curve
    "opens_uninformative": False,  # opens drawn uniformly over the day
    # The heuristic's own knobs: table learning rate and weight of a kept slot.
    "pref_rate": consts.PREFERENCE_LEARNING_RATE,
    "kernel_sd": 0.75,  # arms marked "kernel": hour kernel width (production)
    "kernel_pool": 1.0,  # arms marked "kernel": same-group weekdays (production)
    "kept_weight": PREFERENCE_KEPT_WEIGHT,
    # Delete behaviour of the students (semester): noise, and the slot-dependent part.
    "delete_noise": 0.0,
    "delete_slot": 0.0,
}
_PRODUCTION = {
    "gap": consts.LINUCB_GAP_WEIGHT,
    "deadline": consts.DEADLINE_PENALTY_WEIGHT,
}


def _bias_only(**_: Any) -> Any:
    """The context of a non-contextual bandit: 0 everywhere, 1 for the bias."""
    x = np.zeros(consts.FEATURE_DIM)
    x[-1] = 1.0
    return x


def configure(cfg: dict[str, Any]) -> None:
    """Set this process's sweep config. Read at each placement, never global."""
    CFG.update(cfg)


@contextmanager
def _knobs(spec: dict[str, Any]) -> Iterator[None]:
    """Apply one arm's gap, deadline and prior settings around its placements."""
    gap = CFG["gap_weight"] if CFG["gap_weight"] is not None else _PRODUCTION["gap"]
    deadline = (
        CFG["deadline_weight"]
        if CFG["deadline_weight"] is not None
        else _PRODUCTION["deadline"]
    )
    saved = (
        consts.LINUCB_GAP_WEIGHT,
        consts.DEADLINE_PENALTY_WEIGHT,
        prior_module.PRIOR_MATRIX,
        prior_module.N0_WEEKDAY,
        prior_module.N0_WEEKEND,
        consts.LINUCB_DEADLINE_HORIZON_HOURS,
    )
    saved_horizon = slot_score.deadline_penalty_scores.__defaults__
    saved_ctx = (place_module.build_context_vector, prior_module.build_context_vector)
    if spec.get("context") == "none":  # a bandit that sees only the bias
        place_module.build_context_vector = _bias_only
        prior_module.build_context_vector = _bias_only
    if CFG["deadline_horizon"] is not None:
        consts.LINUCB_DEADLINE_HORIZON_HOURS = CFG["deadline_horizon"]
    if "deadline_horizon" in spec:  # LinUCB's reach for this arm
        consts.LINUCB_DEADLINE_HORIZON_HOURS = spec["deadline_horizon"]
    if "heuristic_horizon" in spec:  # the heuristic's reach, a default argument
        slot_score.deadline_penalty_scores.__defaults__ = (
            float(spec["heuristic_horizon"]),
        )
    if CFG["n0"] is not None:
        prior_module.N0_WEEKDAY, prior_module.N0_WEEKEND = CFG["n0"]
    consts.LINUCB_GAP_WEIGHT = spec.get("gap_weight", gap)
    deadline = spec.get("deadline_weight", deadline)  # this arm's own weight
    consts.DEADLINE_PENALTY_WEIGHT = deadline if spec.get("deadline", True) else 0.0
    if spec.get("prior") == "cold":
        prior_module.PRIOR_MATRIX = None
    try:
        yield
    finally:
        (
            consts.LINUCB_GAP_WEIGHT,
            consts.DEADLINE_PENALTY_WEIGHT,
            prior_module.PRIOR_MATRIX,
            prior_module.N0_WEEKDAY,
            prior_module.N0_WEEKEND,
            consts.LINUCB_DEADLINE_HORIZON_HOURS,
        ) = saved
        slot_score.deadline_penalty_scores.__defaults__ = saved_horizon
        place_module.build_context_vector, prior_module.build_context_vector = saved_ctx


# --- Worlds -------------------------------------------------------------------

BANDS = {
    "day_9_17": (9, 17),  # the old default map's band, so H starts near its ceiling
    "morning_6_10": (6, 10),
    "afternoon_13_17": (13, 17),
    "evening_17_21": (17, 21),
    "night_21_24": (21, 24),
    "dip_13_15": (13, 15),  # inside the post-lunch dip the matrix rates low
}


def worlds(kind: str = "all") -> dict[str, Student]:
    """The band grid, then the other checks.

    ``bands`` is the band grid and the weekend world. ``all`` adds an attention
    sweep, an absent student and a routine change.
    """
    grid: dict[str, Student] = {
        f"band_{name}": Student(name, band, 0.5, 0.5, 0.3)
        for name, band in BANDS.items()
    }
    # Weekdays 17 to 21 at attention 0.5; weekends later (19 to 23) and lazier (0.3).
    grid["weekend_later_lazier"] = Student(
        "weekend",
        (17, 21),
        0.5,
        0.5,
        0.3,
        weekend_band=(19, 23),
        weekend_attention=0.3,
    )
    if kind == "bands":
        return grid
    for level in (0.05, 0.15, 0.3, 0.6, 0.9):
        grid[f"attention_{level}_evening"] = Student(
            "evening", (17, 21), level, 0.5, 0.3
        )
    grid["absent_evening"] = replace(
        ARCHETYPES["absent"].with_attention(0.02), band=(17, 21)
    )
    # Routine changes after two weeks, evening to morning.
    grid["shift_evening_to_morning"] = Student(
        "shift",
        (17, 21),
        0.5,
        0.5,
        0.3,
        shift_at_ms=14 * DAY_MS,
        band_after=(6, 10),
    )
    return grid


# --- Placement ----------------------------------------------------------------


Placed = dict[int, list[tuple[int, int]]]


def _days(
    first_ms: int, last_ms: int, cal: Calendar, placed: Placed | None = None
) -> list[dict[str, Any]]:
    """The day windows of one request. ``placed`` are blocks already on the calendar
    (day to minute intervals): they occupy time and count as TASK workload."""
    out = []
    ms = first_ms
    while ms <= last_ms:
        busy = busy_minutes(cal, ms)
        mine = (placed or {}).get(ms // DAY_MS, [])
        workload = {**ZERO_WORKLOAD}
        workload["LECTURE"] = {
            "hours": sum(b - a for a, b in busy) / 60,
            "count": len(busy),
        }
        if mine:
            workload["TASK"] = {
                "hours": sum(b - a for a, b in mine) / 60,
                "count": len(mine),
            }
        out.append(
            {
                "dayStr": day_str(ms),
                "dayStartMs": ms,
                "dayEndMs": ms + DAY_MS,
                "occupied": [
                    {"startMs": ms + a * MS_PER_MINUTE, "endMs": ms + b * MS_PER_MINUTE}
                    for a, b in sorted([*busy, *mine])
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
    cal: Calendar,
    both: bool = False,
    placed: Placed | None = None,
) -> dict[str, Any]:
    """The ``/v1/place`` request the harness sends for one task."""
    first = (task.arrival_ms // DAY_MS) * DAY_MS
    last = ((task.deadline_ms - 1) // DAY_MS) * DAY_MS
    user: dict[str, Any] = {"preferenceMatrix": matrix.tolist(), "observationCount": n}
    body: dict[str, Any] = {
        "contractVersion": PLACEMENT_CONTRACT_VERSION,
        "requestId": f"eval-{n}",
        "mode": "PLACE",
        "nowMs": task.arrival_ms,
        "timezone": "UTC",
        "deadlineMs": task.deadline_ms,
        "maxScanDays": 30,
        "member": {
            "id": "t",
            "durationMinutes": task.duration_min,
            "primaryPolicy": primary,
            "computeBoth": both,
        },
        "days": _days(first, last, cal, placed),
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
    cal: Calendar,
    both: bool = False,
    placed: Placed | None = None,
) -> dict[str, Any] | None:
    """One placement through the production placer, in-process."""
    body = place_body(task, primary, state, matrix, n, cal, both, placed)
    res = run_place(PlaceRequest.model_validate(body), 0.0).model_dump(by_alias=True)
    r = res["result"]
    return r if r["outcome"] == "PLACED" else None


NO_KERNEL = (0.0, 0.0)


def kernel_of(spec: dict[str, Any]) -> tuple[float, float]:
    """``(sd, pool)`` of the matrix update for an arm: the swept kernel or none."""
    if not spec.get("kernel"):
        return NO_KERNEL
    return float(CFG["kernel_sd"]), float(CFG["kernel_pool"])


def _kept(matrix: Any, start: int, kern: tuple[float, float] = NO_KERNEL) -> Any:
    """The heuristic's table after the student keeps or starts a slot."""
    return reinforce_preference_smooth(
        matrix, start, "UTC", CFG["kept_weight"], CFG["pref_rate"], *kern
    )


def _deleted(
    matrix: Any, start: int, weight: float, kern: tuple[float, float] = NO_KERNEL
) -> Any:
    """The heuristic's table after a delete: a kept update with a negative weight."""
    return reinforce_preference_smooth(
        matrix, start, "UTC", weight, CFG["pref_rate"], *kern
    )


def _moved(
    matrix: Any, old: int, new: int, drag: float, kern: tuple[float, float] = NO_KERNEL
) -> Any:
    """The heuristic's table after the student moves a slot."""
    return reinforce_preference_move(
        matrix, old, new, "UTC", drag, CFG["pref_rate"], *kern
    )


def _learn(
    state: dict[str, Any],
    arm_id: str,
    x: list[float],
    reward: float,
    spec: dict[str, Any],
) -> None:
    """One production update: the reward for ``arm_id``, spread over 24 hour arms."""
    if CFG["discount"] < 1.0:
        _forget(state, CFG["discount"])
    with _knobs(spec):  # a cold arm hydrates from its own matrix prior
        upd = update_arm(
            UpdateRequest.model_validate(
                {
                    "ridge": CFG["ridge"],
                    "arm": arm_id,
                    "x": x,
                    "reward": reward,
                    "arms": state,
                }
            )
        )
    for arm, st in upd.arms.items():
        state[arm] = {"A": st.A, "b": st.b}


def _forget(state: dict[str, Any], gamma: float) -> None:
    """Shrink every warm arm's evidence by ``gamma`` toward ``ridge * I``.

    Applied to all 24 arms before an update, since the kernel moves all of them. The
    prior pseudo-observations fade with the rest. Cold arms have no evidence to shrink.
    """
    ridge = CFG["ridge"]
    for arm, st in state.items():
        if not st["A"]:
            continue
        a = np.asarray(st["A"]).reshape(-1, int(np.sqrt(len(st["A"]))))
        eye = ridge * np.eye(a.shape[0])
        state[arm] = {
            "A": (eye + gamma * (a - eye)).reshape(-1).tolist(),
            "b": (gamma * np.asarray(st["b"])).tolist(),
        }


# --- Student reaction ----------------------------------------------------------


def react(
    s: Student, task: Task, start: int, style: str, cal: Calendar
) -> tuple[bool, str | None, float | None, int]:
    """(done, signal, reward, new_start) for a block at ``start``.

    ``done`` is the latent outcome the metrics read: the student completes a block
    inside the band. The learner hears only KEPT for a block left in place, in the
    band or not. Outside the band a ``drag`` style student moves the block, to the
    free start nearest the band centre (a MOVE); with none free, it stays.
    """
    midnight = (start // DAY_MS) * DAY_MS
    p = open_chance(s, (task.deadline_ms - start) / DAY_MS, start)
    if in_band(s, start, midnight):
        return task.u_open < p, "KEPT", KEPT_REWARD, start
    if style == "drag" and task.u_drag < s.drag:
        minute = feasible_start(
            s.band_on(midnight // DAY_MS),
            busy_minutes(cal, midnight),
            task.duration_min,
        )
        if minute is None:
            return False, "KEPT", KEPT_REWARD, start
        moved = midnight + minute * MS_PER_MINUTE
        drag = abs(moved - start) / MS_PER_MINUTE
        return (
            task.u_open < p,
            "MOVE",
            drag_distance_reward(drag, CFG["move_scale"]),
            moved,
        )
    return False, "KEPT", KEPT_REWARD, start


def utility(s: Student, start: int) -> float:
    """How good a start looks to the student: 1 in their band, falling outside it."""
    h = (start % DAY_MS) / HOUR_MS
    lo, hi = s.band_on(start // DAY_MS)
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
        lo, hi = s.band_on(d)
        for m in range(lo * 60, hi * 60 - task.duration_min + 1, 15):
            start = d * DAY_MS + m * MS_PER_MINUTE
            end = start + task.duration_min * MS_PER_MINUTE
            if start < task.arrival_ms or end > task.deadline_ms:
                continue
            if any(m < be and m + task.duration_min > bs for bs, be in busy):
                continue
            if 2 * 60 <= m % 1440 < 6 * 60:
                continue
            p = open_chance(s, (task.deadline_ms - start) / DAY_MS, start)
            if best is None or p > best[0] + 1e-12:
                best = (p, start)
    return best[1] if best else None


# --- One student ---------------------------------------------------------------


def _table() -> Any:
    """The heuristic's starting table: the broad matrix the LinUCB prior reads."""
    return default_preference_matrix()


def simulate(
    s: Student,
    tasks: list[Task],
    arm: str,
    style: str,
    rng: random.Random,
    cal: Calendar,
) -> dict[str, Any]:
    """One student through one single-policy arm.

    ``slack`` is the mean hours between a placed block's end and its deadline;
    ``close`` is the share of placed blocks ending within 24 hours of it, over tasks
    whose window is at least ``LONG_WINDOW_DAYS`` (a shorter window cannot avoid it).
    """
    spec = ARM_SPEC[arm]
    policy = spec["policy"]
    state: dict[str, dict[str, list[float]]] = {
        a: {"A": [], "b": []} for a in HOUR_ARM_IDS
    }
    matrix = _table()
    kern = kernel_of(spec)
    done = starts = moves = placed = close = long_placed = 0
    slack = 0.0
    for n, task in enumerate(tasks):
        st = s.at(task.arrival_ms)
        lin = None
        if policy in ("HEURISTIC", "LINUCB"):
            with _knobs(spec):
                res = _place(task, policy, state, matrix, n, cal)
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
        left_h = (
            task.deadline_ms - start - task.duration_min * MS_PER_MINUTE
        ) / HOUR_MS
        slack += left_h
        if task.deadline_ms - task.arrival_ms >= LONG_WINDOW_DAYS * DAY_MS:
            long_placed += 1
            close += left_h <= CLOSE_HOURS
        ok, signal, reward, new_start = react(st, task, start, style, cal)
        done += ok
        if signal == "KEPT":
            matrix = _kept(matrix, start, kern)
        elif signal == "MOVE":
            moves += 1
            drag = abs(new_start - start) / MS_PER_MINUTE
            matrix = _moved(matrix, start, new_start, drag, kern)
        if lin and reward is not None:
            _learn(state, lin["selectedArm"], lin["featureVector"], reward, spec)
    return {
        "done": done,
        "starts": starts,
        "moves": moves,
        "placed": placed,
        "slack": slack / placed if placed else float("nan"),
        "close": close / long_placed if long_placed else float("nan"),
    }


def simulate_ab(
    s: Student,
    tasks: list[Task],
    style: str,
    cal: Calendar,
    spec: dict[str, Any] | None = None,
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
    ``spec`` is the LinUCB variant to place (an ``ARM_SPEC`` entry); ``None`` ships.
    """
    variant = spec or {}
    kern = kernel_of(variant)
    state: dict[str, dict[str, list[float]]] = {
        a: {"A": [], "b": []} for a in HOUR_ARM_IDS
    }
    matrix = _table()
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
        with _knobs(variant):
            res = _place(task, primary, state, matrix, n, cal, both=True)
        if res is None or not res.get("linucb") or not res.get("heuristic"):
            out["infeasible"] += 1
            continue
        lin, heu = res["linucb"], res["heuristic"]
        ls, hs = lin["startMs"], heu["startMs"]
        prim, alt = (ls, hs) if primary == "LINUCB" else (hs, ls)
        alt_policy = "HEURISTIC" if primary == "LINUCB" else "LINUCB"
        offered = abs(hs - ls) >= MIN_ALTERNATIVE_GAP_MINUTES * MS_PER_MINUTE
        p_see = open_chance(st, (task.deadline_ms - prim) / DAY_MS, prim)
        tapped = offered and style == "tap" and task.u_see < p_see
        applied, applied_policy = prim, primary
        x, arm_id = lin["featureVector"], lin["selectedArm"]
        if tapped:
            if pick_alternative(
                utility(st, prim), utility(st, alt), task.eps_primary, task.eps_alt
            ):
                applied, applied_policy = alt, alt_policy
            if applied_policy == "LINUCB":
                _learn(state, arm_id, x, PAIRWISE_WIN_REWARD, variant)
            elif primary == "HEURISTIC":
                _learn(state, arm_id, x, PAIRWISE_LOSS_REWARD, variant)
                matrix = _kept(matrix, applied, kern)
            else:
                drag = abs(hs - ls) / MS_PER_MINUTE
                _learn(
                    state,
                    arm_id,
                    x,
                    drag_distance_reward(drag, CFG["move_scale"]),
                    variant,
                )
                matrix = _moved(matrix, ls, hs, drag, kern)
        ok, signal, reward, new_start = react(st, task, applied, style, cal)
        if signal == "KEPT":
            matrix = _kept(matrix, applied, kern)
        elif signal == "MOVE":
            drag = abs(new_start - applied) / MS_PER_MINUTE
            matrix = _moved(matrix, applied, new_start, drag, kern)
        if signal and applied_policy == "LINUCB" and reward is not None:
            _learn(state, arm_id, x, reward, variant)
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
    if CFG["mode"] == "semester":
        from evalx import semester

        return semester.run_seed(seed, students, arms)
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
                per[arm].append([row["done"], row["slack"], row["close"]])
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
    "L_minus_H": ("L", "H"),
    "prior": ("L", "L-cold"),
    "deadline": ("L", "L-deadline"),
    "deadline_H": ("H", "H-deadline"),
    "gap": ("L", "L-nogap"),
    "gap_only": ("L-deadline", "L-nogap-deadline"),
}


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
        "done_linucb_primary": rate(cols["done_linucb"], cols["events_linucb"], seed),
        "done_heuristic_primary": rate(
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
    extra: dict[str, dict[str, np.ndarray]] = {}
    ab: dict[str, dict[str, np.ndarray]] = {}
    for name in parts[0]["worlds"]:
        done[name], extra[name] = {}, {}
        for arm in arms:
            rows = [r for p in parts for r in p["worlds"][name][arm]]
            if arm == "AB":
                ab[name] = _ab_cols(rows)
            else:
                cols = np.asarray(rows, dtype=float)
                done[name][arm] = cols[:, 0]
                extra[name][arm] = cols[:, 1:]
        entry: dict[str, Any] = {
            "arms": {
                a: {
                    "mean": float(v.mean()),
                    "ci": list(_interval(v, 1)),
                    "per_seed_sd": float(v.reshape(n_seeds, -1).mean(1).std(ddof=1))
                    if n_seeds > 1
                    else 0.0,
                    "slack_h": float(np.nanmean(extra[name][a][:, 0])),
                    "within_24h": float(np.nanmean(extra[name][a][:, 1])),
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
    names = list(done)
    pooled: dict[str, Any] = {"worlds": len(names), "contrasts": {}}
    for label, (a, b) in PAIRS.items():
        if all(a in done[n] and b in done[n] for n in names):
            diff = np.mean([done[n][a] - done[n][b] for n in names], axis=0)
            pooled["contrasts"][label] = contrast(diff, n_seeds, seed=4)
    if all(n in ab for n in names):
        merged = {k: np.concatenate([ab[n][k] for n in names]) for k in ab[names[0]]}
        pooled["ab"] = _ab_summary(merged, 5)
    results["pooled"]["all"] = pooled
    for entry in results["worlds"].values():
        c = entry["contrasts"].get("L_minus_H")
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
    if run_cfg["mode"] == "semester":
        from evalx import semester
        from evalx.academic_calendar import WEEKS as SEMESTER_WEEKS

        results = semester.merge(loaded, arms, {**config, "weeks": SEMESTER_WEEKS})
    else:
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
    "prior strength 0.5 and 0.5 (ships)": {},
    "gap term off": {"gap_weight": 0.0},
    "deadline term off": {"deadline_weight": 0.0},
    "deadline reach 24h (old)": {"deadline_horizon": 24},
    "prior strength 1 and 0.5": {"n0": (1.0, 0.5)},
    "prior strength 2 and 1": {"n0": (2.0, 1.0)},
    "prior strength 4 and 2": {"n0": (4.0, 2.0)},
}

# (horizon hours, weight); weight 0 is the term off.
DEADLINE_GRID = (
    (24, 0.0),
    (24, 0.2),
    (24, 0.4),
    (24, 0.6),
    (48, 0.2),
    (48, 0.4),
    (72, 0.2),
    (72, 0.4),
    (96, 0.4),
    (96, 0.6),
)


def sensitivity(out: Path, seeds: int, students: int, workers: int) -> dict[str, Any]:
    """L minus H and the pick rate under each assumption, on tuning seeds."""
    rows: dict[str, Any] = {}
    for name, cfg in SENSITIVITY.items():
        res = run_all(
            seeds,
            students,
            ("H", "L", "AB"),
            workers,
            out / "sensitivity",
            100,
            {**cfg, "mode": "bands", "worlds": "bands"},
        )
        pooled = res["pooled"]["all"]
        worlds_ = res["worlds"].values()
        rows[name] = {
            "L_minus_H": pooled["contrasts"]["L_minus_H"],
            "pick_linucb": pooled["ab"]["pick_linucb"],
            "L_starts": float(np.mean([w["arms"]["L"]["mean"] for w in worlds_])),
            "L_hours": float(np.mean([w["arms"]["L"]["slack_h"] for w in worlds_])),
            "L_within_24h": float(
                np.mean([w["arms"]["L"]["within_24h"] for w in worlds_])
            ),
        }
    (out / "sensitivity.json").write_text(json.dumps(rows, indent=2) + "\n")
    return rows


def deadline_sweep(
    out: Path, seeds: int, students: int, workers: int
) -> dict[str, Any]:
    """Starts and distance to the deadline at each deadline weight and horizon."""
    rows: dict[str, Any] = {}
    for horizon, weight in DEADLINE_GRID:
        res = run_all(
            seeds,
            students,
            ("H", "L", "Oracle"),
            workers,
            out / "deadline",
            0,
            {
                "deadline_weight": weight,
                "deadline_horizon": horizon,
                "mode": "bands",
                "worlds": "bands",
            },
        )
        arms = {
            arm: {
                k: float(np.mean([w["arms"][arm][k] for w in res["worlds"].values()]))
                for k in ("mean", "slack_h", "within_24h")
            }
            for arm in ("H", "L", "Oracle")
        }
        rows[f"{weight:.1f} over {horizon}h"] = arms
    (out / "deadline.json").write_text(json.dumps(rows, indent=2) + "\n")
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
    """Read L - H from both intervals, taking the wider on each side."""
    lo, hi = min(c["ci_lo"], c["seed_lo"]), max(c["ci_hi"], c["seed_hi"])
    if lo > 0:
        return "better"
    if hi < 0:
        return "worse" if lo < -DELTA else "slightly worse"
    return "level"


def render(res: dict[str, Any]) -> str:
    cfg, man = res["config"], res["manifest"]
    n = cfg["seeds"] * cfg["students_per_seed"]
    lines = [
        "# Eval: heuristic vs matrix-seeded LinUCB",
        "",
        "Simulated students only. Their traits (band, attention, drag, tap "
        "behaviour) are assumptions.",
        "",
        f"Seeds {cfg['seed_offset']} to {cfg['seed_offset'] + cfg['seeds'] - 1}, "
        f"{n} students per world, {cfg['weeks']} weeks of {cfg['tasks_per_week']} "
        f"tasks, reaction mix `{cfg['cfg']['mix']}`. Code `{man['code_sha']}`, "
        f"config `{man['config_hash']}`, {man['generated']}.",
        "",
        "Effects are done rate per student. Each reads "
        "`mean [95% CI over students] / [95% CI over seeds]`.",
        "",
        "## Headline: L against the default heuristic (H)",
        "",
        f"Margin: {DELTA} starts. The verdict uses the wider of the two intervals.",
        "",
        "| World | H | L | L − H | Verdict |",
        "|---|---|---|---|---|",
    ]
    for name, w in res["worlds"].items():
        a, c = w["arms"], w["contrasts"]["L_minus_H"]
        lines.append(
            f"| {name} | {a['H']['mean']:.2f} | {a['L']['mean']:.2f} "
            f"| {_fmt(c)} | {verdict(c)} |"
        )
    lines += [
        "",
        "## Every arm, done rate per student",
        "",
        "| World | H | L-cold | L | Oracle | Rand |",
        "|---|---|---|---|---|---|",
    ]
    for name, w in res["worlds"].items():
        a = w["arms"]
        cells = " | ".join(
            f"{a[k]['mean']:.2f}" for k in ("H", "L-cold", "L", "Oracle", "Rand")
        )
        lines.append(f"| {name} | {cells} |")
    lines += [
        "",
        "## What each part adds",
        "",
        "| World | Prior (L − L-cold) | Gap term (L − L-nogap) "
        "| Deadline term (L − L-deadline) |",
        "|---|---|---|---|",
    ]
    for name, w in res["worlds"].items():
        c = w["contrasts"]
        lines.append(
            f"| {name} | {_fmt(c['prior'])} | {_fmt(c['gap'])} "
            f"| {_fmt(c['deadline'])} |"
        )
    lines += [
        "",
        "## Distance to the deadline",
        "",
        "Mean hours between a block's end and its deadline, and the share of "
        "blocks ending within 24 hours of it, over tasks with a window of 3 days "
        "or more.",
        "",
        "| World | Arm | Hours left | Within 24h |",
        "|---|---|---|---|",
    ]
    for name, w in res["worlds"].items():
        for arm in ("H", "L", "L-deadline", "L-nogap", "L-nogap-deadline"):
            a = w["arms"][arm]
            lines.append(
                f"| {name} | {arm} | {a['slack_h']:.1f} "
                f"| {100 * a['within_24h']:.0f}% |"
            )
    lines += [
        "",
        "## Pairwise offer (live protocol)",
        "",
        "Cluster bootstrap by student. A pick rate of 50% is no preference.",
        "",
        "| World | Offered | Tapped | LinUCB pick rate "
        "| Done, LinUCB primary | Done, heuristic primary |",
        "|---|---|---|---|---|---|",
    ]
    for name, w in res["worlds"].items():
        a = w["ab"]
        lines.append(
            f"| {name} | {_pct(a['offered'])} | {_pct(a['tapped'])} "
            f"| {_pct(a['pick_linucb'])} | {_pct(a['done_linucb_primary'])} "
            f"| {_pct(a['done_heuristic_primary'])} |"
        )
    lines += [
        "",
        "## Limits",
        "",
        "- Simulated students only; traits are assumptions, not calibrated.",
        "- The result depends on the reaction mix; see the sensitivity table.",
        "- Lectures fill the calendar; placed tasks do not.",
        "- A start depends on the start hour only. The student opens the app more "
        "near a deadline, so the deadline term is scored against the assumed student.",
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
        "| Assumption | L − H | Pick rate | L starts | L hours left | L within 24h |",
        "|---|---|---|---|---|---|",
    ]
    for name, r in rows.items():
        lines.append(
            f"| {name} | {_fmt(r['L_minus_H'])} | {_pct(r['pick_linucb'])} "
            f"| {r['L_starts']:.2f} | {r['L_hours']:.1f} "
            f"| {100 * r['L_within_24h']:.0f}% |"
        )
    return "\n".join(lines) + "\n"


def render_deadline(rows: dict[str, Any]) -> str:
    lines = [
        "# Deadline term (seeds 0 and up, band worlds, mean over worlds)",
        "",
        "| Weight and horizon | H starts | H hours | L starts | L hours "
        "| L within 24h "
        "| Oracle starts |",
        "|---|---|---|---|---|---|---|",
    ]
    for weight, r in rows.items():
        lines.append(
            f"| {weight} | {r['H']['mean']:.2f} | {r['H']['slack_h']:.1f} "
            f"| {r['L']['mean']:.2f} | {r['L']['slack_h']:.1f} "
            f"| {100 * r['L']['within_24h']:.0f}% | {r['Oracle']['mean']:.2f} |"
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
    run.add_argument("--seeds", type=int, default=100)
    run.add_argument("--students", type=int, default=100)
    run.add_argument("--workers", type=int, default=8)
    run.add_argument("--arms", default="", help="default: the mode's headline arms")
    run.add_argument(
        "--ablations",
        action="store_true",
        help="semester: add the deadline and gap arms",
    )
    run.add_argument("--out", type=Path, default=Path(__file__).parent / "out")
    run.add_argument("--seed-offset", type=int, default=0)
    run.add_argument("--config", default="{}")
    sub_bands = argparse.ArgumentParser(add_help=False)
    sub_bands.add_argument(
        "--bands", action="store_true", help="the fixed band worlds, not the semester"
    )
    sens = sub.add_parser(
        "sensitivity",
        help="student traits, alpha and component weights",
        parents=[sub_bands],
    )
    sens.add_argument("--seeds", type=int, default=10)
    sens.add_argument("--students", type=int, default=20)
    sens.add_argument("--workers", type=int, default=8)
    sens.add_argument("--out", type=Path, default=Path(__file__).parent / "out")
    heur = sub.add_parser(
        "heuristic", help="the heuristic's own deadline reach and weight"
    )
    heur.add_argument("--seeds", type=int, default=10)
    heur.add_argument("--students", type=int, default=50)
    heur.add_argument("--workers", type=int, default=8)
    heur.add_argument("--out", type=Path, default=Path(__file__).parent / "out")
    mis = sub.add_parser("misspec", help="start curves the learner was not built for")
    mis.add_argument("--seeds", type=int, default=10)
    mis.add_argument("--students", type=int, default=50)
    mis.add_argument("--workers", type=int, default=8)
    mis.add_argument("--out", type=Path, default=Path(__file__).parent / "out")
    real = sub.add_parser(
        "reality", help="less generous students, signals and routines"
    )
    real.add_argument("--seeds", type=int, default=10)
    real.add_argument("--students", type=int, default=50)
    real.add_argument("--workers", type=int, default=8)
    real.add_argument("--out", type=Path, default=Path(__file__).parent / "out")
    real.add_argument("--seed-offset", type=int, default=100)
    dl = sub.add_parser(
        "deadline",
        help="done rate and distance by deadline weight",
        parents=[sub_bands],
    )
    dl.add_argument("--seeds", type=int, default=10)
    dl.add_argument("--students", type=int, default=100)
    dl.add_argument("--workers", type=int, default=8)
    dl.add_argument("--out", type=Path, default=Path(__file__).parent / "out")
    args = ap.parse_args(argv)

    if args.cmd == "misspec":
        from evalx import semester

        args.out.mkdir(parents=True, exist_ok=True)
        rows = semester.misspec_sweep(args.out, args.seeds, args.students, args.workers)
        text = semester.render_misspec(rows)
        (args.out / "misspec.md").write_text(text)
        print(text)
        return 0

    if args.cmd == "reality":
        from evalx import semester

        args.out.mkdir(parents=True, exist_ok=True)
        rows = semester.reality_sweep(
            args.out, args.seeds, args.students, args.workers, args.seed_offset
        )
        text = semester.render_reality(rows, args.seed_offset)
        (args.out / "reality.md").write_text(text)
        print(text)
        return 0

    if args.cmd == "heuristic":
        from evalx import semester

        args.out.mkdir(parents=True, exist_ok=True)
        rows = semester.heuristic_sweep(
            args.out, args.seeds, args.students, args.workers
        )
        text = semester.render_heuristic(rows)
        (args.out / "heuristic.md").write_text(text)
        print(text)
        return 0

    if args.cmd in ("deadline", "sensitivity") and not args.bands:
        from evalx import semester

        args.out.mkdir(parents=True, exist_ok=True)
        run_sweep, show = (
            (semester.deadline_sweep, semester.render_deadline)
            if args.cmd == "deadline"
            else (semester.sensitivity, semester.render_sensitivity)
        )
        rows = run_sweep(args.out, args.seeds, args.students, args.workers)
        text = show(rows)
        (args.out / f"{args.cmd}.md").write_text(text)
        print(text)
        return 0

    if args.cmd == "deadline":
        args.out.mkdir(parents=True, exist_ok=True)
        rows = deadline_sweep(args.out, args.seeds, args.students, args.workers)
        text = render_deadline(rows)
        (args.out / "deadline.md").write_text(text)
        print(text)
        return 0

    if args.cmd == "sensitivity":
        args.out.mkdir(parents=True, exist_ok=True)
        rows = sensitivity(args.out, args.seeds, args.students, args.workers)
        text = render_sensitivity(rows)
        (args.out / "sensitivity.md").write_text(text)
        print(text)
        return 0

    arms = tuple(a.strip() for a in args.arms.split(",") if a.strip())
    if args.cmd == "run" and not arms:
        cfg = json.loads(args.config)
        if cfg.get("mode", CFG["mode"]) == "semester":
            from evalx import semester

            arms = semester.SEMESTER_ARMS + (
                semester.ABLATIONS if args.ablations else ()
            )
        else:
            arms = ARMS
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
    if "arms" in res:
        from evalx import report_generator

        text = report_generator.render(res)
        (args.out / "report.md").write_text(text)
        (args.out / "tables.tex").write_text(report_generator.render_latex(res))
        print(text)
    elif set(ARMS) <= set(arms):
        (args.out / "report.md").write_text(render(res))
        print(render(res))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
