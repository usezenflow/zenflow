"""Output-equivalence tests for `_Placer._build_batch`'s (M, N, D) tensor path.

`_Placer` builds one batched `(1, N, D)` tensor of the task's candidate-day
context vectors (`_build_batch`) and scores all 6 arms against it in one
broadcast call per arm.

`_old_run` below reconstructs the pre-batch algorithm (per-duration vector and
arm-score caches, called from a per-task `linucb()`), built only out of pieces
of `_Placer` that the batching left untouched. Every test below asserts the
batched `_Placer.run()` reproduces it exactly, field for field, across a single
task, an all-cold-arm request, and a DST-boundary candidate day.
"""

from __future__ import annotations

import copy
import math
from typing import Any

import numpy as np
import pytest
from numpy.typing import NDArray

from src.core import constants as consts
from src.core import matrix_prior
from src.core.constants import DAY_MS, FEATURE_DIM, MS_PER_MINUTE
from src.core.context_vector import build_context_vector
from src.core.hour_arms import unit_length
from src.core.preference import default_preference_matrix
from src.core.slot import (
    add_days_str,
    day_diff_str,
    iso_weekday,
    local_date_str,
    local_midnight_ms,
)
from src.models.linucb import score as linucb_score
from src.place import _Placer, _Timer
from src.policies.selector import PolicySelector
from src.schemas import HOUR_ARM_IDS, ArmId
from src.schemas_place import (
    PLACEMENT_CONTRACT_VERSION,
    PlacedMember,
    PlaceRequest,
)

HOUR = 60 * MS_PER_MINUTE
NOW = 1_789_977_600_000  # Mon 2026-09-21 08:00 UTC
ZERO_WL = {
    t: {"hours": 0, "count": 0}
    for t in ("LECTURE", "ASSIGNMENT", "EXAM", "TASK", "DND")
}


def make_days(
    n: int,
    tz: str = "UTC",
    occupied: dict[int, list[tuple[int, int]]] | None = None,
    start_day: str = "2026-09-21",
) -> list[dict[str, Any]]:
    occupied = occupied or {}
    out = []
    for i in range(n):
        ds = add_days_str(start_day, i)
        out.append(
            {
                "dayStr": ds,
                "dayStartMs": local_midnight_ms(ds, tz),
                "dayEndMs": local_midnight_ms(add_days_str(ds, 1), tz),
                "occupied": [
                    {"startMs": a, "endMs": b} for a, b in occupied.get(i, [])
                ],
                "workloadByType": copy.deepcopy(ZERO_WL),
            }
        )
    return out


def member(
    mid: str = "t1", dur: int = 60, policy: str = "LINUCB", both: bool = False
) -> dict[str, Any]:
    return {
        "id": mid,
        "durationMinutes": dur,
        "primaryPolicy": policy,
        "computeBoth": both,
    }


def make_req(**kw: Any) -> PlaceRequest:
    req: dict[str, Any] = {
        "contractVersion": PLACEMENT_CONTRACT_VERSION,
        "requestId": "test-batch",
        "mode": "PLACE",
        "nowMs": NOW,
        "timezone": "UTC",
        "deadlineMs": NOW + 5 * DAY_MS,
        "maxScanDays": 30,
        "member": member(),
        "days": make_days(6),
        "user": {
            "preferenceMatrix": default_preference_matrix().tolist(),
            "observationCount": 0,
        },
    }
    req.update(kw)
    return PlaceRequest.model_validate(req)


def warm_state(seed: int = 3) -> dict[str, dict[str, list[float]]]:
    rng = np.random.default_rng(seed)
    state: dict[str, dict[str, list[float]]] = {}
    for arm in HOUR_ARM_IDS:
        x = rng.normal(size=(40, FEATURE_DIM))
        a = np.eye(FEATURE_DIM) + x.T @ x / 10
        b = rng.normal(size=FEATURE_DIM) * 0.5
        state[arm] = {"A": a.reshape(-1).tolist(), "b": b.tolist()}
    return state


def cold_state() -> dict[str, dict[str, list[float]]]:
    return {a: {"A": [], "b": []} for a in HOUR_ARM_IDS}


def bandit(
    state: dict[str, Any], alpha: float = 0.15, ridge: float = 1.0
) -> dict[str, Any]:
    return {"alpha": alpha, "ridge": ridge, "state": state}


# ---- oracle: the pre-batch sequential algorithm, reconstructed -----------


