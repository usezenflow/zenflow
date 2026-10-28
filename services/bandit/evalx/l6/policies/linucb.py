"""LinUCB placement policy: slot-first scan wired to :mod:`src.models.linucb`."""

from __future__ import annotations

import math
from collections.abc import Sequence

import numpy as np
from numpy.typing import NDArray

from evalx.l6.core import constants as consts
from evalx.l6.core.hybrid import Z_DIM
from evalx.l6.core.linucb_best_slot import LinucbCandidateDay, best_linucb_slot
from evalx.l6.core.slot import Intervals
from evalx.l6.models.linucb import score as linucb_score
from evalx.l6.schemas import ARM_IDS, ArmId
from evalx.l6.schemas_place import (
    BanditWire,
    LinucbPick,
    PlacementDay,
    PlacementMember,
    Weights,
)
from evalx.l6.serialization import hydrate_arms, hydrate_shared, is_cold
from evalx.l6.telemetry import cold_arms


class LinucbPolicy:
    """Slot-first LinUCB search (issue #62 A) over one request's bandit state.

    Hydrates every arm's ``(A, b)`` once per request via
    :func:`src.serialization.hydrate_arms`; a cold arm is the ridge prior
    (``A = ridge * I, b = 0``) and scores its full exploration bonus. The
    preference matrix enters only the slot score (``best_slot``), as a
    weighted term that picks the hour inside the chosen band; it never
    touches the arm models.
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
            cold_arms.record(sum(is_cold(bandit.state.get(a)) for a in ARM_IDS))
        # beta of the hybrid model; zero when the request carries no shared block.
        shared_a, shared_b = hydrate_shared(
            bandit.shared if bandit is not None else None,
            bandit.ridge if bandit else 1.0,
            Z_DIM,
        )
        self._beta: NDArray[np.float64] = np.linalg.solve(shared_a, shared_b)

    @property
    def enabled(self) -> bool:
        """``True`` iff the request carried bandit state at all."""
        return bool(self._arms)

    def arm_scores_batch(
        self,
        x: NDArray[np.float64],
        z: NDArray[np.float64] | None = None,
    ) -> dict[ArmId, NDArray[np.float64]]:
        """Score every arm against a batched ``(M, N, D)`` context tensor.

        ``M`` candidate-series-members by ``N`` candidate days (padded, per
        :func:`src.place._Placer._build_batch`) by ``D = FEATURE_DIM``
        features. Flattens to ``(M*N, D)`` so each arm's ``A`` is inverted
        once regardless of member/day count, then reshapes back — replaces
        the old per-``dayStr`` dict-of-dicts scoring, which was called once
        per distinct ``duration_minutes`` instead of once per request.

        Parameters
        ----------
        x : ndarray of shape (M, N, D)

        Returns
        -------
        dict[ArmId, ndarray of shape (M, N)]
            All 6 arms, per contract.
        """
        m, n, d = x.shape
        flat = x.reshape(m * n, d) if m * n else np.empty((0, d))
        out: dict[ArmId, NDArray[np.float64]] = {}
        for arm in ARM_IDS:
            params = self._arms[arm]
            scored = np.asarray(
                linucb_score(params.A, params.b, flat, self.alpha), dtype=np.float64
            )
            out[arm] = scored.reshape(m, n)
            if z is not None:
                # hybrid: z[m, n, arm] @ beta, the shared term of the arm's score
                out[arm] = out[arm] + z[:, :, ARM_IDS.index(arm), :] @ self._beta
        return out

    def best_slot(
        self,
        member: PlacementMember,
        days: list[PlacementDay],
        occupied_by_day: dict[str, Intervals],
        vectors_by_day: dict[str, NDArray[np.float64]],
        arm_scores: dict[str, dict[ArmId, float]],
        extra: Intervals,
        next_ms: int,
        deadline_ms: int,
        tie_break_order: Sequence[str],
        crosses: dict[str, NDArray[np.float64]] | None = None,
    ) -> LinucbPick | None:
        """``crosses[day]`` is that day's ``(len(ARM_IDS), Z_DIM)`` cross features."""
        if not self.enabled or not days:
            return None
        cand = [
            LinucbCandidateDay(
                day_str=d.day_str,
                day_start_ms=d.day_start_ms,
                day_end_ms=d.day_end_ms,
                occupied=occupied_by_day[d.day_str],
                vector=vectors_by_day[d.day_str].tolist(),
                arm_scores={str(a): v for a, v in arm_scores[d.day_str].items()},
            )
            for d in days
        ]
        best = best_linucb_slot(
            cand,
            member.duration_minutes,
            self.tz,
            next_ms,
            deadline_ms,
            extra,
            member.prev_start_ms,
            tie_break_order,
            gap_weight=consts.LINUCB_GAP_WEIGHT,
            deadline_weight=consts.DEADLINE_PENALTY_WEIGHT,
            deadline_horizon_hours=consts.LINUCB_DEADLINE_HORIZON_HOURS,
        )
        if best is None or not math.isfinite(best.score):
            return None
        arm: ArmId = next(a for a in ARM_IDS if a == best.arm)
        cross = [0.0] * Z_DIM
        if crosses is not None:
            day = next(
                d for d in days if d.day_start_ms <= best.start_ms < d.day_end_ms
            )
            cross = crosses[day.day_str][ARM_IDS.index(arm)].tolist()
        return LinucbPick(
            start_ms=best.start_ms,
            score=best.score,
            selected_arm=arm,
            feature_vector=best.vector,
            cross_features=cross,
            weights=Weights(wL=1.0, wS=best.stability_weight),
        )
