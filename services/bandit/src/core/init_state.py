"""Initial LinUCB state for a new student: the matrix prior on every hour arm.

Pure: no input beyond the ridge and the feature dimension. The cohort prior is not
here yet; it needs 20 users with data.
"""

from __future__ import annotations

from src.core.constants import FEATURE_DIM
from src.core.matrix_prior import default_prior
from src.models.schemas import ArmParams
from src.schemas import HOUR_ARM_IDS, ArmId


def init_state(ridge: float) -> dict[ArmId, ArmParams]:
    """The matrix prior on each of the 24 hour arms."""
    arms = default_prior(FEATURE_DIM, ridge)
    return {
        arm: arms.get(arm) or ArmParams.cold(FEATURE_DIM, ridge) for arm in HOUR_ARM_IDS
    }