def _old_run(req: PlaceRequest) -> PlacedMember:
    """Reference reimplementation of `_Placer.run()` *before* B.2/B.3's
    batching: `_vectors`/`_arm_scores` cached by `duration_minutes` only,
    rebuilt from scratch per distinct duration, called from inside a
    per-member `linucb()`. Built only from pieces of `_Placer` this change
    left untouched, so any divergence from the new batched `run()` is a real
    behavioural regression, not oracle drift.
    """
    placer = _Placer(req, _Timer())
    vec_cache: dict[int, dict[str, NDArray[np.float64]]] = {}
    score_cache: dict[int, dict[str, list[float]]] = {}

    def vectors(duration: int) -> dict[str, NDArray[np.float64]]:
        hit = vec_cache.get(duration)
        if hit is not None:
            return hit
        remaining = max(0, math.floor((req.deadline_ms - req.now_ms) / consts.DAY_MS))
        vecs: dict[str, NDArray[np.float64]] = {}
        for d in req.days:
            wl: dict[str, dict[str, float]] = {
                k: {"hours": v.hours, "count": v.count}
                for k, v in d.workload_by_type.items()
            }
            vecs[d.day_str] = unit_length(
                build_context_vector(
                    remaining_days_until_deadline=remaining,
                    duration_minutes=duration,
                    candidate_iso_weekday=iso_weekday(d.day_str),
                    candidate_days_from_now=max(
                        0, day_diff_str(placer.today, d.day_str)
                    ),
                    workload_by_type=wl,
                )
            )

        vec_cache[duration] = vecs
        return vecs

    def arm_scores(duration: int) -> dict[str, list[float]]:
        hit = score_cache.get(duration)
        if hit is not None:
            return hit
        vecs = vectors(duration)
        keys = list(vecs)
        x = np.stack([vecs[k] for k in keys]) if keys else np.empty((0, FEATURE_DIM))
        per_arm: dict[ArmId, NDArray[np.float64]] = {}
        for arm in HOUR_ARM_IDS:
            params = placer.linucb_policy._arms[arm]
            per_arm[arm] = np.asarray(
                linucb_score(params.A, params.b, x, placer.linucb_policy.alpha),
                dtype=np.float64,
            )
        out: dict[str, list[float]] = {
            k: [float(per_arm[a][i]) for a in HOUR_ARM_IDS] for i, k in enumerate(keys)
        }
        score_cache[duration] = out
        return out

    def old_linucb(m: Any, days: Any) -> Any:
        if not placer.linucb_policy.enabled or not days:
            return None
        try:
            scores = arm_scores(m.duration_minutes)
        except np.linalg.LinAlgError:
            return None
        vecs = vectors(m.duration_minutes)
        return placer.linucb_policy.best_slot(
            m,
            days,
            placer.occ,
            vecs,
            scores,
            placer.next15,
            req.deadline_ms,
        )

    m = req.member
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
    if placer.next15 + dur_ms > req.deadline_ms:
        return placer._no_slot(m, base)
    first = local_date_str(placer.next15, placer.tz)
    last = local_date_str(req.deadline_ms - 1, placer.tz)
    days = placer._select_days(first, last)
    lin = old_linucb(m, days) if PolicySelector.should_try_linucb(req.mode, m) else None
    heur = (
        placer.heuristic(m, days)
        if PolicySelector.should_try_heuristic(req.mode, m, lin)
        else None
    )
    decision = PolicySelector.resolve(req.mode, m, heur, lin)
    if decision is None:
        return placer._no_slot(m, base)
    policy, start_ms = decision
    return base.model_copy(
        update={
            "outcome": "PLACED",
            "applied_policy": policy,
            "heuristic": heur,
            "linucb": lin,
            "start_ms": start_ms,
        }
    )


def _assert_equivalent(req: PlaceRequest) -> PlacedMember:
    new = _Placer(req, _Timer()).run()
    old = _old_run(req)
    # The oracle predates the reason code (#254); check it separately.
    assert new.model_dump(exclude={"reason"}) == old.model_dump(exclude={"reason"}), (
        new.id,
        new,
        old,
    )
    assert (new.reason is None) == (new.start_ms is None), new.id
    return new


# ---- scenarios -------------------------------------------------------------


def test_single_task_m1_matches_oracle() -> None:
    """M = 1: the lone-task path goes through the same batched `_build_batch`
    with no special-casing, not a hand-rolled fast path."""
    req = make_req(member=member(dur=90), bandit=bandit(warm_state()))
    result = _assert_equivalent(req)
    assert result.outcome == "PLACED"
    assert result.linucb is not None


def test_all_cold_arms_matches_oracle(monkeypatch: pytest.MonkeyPatch) -> None:
    """Every arm cold (no A/b) -> all arms tie on the same exploration bonus (the
    batch tensor's arm-score slices, not just the final pick), so the seeded
    tie-break order picks the band and the exact slot. The matrix prior is off, so
    cold means ridge only."""
    monkeypatch.setattr(matrix_prior, "PRIOR_MATRIX", None)
    req = make_req(
        member=member(dur=60),
        deadlineMs=NOW + 3 * DAY_MS,
        days=make_days(4),
        maxScanDays=60,
        bandit=bandit(cold_state()),
    )
    result = _assert_equivalent(req)
    assert result.linucb is not None

    placer = _Placer(req, _Timer())
    first = local_date_str(placer.next15, placer.tz)
    last = local_date_str(req.deadline_ms - 1, placer.tz)
    batch = placer._build_batch([req.member], [(first, last)])
    first_arr = next(iter(batch.arm_scores.values()))
    assert (first_arr[batch.valid] > 0.0).all()
    scores = {a: arr[batch.valid] for a, arr in batch.arm_scores.items()}
    for arm_scores in scores.values():
        np.testing.assert_allclose(arm_scores, scores[HOUR_ARM_IDS[0]])
    assert result.start_ms is not None
    assert result.applied_policy == "LINUCB"


def test_dst_boundary_day_matches_oracle() -> None:
    """One candidate day is a 23-hour DST-start day (`best_linucb_slot`'s
    scalar, non-1440-minute branch) -- the batched tensor's per-day arm-score
    slice must still line up with the right day after the scalar branch
    picks a slot on it."""
    tz = "America/New_York"
    start_day = "2026-03-07"  # 03-08 (index 1) is DST start (23h day)
    days = make_days(4, tz=tz, start_day=start_day)
    assert days[1]["dayEndMs"] - days[1]["dayStartMs"] == 23 * HOUR
    now = days[0]["dayStartMs"]
    req = make_req(
        nowMs=now,
        timezone=tz,
        member=member(dur=90),
        deadlineMs=now + 4 * DAY_MS,
        days=days,
        maxScanDays=60,
        bandit=bandit(warm_state()),
    )
    _assert_equivalent(req)
