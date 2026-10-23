"""LinUCB placement policy (L24N): hour arms, slot-first scan of one request."""

from __future__ import annotations

import math
from collections.abc import Mapping, Sequence

import numpy as np
from numpy.typing import NDArray

from src.core import constants as consts
from src.core.linucb_best_slot import LinucbCandidateDay, best_linucb_slot
from src.core.slot import Intervals
from src.models.linucb import score as linucb_score
from src.schemas import HOUR_ARM_IDS, ArmId
from src.schemas_place import (
    BanditWire,
    LinucbPick,
    PlacementDay,
    PlacementMember,
    Weights,
)
from src.serialization import hydrate_arms, is_cold
from src.telemetry import cold_arms


class LinucbPolicy:
    """Slot-first LinUCB search over the 24 hour arms of one request.

    Hydrates every hour arm's ``(A, b)`` once per request via
    :func:`src.serialization.hydrate_arms`. A slot is scored by the UCB of its own start
    hour, plus the gap, deadline and stability terms. The preference matrix enters only
    through the arms' prior, never the slot score.
    """

    def __init__(self, bandit: BanditWire | None, timezone: str) -> None:
        self.tz = timezone
        self.alpha = bandit.alpha if bandit is not None else 0.0
        self._arms = (
            hydrate_arms(bandit.state, consts.FEATURE_DIM, bandit.ridge)
            if bandit is not None
            else {}
        )
        if bandit is not None:
            cold_arms.record(sum(is_cold(bandit.state.get(a)) for a in HOUR_ARM_IDS))

    @property
    def enabled(self) -> bool:
        """``True`` iff the request carried bandit state at all."""
        return bool(self._arms)

    def arm_scores_batch(
        self, x: NDArray[np.float64]
    ) -> dict[ArmId, NDArray[np.float64]]:
        """UCB of every hour arm against a batched ``(M, N, D)`` context tensor.

        ``M`` (one task) by ``N`` candidate days (padded, per
        :func:`src.place._Placer._build_batch`) by ``D = FEATURE_DIM`` features. Each
        arm's ``A`` is inverted once for the whole batch.

        Returns
        -------
        dict[ArmId, ndarray of shape (M, N)]
            All 24 hour arms.
        """
        m, n, d = x.shape
        flat = x.reshape(m * n, d) if m * n else np.empty((0, d))
        out: dict[ArmId, NDArray[np.float64]] = {}
        for arm in HOUR_ARM_IDS:
            params = self._arms[arm]
            scored = np.asarray(
                linucb_score(params.A, params.b, flat, self.alpha), dtype=np.float64
            )
            out[arm] = scored.reshape(m, n)
        return out

    def best_slot(
        self,
        member: PlacementMember,
        days: list[PlacementDay],
        occupied_by_day: dict[str, Intervals],
        vectors_by_day: dict[str, NDArray[np.float64]],
        arm_scores: Mapping[str, Sequence[float]],
        next_ms: int,
        deadline_ms: int,
    ) -> LinucbPick | None:
        """``arm_scores[day]`` holds that day's 24 hour-arm UCBs, index = start hour."""
        if not self.enabled or not days:
            return None
        cand = [
            LinucbCandidateDay(
                day_str=d.day_str,
                day_start_ms=d.day_start_ms,
                day_end_ms=d.day_end_ms,
                occupied=occupied_by_day[d.day_str],
                vector=vectors_by_day[d.day_str].tolist(),
                arm_scores=arm_scores[d.day_str],
            )
            for d in days
        ]
        best = best_linucb_slot(
            cand,
            member.duration_minutes,
            self.tz,
            next_ms,
            deadline_ms,
            member.prev_start_ms,
            gap_weight=consts.LINUCB_GAP_WEIGHT,
            deadline_weight=consts.DEADLINE_PENALTY_WEIGHT,
            deadline_horizon_hours=consts.LINUCB_DEADLINE_HORIZON_HOURS,
        )
        if best is None or not math.isfinite(best.score):
            return None
        return LinucbPick(
            start_ms=best.start_ms,
            score=best.score,
            selected_arm=HOUR_ARM_IDS[best.hour],
            feature_vector=best.vector,
            weights=Weights(wL=1.0, wS=best.stability_weight),
        )
