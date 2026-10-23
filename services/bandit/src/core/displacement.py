"""Flexible-task displacement: cost-based cascade over flexible sessions.

Issue #62 B (EDF eviction with spillover) plus issue #250 (move cost).
"""

from __future__ import annotations

import time
from collections import Counter
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from typing import Any

import numpy as np
from numpy.typing import ArrayLike, NDArray

from .constants import (
    DAY_MS,
    DISPLACE_COST_AUTO,
    DISPLACE_COST_CROSS_DAY,
    FROZEN_WINDOW_HOURS,
    HOUR_MS,
    MAX_DISPLACED_TASKS,
    MS_PER_MINUTE,
    REPACK_CANDIDATES_PER_TASK,
    REPACK_MAX_MOVES,
    REPACK_MAX_NODES,
    REPACK_TIME_BUDGET_S,
    SLOT_MS,
)
from .slot import (
    Intervals,
    add_days_str,
    ceil_to_slot,
    floor_to_slot,
    local_date_str,
    local_midnight_ms,
    overlaps_any,
)
from .slot_score import free_start_mask, slot_preference_scores

_TIE_DECIMALS = 9

FROZEN_WINDOW_MS = FROZEN_WINDOW_HOURS * HOUR_MS


@dataclass(frozen=True)
class FlexibleTask:
    id: str
    duration_minutes: int
    deadline_ms: int
    start_ms: int

    @property
    def end_ms(self) -> int:
        return self.start_ms + self.duration_minutes * MS_PER_MINUTE


@dataclass(frozen=True)
class DisplacementMove:
    id: str
    from_ms: int
    to_ms: int
    cost: float = 0.0


@dataclass(frozen=True)
class DisplacementPlan:
    kind: str  # "placed" | "infeasible"
    start_ms: int | None = None
    moves: tuple[DisplacementMove, ...] = ()
    late: tuple[str, ...] = ()  # ids placed past their deadline (repack only)

    @property
    def cost(self) -> float:
        return sum(m.cost for m in self.moves)


def is_frozen(f: FlexibleTask, now_ms: int, frozen_ms: int = FROZEN_WINDOW_MS) -> bool:
    """Started, or starting within ``frozen_ms`` of now."""
    return f.start_ms < now_ms + frozen_ms or f.start_ms < ceil_to_slot(now_ms)


def is_movable(
    f: FlexibleTask,
    now_ms: int,
    frozen_ms: int = FROZEN_WINDOW_MS,
) -> bool:
    """Frozen tasks never move."""
    return not is_frozen(f, now_ms, frozen_ms)


def _local_day_bounds(ms: int, timezone: str) -> tuple[int, int]:
    day = local_date_str(ms, timezone)
    return local_midnight_ms(day, timezone), local_midnight_ms(
        add_days_str(day, 1), timezone
    )


def move_cost(from_ms: int, to_ms: int, timezone: str) -> float:
    """Base, plus hours moved, plus the cross-day penalty."""
    ds, de = _local_day_bounds(from_ms, timezone)
    cross = 0 if ds <= to_ms < de else DISPLACE_COST_CROSS_DAY
    return DISPLACE_COST_AUTO + abs(to_ms - from_ms) / HOUR_MS + cross


def nearest_free_start(
    duration_minutes: int,
    occupied: Intervals,
    lower_ms: int,
    fit_end_ms: int,
    target_ms: int,
) -> int | None:
    """Free slot-aligned start in ``[lower, fit_end - duration]`` closest to
    ``target_ms`` (ties -> earlier); ``None`` when nothing fits."""
    duration_ms = duration_minutes * MS_PER_MINUTE
    first = ceil_to_slot(lower_ms)
    if first + duration_ms > fit_end_ms:
        return None
    n = (fit_end_ms - duration_ms - first) // SLOT_MS + 1
    free = np.flatnonzero(free_start_mask(first, n, duration_ms, occupied))
    starts = first + free.astype(np.int64) * SLOT_MS
    if starts.size == 0:
        return None
    return int(starts[int(np.lexsort((starts, np.abs(starts - target_ms)))[0])])


