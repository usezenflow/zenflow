"""Band prior for cold LinUCB arms (level-up plan, LinUCB v2).

A student's stated focus band seeds each arm with pseudo-observations at one
reference context. The band's arms lead the first picks instead of a tie-break.
Each real reward adds ``x x^T`` against ``N0`` pseudo-observations, so real data
dominates after roughly ten starts.
"""

from __future__ import annotations

from typing import Literal, cast

import numpy as np

from src.core.arms import ARM_BANDS
from src.core.constants import MAX_SCAN_DAYS
from src.core.context_vector import build_context_vector
from src.models.schemas import ArmParams
from src.schemas import ArmId

FocusBand = Literal["MORNING", "AFTERNOON", "EVENING", "LATE_NIGHT"]

# Local minutes of day for each band, as ``(start, end)``. LATE_NIGHT wraps.
BAND_MINUTES: dict[FocusBand, tuple[tuple[int, int], ...]] = {
    "MORNING": ((8 * 60, 12 * 60),),
    "AFTERNOON": ((12 * 60, 17 * 60),),
    "EVENING": ((17 * 60, 21 * 60),),
    "LATE_NIGHT": ((21 * 60, 24 * 60), (0, 2 * 60)),
}

N0 = 3.0
# Pseudo-reward ``BASE + SLOPE * share``: +0.5 for an arm wholly inside the band,
# -0.2 for an arm outside it.
PRIOR_BASE = -0.2
PRIOR_SLOPE = 0.7

# Mid-horizon weekday in the middle of the scan, 60 minute session, average loads.
REFERENCE_DURATION_MINUTES = 60
REFERENCE_ISO_WEEKDAY = 3


def band_share(arm_start: int, arm_end: int, band: FocusBand) -> float:
    """Fraction of ``[arm_start, arm_end)`` inside ``band``'s local hours."""
    width = arm_end - arm_start
    inside = 0
    for b_start, b_end in BAND_MINUTES[band]:
        inside += max(0, min(arm_end, b_end) - max(arm_start, b_start))
    return inside / width


def reference_context() -> np.ndarray:
    """The ``x`` the pseudo-observations sit at; a mid-horizon weekday."""
    half = MAX_SCAN_DAYS / 2
    return build_context_vector(
        remaining_days_until_deadline=half,
        duration_minutes=REFERENCE_DURATION_MINUTES,
        candidate_iso_weekday=REFERENCE_ISO_WEEKDAY,
        candidate_days_from_now=half,
    )


def band_prior(band: FocusBand, d: int, ridge: float) -> dict[ArmId, ArmParams]:
    """``(A, b)`` for every arm, seeded from the focus band."""
    x = reference_context()
    if x.shape != (d,):
        raise ValueError(f"reference context has {x.size} features, expected {d}")
    xx = np.outer(x, x)
    prior: dict[ArmId, ArmParams] = {}
    for arm, start, end in ARM_BANDS:
        reward = PRIOR_BASE + PRIOR_SLOPE * band_share(start, end, band)
        prior[cast(ArmId, arm)] = ArmParams(
            A=ridge * np.eye(d) + N0 * xx,
            b=N0 * reward * x,
        )
    return prior
