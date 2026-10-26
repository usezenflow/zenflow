"""The semester eval: every arm runs a full 15-week semester for sampled students.

Each student gets the same semester (timetable, assignments, exams) and the same
random draws under every arm, so arms differ only by placement. Placed blocks
occupy the calendar for later placements, as in production. Learning follows
``run.py``: KEPT +1, MOVE by distance, pairwise rewards as the backend.

Arms
  H, L, L-cold      as in ``run.py``
  Fixed             7 pm the day before the deadline, nearest free slot back from it
  Oracle            the free slot with the best chance of a completion (ceiling)
  Rand              a random day and hour in the window (floor)
  AB                the live protocol: 50/50 primary, both slots, a pairwise offer
Ablations (``ABLATIONS``) add the deadline and gap variants of H and L.
"""

from __future__ import annotations

import json
import random
import warnings
from collections.abc import Callable
from dataclasses import replace
from pathlib import Path
from typing import Any

import numpy as np

from evalx import metrics, student_behavior
from evalx import run as core
from evalx.academic_calendar import WEEKS, Semester, build_semester, week_of
from evalx.hourly import HourlyArms
from evalx.student_behavior import (
    PassiveStudent,
    sample_opens,
    sample_shifts,
    sample_student,
)
from evalx.world import HOUR_MS, Calendar, Task, busy_minutes
from src.core.constants import (
    DAY_MS,
    KEPT_REWARD,
    MS_PER_MINUTE,
    PREFERENCE_KEPT_WEIGHT,
)
from src.core.preference import default_preference_matrix
from src.core.reward import drag_distance_reward
from src.schemas import HOUR_ARM_IDS

HEADLINE = (
    "H",
    "L",
    "L-cold",
    "L-flat",
    "H-frozen",
    "ASAP",
    "Fixed",
    "Oracle",
    "Rand",
)
# Arms the semester adds to ``run.ARM_SPEC``: baselines that test what L and H earn.
# Delete scoring (ADR-0043). An LinUCB arm learns the delete reward; a
# heuristic arm updates its matrix with PREFERENCE_KEPT_WEIGHT times the same reward.
DELETE_ARMS: dict[str, dict[str, Any]] = {
    **{
        f"L+D{r:g}": {"policy": "LINUCB", "delete_reward": r}
        for r in (-0.1, -0.25, -0.5)
    },
    **{
        f"{name}+M{r * PREFERENCE_KEPT_WEIGHT:g}": {
            "policy": "HEURISTIC",
            "delete_weight": r * PREFERENCE_KEPT_WEIGHT,
            **({"kernel": True} if name == "H+K" else {}),
        }
        for name in ("H", "H+K")
        for r in (-0.125, -0.25, -0.5)
    },
}

EXTRA_SPEC: dict[str, dict[str, Any]] = {
    **DELETE_ARMS,
    "H-frozen": {"policy": "HEURISTIC", "frozen": True},  # H that never learns
    "L-flat": {"policy": "LINUCB", "context": "none"},  # LinUCB with no features
    "ASAP": {"policy": "ASAP"},  # earliest free slot, as an EDF queue would
    "H+K": {"policy": "HEURISTIC", "kernel": True},  # H with the hour kernel
    "L+K": {"policy": "LINUCB", "kernel": True},  # L with the hour kernel
    "L-hourly": {"policy": "HOURLY"},  # 24 hour arms, no kernel
    "L-hourly-K": {"policy": "HOURLY", "kernel": True},  # 24 hour arms, kernel
    # Plan steps 2 to 4, each on top of the one before (step 1 is L-hourly-K).
    "L-hourly-K+S": {"policy": "HOURLY", "kernel": True, "features": True},
    "L-hourly-K+S0": {
        "policy": "HOURLY",
        "kernel": True,
        "features": True,
        "shared_alpha": 0.0,
    },
    "L-hourly-K+SF": {
        "policy": "HOURLY",
        "kernel": True,
        "features": True,
        "hour_free": True,
    },
    # Paper-style disjoint features (plan phase A). Membership needs opens.
    "L-hourly-K+N": {"policy": "HOURLY", "kernel": True, "norm": True},
    "L-hourly-K+CO+N": {
        "policy": "HOURLY",
        "kernel": True,
        "posterior": True,
        "opens": True,
        "norm": True,
    },
    "L-hourly-K+CO+Ua": {
        "policy": "HOURLY",
        "kernel": True,
        "posterior": True,
        "opens": True,
        "norm": True,
        "membership": "append",
    },
    "L-hourly-K+CO+Ur": {
        "policy": "HOURLY",
        "kernel": True,
        "posterior": True,
        "opens": True,
        "norm": True,
        "membership": "replace",
    },
    "L-hourly-K+C": {"policy": "HOURLY", "kernel": True, "posterior": True},
    "L-hourly-K+CO": {
        "policy": "HOURLY",
        "kernel": True,
        "posterior": True,
        "opens": True,
    },
    "L-hourly-K+LR": {"policy": "HOURLY", "kernel": True, "start_model": True},
    "L-hourly-K+CSO": {
        "policy": "HOURLY",
        "kernel": True,
        "posterior": True,
        "features": True,
        "opens": True,
    },
}
ABLATIONS = ("H-deadline", "L-deadline", "L-nogap", "L-nogap-deadline")
SEMESTER_ARMS = (*HEADLINE, "AB")
LONG_WINDOW_DAYS = core.LONG_WINDOW_DAYS
CLOSE_HOURS = core.CLOSE_HOURS
DONE_RATE_DELTA = 0.03  # non-inferiority margin, share of tasks completed
CURVE_TASKS = 30
FIXED_HOUR = 19  # the Fixed baseline's start hour
EARLIEST_H = 6  # no baseline starts a block before this hour
PAIRS: dict[str, tuple[str, str]] = {
    "L_minus_H": ("L", "H"),
    "L_minus_Fixed": ("L", "Fixed"),
    "H_minus_Fixed": ("H", "Fixed"),
    "L_minus_ASAP": ("L", "ASAP"),
    "L_minus_Hfrozen": ("L", "H-frozen"),
    "H_minus_Hfrozen": ("H", "H-frozen"),
    "context": ("L", "L-flat"),
    "prior": ("L", "L-cold"),
    "deadline": ("L", "L-deadline"),
    "deadline_H": ("H", "H-deadline"),
    "gap": ("L", "L-nogap"),
    "gap_only": ("L-deadline", "L-nogap-deadline"),
    "kernel_L": ("L+K", "L"),
    "hourly_K_vs_L": ("L-hourly-K", "L"),
    "hourly_K_vs_hourly": ("L-hourly-K", "L-hourly"),
    "hourly_vs_L": ("L-hourly", "L"),
    "S_vs_K": ("L-hourly-K+S", "L-hourly-K"),
    "CO_vs_K": ("L-hourly-K+CO", "L-hourly-K"),
    "C_vs_K": ("L-hourly-K+C", "L-hourly-K"),
    "O_vs_C": ("L-hourly-K+CO", "L-hourly-K+C"),
    "SCO_vs_K": ("L-hourly-K+CSO", "L-hourly-K"),
    "N_vs_K": ("L-hourly-K+N", "L-hourly-K"),
    "N_vs_L": ("L-hourly-K+N", "L"),
    "N_vs_HK": ("L-hourly-K+N", "H+K"),
    "CON_vs_CO": ("L-hourly-K+CO+N", "L-hourly-K+CO"),
    "Ua_vs_CON": ("L-hourly-K+CO+Ua", "L-hourly-K+CO+N"),
    "Ur_vs_CON": ("L-hourly-K+CO+Ur", "L-hourly-K+CO+N"),
    "kernel_H": ("H+K", "H"),
    "L_minus_HK": ("L", "H+K"),
}
# Column keys: s = done (1.0 if the student completed the block), p = done
# chance, m = deadline margin hours, c = conflict free, tap/offer/pick/pri are
# AB pairwise fields, mov = move flag.
COLS = ("s", "p", "m", "c", "tap", "mov", "off", "pl", "pri")


