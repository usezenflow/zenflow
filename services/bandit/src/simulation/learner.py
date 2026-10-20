"""Per-policy learned state, updated with the production rules.

* Preference matrix (shared rule, eta = 0.1, nightly decay): MOVE lowers the old
  hour and raises the new one by ``eta * g`` (``g = |drag_distance_reward|``).
  A kept placement is labelled by what the student did in it (level-up plan):
  started or done raises the hour, a lapse lowers it, a skip or a wrong-time
  check-off leaves it. The helpers are the real ``src.core.preference``
  functions.
* LinUCB ``(A, b)`` per arm: MOVE reward = ``drag_distance_reward``, RETAINED =
  +1, via ``src.models.linucb.update`` / ``score``. Only sessions that actually
  carried a LinUCB proposal update it. The hybrid model (``hybrid=True``) also
  keeps one shared ``beta`` over the cross features ``z``
  (:mod:`src.core.hybrid`).
"""

from __future__ import annotations

import numpy as np
from numpy.typing import NDArray

from src.core.arms import ARM_BANDS
from src.core.constants import FEATURE_DIM, PREFERENCE_KEPT_WEIGHT
from src.core.hybrid import Z_DIM, hybrid_update
from src.core.preference import (
    decay_matrix,
    default_preference_matrix,
    reinforce_preference_cell,
    reinforce_preference_move,
)
from src.models.linucb import score as linucb_score
from src.models.linucb import update as linucb_update

ARMS = tuple(b[0] for b in ARM_BANDS)
RETAINED_REWARD = 1.0


class PreferenceMatrix:
    def __init__(self, timezone: str) -> None:
        self.tz = timezone
        self.matrix: NDArray[np.float64] = default_preference_matrix()

    def decay(self, delta_days: float) -> None:
        self.matrix = decay_matrix(self.matrix, delta_days)

    def retained(self, start_ms: int) -> None:
        """Legacy kept-placement rule (``reward="retained"``)."""
        self.matrix = reinforce_preference_cell(
            self.matrix, start_ms, self.tz, PREFERENCE_KEPT_WEIGHT
        )

    def labelled(self, at_ms: int, reward: float) -> None:
        """Kept placement: ``reward`` is the completion reward (0 for a skip)."""
        self.matrix = reinforce_preference_cell(
            self.matrix, at_ms, self.tz, PREFERENCE_KEPT_WEIGHT * reward
        )

    def moved(self, old_ms: int, new_ms: int, drag_minutes: float) -> None:
        self.matrix = reinforce_preference_move(
            self.matrix, old_ms, new_ms, self.tz, drag_minutes
        )


class LinUCBState:
    def __init__(
        self,
        alpha: float,
        ridge: float,
        hybrid: bool = False,
        shared_prior: tuple[NDArray[np.float64], NDArray[np.float64]] | None = None,
    ) -> None:
        self.alpha = alpha
        self.hybrid = hybrid
        self.a = {arm: ridge * np.identity(FEATURE_DIM) for arm in ARMS}
        self.b = {arm: np.zeros(FEATURE_DIM) for arm in ARMS}
        prior_a, prior_b = shared_prior or (
            ridge * np.identity(Z_DIM),
            np.zeros(Z_DIM),
        )
        self.prior_a, self.prior_b = prior_a, prior_b
        self.shared_a = prior_a.copy()
        self.shared_b = prior_b.copy()
        self.n_shared = 0

    def _beta(self) -> NDArray[np.float64]:
        return np.linalg.solve(self.shared_a, self.shared_b)

    def arm_scores(
        self, x: NDArray[np.float64], z: NDArray[np.float64] | None = None
    ) -> dict[str, NDArray[np.float64]]:
        """Score every arm for a batch ``(n, d)`` of per-day contexts.

        ``z`` is ``(n, len(ARMS), Z_DIM)``, the cross features of each (day, arm);
        it is used only by the hybrid model.
        """
        beta = self._beta() if self.hybrid and z is not None else None
        out: dict[str, NDArray[np.float64]] = {}
        for k, arm in enumerate(ARMS):
            scored = np.asarray(
                linucb_score(self.a[arm], self.b[arm], x, self.alpha),
                dtype=np.float64,
            )
            if beta is not None and z is not None:
                scored = scored + z[:, k, :] @ beta
            out[arm] = scored
        return out

    def observe(
        self,
        arm: str,
        x: NDArray[np.float64],
        reward: float,
        z: NDArray[np.float64] | None = None,
    ) -> None:
        if self.hybrid and z is not None:
            (self.shared_a, self.shared_b), (self.a[arm], self.b[arm]) = hybrid_update(
                self.shared_a, self.shared_b, self.a[arm], self.b[arm], x, z, reward
            )
            self.n_shared += 1
            return
        self.a[arm], self.b[arm] = linucb_update(self.a[arm], self.b[arm], x, reward)

    def own_shared_stats(self) -> tuple[NDArray[np.float64], NDArray[np.float64], int]:
        """This student's own ``(sum z z^T, sum residual z, n)``, without the prior."""
        return self.shared_a - self.prior_a, self.shared_b - self.prior_b, self.n_shared
