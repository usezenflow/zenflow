"""Hour-level LinUCB (L24N): one arm per local start hour, kernel update, unit features.

Each arm is ``(A, b)`` for one start hour. A slot is scored by the UCB of its own start
hour. A reward at hour ``h`` updates every hour arm, weighted by a circular Gaussian of
width :data:`KERNEL_SD` hours, so neighbouring hours share evidence. The day context is
divided by its L2 length before scoring and before every update.

Port of the eval reference ``services/bandit/evalx/hourly.py`` (arm ``L-hourly-K+N``).
"""

from __future__ import annotations

import math
from collections.abc import Mapping

import numpy as np
from numpy.typing import ArrayLike, NDArray

from src.core.constants import PREFERENCE_SLOTS_PER_DAY
from src.core.preference import kernel_hour_weights
from src.models.schemas import ArmParams
from src.schemas import HOUR_ARM_IDS, ArmId

#: Width, in hours, of the Gaussian that spreads one reward over neighbouring hours.
KERNEL_SD = 0.75


def hour_arm(local_minute: float) -> ArmId:
    """The arm of a slot starting at ``local_minute`` past local midnight."""
    return HOUR_ARM_IDS[(math.floor(local_minute) % 1440) // 60]


def unit_length(x: ArrayLike) -> NDArray[np.float64]:
    """``x`` divided by its L2 length; a zero vector is returned unchanged."""
    arr = np.asarray(x, dtype=np.float64)
    norm = float(np.linalg.norm(arr))
    return arr / norm if norm > 0 else arr


def kernel_update(
    arms: Mapping[ArmId, ArmParams],
    hour: int,
    x: ArrayLike,
    reward: float,
    sd: float = KERNEL_SD,
) -> dict[ArmId, ArmParams]:
    """Fold one ``(context, reward)`` at start ``hour`` into all 24 hour arms.

    Arm ``h`` gains ``w[h] * x xᵀ`` and ``w[h] * reward * x``, where ``w`` is
    :func:`src.core.preference.kernel_hour_weights` of width ``sd`` centred on
    ``hour``. The centre arm gets the full weight of 1.
    """
    if len(arms) != PREFERENCE_SLOTS_PER_DAY:
        raise ValueError(f"expected {PREFERENCE_SLOTS_PER_DAY} hour arms")
    vec = np.asarray(x, dtype=np.float64)
    outer = np.outer(vec, vec)
    w = kernel_hour_weights(sd, hour)
    out: dict[ArmId, ArmParams] = {}
    for h, arm in enumerate(HOUR_ARM_IDS):
        p = arms[arm]
        out[arm] = ArmParams(
            A=p.A + w[h] * outer,
            b=p.b + w[h] * reward * vec,
        )
    return out