# --- Calendar bookkeeping ------------------------------------------------------


def _occupy(placed: core.Placed, start_ms: int, minutes: int) -> None:
    """Record a block as busy time, split at midnight."""
    ms, end = start_ms, start_ms + minutes * MS_PER_MINUTE
    while ms < end:
        day = ms // DAY_MS
        nxt = min(end, (day + 1) * DAY_MS)
        lo = (ms - day * DAY_MS) // MS_PER_MINUTE
        hi = (nxt - day * DAY_MS) // MS_PER_MINUTE
        placed.setdefault(day, []).append((lo, hi))
        ms = nxt


def _clear(start_ms: int, minutes: int, cal: Calendar, placed: core.Placed) -> bool:
    """Whether a block avoids every lecture and every block already placed."""
    ms, end = start_ms, start_ms + minutes * MS_PER_MINUTE
    while ms < end:
        day = ms // DAY_MS
        nxt = min(end, (day + 1) * DAY_MS)
        lo = (ms - day * DAY_MS) // MS_PER_MINUTE
        hi = (nxt - day * DAY_MS) // MS_PER_MINUTE
        busy = [*cal.busy.get(day, []), *placed.get(day, [])]
        if any(lo < be and hi > bs for bs, be in busy):
            return False
        ms = nxt
    return True


def fixed_start(task: Task, cal: Calendar, placed: core.Placed) -> int | None:
    """7 pm the day before the deadline, else the nearest free earlier start.

    Searches that day from 19:00 back to 06:00 in 15 minute steps, then earlier
    days, then the deadline day. ``None`` when nothing in the window is free.
    """
    last = (task.deadline_ms - 1) // DAY_MS
    first = task.arrival_ms // DAY_MS
    days = [*range(last - 1, first - 1, -1), last]
    length = task.duration_min * MS_PER_MINUTE
    for day in days:
        for minute in range(FIXED_HOUR * 60, EARLIEST_H * 60 - 1, -15):
            start: int = day * DAY_MS + minute * MS_PER_MINUTE
            if start < task.arrival_ms or start + length > task.deadline_ms:
                continue
            if _clear(start, task.duration_min, cal, placed):
                return start
    return None