def cheapest_free_start(
    task: FlexibleTask,
    occupied: Intervals,
    lower_ms: int,
    fit_end_ms: int,
    timezone: str,
) -> tuple[int, float] | None:
    """Free start for ``task`` with the lowest :func:`move_cost` (ties ->
    earlier)."""
    duration_ms = task.duration_minutes * MS_PER_MINUTE
    first = ceil_to_slot(lower_ms)
    if first + duration_ms > fit_end_ms:
        return None
    n = (fit_end_ms - duration_ms - first) // SLOT_MS + 1
    starts = first + np.arange(n, dtype=np.int64) * SLOT_MS
    ok = free_start_mask(first, n, duration_ms, occupied)
    starts = starts[ok]
    if starts.size == 0:
        return None
    ds, de = _local_day_bounds(task.start_ms, timezone)
    cost = (
        DISPLACE_COST_AUTO
        + np.abs(starts - task.start_ms) / HOUR_MS
        + DISPLACE_COST_CROSS_DAY * ((starts < ds) | (starts >= de))
    )
    i = int(np.lexsort((starts, cost))[0])
    return int(starts[i]), float(cost[i])


def _without(
    intervals: Sequence[tuple[int, int]], remove: Iterable[tuple[int, int]]
) -> Intervals:
    """``intervals`` minus one instance of each ``remove`` item (multiset)."""
    left = Counter(remove)
    out: Intervals = []
    for iv in intervals:
        if left[iv] > 0:
            left[iv] -= 1
        else:
            out.append(iv)
    return out


def _cascade(
    candidate: tuple[int, int],
    obstacles: Intervals,
    participants: Sequence[FlexibleTask],
    lower_ms: int,
    horizon_end_ms: int,
    max_moves: int,
    timezone: str,
) -> list[DisplacementMove] | None:
    """Settle ``participants`` around ``candidate`` in EDF order.

    A participant still clear of everything settled stays put. One that
    collides moves to its cheapest free start in ``[lower, min(deadline,
    horizon_end)]``. It may land on an unsettled participant with a strictly
    later deadline, which then gets its own turn; equal-deadline peers don't
    ripple-shift.
    """
    ordered = sorted(participants, key=lambda t: (t.deadline_ms, t.id))
    settled: Intervals = [*obstacles, candidate]
    moves: list[DisplacementMove] = []
    for i, p in enumerate(ordered):
        if not overlaps_any(settled, p.start_ms, p.end_ms):
            settled.append((p.start_ms, p.end_ms))
            continue
        peers = [
            (q.start_ms, q.end_ms)
            for q in ordered[i + 1 :]
            if q.deadline_ms <= p.deadline_ms
        ]
        hit = cheapest_free_start(
            p,
            [*settled, *peers],
            lower_ms,
            min(p.deadline_ms, horizon_end_ms),
            timezone,
        )
        if hit is None:
            return None
        slot, cost = hit
        moves.append(DisplacementMove(p.id, p.start_ms, slot, cost))
        if len(moves) > max_moves:
            return None
        settled.append((slot, slot + p.duration_minutes * MS_PER_MINUTE))
    return moves


