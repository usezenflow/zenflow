"""Resolve an overlap: repack the flexible sessions that clash with an anchor."""

from __future__ import annotations

from src.core import constants as consts
from src.core.displacement import FlexibleTask, plan_repack
from src.core.quiet_hours import quiet_intervals
from src.core.slot import Intervals, add_days_str, local_date_str
from src.schemas_place import Move, ResolveRequest, ResolveResponse


def _quiet_hours(now_ms: int, end_ms: int, timezone: str) -> Intervals:
    """Quiet windows on every local day from ``now`` to ``end``."""
    day = local_date_str(now_ms, timezone)
    last = local_date_str(end_ms, timezone)
    out: Intervals = []
    while day <= last:
        out.extend(quiet_intervals(day, timezone))
        day = add_days_str(day, 1)
    return out


def resolve(req: ResolveRequest) -> ResolveResponse:
    anchor = (req.anchor.start_ms, req.anchor.end_ms)
    fixed = [
        *((f.start_ms, f.end_ms) for f in req.fixed),
        *_quiet_hours(req.now_ms, req.horizon_end_ms, req.timezone),
    ]
    flexible = [
        FlexibleTask(f.id, f.duration_minutes, f.deadline_ms, f.start_ms)
        for f in req.flexible
    ]
    plan = plan_repack(
        None,
        None,
        None,
        flexible,
        [*fixed, anchor],
        req.now_ms,
        req.horizon_end_ms,
        timezone=req.timezone,
        pref_matrix=req.preference_matrix,
        horizon_occupied=[(i.start_ms, i.end_ms) for i in req.horizon_occupied],
        max_moves=consts.REPACK_MAX_MOVES,
    )
    if plan.kind != "placed":
        return ResolveResponse(
            contract_version=req.contract_version,
            request_id=req.request_id,
            outcome="INFEASIBLE",
            moves=[],
            late_ids=[],
        )
    return ResolveResponse(
        contract_version=req.contract_version,
        request_id=req.request_id,
        outcome="RESOLVED",
        moves=[
            Move(id=m.id, from_ms=m.from_ms, to_ms=m.to_ms, cost=m.cost)
            for m in plan.moves
        ],
        late_ids=list(plan.late),
    )