def asap_start(task: Task, cal: Calendar, placed: core.Placed) -> int | None:
    """The earliest free start from arrival, between 06:00 and 23:00."""
    length = task.duration_min * MS_PER_MINUTE
    for day in range(task.arrival_ms // DAY_MS, (task.deadline_ms - 1) // DAY_MS + 1):
        for minute in range(EARLIEST_H * 60, 23 * 60 - task.duration_min + 1, 15):
            start = day * DAY_MS + minute * MS_PER_MINUTE
            if start < task.arrival_ms or start + length > task.deadline_ms:
                continue
            if _clear(start, task.duration_min, cal, placed):
                return start
    return None


def random_start(task: Task, rng: random.Random) -> int:
    """A random day in the window at a random hour from 08:00 to 21:00, clamped."""
    days = max(1, (task.deadline_ms - task.arrival_ms) // DAY_MS)
    midnight = (task.arrival_ms // DAY_MS) * DAY_MS
    start = (
        midnight + rng.randrange(int(days)) * DAY_MS + rng.randrange(8, 22) * HOUR_MS
    )
    latest = task.deadline_ms - task.duration_min * MS_PER_MINUTE
    return min(max(start, task.arrival_ms), latest)


# --- One student ---------------------------------------------------------------


def _row(
    task: Task,
    start: int | None,
    started: bool,
    p: float,
    cal: Calendar,
    placed: core.Placed,
) -> dict[str, float | None]:
    """The record of one task. ``start`` is ``None`` when nothing was placed."""
    if start is None:
        return dict.fromkeys(COLS)
    margin = metrics.deadline_margin_h(
        np.array([start + task.duration_min * MS_PER_MINUTE]),
        np.array([task.deadline_ms]),
    )[0]
    clear = _clear(start, task.duration_min, cal, placed)
    return {"s": float(started), "p": p, "m": float(margin), "c": float(clear)}


def _unplaced() -> dict[str, float | None]:
    return {"s": 0.0, "p": 0.0, "m": None, "c": None}


def parse_arm(arm: str) -> dict[str, Any]:
    """The spec of an arm named ``H:<reach h>:<weight>[:hr]`` or ``L:...``.

    ``hr`` scales the weight by the block's hours, so a 3 hour block pays three
    times a 1 hour block, as the heuristic's preference sum does.
    """
    policy, reach, weight, *flag = arm.split(":")
    spec: dict[str, Any] = {
        "policy": "HEURISTIC" if policy == "H" else "LINUCB",
        "deadline_weight": float(weight),
        "per_hour": "hr" in flag,
    }
    spec["heuristic_horizon" if policy == "H" else "deadline_horizon"] = float(reach)
    return spec


Noise = list[tuple[float, float]]


class Feedback:
    """What the learner hears of a student's actions, as the live app would.

    A kept slot reaches the learner with chance ``detect`` (the sweep missed it);
    every effect lands ``delay`` tasks late.
    The student's true behaviour, and so the metrics, are untouched.
    """

    def __init__(self, noise: Noise | None) -> None:
        self.noise = noise
        self.queue: list[tuple[int, Callable[[], None]]] = []

    def delete_draw(self, n: int) -> float:
        """The student's delete draw for task ``n``. 1 (never deletes) without noise."""
        return self.noise[n][1] if self.noise else 1.0

    def seen(self, n: int, signal: str | None) -> str | None:
        u_detect = self.noise[n][0] if self.noise else 0.0
        if signal == "KEPT":
            return "KEPT" if u_detect < core.CFG["detect"] else None
        return signal

    def defer(self, n: int, effect: Callable[..., None]) -> None:
        if core.CFG["delay"] <= 0:
            effect()
        else:
            self.queue.append((n + int(core.CFG["delay"]), effect))

    def flush(self, n: int) -> None:
        due = [e for k, e in self.queue if k <= n]
        self.queue = [(k, e) for k, e in self.queue if k > n]
        for effect in due:
            effect()


def simulate_arm(
    s: PassiveStudent,
    sem: Semester,
    arm: str,
    rng: random.Random,
    noise: Noise | None = None,
) -> list[dict[str, float | None]]:
    """One student through one single-policy arm, one record per task."""
    spec = (
        core.ARM_SPEC.get(arm)
        or EXTRA_SPEC.get(arm)
        or (parse_arm(arm) if ":" in arm else {"policy": arm.upper()})
    )
    policy = spec["policy"]
    kern = core.kernel_of(spec)
    cal = sem.calendar
    state: dict[str, dict[str, list[float]]] = {
        a: {"A": [], "b": []} for a in HOUR_ARM_IDS
    }
    hourly = (
        HourlyArms(
            default_preference_matrix(),
            core.CFG["alpha"],
            core.CFG["ridge"],
            posterior=bool(spec.get("posterior")),
            features=bool(spec.get("features")),
            shared_alpha=spec.get("shared_alpha"),
            hour_free=bool(spec.get("hour_free")),
            norm=bool(spec.get("norm")),
            membership=spec.get("membership"),
            start_model=bool(spec.get("start_model")),
        )
        if policy == "HOURLY"
        else None
    )
    opens: list[int] = []
    if hourly and spec.get("opens"):
        end = max((t.deadline_ms for t in sem.tasks), default=0)
        opens = sample_opens(
            s, rng, end, core.CFG["opens_shift"], core.CFG["opens_uninformative"]
        )
    next_open = 0
    box = [core._table()]
    feed = Feedback(noise)
    placed: core.Placed = {}
    rows: list[dict[str, float | None]] = []
    for n, task in enumerate(sem.tasks):
        feed.flush(n)
        while (
            hourly is not None
            and next_open < len(opens)
            and opens[next_open] < task.arrival_ms
        ):
            hourly.observe_open((opens[next_open] % DAY_MS) // HOUR_MS)
            next_open += 1
        lin = None
        if policy in ("HEURISTIC", "LINUCB"):
            placing = spec
            if spec.get("per_hour"):
                weight = spec["deadline_weight"] * task.duration_min / 60
                placing = {**spec, "deadline_weight": weight}
            with core._knobs(placing):
                res = core._place(task, policy, state, box[0], n, cal, placed=placed)
            if res is None:
                rows.append(_unplaced())
                continue
            lin = res.get("linucb") if res.get("appliedPolicy") == "LINUCB" else None
            start: int | None = lin["startMs"] if lin else res["startMs"]
        elif policy == "HOURLY":
            assert hourly is not None
            body = core.place_body(task, "LINUCB", state, box[0], n, cal, placed=placed)
            fixed, placed_ms = {}, {}
            for d in body["days"]:
                d0 = d["dayStartMs"]
                fixed[d0] = [
                    (d0 + a * MS_PER_MINUTE, d0 + b * MS_PER_MINUTE)
                    for a, b in busy_minutes(cal, d0)
                ]
                placed_ms[d0] = [
                    (d0 + a * MS_PER_MINUTE, d0 + b * MS_PER_MINUTE)
                    for a, b in placed.get(d0 // DAY_MS, [])
                ]
            pick = hourly.pick(body, [], None, fixed, placed_ms)
            start = pick.start_ms if pick else None
            if pick:
                lin = {
                    "selectedArm": pick.hour,
                    "featureVector": pick.vector.tolist(),
                    "slot": pick.slot.tolist(),
                }
        elif policy == "ORACLE":
            start = s.oracle_start(task, cal, placed)
        elif policy == "FIXED":
            start = fixed_start(task, cal, placed)
        elif policy == "ASAP":
            start = asap_start(task, cal, placed)
        else:
            start = random_start(task, rng)
        if start is None:
            rows.append(_unplaced())
            continue
        done, signal, applied, p = s.react(task, start, cal, feed.delete_draw(n))
        row = _row(task, applied, done, p, cal, placed)
        row["mov"] = float(signal == "MOVE")
        rows.append(row)
        if signal != "DELETE":  # a deleted block frees its slot
            _occupy(placed, applied, task.duration_min)
        heard = feed.seen(n, signal)
        reward: float | None = None
        if hourly and hourly.start_model and lin:
            hour, z = lin["selectedArm"], np.asarray(lin["slot"])
            done_label = heard == "KEPT"
            feed.defer(
                n,
                lambda h=hour, v=z, y=done_label: hourly.observe_label(h, v, y),
            )
        if heard == "KEPT":
            reward = KEPT_REWARD
            if not spec.get("frozen"):
                feed.defer(
                    n,
                    lambda a=applied: box.__setitem__(0, core._kept(box[0], a, kern)),
                )
        elif heard == "MOVE":
            drag = abs(applied - start) / MS_PER_MINUTE
            reward = drag_distance_reward(drag, core.CFG["move_scale"])
            feed.defer(
                n,
                lambda o=start, a=applied, d=drag: box.__setitem__(
                    0, core._moved(box[0], o, a, d, kern)
                ),
            )
        elif heard == "DELETE":
            # Only arms that declare a delete signal learn from it.
            reward = spec.get("delete_reward")
            if spec.get("delete_weight") is not None:
                feed.defer(
                    n,
                    lambda a=applied, w=spec["delete_weight"]: box.__setitem__(
                        0, core._deleted(box[0], a, w, kern)
                    ),
                )
        if lin and reward is not None:
            slot = lin.get("slot")
            feed.defer(
                n,
                lambda a=lin["selectedArm"], x=lin["featureVector"], r=reward, z=slot: (
                    hourly.update(
                        a,
                        np.asarray(x),
                        r,
                        kern[0],
                        None if z is None else np.asarray(z),
                    )
                    if hourly
                    else core._learn(state, a, x, r, spec)
                ),
            )
    return rows


def simulate_ab(
    s: PassiveStudent,
    sem: Semester,
    spec: dict[str, Any] | None = None,
    noise: Noise | None = None,
) -> list[dict[str, float | None]]:
    """One student under the live protocol; the rules are ``run.simulate_ab``."""
    variant = spec or {}
    cal = sem.calendar
    state: dict[str, dict[str, list[float]]] = {
        a: {"A": [], "b": []} for a in HOUR_ARM_IDS
    }
    box = [core._table()]
    feed = Feedback(noise)
    placed: core.Placed = {}
    rows: list[dict[str, float | None]] = []
    for n, task in enumerate(sem.tasks):
        feed.flush(n)
        primary = "LINUCB" if task.u_coin < 0.5 else "HEURISTIC"
        with core._knobs(variant):
            res = core._place(
                task, primary, state, box[0], n, cal, both=True, placed=placed
            )
        if res is None or not res.get("linucb") or not res.get("heuristic"):
            rows.append(_unplaced())
            continue
        lin, heu = res["linucb"], res["heuristic"]
        ls, hs = lin["startMs"], heu["startMs"]
        prim, alt = (ls, hs) if primary == "LINUCB" else (hs, ls)
        alt_policy = "HEURISTIC" if primary == "LINUCB" else "LINUCB"
        offered = abs(hs - ls) >= core.MIN_ALTERNATIVE_GAP_MINUTES * MS_PER_MINUTE
        tapped = offered and s.sees_offer(task)
        applied, applied_policy = prim, primary
        x, arm_id = lin["featureVector"], lin["selectedArm"]
        if tapped:
            if core.pick_alternative(
                s.utility(prim), s.utility(alt), task.eps_primary, task.eps_alt
            ):
                applied, applied_policy = alt, alt_policy
            if applied_policy == "LINUCB":
                core._learn(state, arm_id, x, core.PAIRWISE_WIN_REWARD, variant)
            elif primary == "HEURISTIC":
                core._learn(state, arm_id, x, core.PAIRWISE_LOSS_REWARD, variant)
                box[0] = core._kept(box[0], applied)
            else:
                drag = abs(hs - ls) / MS_PER_MINUTE
                learn_reward = drag_distance_reward(drag, core.CFG["move_scale"])
                core._learn(state, arm_id, x, learn_reward, variant)
                box[0] = core._moved(box[0], ls, hs, drag)
        done, signal, final, p = s.react(task, applied, cal)
        row = _row(task, final, done, p, cal, placed)
        row.update(
            tap=float(tapped),
            mov=float(signal == "MOVE"),
            off=float(offered),
            pl=float(tapped and applied_policy == "LINUCB"),
            pri=float(primary == "LINUCB"),
        )
        rows.append(row)
        _occupy(placed, final, task.duration_min)
        heard = feed.seen(n, signal)
        reward: float | None = None
        if heard == "KEPT":
            reward = KEPT_REWARD
            feed.defer(n, lambda a=final: box.__setitem__(0, core._kept(box[0], a)))
        elif heard == "MOVE":
            drag = abs(final - applied) / MS_PER_MINUTE
            reward = drag_distance_reward(drag, core.CFG["move_scale"])
            feed.defer(
                n,
                lambda o=applied, a=final, d=drag: box.__setitem__(
                    0, core._moved(box[0], o, a, d)
                ),
            )
        if reward is not None and applied_policy == "LINUCB":
            feed.defer(
                n,
                lambda a=arm_id, v=x, r=reward: core._learn(state, a, v, r, variant),
            )
    return rows


def _meta(s: PassiveStudent, sem: Semester) -> dict[str, Any]:
    return {
        "chronotype": s.chronotype,
        "respond": s.respond,
        "attention": s.attention,
        "weak": sem.weak,
        "week": [week_of((t.deadline_ms - 1) // DAY_MS) for t in sem.tasks],
        "exam": [int(t.kind == "EXAM") for t in sem.tasks],
        "long": [
            int(t.deadline_ms - t.arrival_ms >= LONG_WINDOW_DAYS * DAY_MS)
            for t in sem.tasks
        ],
    }


def reality(s: PassiveStudent, seed: int, idx: int) -> PassiveStudent:
    """Apply the reality knobs to a sampled student. Separate draws, so the
    population and semester are the same at every setting."""
    cfg = core.CFG
    s = replace(
        s,
        timing=cfg["timing"],
        respond=min(1.0, s.respond * cfg["tap_scale"]),
        attention=min(1.0, s.attention * cfg["attention_scale"]),
        delete_noise=cfg["delete_noise"],
        delete_slot=cfg["delete_slot"],
    )
    if cfg["shape"]:
        rng = random.Random(f"shape:{seed}:{idx}")
        if cfg["shape"] == "bimodal":
            sign = 1 if rng.random() < 0.5 else -1
            s = replace(s, second_offset_h=sign * rng.uniform(8, 12))
        else:  # weekday: the peak moves up to 3 hours either way on each weekday
            s = replace(s, weekday_shift=tuple(rng.uniform(-3, 3) for _ in range(7)))
    drift = cfg["drift"]
    if drift:
        rng = random.Random(f"drift:{seed}:{idx}")
        s = replace(s, shifts=sample_shifts(rng, drift["kind"], drift["hours"]))
    return s


def run_seed(seed: int, students: int, arms: tuple[str, ...]) -> dict[str, Any]:
    """Every sampled student through every arm for one seed.

    Each draw depends only on the seed, student index and arm, so a rerun
    reproduces the part byte for byte.
    """
    out: dict[str, Any] = {"seed": seed, "students": []}
    student_behavior.FATIGUE_SCALE = float(core.CFG.get("fatigue_scale", 1.0))
    for idx in range(students):
        s = sample_student(
            random.Random(f"student:{seed}:{idx}"), idx, core.CFG["chrono"]
        )
        if core.CFG["drag"]:
            s = s.with_drag(core.CFG["drag"])
        s = replace(s, imminence=min(1.0, s.imminence * core.CFG["imminence"]))
        s = reality(s, seed, idx)
        sem = build_semester(random.Random(f"semester:{seed}:{idx}"))
        sig = random.Random(f"signal:{seed}:{idx}")
        noise = [(sig.random(), sig.random()) for _ in sem.tasks]
        per: dict[str, Any] = {}
        for arm in arms:
            if arm == "AB":
                per[arm] = simulate_ab(s, sem, noise=noise)
            else:
                rng = random.Random(f"rand:{seed}:{idx}:{arm}")
                per[arm] = simulate_arm(s, sem, arm, rng, noise)
        out["students"].append({"meta": _meta(s, sem), "arms": per})
    return out


# --- Aggregation ---------------------------------------------------------------


def _grid(values: list[list[Any]]) -> np.ndarray:
    """Ragged per-student lists as a NaN padded (students, tasks) array."""
    width = max(len(v) for v in values)
    grid = np.full((len(values), width), np.nan)
    for i, v in enumerate(values):
        grid[i, : len(v)] = [np.nan if x is None else x for x in v]
    return grid


def _col(rows: list[list[dict[str, Any]]], key: str) -> np.ndarray:
    return _grid([[r.get(key) for r in student] for student in rows])


def _per_student(
    cols: dict[str, np.ndarray], long: np.ndarray
) -> dict[str, np.ndarray]:
    """Student level outcomes from one arm's task grids."""
    done = cols["s"]
    valid = ~np.isnan(done)
    tasks = valid.sum(axis=1)
    margin = cols["m"]
    placed = ~np.isnan(margin)
    close = (margin < CLOSE_HOURS) & placed & (long > 0)
    window = placed & (long > 0)
    zero = np.nan_to_num
    with np.errstate(invalid="ignore", divide="ignore"), warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)  # a student with no blocks
        return {
            "done_rate": zero(done).sum(axis=1) / tasks,
            "dones": zero(done).sum(axis=1),
            "margin_h": np.nanmean(margin, axis=1),
            "last_day": close.sum(axis=1) / window.sum(axis=1),
            "conflict_free": np.nanmean(cols["c"], axis=1),
            "burden": zero(done).sum(axis=1)
            + zero(cols["tap"]).sum(axis=1)
            + zero(cols["mov"]).sum(axis=1),
        }


def _ci(values: np.ndarray, seed: int) -> dict[str, float]:
    ok = values[~np.isnan(values)]
    if not len(ok):
        return {"mean": float("nan"), "ci_lo": float("nan"), "ci_hi": float("nan")}
    lo, hi = metrics.bootstrap_ci(ok, seed)
    return {"mean": float(ok.mean()), "ci_lo": lo, "ci_hi": hi}


def verdict(c: dict[str, float]) -> str:
    """Read a done-rate contrast from both intervals, taking the wider side."""
    lo, hi = min(c["ci_lo"], c["seed_lo"]), max(c["ci_hi"], c["seed_hi"])
    if lo > 0:
        return "better"
    if hi < 0:
        return "worse" if lo < -DONE_RATE_DELTA else "slightly worse"
    return "level"


def _ab_summary(rows: list[list[dict[str, Any]]]) -> dict[str, Any]:
    """Offer, tap and pick rates with student-cluster intervals."""
    g = {k: np.nan_to_num(_col(rows, k)).sum(axis=1) for k in COLS}
    placed = (~np.isnan(_col(rows, "p"))).astype(float)
    events = placed.sum(axis=1)
    started = np.nan_to_num(_col(rows, "s"))
    primary = np.nan_to_num(_col(rows, "pri"))
    rate = metrics.cluster_rate
    return {
        "offered": rate(g["off"], events, 3),
        "tapped": rate(g["tap"], g["off"], 3),
        "pick_linucb": rate(g["pl"], g["tap"], 3),
        "start_linucb_primary": rate((started * primary).sum(axis=1), g["pri"], 3),
        "start_heuristic_primary": rate(
            (started * (1 - primary) * placed).sum(axis=1), events - g["pri"], 3
        ),
        "done_rate": rate(g["s"], events, 3),
    }


def _groups(meta: list[dict[str, Any]], diff: np.ndarray) -> dict[str, Any]:
    """L minus H in done rate by chronotype, attention tercile and offer response."""
    attention = np.array([m["attention"] for m in meta])
    lo, hi = np.quantile(attention, [1 / 3, 2 / 3])
    keys: dict[str, np.ndarray] = {
        **{
            c: np.array([m["chronotype"] == c for m in meta])
            for c in ("lark", "day", "evening", "owl")
        },
        "low attention": attention < lo,
        "middle attention": (attention >= lo) & (attention < hi),
        "high attention": attention >= hi,
        "never answers offers": np.array([m["respond"] == 0 for m in meta]),
        "answers offers": np.array([m["respond"] > 0 for m in meta]),
    }
    out: dict[str, Any] = {}
    for name, mask in keys.items():
        d = diff[mask]
        lo_ci, hi_ci = metrics.bootstrap_ci(d, 7)
        out[name] = {
            "n": int(mask.sum()),
            "mean": float(d.mean()),
            "ci_lo": lo_ci,
            "ci_hi": hi_ci,
            "share_better": float((d > 0).mean()),
            "share_worse": float((d < 0).mean()),
        }
    return out


def merge(
    parts: list[dict[str, Any]], arms: tuple[str, ...], config: dict[str, Any]
) -> dict[str, Any]:
    """Pool every seed's students: arm summaries, contrasts, curves and the AB rates."""
    seeds = len(parts)
    students = [st for p in parts for st in p["students"]]
    meta = [st["meta"] for st in students]
    long = _grid([m["long"] for m in meta])
    week = _grid([m["week"] for m in meta])
    exam = _grid([m["exam"] for m in meta])
    per: dict[str, dict[str, np.ndarray]] = {}
    grids: dict[str, dict[str, np.ndarray]] = {}
    ab_rows: list[list[dict[str, Any]]] | None = None
    for arm in arms:
        rows = [st["arms"][arm] for st in students]
        if arm == "AB":
            ab_rows = rows
        grids[arm] = {k: _col(rows, k) for k in COLS}
        per[arm] = _per_student(grids[arm], long)
    out: dict[str, Any] = {"config": config, "arms": {}, "contrasts": {}}
    out["population"] = {
        "students": len(students),
        "tasks_per_student": float(np.mean([len(m["week"]) for m in meta])),
        "exams_per_student": float(np.mean([sum(m["exam"]) for m in meta])),
        "ignorers": float(np.mean([m["respond"] == 0 for m in meta])),
        "chronotypes": {
            c: float(np.mean([m["chronotype"] == c for m in meta]))
            for c in ("lark", "day", "evening", "owl")
        },
    }
    for arm in arms:
        a = per[arm]
        entry: dict[str, Any] = {k: _ci(v, 1) for k, v in a.items()}
        per_seed = a["done_rate"].reshape(seeds, -1).mean(axis=1)
        entry["done_rate"]["seed_sd"] = (
            float(per_seed.std(ddof=1)) if seeds > 1 else 0.0
        )
        out["arms"][arm] = entry
    names = [n for n, (x, y) in PAIRS.items() if x in per and y in per]
    labels = [PAIRS[n] for n in names]
    contrasts: dict[str, dict[str, Any]] = {}
    for name, (x, y) in zip(names, labels, strict=True):
        diff = per[x]["done_rate"] - per[y]["done_rate"]
        contrasts[name] = metrics.contrast(diff, seeds, seed=2)
        contrasts[name]["verdict"] = verdict(contrasts[name])
        base = float(per[y]["done_rate"].mean())
        contrasts[name]["rel_lift"] = contrasts[name]["mean"] / base if base else 0.0
        mdiff = np.nan_to_num(per[x]["margin_h"] - per[y]["margin_h"])
        contrasts[name]["margin_h"] = metrics.contrast(mdiff, seeds, seed=6)
    adjusted = metrics.holm([contrasts[n]["p"] for n in names])
    for name, p_adj in zip(names, adjusted, strict=True):
        contrasts[name]["p_holm"] = p_adj
        contrasts[name]["non_inferior"] = bool(
            min(contrasts[name]["ci_lo"], contrasts[name]["seed_lo"]) > -DONE_RATE_DELTA
        )
    out["contrasts"] = contrasts
    if "L" in per and "H" in per:
        out["groups"] = _groups(meta, per["L"]["done_rate"] - per["H"]["done_rate"])
    if "Oracle" in grids:
        zero = np.nan_to_num
        oracle_p = zero(grids["Oracle"]["p"])
        out["regret"] = {
            arm: metrics.cumulative_regret(oracle_p, zero(g["p"])).tolist()
            for arm, g in grids.items()
            if arm != "Oracle"
        }
    out["learning"] = {
        arm: np.nanmean(g["s"][:, :CURVE_TASKS], axis=0).tolist()
        for arm, g in grids.items()
    }
    weeks = list(range(1, WEEKS + 1))
    out["weekly"] = {
        arm: [
            float(np.nanmean(g["s"][(week == w) & ~np.isnan(g["s"])]))
            if ((week == w) & ~np.isnan(g["s"])).any()
            else float("nan")
            for w in weeks
        ]
        for arm, g in grids.items()
    }
    out["by_kind"] = {
        arm: {
            "exam": float(np.nanmean(g["s"][exam == 1])),
            "assignment": float(np.nanmean(g["s"][exam == 0])),
        }
        for arm, g in grids.items()
    }
    out["dist"] = {
        arm: {
            "margin_h": [
                None if np.isnan(x) else float(x) for x in per[arm]["margin_h"]
            ],
            "done_rate": per[arm]["done_rate"].tolist(),
        }
        for arm in arms
    }
    if ab_rows is not None:
        out["ab"] = _ab_summary(ab_rows)
    return out


# --- Sweeps --------------------------------------------------------------------

SENSITIVITY: dict[str, dict[str, Any]] = {
    "production": {},
    "students ignore deadlines": {"imminence": 0.0},
    "students rush deadlines (x1.5)": {"imminence": 1.5},
    "drag 0.1": {"drag": 0.1},
    "drag 0.3": {"drag": 0.3},
    "alpha 0.05": {"alpha": 0.05},
    "alpha 0.5": {"alpha": 0.5},
    "heuristic rate 0.05": {"pref_rate": 0.05},
    "heuristic rate 2": {"pref_rate": 2.0},
    "heuristic kept weight 0": {"kept_weight": 0.0},
    "heuristic kept weight 1": {"kept_weight": 1.0},
    "prior strength 0 and 0": {"n0": (0.0, 0.0)},
    "prior strength 2 and 1": {"n0": (2.0, 1.0)},
    "prior strength 4 and 2": {"n0": (4.0, 2.0)},
    "gap term off": {"gap_weight": 0.0},
    "deadline term off": {"deadline_weight": 0.0},
    "deadline reach 48h (old)": {"deadline_horizon": 48},
}
# (horizon hours, weight); weight 0 is the term off.
DEADLINE_GRID = tuple(
    (h, w) for h in (24, 48, 72, 96) for w in (0.1, 0.2, 0.4, 0.6, 1.0)
)
SWEEP_ARMS = ("H", "L", "AB")


def _summary(res: dict[str, Any]) -> dict[str, Any]:
    c = res["contrasts"]["L_minus_H"]
    return {
        "L_minus_H": c,
        "L": res["arms"]["L"]["done_rate"]["mean"],
        "H": res["arms"]["H"]["done_rate"]["mean"],
        "L_hours": res["arms"]["L"]["margin_h"]["mean"],
        "H_hours": res["arms"]["H"]["margin_h"]["mean"],
        "L_last_day": res["arms"]["L"]["last_day"]["mean"],
        "H_last_day": res["arms"]["H"]["last_day"]["mean"],
        "pick_linucb": res["ab"]["pick_linucb"],
        **{
            f"{k}_done_rate": res["arms"][k]["done_rate"]["mean"]
            for k in ("L-flat", "H-frozen", "L-deadline", "H-deadline", "AB")
            if k in res["arms"]
        },
    }


def sensitivity(out: Path, seeds: int, students: int, workers: int) -> dict[str, Any]:
    """L minus H under each assumption, on tuning seeds."""
    rows: dict[str, Any] = {}
    for name, cfg in SENSITIVITY.items():
        res = core.run_all(
            seeds, students, SWEEP_ARMS, workers, out / "sensitivity", 100, cfg
        )
        rows[name] = _summary(res)
    (out / "sensitivity.json").write_text(json.dumps(rows, indent=2) + "\n")
    return rows


def deadline_sweep(
    out: Path, seeds: int, students: int, workers: int
) -> dict[str, Any]:
    """L at each deadline weight and reach, for students who do and do not rush."""
    rows: dict[str, Any] = {}
    for label, scale in (("rush", 1.0), ("indifferent", 0.0)):
        for horizon, weight in DEADLINE_GRID:
            cfg = {
                "deadline_weight": weight,
                "deadline_horizon": horizon,
                "imminence": scale,
            }
            res = core.run_all(
                seeds, students, SWEEP_ARMS, workers, out / "deadline", 100, cfg
            )
            rows[f"{label}: {weight:.1f} over {horizon}h"] = _summary(res)
    (out / "deadline.json").write_text(json.dumps(rows, indent=2) + "\n")
    return rows


def _points(c: dict[str, float]) -> str:
    return f"{100 * c['mean']:+.1f} [{100 * c['ci_lo']:+.1f}, {100 * c['ci_hi']:+.1f}]"


def render_sensitivity(rows: dict[str, Any]) -> str:
    lines = [
        "# Sensitivity (tuning seeds 100 and up)",
        "",
        "| Assumption | H | L | L against H, points | Hours before deadline, L "
        "| Last day share, L | Pick rate |",
        "|---|---|---|---|---|---|---|",
    ]
    for name, r in rows.items():
        c = r["L_minus_H"]
        lines.append(
            f"| {name} | {100 * r['H']:.1f}% | {100 * r['L']:.1f}% "
            f"| {_points(c)} "
            f"| {r['L_hours']:.1f} | {100 * r['L_last_day']:.0f}% "
            f"| {100 * r['pick_linucb']['rate']:.0f}% |"
        )
    return "\n".join(lines) + "\n"


def render_deadline(rows: dict[str, Any]) -> str:
    lines = [
        "# Deadline term (tuning seeds 100 and up)",
        "",
        "H is the heuristic on the same students. Last day share is blocks ending "
        "within 24 hours of the deadline.",
        "",
        "| Students and term | H | L | L against H, points | Hours before deadline, L "
        "| Hours, H | Last day, L | Last day, H |",
        "|---|---|---|---|---|---|---|---|",
    ]
    for name, r in rows.items():
        c = r["L_minus_H"]
        lines.append(
            f"| {name} | {100 * r['H']:.1f}% | {100 * r['L']:.1f}% "
            f"| {_points(c)} "
            f"| {r['L_hours']:.1f} | {r['H_hours']:.1f} "
            f"| {100 * r['L_last_day']:.0f}% | {100 * r['H_last_day']:.0f}% |"
        )
    return "\n".join(lines) + "\n"


TYPICAL: dict[str, Any] = {
    "timing": 0.5,
    "detect": 0.6,
    "delay": 3,
    "tap_scale": 0.5,
    "drift": {"kind": "walk", "hours": 1.0},
}
HARSH: dict[str, Any] = {
    "timing": 0.25,
    "detect": 0.3,
    "delay": 10,
    "tap_scale": 0.2,
    "drift": {"kind": "walk", "hours": 1.5},
}
REALITY: dict[str, dict[str, Any]] = {
    "headline student and signal": {},
    "hour matters half as much": {"timing": 0.5},
    "hour matters a quarter as much": {"timing": 0.25},
    "60% of kept slots reach the learner": {"detect": 0.6},
    "30% of kept slots reach the learner": {"detect": 0.3},
    "rewards 3 tasks late": {"delay": 3},
    "rewards 10 tasks late": {"delay": 10},
    "peak hour shifts 3 hours once": {"drift": {"kind": "step", "hours": 3.0}},
    "peak hour walks 1 hour every 2 weeks": {"drift": {"kind": "walk", "hours": 1.0}},
    "peak hour walks 2 hours every 2 weeks": {"drift": {"kind": "walk", "hours": 2.0}},
    "walk 2 hours, L forgets 10% per update": {
        "drift": {"kind": "walk", "hours": 2.0},
        "discount": 0.9,
    },
    "typical mix": TYPICAL,
    "typical mix, L forgets 5% per update": {**TYPICAL, "discount": 0.95},
    "harsh mix": HARSH,
    "harsh mix, L forgets 5% per update": {**HARSH, "discount": 0.95},
}


REALITY_ARMS = ("H+K", "L")


def reality_sweep(
    out: Path, seeds: int, students: int, workers: int, offset: int = 100
) -> dict[str, Any]:
    """L against H+K as the student and the signal get less generous."""
    rows: dict[str, Any] = {}
    for name, cfg in REALITY.items():
        res = core.run_all(
            seeds, students, REALITY_ARMS, workers, out / "reality", offset, cfg
        )
        rows[name] = _robust_row(res)
    (out / "reality.json").write_text(json.dumps(rows, indent=2) + "\n")
    return rows


MISSPEC: dict[str, dict[str, Any]] = {
    "shipped": {},
    "two daily peaks, 8 to 12 hours apart": {"shape": "bimodal"},
    "peak differs by weekday, up to 3 hours": {"shape": "weekday"},
    "all chronotypes equally likely": {"chrono": "uniform"},
    "mostly larks": {"chrono": "lark heavy"},
    "mostly owls": {"chrono": "owl heavy"},
    "willingness to start halved": {"attention_scale": 0.5},
    "two peaks and a walking routine": {
        "shape": "bimodal",
        "drift": {"kind": "walk", "hours": 1.0},
    },
}
MISSPEC_ARMS = ("H", "L", "L-flat", "H-frozen", "AB")


def misspec_sweep(out: Path, seeds: int, students: int, workers: int) -> dict[str, Any]:
    """L, H and the two no-learning baselines on students L was not built for."""
    rows: dict[str, Any] = {}
    for name, cfg in MISSPEC.items():
        res = core.run_all(
            seeds, students, MISSPEC_ARMS, workers, out / "misspec", 100, cfg
        )
        rows[name] = _summary(res)
    (out / "misspec.json").write_text(json.dumps(rows, indent=2) + "\n")
    return rows


def render_misspec(rows: dict[str, Any]) -> str:
    lines = [
        "# Students the learner was not built for (tuning seeds 100 and up)",
        "",
        "| Students | H | H-frozen | L | L-flat | L against H, points |",
        "|---|---|---|---|---|---|",
    ]
    for name, r in rows.items():
        lines.append(
            f"| {name} | {100 * r['H']:.1f}% | {100 * r['H-frozen_done_rate']:.1f}% "
            f"| {100 * r['L']:.1f}% | {100 * r['L-flat_done_rate']:.1f}% "
            f"| {_points(r['L_minus_H'])} |"
        )
    return "\n".join(lines) + "\n"


def _robust_row(res: dict[str, Any]) -> dict[str, Any]:
    """L (L24N, production) against H+K, one world."""
    c = res["contrasts"]["L_minus_HK"]
    return {
        "L_minus_HK": c,
        "L": res["arms"]["L"]["done_rate"]["mean"],
        "HK": res["arms"]["H+K"]["done_rate"]["mean"],
        "L_hours": res["arms"]["L"]["margin_h"]["mean"],
        "HK_hours": res["arms"]["H+K"]["margin_h"]["mean"],
    }


def render_reality(rows: dict[str, Any], offset: int = 100) -> str:
    lines = [
        f"# Robustness: L24N against H+K (seeds {offset} and up)",
        "",
        "| World | H+K | L24N | L24N against H+K, points | Lower bound | "
        "Hours, L24N | Hours, H+K |",
        "|---|---|---|---|---|---|---|",
    ]
    for name, r in rows.items():
        c = r["L_minus_HK"]
        lines.append(
            f"| {name} | {100 * r['HK']:.1f}% | {100 * r['L']:.1f}% "
            f"| {_points(c)} | {100 * c['ci_lo']:+.2f} "
            f"| {r['L_hours']:.1f} | {r['HK_hours']:.1f} |"
        )
    return "\n".join(lines) + "\n"


HEURISTIC_REACHES = (24, 48, 72, 96)
HEURISTIC_WEIGHTS = (0.1, 0.2, 0.4, 1.0)
PER_HOUR_WEIGHTS = (0.05, 0.1, 0.2)


def heuristic_arms() -> tuple[str, ...]:
    """Shipped H and L, then H over its own reach and weight, plain and per hour."""
    plain = tuple(f"H:{r}:{w}" for r in HEURISTIC_REACHES for w in HEURISTIC_WEIGHTS)
    scaled = tuple(f"H:{r}:{w}:hr" for r in (24, 48) for w in PER_HOUR_WEIGHTS)
    return ("H", "L", *plain, *scaled)


def heuristic_sweep(
    out: Path, seeds: int, students: int, workers: int
) -> dict[str, Any]:
    """H at every reach and weight against shipped L, tuning seeds."""
    res = core.run_all(
        seeds, students, heuristic_arms(), workers, out / "heuristic", 100, {}
    )
    rows = {
        arm: {
            "done_rate": a["done_rate"],
            "hours": a["margin_h"]["mean"],
            "last_day": a["last_day"]["mean"],
            "exam": res["by_kind"][arm]["exam"],
            "assignment": res["by_kind"][arm]["assignment"],
        }
        for arm, a in res["arms"].items()
    }
    (out / "heuristic.json").write_text(json.dumps(rows, indent=2) + "\n")
    return rows


def render_heuristic(rows: dict[str, Any]) -> str:
    lines = [
        "# Heuristic deadline penalty (tuning seeds 100 and up)",
        "",
        "Arm `H:<reach>:<weight>`; `hr` scales the weight by block hours. "
        "Shipped H is 24 hours at 0.2.",
        "",
        "| Arm | Adherence | Hours before deadline | Last day | Exam blocks "
        "| Assignment blocks |",
        "|---|---|---|---|---|---|",
    ]
    for arm, r in rows.items():
        a = r["done_rate"]
        lines.append(
            f"| {arm} | {100 * a['mean']:.1f}% "
            f"[{100 * a['ci_lo']:.1f}, {100 * a['ci_hi']:.1f}] "
            f"| {r['hours']:.1f} | {100 * r['last_day']:.0f}% "
            f"| {100 * r['exam']:.1f}% | {100 * r['assignment']:.1f}% |"
        )
    return "\n".join(lines) + "\n"
