"""Paired closed-loop runs: the same student, calendar and tasks under each policy.

Each *world* places every task with one policy, lets the student react (keep or
drag), applies the production learning rules and moves on. Per placement it
records the regret against an oracle (the best free slot in the same window by
the student's true utility), acceptance and drag distance.

The slot selection calls the real ``src.core`` functions (``best_free_slot``,
``best_linucb_slot``, ``build_context_vector``, ``series_day_windows``); the
glue around them mirrors ``src.policies`` / ``src.place`` minus the pydantic
layer (a parity test pins it to ``/v1/place``).
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field, replace

import numpy as np
from numpy.typing import NDArray

from src.core import constants as consts
from src.core.arms import seeded_tie_break_order
from src.core.context_vector import build_context_vector
from src.core.hybrid import cohort_shared_prior, days_left_on, shared_tensor
from src.core.linucb_best_slot import LinucbCandidateDay, best_linucb_slot
from src.core.quiet_hours import quiet_intervals
from src.core.reward import drag_distance_reward
from src.core.series_spread import series_day_windows
from src.core.slot import ceil_to_slot, local_date_str
from src.core.slot_score import (
    best_free_slot,
    deadline_penalty,
    free_start_mask,
    slot_preference_score,
)
from src.schemas import ARM_IDS

from .archetypes import (
    DEFAULT_INTERACTION_MIX,
    INTERACTION_STYLES,
    StudentProfile,
    interaction_style_from_mix,
    make_student,
)
from .learner import LinUCBState, PreferenceMatrix
from .reaction import (
    choose_offer,
    completion_outcome,
    decide,
    draw_reaction,
    reaction_label,
)
from .rng import stream
from .utility import DayContext, slot_utility
from .world import (
    SCENARIO_BY_NAME,
    SCENARIOS,
    TZ,
    Calendar,
    Interval,
    Task,
    build_calendar,
    build_daytime,
    build_drift,
    build_tasks,
    day_index,
    day_start_ms,
    daytime_pull,
    iso_weekday_of,
    n_calendar_days,
)

HEURISTIC = "heuristic"
SINGLE_SCAN_DAYS = consts.SCAN_CAP_DAYS
SERIES_SCAN_DAYS = consts.MAX_SCAN_DAYS


@dataclass(frozen=True)
class SimConfig:
    seed: int = 1
    n_students: int = 75
    n_events: int = 60
    alphas: tuple[float, ...] = (0.15,)
    ridge: float = 1.0
    scenarios: tuple[str, ...] = tuple(s.name for s in SCENARIOS)
    balanced: bool = True
    # LinUCB v2 (default): hour inside a band from gap quality. v1 is the
    # preference matrix instead: ``pref_weight=LINUCB_PREF_WEIGHT, gap_weight=0``.
    pref_weight: float = 0.0
    gap_weight: float = consts.LINUCB_GAP_WEIGHT
    # Deadline-pressure penalty (heuristic and LinUCB); 0 disables it.
    deadline_weight: float = consts.DEADLINE_PENALTY_WEIGHT
    # Hybrid LinUCB (level-up plan): shared beta over the cross features. False is
    # the disjoint model of the previous step, for ablation.
    hybrid: bool = True
    # Hypothesis knob for the weak-student effect in the hidden utility (0 = none).
    weak_effect: float = 0.0
    # Cohort warm start for the shared beta (plan step 5): each student's beta starts
    # from the other students' pooled statistics (leave-one-out, two passes).
    cohort: bool = False
    # Interaction-style mix. Keys are ``INTERACTION_STYLES``; values are shares.
    # The legacy drag-only simulator is ``{"dragger": 1.0}``.
    interaction_mix: dict[str, float] = field(
        default_factory=lambda: dict(DEFAULT_INTERACTION_MIX)
    )
    # Where the alternative time chip comes from.
    offer_source: str = "runner_up"  # "runner_up" | "other_policy"
    # "completion": start/done/lapse/skip model. "retained": old keep-everything rule.
    reward: str = "completion"

    def __post_init__(self) -> None:
        if self.reward not in ("completion", "retained"):
            raise ValueError(f"unknown reward mode: {self.reward}")
        total = sum(self.interaction_mix.get(s, 0.0) for s in INTERACTION_STYLES)
        if not math.isclose(total, 1.0, rel_tol=1e-6):
            raise ValueError(f"interaction_mix must sum to 1, got {total}")

    def interaction_style_for(self, student_id: int) -> str:
        rng = stream(self.seed, "interaction", student_id)
        return interaction_style_from_mix(rng, self.interaction_mix)


def linucb_label(alpha: float) -> str:
    return f"linucb@{alpha:g}"


@dataclass
class PlacementLog:
    """Per-placement records of one world (columns, appended in order)."""

    task_id: list[int] = field(default_factory=list)
    member: list[int] = field(default_factory=list)
    obs_before: list[int] = field(default_factory=list)
    regret: list[float] = field(default_factory=list)
    accepted: list[float] = field(default_factory=list)
    drag: list[float] = field(default_factory=list)
    start: list[int] = field(default_factory=list)
    used_linucb: list[float] = field(default_factory=list)
    completed: list[float] = field(default_factory=list)
    # New lazy-user telemetry.
    started: list[float] = field(default_factory=list)
    done: list[float] = field(default_factory=list)
    lapsed: list[float] = field(default_factory=list)
    skipped: list[float] = field(default_factory=list)
    wrong_time: list[float] = field(default_factory=list)
    chose_option: list[float] = field(
        default_factory=list
    )  # 1 = tapped alternative chip
    label: list[str] = field(
        default_factory=list
    )  # moved/lapsed/skipped/done/started/wrong_time
    infeasible: int = 0

    def arrays(self) -> dict[str, NDArray[np.float64]]:
        return {
            "task_id": np.asarray(self.task_id, dtype=np.float64),
            "member": np.asarray(self.member, dtype=np.float64),
            "obs_before": np.asarray(self.obs_before, dtype=np.float64),
            "regret": np.asarray(self.regret, dtype=np.float64),
            "accepted": np.asarray(self.accepted, dtype=np.float64),
            "drag": np.asarray(self.drag, dtype=np.float64),
            "start": np.asarray(self.start, dtype=np.float64),
            "used_linucb": np.asarray(self.used_linucb, dtype=np.float64),
            "completed": np.asarray(self.completed, dtype=np.float64),
            "started": np.asarray(self.started, dtype=np.float64),
            "done": np.asarray(self.done, dtype=np.float64),
            "lapsed": np.asarray(self.lapsed, dtype=np.float64),
            "skipped": np.asarray(self.skipped, dtype=np.float64),
            "wrong_time": np.asarray(self.wrong_time, dtype=np.float64),
            "chose_option": np.asarray(self.chose_option, dtype=np.float64),
        }


@dataclass
class _Day:
    idx: int
    start_ms: int
    end_ms: int
    occupied: list[Interval]
    fixed_hours: float
    flex_hours: float


def _blocked(day: _Day) -> list[Interval]:
    """Fixed occupancy plus quiet hours, the rule ``/v1/place`` applies too."""
    dates = local_date_str(day.start_ms, TZ)
    return [*day.occupied, *quiet_intervals(dates, TZ)]


@dataclass
class _Proposal:
    start_ms: int
    duration: int
    day_idx: int
    day_ctx: DayContext
    arm: str | None  # set only when LinUCB made the pick
    x: NDArray[np.float64] | None
    z: NDArray[np.float64] | None  # hybrid cross features of the picked (day, arm)
    regret: float
    utility: float
    cand_days: list[_Day]


class World:
    def __init__(
        self,
        cfg: SimConfig,
        profile: StudentProfile,
        tasks: list[Task],
        calendar: Calendar,
        drift: NDArray[np.float64],
        policy: str,
        alpha: float,
        scenario: str,
        daytime: NDArray[np.float64] | None = None,
        shared_prior: tuple[NDArray[np.float64], NDArray[np.float64]] | None = None,
    ) -> None:
        self.cfg = cfg
        self.daytime = (
            build_daytime(cfg.seed, profile, len(drift)) if daytime is None else daytime
        )
        self.p = replace(profile, weak_effect=cfg.weak_effect)
        self.tasks = tasks
        self.cal = calendar
        self.drift = drift
        self.policy = policy
        self.scenario = scenario
        self.prefs = PreferenceMatrix(TZ)
        self.linucb = (
            LinUCBState(alpha, cfg.ridge, hybrid=cfg.hybrid, shared_prior=shared_prior)
            if policy != HEURISTIC
            else None
        )
        self.placed: list[Interval] = []
        self.log = PlacementLog()
        self._last_day = 0

    # ---- calendar views -------------------------------------------------
    def _flex_hours(self) -> dict[int, float]:
        out: dict[int, float] = {}
        for s, e in self.placed:
            d = day_index(s)
            out[d] = out.get(d, 0.0) + (e - s) / consts.HOUR_MS
        return out

    def _day(self, idx: int, flex: dict[int, float]) -> _Day:
        start = day_start_ms(idx)
        end = start + consts.DAY_MS
        occ = list(self.cal.fixed[idx])
        occ.extend((s, e) for s, e in self.placed if e > start and s < end)
        return _Day(idx, start, end, occ, self.cal.fixed_hours[idx], flex.get(idx, 0.0))

    def _ctx(self, day: _Day, deadline_day: int) -> DayContext:
        days_left = float(max(0, deadline_day - day.idx))
        return DayContext(
            weekday=iso_weekday_of(day.idx),
            days_left=days_left,
            fixed_hours=day.fixed_hours,
            drift_h=float(self.drift[day.idx]),
            daytime_pull=daytime_pull(self.p, self.daytime[day.idx], days_left),
        )

    # ---- slot machinery ---------------------------------------------------
    @staticmethod
    def _free_starts(
        day: _Day, duration: int, next_ms: int, deadline_ms: int, extra: list[Interval]
    ) -> NDArray[np.int64]:
        dur_ms = duration * consts.MS_PER_MINUTE
        lower = max(ceil_to_slot(day.start_ms), next_ms)
        upper = min(day.end_ms + dur_ms - consts.SLOT_MS, deadline_ms)
        if lower + dur_ms > upper:
            return np.empty(0, dtype=np.int64)
        n = (upper - dur_ms - lower) // consts.SLOT_MS + 1
        mask = free_start_mask(lower, n, dur_ms, [*_blocked(day), *extra])
        return np.asarray(
            lower + np.arange(n, dtype=np.int64)[mask] * consts.SLOT_MS, dtype=np.int64
        )

    def _utility(
        self, day: _Day, ctx: DayContext, starts: NDArray[np.int64], duration: int
    ) -> NDArray[np.float64]:
        minute = (starts - day.start_ms) / consts.MS_PER_MINUTE
        return slot_utility(self.p, ctx, np.asarray(minute, dtype=np.float64), duration)

    # ---- placement ---------------------------------------------------------
    def _heuristic_pick(
        self,
        days: list[_Day],
        duration: int,
        next_ms: int,
        now_ms: int,
        deadline_ms: int,
        extra: list[Interval],
    ) -> int | None:
        # mirrors HeuristicPolicy.best_slot: best slot per day, best score wins
        dur_ms = duration * consts.MS_PER_MINUTE
        overhang = dur_ms - consts.SLOT_MS
        best: tuple[float, int] | None = None
        for d in days:
            slot = best_free_slot(
                duration,
                [*_blocked(d), *extra],
                max(now_ms, d.start_ms),
                min(deadline_ms, d.end_ms),
                self.prefs.matrix,
                TZ,
                min(deadline_ms, d.end_ms + overhang),
                None,
                deadline_ms,
                self.cfg.deadline_weight,
            )
            if slot is None:
                continue
            score = slot_preference_score(self.prefs.matrix, slot, slot + dur_ms, TZ)
            score += deadline_penalty(
                slot + dur_ms, deadline_ms, self.cfg.deadline_weight
            )
            if best is None or score > best[0]:
                best = (score, slot)
        return None if best is None else best[1]

    def _linucb_pick(
        self,
        days: list[_Day],
        ctxs: list[DayContext],
        task: Task,
        next_ms: int,
        extra: list[Interval],
        tie_seed: str,
        flex_days: list[float],
    ) -> tuple[int, str, NDArray[np.float64], NDArray[np.float64]] | None:
        assert self.linucb is not None
        remaining = max(0, math.floor((task.deadline_ms - task.now_ms) / consts.DAY_MS))
        today = day_index(task.now_ms)
        xs = np.stack(
            [
                build_context_vector(
                    remaining_days_until_deadline=remaining,
                    duration_minutes=task.duration,
                    candidate_iso_weekday=c.weekday,
                    candidate_days_from_now=max(0, d.idx - today),
                    workload_by_type={
                        "LECTURE": {"hours": d.fixed_hours},
                        "TASK": {"hours": fl},
                    },
                )
                for d, c, fl in zip(days, ctxs, flex_days, strict=True)
            ]
        )
        dl = np.array([days_left_on(task.deadline_ms, d.start_ms) for d in days])
        lect = np.array([d.fixed_hours for d in days])
        zs = shared_tensor(self.p.weak, [task.kind], dl[None], lect[None])[0]
        scores = self.linucb.arm_scores(xs, zs)
        cand = [
            LinucbCandidateDay(
                day_str=str(d.idx),
                day_start_ms=d.start_ms,
                day_end_ms=d.end_ms,
                occupied=_blocked(d),
                vector=xs[i].tolist(),
                arm_scores={a: float(v[i]) for a, v in scores.items()},
            )
            for i, d in enumerate(days)
        ]
        best = best_linucb_slot(
            cand,
            task.duration,
            TZ,
            next_ms,
            task.deadline_ms,
            extra,
            None,
            seeded_tie_break_order(tie_seed),
            self.prefs.matrix,
            self.cfg.pref_weight,
            self.cfg.gap_weight,
            self.cfg.deadline_weight,
        )
        if best is None or not math.isfinite(best.score):
            return None
        di = next(
            i for i, d in enumerate(days) if d.start_ms <= best.start_ms < d.end_ms
        )
        arm_idx = ARM_IDS.index(best.arm)
        return (
            best.start_ms,
            best.arm,
            np.asarray(best.vector, dtype=np.float64),
            zs[di, arm_idx],
        )

    def _windows(self, task: Task, next_ms: int) -> list[tuple[int, int]]:
        first = day_index(next_ms)
        if task.n_members == 1:
            return [(first, day_index(task.deadline_ms - 1))]
        span = min(
            math.floor((task.deadline_ms - next_ms) / consts.DAY_MS),
            consts.MAX_SCAN_DAYS - 1,
        )
        return [
            (first + lo, first + hi)
            for lo, hi in series_day_windows(span, task.n_members)
        ]

    def _propose(
        self,
        task: Task,
        window: tuple[int, int],
        siblings: list[Interval],
        sibling_days: set[int],
        flex: dict[int, float],
        tie_seed: str,
        extra_blocked: list[Interval] | None = None,
    ) -> _Proposal | None:
        next_ms = ceil_to_slot(task.now_ms)
        cap = SINGLE_SCAN_DAYS if task.n_members == 1 else SERIES_SCAN_DAYS
        idxs = [
            d
            for d in range(window[0], window[1] + 1)
            if d not in sibling_days and d < len(self.cal.fixed)
        ][:cap]
        days = [self._day(i, flex) for i in idxs]
        dl_day = day_index(task.deadline_ms - 1)
        ctxs = [self._ctx(d, dl_day) for d in days]
        extra = [*siblings, *(extra_blocked or [])]

        # oracle: best free slot in the window by the student's true utility
        best_u = -math.inf
        for d, c in zip(days, ctxs, strict=True):
            starts = self._free_starts(
                d, task.duration, next_ms, task.deadline_ms, extra
            )
            if starts.size:
                best_u = max(
                    best_u, float(self._utility(d, c, starts, task.duration).max())
                )
        if best_u == -math.inf:
            return None

        start: int | None = None
        arm: str | None = None
        x: NDArray[np.float64] | None = None
        z: NDArray[np.float64] | None = None
        if self.linucb is not None:
            pick = self._linucb_pick(
                days,
                ctxs,
                task,
                next_ms,
                extra,
                tie_seed,
                [d.flex_hours for d in days],
            )
            if pick is not None:
                start, arm, x, z = pick
        if start is None:
            start = self._heuristic_pick(
                days, task.duration, next_ms, task.now_ms, task.deadline_ms, extra
            )
        if start is None:
            return None
        di = next(i for i, d in enumerate(days) if d.start_ms <= start < d.end_ms)
        u = float(
            self._utility(
                days[di], ctxs[di], np.array([start], dtype=np.int64), task.duration
            )[0]
        )
        return _Proposal(
            start,
            task.duration,
            days[di].idx,
            ctxs[di],
            arm,
            x,
            z,
            max(0.0, best_u - u),
            u,
            days,
        )

    # ---- one arrival event --------------------------------------------------
    def _tie_seed(self, task: Task, member: int) -> str:
        """Seed of the cold-start band order (the service uses ``requestId|id``)."""
        return (
            f"{self.cfg.seed}|{self.p.student_id}|{self.scenario}"
            f"|{task.task_id}|{member}"
        )

    def _runner_up_prop(
        self,
        default: _Proposal,
        task: Task,
        window: tuple[int, int],
        siblings: list[Interval],
        sibling_days: set[int],
        flex: dict[int, float],
        tie_seed: str,
    ) -> _Proposal | None:
        """Second-best proposal after blocking the default start."""
        dur_ms = task.duration * consts.MS_PER_MINUTE
        blocked: list[Interval] = [(default.start_ms, default.start_ms + dur_ms)]
        return self._propose(
            task, window, siblings, sibling_days, flex, tie_seed, blocked
        )

    def _propose_all(
        self, task: Task, flex: dict[int, float]
    ) -> list[tuple[_Proposal | None, _Proposal | None]]:
        """Place every member and, for tappers, its runner-up alternative."""
        next_ms = ceil_to_slot(task.now_ms)
        siblings: list[Interval] = []
        sibling_days: set[int] = set()
        out: list[tuple[_Proposal | None, _Proposal | None]] = []
        windows = list(self._windows(task, next_ms))
        for m, win in enumerate(windows):
            tie = self._tie_seed(task, m)
            prop = self._propose(task, win, siblings, sibling_days, flex, tie)
            runner_up: _Proposal | None = None
            if prop is not None and self.p.interaction_style == "tapper":
                runner_up = self._runner_up_prop(
                    prop, task, win, siblings, sibling_days, flex, tie
                )
            out.append((prop, runner_up))
            if prop is not None:
                dur_ms = task.duration * consts.MS_PER_MINUTE
                siblings.append((prop.start_ms, prop.start_ms + dur_ms))
                sibling_days.add(day_index(prop.start_ms))
        return out

    def _event(self, task: Task) -> None:
        today = day_index(task.now_ms)
        if today > self._last_day:
            self.prefs.decay(today - self._last_day)  # nightly decay
            self._last_day = today
        self.placed = [
            (s, e) for s, e in self.placed if e > day_start_ms(today) - consts.DAY_MS
        ]
        pairs = self._propose_all(task, self._flex_hours())
        dur_ms = task.duration * consts.MS_PER_MINUTE
        current: list[Interval] = [
            (0, 0) if p is None else (p.start_ms, p.start_ms + dur_ms) for p, _ in pairs
        ]
        for m, (prop, runner_up) in enumerate(pairs):
            if prop is None:
                self.log.infeasible += 1
                continue
            others = [iv for j, iv in enumerate(current) if j != m and iv[1] > iv[0]]
            self._react(task, m, prop, runner_up, others, current)

    def _react(
        self,
        task: Task,
        m: int,
        prop: _Proposal,
        runner_up: _Proposal | None,
        others: list[Interval],
        current: list[Interval],
    ) -> None:
        day = next(d for d in prop.cand_days if d.idx == prop.day_idx)
        next_ms = ceil_to_slot(task.now_ms)
        starts = self._free_starts(
            day, task.duration, next_ms, task.deadline_ms, others
        )
        utils = self._utility(day, prop.day_ctx, starts, task.duration)
        draws = draw_reaction(self.cfg.seed, self.p.student_id, task.task_id, m)

        final_ms = prop.start_ms
        final_utility = prop.utility
        moved = False
        chose_option = False
        option_arm: str | None = None
        option_x: NDArray[np.float64] | None = None
        option_z: NDArray[np.float64] | None = None

        if self.p.interaction_style == "dragger":
            target = decide(self.p, draws, prop.start_ms, prop.utility, starts, utils)
            if target is not None:
                final_ms = target
                moved = True
                final_utility = float(utils[int(np.flatnonzero(starts == target)[0])])
        elif self.p.interaction_style == "tapper" and runner_up is not None:
            choice = choose_offer(
                self.p,
                draws,
                prop.start_ms,
                prop.utility,
                runner_up.start_ms,
                runner_up.utility,
            )
            if choice == "option":
                final_ms = runner_up.start_ms
                final_utility = runner_up.utility
                moved = True
                chose_option = True
                option_arm = runner_up.arm
                option_x = runner_up.x
                option_z = runner_up.z

        completion = completion_outcome(self.p, draws, final_utility)
        drag_min = abs(final_ms - prop.start_ms) / consts.MS_PER_MINUTE

        if self.cfg.reward == "retained":
            # Legacy parity path: drags update the move model, everything else retained.
            if moved:
                self.prefs.moved(prop.start_ms, final_ms, drag_min)
                reward = drag_distance_reward(drag_min)
            else:
                self.prefs.retained(final_ms)
                reward = 1.0
            if self.linucb is not None and prop.arm is not None and prop.x is not None:
                self.linucb.observe(prop.arm, prop.x, reward, prop.z)
                if chose_option and option_arm is not None and option_x is not None:
                    self.linucb.observe(option_arm, option_x, -0.2, option_z)
        else:
            # Completion-based reward (level-up plan). The matrix learns from what
            # the student did in the kept slot, the same label LinUCB gets.
            if moved:
                self.prefs.moved(prop.start_ms, final_ms, drag_min)
            if not completion.wrong_time:
                self.prefs.labelled(final_ms, completion.reward())

            if self.linucb is not None and prop.arm is not None and prop.x is not None:
                self.linucb.observe(prop.arm, prop.x, completion.reward(), prop.z)
                if chose_option and option_arm is not None and option_x is not None:
                    # Pairwise: option chosen over default.
                    self.linucb.observe(option_arm, option_x, 1.0, option_z)
                    self.linucb.observe(prop.arm, prop.x, -0.2, prop.z)
                elif (
                    runner_up is not None
                    and runner_up.arm is not None
                    and runner_up.x is not None
                    and not chose_option
                    and not moved
                ):
                    # Default kept/ignored: option was shown but not chosen.
                    self.linucb.observe(runner_up.arm, runner_up.x, -0.2, runner_up.z)

        dur_ms = task.duration * consts.MS_PER_MINUTE
        current[m] = (final_ms, final_ms + dur_ms)
        self.placed.append((final_ms, final_ms + dur_ms))

        log = self.log
        log.obs_before.append(len(log.task_id))
        log.task_id.append(task.task_id)
        log.member.append(m)
        log.regret.append(prop.regret)
        log.accepted.append(0.0 if moved else 1.0)
        log.drag.append(drag_min)
        log.start.append(prop.start_ms)
        log.used_linucb.append(1.0 if prop.arm is not None else 0.0)
        log.completed.append(1.0 if completion.done else 0.0)
        log.started.append(1.0 if completion.started else 0.0)
        log.done.append(1.0 if completion.done else 0.0)
        log.lapsed.append(1.0 if completion.lapsed else 0.0)
        log.skipped.append(1.0 if completion.skipped else 0.0)
        log.wrong_time.append(1.0 if completion.wrong_time else 0.0)
        log.chose_option.append(1.0 if chose_option else 0.0)
        log.label.append(reaction_label(completion, moved))

    def run(self) -> PlacementLog:
        for task in self.tasks:
            self._event(task)
        return self.log


@dataclass
class StudentResult:
    student_id: int
    chronotype: str
    behavior: str
    logs: dict[str, dict[str, dict[str, NDArray[np.float64]]]]
    # logs[scenario][policy label] -> columns
    # own shared-beta statistics per "scenario|label", without any cohort prior
    shared: dict[str, tuple[NDArray[np.float64], NDArray[np.float64], int]] = field(
        default_factory=dict
    )


def run_student(
    cfg: SimConfig,
    student_id: int,
    cohort: dict[str, tuple[NDArray[np.float64], NDArray[np.float64], int]]
    | None = None,
) -> StudentResult:
    """Every scenario x policy world of one student (heuristic once, LinUCB/alpha).

    ``cohort`` maps ``"scenario|label"`` to the other students' pooled shared-beta
    statistics; it seeds each LinUCB world's beta when ``cfg.cohort`` is set.
    """
    style = cfg.interaction_style_for(student_id)
    profile = make_student(cfg.seed, student_id, cfg.balanced, style)
    n_days = n_calendar_days(cfg.n_events)
    calendar = build_calendar(cfg.seed, student_id, n_days)
    drift = build_drift(cfg.seed, profile, n_days)
    daytime = build_daytime(cfg.seed, profile, n_days)
    out: dict[str, dict[str, dict[str, NDArray[np.float64]]]] = {}
    shared: dict[str, tuple[NDArray[np.float64], NDArray[np.float64], int]] = {}
    for name in cfg.scenarios:
        tasks = build_tasks(cfg.seed, student_id, SCENARIO_BY_NAME[name], cfg.n_events)
        worlds: dict[str, dict[str, NDArray[np.float64]]] = {}
        h = World(cfg, profile, tasks, calendar, drift, HEURISTIC, 0.0, name, daytime)
        worlds[HEURISTIC] = h.run().arrays()
        for alpha in cfg.alphas:
            label = linucb_label(alpha)
            key = f"{name}|{label}"
            prior = None
            if cohort is not None and key in cohort:
                a_sum, b_sum, n_obs = cohort[key]
                prior = cohort_shared_prior(a_sum, b_sum, n_obs, cfg.ridge)
            lw = World(
                cfg,
                profile,
                tasks,
                calendar,
                drift,
                "linucb",
                alpha,
                name,
                daytime,
                shared_prior=prior,
            )
            worlds[label] = lw.run().arrays()
            if lw.linucb is not None:
                shared[key] = lw.linucb.own_shared_stats()
        out[name] = worlds
    return StudentResult(student_id, profile.chronotype, profile.behavior, out, shared)
