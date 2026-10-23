"""Authoritative placement for ``POST /v1/place`` (ADR-0003).

Pure orchestration over :mod:`src.core` and :mod:`src.policies`: no I/O, no
clock (``nowMs`` is a request field), no randomness. Ports the TS heuristic /
bandit placers and displacement service (``5763a29``):

* one request = one task;
* the task scans its local-day window, then the whole ``now ... deadline``
  range when its window has no room;
* :class:`~src.policies.heuristic.HeuristicPolicy` /
  :class:`~src.policies.linucb.LinucbPolicy` compute a pick each;
  :class:`~src.policies.selector.PolicySelector` is the A/B split deciding
  which one is applied (see ``place_member`` below);
* no free slot -> ``NEEDS_INFEASIBLE_CONTEXT``, then (with ``infeasible``)
  EDF displacement and the user's fallback.
"""

from __future__ import annotations

import hashlib
import json
import math
import time
from collections.abc import Sequence
from dataclasses import dataclass

import numpy as np
from numpy.typing import NDArray

from src.core import constants as consts
from src.core.context_vector import build_context_vector as build_context_vector
from src.core.displacement import (
    DisplacementMove,
    FlexibleTask,
    last_resort_pin,
    pick_late_slot,
    pick_min_conflict_slot,
    plan_displacement,
    plan_repack,
)
from src.core.hour_arms import unit_length
from src.core.preference import preference_score_at
from src.core.quiet_hours import quiet_intervals
from src.core.reason import (
    PlacementReason,
    count_free_starts,
    is_near_block,
    placement_reason,
)
from src.core.slot import (
    Intervals,
    add_days_str,
    ceil_to_slot,
    day_diff_str,
    deadline_day_str,
    iso_weekday,
    local_date_str,
    local_midnight_ms,
)
from src.policies.heuristic import HeuristicPolicy
from src.policies.linucb import LinucbPolicy
from src.policies.selector import PolicySelector
from src.schemas import HOUR_ARM_IDS, ArmId
from src.schemas_place import (
    PLACEMENT_CONTRACT_VERSION,
    HeuristicPick,
    IntervalMs,
    LinucbPick,
    Move,
    Outcome,
    PlacedMember,
    PlacementDay,
    PlacementMember,
    PlaceRequest,
    PlaceResponse,
    Timings,
)
from src.telemetry import singular_matrix


def _params_version() -> str:
    table: dict[str, object] = {
        k: getattr(consts, k)
        for k in sorted(dir(consts))
        if k.isupper() and not k.startswith("_")
    }
    table["PLACEMENT_CONTRACT_VERSION"] = PLACEMENT_CONTRACT_VERSION
    blob = json.dumps(table, sort_keys=True, default=list)
    return f"py-{consts.ARM_LAYOUT}-" + hashlib.sha256(blob.encode()).hexdigest()[:12]


PARAMS_VERSION = _params_version()


def _ivals(items: list[IntervalMs]) -> Intervals:
    return [(i.start_ms, i.end_ms) for i in items]


@dataclass
class _Timer:
    decode: float = 0.0
    context: float = 0.0
    predict: float = 0.0
    scan: float = 0.0
    displace: float = 0.0


@dataclass
class _ScoreBatch:
    """One request's precomputed LinUCB context and arm-score tensors.

    Built once per request (:meth:`_Placer._build_batch`), covering the task's
    candidate days (``N``) as a single row (``M=1``).
    """

    per_member_days: list[list[PlacementDay]]
    day_index: list[dict[str, int]]  # per member: dayStr -> column j
    valid: NDArray[np.bool_]  # (M, N) -- False on padding
    vectors: NDArray[np.float64]  # (M, N, D)
    arm_scores: dict[ArmId, NDArray[np.float64]]  # each hour arm, (M, N)
    ok: bool = True  # False if LinUCB's A matrices were singular for this request


