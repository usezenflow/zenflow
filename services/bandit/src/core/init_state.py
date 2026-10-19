"""Initial LinUCB v2 state for a new student (level-up plan, step 2 and 4).

Pure: the caller passes the focus band and marks, and gets back every arm's
``(A, b)`` plus the shared ``beta`` block. The cohort prior is not here yet;
it needs 20 users with data.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from numpy.typing import NDArray

from src.core.band_prior import FocusBand, band_prior
from src.core.constants import FEATURE_DIM
from src.core.hybrid import Z_DIM, shared_prior
from src.models.schemas import ArmParams
from src.schemas import ARM_IDS, ArmId


@dataclass(frozen=True)
class InitState:
    arms: dict[ArmId, ArmParams]
    shared_a: NDArray[np.float64]
    shared_b: NDArray[np.float64]


def init_state(
    ridge: float, focus_band: FocusBand | None, has_marks: bool
) -> InitState:
    """Band prior on every arm, marks prior on ``beta`` when marks exist."""
    if focus_band:
        arms = band_prior(focus_band, FEATURE_DIM, ridge)
    else:
        arms = {arm: ArmParams.cold(FEATURE_DIM, ridge) for arm in ARM_IDS}
    if has_marks:
        shared_a, shared_b = shared_prior(ridge)
    else:
        shared_a, shared_b = ridge * np.identity(Z_DIM), np.zeros(Z_DIM)
    return InitState(
        arms={arm: arms[arm] for arm in ARM_IDS},
        shared_a=shared_a,
        shared_b=shared_b,
    )
