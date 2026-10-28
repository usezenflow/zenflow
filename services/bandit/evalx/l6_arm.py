"""L6: the six time-of-day band LinUCB, recovered from commit 38b4afd3.

The placer and its state live in ``evalx/l6`` (a copy of that commit's ``src``
with its imports renamed). This module only adapts the request and the update
to the semester harness. The arm learns the production v1 rewards, so it does
not take reward v2 signals.
"""

from __future__ import annotations

from typing import Any

import numpy as np

from evalx import run as core
from evalx.l6.api import update_arm
from evalx.l6.place import place as run_place
from evalx.l6.schemas import ARM_IDS, UpdateRequest
from evalx.l6.schemas_place import PLACEMENT_CONTRACT_VERSION, PlaceRequest
from evalx.world import Calendar, Task

DAY_MS = 24 * 60 * 60_000

ARM_NAMES: tuple[str, ...] = tuple(ARM_IDS)


def init_state() -> dict[str, dict[str, list[float]]]:
    """A cold start: no observations, so every band sits at the ridge prior."""
    return {arm: {"A": [], "b": []} for arm in ARM_NAMES}


def body(
    task: Task,
    state: dict[str, dict[str, list[float]]],
    matrix: np.ndarray,
    n: int,
    cal: Calendar,
    placed: core.Placed,
    alpha: float,
    ridge: float,
) -> dict[str, Any]:
    """The request 38b4afd3 sends: one ``members`` entry, LINUCB only.

    The day windows are the harness's own, so the blocks this student already
    placed occupy time as they do for every other arm.
    """
    first = (task.arrival_ms // DAY_MS) * DAY_MS
    last = ((task.deadline_ms - 1) // DAY_MS) * DAY_MS
    return {
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
                "primaryPolicy": "LINUCB",
                "computeBoth": False,
            }
        ],
        "fixedOccupied": [],
        "days": core._days(first, last, cal, placed),
        "user": {"preferenceMatrix": matrix.tolist(), "observationCount": n},
        "bandit": {"alpha": alpha, "ridge": ridge, "state": state},
    }


def place(body: dict[str, Any]) -> dict[str, Any] | None:
    """One placement through the recovered placer."""
    res = run_place(PlaceRequest.model_validate(body), 0.0).model_dump(by_alias=True)
    r = res["results"][0]
    return r if r["outcome"] == "PLACED" else None


def learn(
    state: dict[str, dict[str, list[float]]],
    arm_id: str,
    x: list[float],
    reward: float,
    ridge: float,
) -> None:
    """Fold one ``(context, reward)`` observation into a band's state."""
    upd = update_arm(
        UpdateRequest.model_validate(
            {
                "ridge": ridge,
                "arm": arm_id,
                "x": x,
                "reward": reward,
                "state": state[arm_id],
            }
        )
    )
    state[arm_id] = {"A": upd.A, "b": upd.b}