def plan_displacement(
    task_duration_minutes: int,
    task_deadline_ms: int,
    flexible: Sequence[FlexibleTask],
    fixed: Intervals,
    now_ms: int,
    windows: Sequence[tuple[int, int]],
    horizon_occupied: Intervals,
    horizon_end_ms: int,
    max_moves: int | None = None,
    *,
    timezone: str = "UTC",
    frozen_ms: int = FROZEN_WINDOW_MS,
) -> DisplacementPlan:
    """Cheapest cascade for a task with no free slot before its deadline.

    Per window: movable flexible tasks (:func:`is_movable`) overlapping it are
    *participants*; fixed, frozen and out-of-window tasks are obstacles. Every
    obstacle-free start before the deadline is tried with :func:`_cascade`. The
    lowest total move cost wins (ties -> earlier window, earlier start). Moved
    participants may spill to any day up to their own deadline (bounded by
    ``horizon_end_ms``), avoiding ``horizon_occupied``.
    """
    max_moves = MAX_DISPLACED_TASKS if max_moves is None else max_moves
    duration_ms = task_duration_minutes * MS_PER_MINUTE
    lower_ms = ceil_to_slot(now_ms)
    movable = [f for f in flexible if is_movable(f, now_ms, frozen_ms)]

    best = DisplacementPlan("infeasible")
    best_cost = float("inf")
    for win in windows:
        participants = [f for f in movable if f.end_ms > win[0] and f.start_ms < win[1]]
        p_ids = {p.id for p in participants}
        obstacles: Intervals = [
            *fixed,
            *((f.start_ms, f.end_ms) for f in flexible if f.id not in p_ids),
        ]
        global_obstacles: Intervals = [
            *fixed,
            *_without(horizon_occupied, ((p.start_ms, p.end_ms) for p in participants)),
            *obstacles,
        ]

        first = max(lower_ms, ceil_to_slot(win[0]))
        hi = min(win[1], task_deadline_ms - duration_ms + 1)  # exclusive
        if hi <= first:
            continue
        n = -((first - hi) // SLOT_MS)  # ceil((hi - first) / SLOT)
        free = np.flatnonzero(free_start_mask(first, n, duration_ms, obstacles))
        for s in (first + free * SLOT_MS).tolist():
            # Lower bound: every participant under the candidate must move.
            floor = sum(
                DISPLACE_COST_AUTO
                for p in participants
                if p.start_ms < s + duration_ms and p.end_ms > s
            )
            if floor >= best_cost:
                continue
            moves = _cascade(
                (s, s + duration_ms),
                global_obstacles,
                participants,
                lower_ms,
                horizon_end_ms,
                max_moves,
                timezone,
            )
            if moves is None:
                continue
            cost = sum(m.cost for m in moves)
            if cost < best_cost:
                best = DisplacementPlan("placed", s, tuple(moves))
                best_cost = cost
    return best


@dataclass(frozen=True)
class _Slate:
    """One task's candidate starts, with the terms the search ranks them by."""

    id: str
    minutes: int
    deadline_ms: int
    orig_ms: int | None  # None for the task being placed
    starts: NDArray[np.int64]
    late_ms: NDArray[np.int64]
    cost: NDArray[np.float64]
    pref: NDArray[np.float64]
    options: NDArray[np.intp]  # indices into the arrays above, best first

    @property
    def duration_ms(self) -> int:
        return self.minutes * MS_PER_MINUTE


def _per_day_best(
    order: NDArray[np.intp], starts: NDArray[np.int64], lower_ms: int
) -> NDArray[np.intp]:
    """From ``order`` (best first), the first index in each 24h bucket."""
    if order.size == 0:
        return order
    buckets = (starts[order] - lower_ms) // DAY_MS
    _, first = np.unique(buckets, return_index=True)
    return order[np.sort(first)]


def _slate(
    task_id: str,
    minutes: int,
    deadline_ms: int,
    orig_ms: int | None,
    pinned: Intervals,
    lower_ms: int,
    horizon_end_ms: int,
    timezone: str,
    pref_matrix: ArrayLike | None,
    per_task: int,
) -> _Slate | None:
    """Free starts in ``[lower, horizon_end - duration]``, cheapest on-time and
    least-late options first. ``None`` when nothing fits."""
    duration_ms = minutes * MS_PER_MINUTE
    last = horizon_end_ms - duration_ms
    if last < lower_ms:
        return None
    n = (last - lower_ms) // SLOT_MS + 1
    free = free_start_mask(lower_ms, n, duration_ms, pinned)
    starts = (lower_ms + np.arange(n, dtype=np.int64) * SLOT_MS)[free]
    if starts.size == 0:
        return None
    late_ms = np.maximum(0, starts + duration_ms - deadline_ms)
    if orig_ms is None:
        cost = np.zeros(starts.size)
        pref = np.zeros(starts.size)
    else:
        ds, de = _local_day_bounds(orig_ms, timezone)
        cost = np.where(
            starts == orig_ms,
            0.0,
            DISPLACE_COST_AUTO
            + np.abs(starts - orig_ms) / HOUR_MS
            + DISPLACE_COST_CROSS_DAY * ((starts < ds) | (starts >= de)),
        )
        pref = (
            np.zeros(starts.size)
            if pref_matrix is None
            else slot_preference_scores(pref_matrix, starts, minutes, timezone)
        )
    on_time = np.flatnonzero(late_ms == 0)
    on_time = on_time[np.lexsort((starts[on_time], -pref[on_time], cost[on_time]))]
    late = np.flatnonzero(late_ms > 0)
    late = late[np.lexsort((starts[late], -pref[late], cost[late], late_ms[late]))]
    # The nearest starts all sit on one day and collide with each other, so
    # the best start of every 24h bucket is kept too. That is what lets a task
    # spill to a later day.
    picks = [
        *on_time[:per_task],
        *_per_day_best(on_time, starts, lower_ms),
        *late[:per_task],
        *_per_day_best(late, starts, lower_ms),
    ]
    options = np.array(list(dict.fromkeys(int(i) for i in picks)), dtype=np.intp)
    return _Slate(
        task_id,
        minutes,
        deadline_ms,
        orig_ms,
        starts,
        late_ms,
        cost,
        pref,
        options,
    )


def _greedy_seed(
    order: Sequence[_Slate], max_moves: int
) -> tuple[tuple[int, int, float, float], list[int]] | None:
    """The first non-clashing option per task, in search order. Gives the
    depth-first search an incumbent to prune against from the start."""
    chosen: Intervals = []
    picks: list[int] = []
    late_n = late_sum = moves = 0
    cost_sum = pref_sum = 0.0
    for slate in order:
        for k in slate.options.tolist():
            s = int(slate.starts[k])
            e = s + slate.duration_ms
            moved = slate.orig_ms is not None and s != slate.orig_ms
            if moves + moved > max_moves:
                continue
            if not any(s < ce and e > cs for cs, ce in chosen):
                break
        else:
            return None
        chosen.append((s, e))
        picks.append(k)
        late_n += int(slate.late_ms[k] > 0)
        late_sum += int(slate.late_ms[k])
        cost_sum += float(slate.cost[k])
        pref_sum += float(slate.pref[k])
        moves += moved
    return (late_n, late_sum, cost_sum, -pref_sum), picks


def plan_repack(
    task_id: str | None,
    task_duration_minutes: int | None,
    task_deadline_ms: int | None,
    flexible: Sequence[FlexibleTask],
    fixed: Intervals,
    now_ms: int,
    horizon_end_ms: int,
    *,
    timezone: str = "UTC",
    pref_matrix: ArrayLike | None = None,
    horizon_occupied: Sequence[tuple[int, int]] = (),
    frozen_ms: int = FROZEN_WINDOW_MS,
    max_moves: int = REPACK_MAX_MOVES,
    time_budget_s: float = REPACK_TIME_BUDGET_S,
    per_task: int = REPACK_CANDIDATES_PER_TASK,
    max_nodes: int = REPACK_MAX_NODES,
) -> DisplacementPlan:
    """Re-solve the movable flexible tasks and the new task together, over the
    whole horizon, so slack tasks can move to another day.

    Frozen, fixed and non-movable busy time on the horizon are obstacles. Tasks
    are searched in least-laxity order, depth first, and the search is cut off
    after ``time_budget_s``
    (the best layout found so far is used). The objective is lexicographic:
    fewest tasks past their deadline, least total lateness, least move cost,
    then best preference score. Returns ``infeasible`` only when no complete
    layout exists within the move cap and the time budget.

    With ``task_id`` None there is no new task: the obstacles in ``fixed``
    (e.g. an anchor session) stay put and only the movable ``flexible`` tasks
    are re-solved. Then ``new_start`` in the result is None.
    """
    lower_ms = ceil_to_slot(now_ms)
    stop_at = time.perf_counter() + time_budget_s
    movable = [f for f in flexible if is_movable(f, now_ms, frozen_ms)]
    pinned: Intervals = [
        *fixed,
        *_without(horizon_occupied, ((f.start_ms, f.end_ms) for f in movable)),
        *(
            (f.start_ms, f.end_ms)
            for f in flexible
            if not is_movable(f, now_ms, frozen_ms)
        ),
    ]
    new_task: list[_Slate | None] = []
    if task_id is not None:
        if task_duration_minutes is None or task_deadline_ms is None:
            raise ValueError("a new task needs a duration and a deadline")
        new_task.append(
            _slate(
                task_id,
                task_duration_minutes,
                task_deadline_ms,
                None,
                pinned,
                lower_ms,
                horizon_end_ms,
                timezone,
                pref_matrix,
                per_task,
            )
        )
    slates = [
        *new_task,
        *(
            _slate(
                f.id,
                f.duration_minutes,
                f.deadline_ms,
                f.start_ms,
                pinned,
                lower_ms,
                horizon_end_ms,
                timezone,
                pref_matrix,
                per_task,
            )
            for f in movable
        ),
    ]
    if any(s is None for s in slates):
        return DisplacementPlan("infeasible")
    order = sorted(
        (s for s in slates if s is not None),
        key=lambda s: (s.deadline_ms - lower_ms - s.duration_ms, s.id),
    )

    best = _greedy_seed(order, max_moves)
    chosen: Intervals = []
    picks: list[int] = []

    def visit(
        depth: int,
        late_n: int,
        late_sum: int,
        cost_sum: float,
        pref_sum: float,
        moves: int,
    ) -> None:
        nonlocal best
        if time.perf_counter() > stop_at:
            return
        if depth == len(order):
            key = (late_n, late_sum, cost_sum, -pref_sum)
            if best is None or key < best[0]:
                best = (key, list(picks))
            return
        slate = order[depth]
        for k in slate.options.tolist():
            s = int(slate.starts[k])
            e = s + slate.duration_ms
            if any(s < ce and e > cs for cs, ce in chosen):
                continue
            moved = slate.orig_ms is not None and s != slate.orig_ms
            if moves + moved > max_moves:
                continue
            late_n2 = late_n + int(slate.late_ms[k] > 0)
            late_sum2 = late_sum + int(slate.late_ms[k])
            cost2 = cost_sum + float(slate.cost[k])
            if best is not None and (late_n2, late_sum2, cost2) > best[0][:3]:
                continue
            chosen.append((s, e))
            picks.append(k)
            visit(
                depth + 1,
                late_n2,
                late_sum2,
                cost2,
                pref_sum + float(slate.pref[k]),
                moves + moved,
            )
            chosen.pop()
            picks.pop()

    visit(0, 0, 0, 0.0, 0.0, 0)
    if best is None:
        return DisplacementPlan("infeasible")

    moves_out: list[DisplacementMove] = []
    late_ids: list[str] = []
    new_start: int | None = None
    for slate, k in zip(order, best[1], strict=True):
        s = int(slate.starts[k])
        if slate.id == task_id:
            new_start = s
        if slate.late_ms[k] > 0:
            late_ids.append(slate.id)
        if slate.orig_ms is not None and s != slate.orig_ms:
            moves_out.append(
                DisplacementMove(slate.id, slate.orig_ms, s, float(slate.cost[k]))
            )
    return DisplacementPlan("placed", new_start, tuple(moves_out), tuple(late_ids))


def pick_min_conflict_slot(
    duration_minutes: int,
    now_ms: int,
    deadline_ms: int,
    occupied: Intervals,
    pref_matrix: ArrayLike,
    timezone: str,
) -> int | None:
    """Start before the deadline overlapping the least calendar time (ties:
    better preference, then earlier)."""
    duration_ms = duration_minutes * MS_PER_MINUTE
    first = ceil_to_slot(now_ms)
    if first + duration_ms > deadline_ms:
        return None
    n = (deadline_ms - duration_ms - first) // SLOT_MS + 1
    starts = first + np.arange(n, dtype=np.int64) * SLOT_MS
    overlap = np.zeros(n, dtype=np.int64)
    for o_start, o_end in occupied:
        overlap += np.maximum(
            0, np.minimum(o_end, starts + duration_ms) - np.maximum(o_start, starts)
        )
    score = np.round(
        slot_preference_scores(pref_matrix, starts, duration_minutes, timezone),
        _TIE_DECIMALS,
    )
    return int(starts[int(np.lexsort((starts, -score, overlap))[0])])


def pick_late_slot(
    duration_minutes: int,
    now_ms: int,
    deadline_ms: int,
    occupied: Intervals,
    horizon_end_ms: int | None = None,
) -> int | None:
    """Earliest conflict-free start at/after now whose END passes the deadline."""
    duration_ms = duration_minutes * MS_PER_MINUTE
    horizon = (
        deadline_ms + 30 * 24 * 60 * MS_PER_MINUTE
        if horizon_end_ms is None
        else horizon_end_ms
    )
    first = max(ceil_to_slot(now_ms), ceil_to_slot(deadline_ms - duration_ms + 1))
    if first + duration_ms > horizon:
        return None
    n = (horizon - duration_ms - first) // SLOT_MS + 1
    free = np.flatnonzero(free_start_mask(first, n, duration_ms, occupied))
    return int(first + free[0] * SLOT_MS) if free.size else None


def last_resort_pin(
    duration_minutes: int,
    now_ms: int,
    deadline_ms: int,
    avoid: Sequence[tuple[int, int]] = (),
) -> int:
    """Terminal fallback: the latest on-grid start that still ends by the
    deadline, or the next slot when that is already past. Pushed later past
    anything in ``avoid`` (e.g. already-pinned siblings). Always returns a
    start -- a TASK is never left unplaced."""
    duration_ms = duration_minutes * MS_PER_MINUTE
    s = max(ceil_to_slot(now_ms), floor_to_slot(deadline_ms - duration_ms))
    moved = True
    while moved:
        moved = False
        for o_start, o_end in avoid:
            if s < o_end and s + duration_ms > o_start:
                s = ceil_to_slot(o_end)
                moved = True
    return s


def flexible_from_dicts(raw: Sequence[dict[str, Any]]) -> list[FlexibleTask]:
    return [
        FlexibleTask(
            f["id"],
            f["durationMinutes"],
            f["deadlineMs"],
            f["startMs"],
        )
        for f in raw
    ]