class _Placer:
    def __init__(self, req: PlaceRequest, timer: _Timer) -> None:
        self.req = req
        self.t = timer
        self.tz = req.timezone
        self.matrix = req.user.preference_matrix
        self.next15 = ceil_to_slot(req.now_ms)
        self.today = local_date_str(req.now_ms, req.timezone)
        self.day_by_str: dict[str, PlacementDay] = {d.day_str: d for d in req.days}
        self.occ: dict[str, Intervals] = {
            d.day_str: [
                *_ivals(d.occupied),
                *quiet_intervals(d.day_str, req.timezone),
            ]
            for d in req.days
        }
        self.heuristic_policy = HeuristicPolicy(self.matrix, self.tz)
        self.linucb_policy = LinucbPolicy(req.bandit, self.tz)

    # ---- helpers ---------------------------------------------------------
    def _select_days(self, first: str, last: str) -> list[PlacementDay]:
        out: list[PlacementDay] = []
        day = first
        while day <= last and len(out) < self.req.max_scan_days:
            d = self.day_by_str.get(day)
            if d is not None:
                out.append(d)
            day = add_days_str(day, 1)
        return out

    def _build_batch(
        self,
        members: list[PlacementMember],
        windows_days: list[tuple[str, str]],
    ) -> _ScoreBatch:
        """Batch the task's candidate-day context vectors and arm scores.

        Builds one ``(1, N, D)`` tensor and scores all 6 arms against it in
        one broadcast pass.
        """
        req = self.req
        m_count = len(members)
        d_dim = consts.FEATURE_DIM
        remaining = max(0, math.floor((req.deadline_ms - req.now_ms) / consts.DAY_MS))

        per_member_days: list[list[PlacementDay]] = [
            self._select_days(first, last) for first, last in windows_days
        ]
        n_cols = max((len(days) for days in per_member_days), default=0)

        valid = np.zeros((m_count, n_cols), dtype=bool)
        day_index: list[dict[str, int]] = [{} for _ in range(m_count)]
        for i, days in enumerate(per_member_days):
            for j, d in enumerate(days):
                valid[i, j] = True
                day_index[i][d.day_str] = j

        x = np.zeros((m_count, n_cols, d_dim), dtype=np.float64)
        if self.linucb_policy.enabled and n_cols:
            t0 = time.perf_counter()
            for i, (m, days) in enumerate(zip(members, per_member_days, strict=True)):
                for j, d in enumerate(days):
                    wl: dict[str, dict[str, float]] = {
                        k: {"hours": v.hours, "count": v.count}
                        for k, v in d.workload_by_type.items()
                    }
                    x[i, j] = unit_length(
                        build_context_vector(
                            remaining_days_until_deadline=remaining,
                            duration_minutes=m.duration_minutes,
                            candidate_iso_weekday=iso_weekday(d.day_str),
                            candidate_days_from_now=max(
                                0, day_diff_str(self.today, d.day_str)
                            ),
                            workload_by_type=wl,
                        )
                    )
            self.t.context += time.perf_counter() - t0

            t1 = time.perf_counter()
            ok = True
            try:
                arm_scores = self.linucb_policy.arm_scores_batch(x)
            except np.linalg.LinAlgError:
                singular_matrix.add(1, {"op": "place"})
                ok = False
                arm_scores = {arm: np.zeros((m_count, n_cols)) for arm in HOUR_ARM_IDS}
            else:
                for arr in arm_scores.values():
                    arr[~valid] = 0.0
            self.t.predict += time.perf_counter() - t1
        else:
            ok = True
            arm_scores = {arm: np.zeros((m_count, n_cols)) for arm in HOUR_ARM_IDS}

        return _ScoreBatch(
            per_member_days=per_member_days,
            day_index=day_index,
            valid=valid,
            vectors=x,
            arm_scores=arm_scores,
            ok=ok,
        )

    # ---- policies --------------------------------------------------------
    def heuristic(
        self, m: PlacementMember, days: list[PlacementDay]
    ) -> HeuristicPick | None:
        t0 = time.perf_counter()
        pick = self.heuristic_policy.best_slot(
            m, days, self.occ, self.req.now_ms, self.req.deadline_ms
        )
        self.t.scan += time.perf_counter() - t0
        return pick

    def linucb(
        self,
        m: PlacementMember,
        days: list[PlacementDay],
        batch: _ScoreBatch,
        i: int,
    ) -> LinucbPick | None:
        if not self.linucb_policy.enabled or not days or not batch.ok:
            return None
        idx = batch.day_index[i]
        vecs = {d.day_str: batch.vectors[i, idx[d.day_str]] for d in days}
        scores = {
            d.day_str: [
                float(batch.arm_scores[arm][i, idx[d.day_str]]) for arm in HOUR_ARM_IDS
            ]
            for d in days
        }
        t0 = time.perf_counter()
        pick = self.linucb_policy.best_slot(
            m,
            days,
            self.occ,
            vecs,
            scores,
            self.next15,
            self.req.deadline_ms,
        )
        self.t.scan += time.perf_counter() - t0
        return pick

    # ---- one member ------------------------------------------------------
    def place_member(
        self,
        m: PlacementMember,
        windows: list[tuple[str, str]],
        batch: _ScoreBatch,
        i: int,
    ) -> PlacedMember:
        """Place ``m`` in the first of ``windows`` that has room."""
        req = self.req
        base = PlacedMember(
            id=m.id,
            outcome="INFEASIBLE",
            applied_policy="NONE",
            heuristic=None,
            linucb=None,
            start_ms=None,
            moves=[],
            late=False,
            conflicting=False,
            reason=None,
        )
        dur_ms = m.duration_minutes * consts.MS_PER_MINUTE
        if self.next15 + dur_ms > req.deadline_ms:
            return self._no_slot(m, base)

        for first, last in windows:
            days = self._select_days(first, last)
            # Every day the live selection picks must be a column of the batch
            # built upfront for this task (see `_build_batch`).
            assert all(d.day_str in batch.day_index[i] for d in days), (
                f"member {m.id!r}: live _select_days picked a day outside the "
                "batch's upfront candidate set"
            )
            lin = (
                self.linucb(m, days, batch, i)
                if PolicySelector.should_try_linucb(req.mode, m)
                else None
            )
            heur = (
                self.heuristic(m, days)
                if PolicySelector.should_try_heuristic(req.mode, m, lin)
                else None
            )

            decision = PolicySelector.resolve(req.mode, m, heur, lin)
            if decision is None:
                continue
            policy, start_ms = decision
            return base.model_copy(
                update={
                    "outcome": "PLACED",
                    "applied_policy": policy,
                    "heuristic": heur,
                    "linucb": lin,
                    "start_ms": start_ms,
                    "reason": self._placed_reason(m, start_ms, days),
                }
            )
        return self._no_slot(m, base)

    def _free_starts(self, m: PlacementMember, d: PlacementDay) -> int:
        """Free on-grid starts of ``m`` on one candidate day."""
        req = self.req
        dur_ms = m.duration_minutes * consts.MS_PER_MINUTE
        overhang = dur_ms - consts.SLOT_MS
        return count_free_starts(
            self.occ[d.day_str],
            max(self.next15, d.day_start_ms),
            min(req.deadline_ms, d.day_end_ms),
            min(req.deadline_ms, d.day_end_ms + overhang),
            dur_ms,
        )

    def _placed_reason(
        self,
        m: PlacementMember,
        start_ms: int,
        days: list[PlacementDay],
    ) -> PlacementReason:
        dur_ms = m.duration_minutes * consts.MS_PER_MINUTE
        free = sum(self._free_starts(m, d) for d in days)
        return placement_reason(
            "PLACED",
            free_starts=free,
            preference=preference_score_at(self.matrix, start_ms, self.tz),
            near_class=is_near_block(
                self.occ.get(local_date_str(start_ms, self.tz), []), start_ms, dur_ms
            ),
        )

    @staticmethod
    def _outcome_reason(r: PlacedMember) -> PlacedMember:
        """Reason for a start that did not come from the preference scan."""
        if r.start_ms is None:
            return r
        return r.model_copy(
            update={
                "reason": placement_reason(
                    r.outcome, free_starts=0, preference=0.0, near_class=False
                )
            }
        )

    def _no_slot(self, m: PlacementMember, base: PlacedMember) -> PlacedMember:
        return self._outcome_reason(self._no_slot_outcome(m, base))

    def _no_slot_outcome(self, m: PlacementMember, base: PlacedMember) -> PlacedMember:
        req = self.req
        if req.infeasible is None:
            return base.model_copy(update={"outcome": "NEEDS_INFEASIBLE_CONTEXT"})
        t0 = time.perf_counter()
        try:
            return self._resolve_infeasible(m, base)
        finally:
            self.t.displace += time.perf_counter() - t0

    def _resolve_infeasible(
        self, m: PlacementMember, base: PlacedMember
    ) -> PlacedMember:
        req = self.req
        ctx = req.infeasible
        assert ctx is not None
        dd = deadline_day_str(req.deadline_ms, self.tz)
        ds = local_midnight_ms(dd, self.tz)
        de = local_midnight_ms(add_days_str(dd, 1), self.tz)
        flexible = [
            FlexibleTask(
                f.id,
                f.duration_minutes,
                f.deadline_ms,
                f.start_ms,
            )
            for f in ctx.flexible
        ]
        plan = plan_displacement(
            m.duration_minutes,
            req.deadline_ms,
            flexible,
            _ivals(ctx.fixed),
            req.now_ms,
            [(ds, de), (ds - consts.DAY_MS, de + consts.DAY_MS)],
            _ivals(ctx.horizon_occupied),
            req.deadline_ms + consts.INFEASIBLE_HORIZON_DAYS * consts.DAY_MS,
            timezone=self.tz,
        )
        if plan.kind == "placed" and plan.start_ms is not None:
            return self._displaced(base, plan.start_ms, plan.moves, late=False)
        if consts.REPACK_ENABLED:
            repack = plan_repack(
                m.id,
                m.duration_minutes,
                req.deadline_ms,
                flexible,
                _ivals(ctx.fixed),
                req.now_ms,
                req.deadline_ms + consts.INFEASIBLE_HORIZON_DAYS * consts.DAY_MS,
                timezone=self.tz,
                pref_matrix=self.matrix,
                horizon_occupied=_ivals(ctx.horizon_occupied),
            )
            if repack.kind == "placed" and repack.start_ms is not None:
                return self._displaced(
                    base,
                    repack.start_ms,
                    repack.moves,
                    late=m.id in repack.late,
                )
        horizon = _ivals(ctx.horizon_occupied)
        if ctx.policy == "ACCEPT_CONFLICTS":
            s = pick_min_conflict_slot(
                m.duration_minutes,
                req.now_ms,
                req.deadline_ms,
                horizon,
                self.matrix,
                self.tz,
            )
            if s is not None:
                end = s + m.duration_minutes * consts.MS_PER_MINUTE
                clash = any(s < e and end > b for b, e in horizon)
                return self._accepted(base, "ACCEPTED_CONFLICTS", s, conflicting=clash)
        elif ctx.policy == "ACCEPT_LATE_DEADLINE":
            s = pick_late_slot(
                m.duration_minutes,
                req.now_ms,
                req.deadline_ms,
                horizon,
                req.deadline_ms + consts.INFEASIBLE_HORIZON_DAYS * consts.DAY_MS,
            )
            if s is not None:
                return self._accepted(base, "ACCEPTED_LATE", s, late=True)
        return self._last_resort(m, base, horizon, late=True)

    def _last_resort(
        self,
        m: PlacementMember,
        base: PlacedMember,
        occupied: Intervals,
        late: bool,
    ) -> PlacedMember:
        """PLACE only: a TASK row already exists, so it must get *some* start.
        Least-conflict slot before the deadline, else (``late``) the first free
        slot within the +30-day horizon, else the pinned latest start. PREFLIGHT
        keeps answering INFEASIBLE so Nest can still 409 / 400 first."""
        req = self.req
        if req.mode != "PLACE":
            return base
        s = pick_min_conflict_slot(
            m.duration_minutes,
            req.now_ms,
            req.deadline_ms,
            occupied,
            self.matrix,
            self.tz,
        )
        if s is None and late:
            s = pick_late_slot(
                m.duration_minutes,
                req.now_ms,
                req.deadline_ms,
                occupied,
                req.deadline_ms + consts.INFEASIBLE_HORIZON_DAYS * consts.DAY_MS,
            )
        if s is None:
            s = last_resort_pin(m.duration_minutes, req.now_ms, req.deadline_ms, [])
        end = s + m.duration_minutes * consts.MS_PER_MINUTE
        return self._accepted(
            base,
            "ACCEPTED_LAST_RESORT",
            s,
            late=end > req.deadline_ms,
            conflicting=any(s < e and end > b for b, e in occupied),
        )

    @staticmethod
    def _displaced(
        base: PlacedMember,
        start: int,
        moves: Sequence[DisplacementMove],
        late: bool,
    ) -> PlacedMember:
        return base.model_copy(
            update={
                "outcome": "DISPLACED",
                "applied_policy": "HEURISTIC",
                "start_ms": start,
                "late": late,
                "moves": [
                    Move(id=v.id, from_ms=v.from_ms, to_ms=v.to_ms, cost=v.cost)
                    for v in moves
                ],
            }
        )

    @staticmethod
    def _accepted(
        base: PlacedMember,
        outcome: Outcome,
        start: int,
        late: bool = False,
        conflicting: bool = False,
    ) -> PlacedMember:
        return base.model_copy(
            update={
                "outcome": outcome,
                "applied_policy": "HEURISTIC",
                "start_ms": start,
                "late": late,
                "conflicting": conflicting,
            }
        )

    # ---- whole request ---------------------------------------------------
    def run(self) -> PlacedMember:
        req = self.req
        m = req.member
        first = local_date_str(self.next15, self.tz)
        last = local_date_str(req.deadline_ms - 1, self.tz)
        windows_days = [[(first, last)]]

        # Single batched (1, N, D) tensor build for the task, then one scan.
        batch = self._build_batch([m], [(first, last)])
        return self.place_member(m, windows_days[0], batch, 0)


def place(req: PlaceRequest, decode_s: float = 0.0) -> PlaceResponse:
    """Run one placement. ``decode_s`` is the HTTP layer's body-parse time."""
    t_start = time.perf_counter()
    timer = _Timer(decode=decode_s)
    result = _Placer(req, timer).run()
    total = decode_s + (time.perf_counter() - t_start)

    def ms(v: float) -> float:
        return round(v * 1000.0, 3)

    return PlaceResponse(
        contract_version=PLACEMENT_CONTRACT_VERSION,
        request_id=req.request_id,
        params_version=PARAMS_VERSION,
        result=result,
        timings_ms=Timings(
            decode=ms(timer.decode),
            context=ms(timer.context),
            predict=ms(timer.predict),
            scan=ms(timer.scan),
            displace=ms(timer.displace),
            total=ms(total),
        ),
    )
