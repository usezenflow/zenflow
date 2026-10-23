"""Wire contract for the bandit HTTP surface — Pydantic request/response models.

Field names must match the NestJS backend exactly. ``d`` (the context dimension,
7 here) is **inferred** from the length of ``x`` and validated by the cross-field
``model_validator``s here — never hardcoded.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, model_validator

#: One arm per local start hour (``SchedulingArm`` in ``@zenflow/shared``).
ArmId = Literal[
    "HOUR_00",
    "HOUR_01",
    "HOUR_02",
    "HOUR_03",
    "HOUR_04",
    "HOUR_05",
    "HOUR_06",
    "HOUR_07",
    "HOUR_08",
    "HOUR_09",
    "HOUR_10",
    "HOUR_11",
    "HOUR_12",
    "HOUR_13",
    "HOUR_14",
    "HOUR_15",
    "HOUR_16",
    "HOUR_17",
    "HOUR_18",
    "HOUR_19",
    "HOUR_20",
    "HOUR_21",
    "HOUR_22",
    "HOUR_23",
]

HOUR_ARM_IDS: tuple[ArmId, ...] = (
    "HOUR_00",
    "HOUR_01",
    "HOUR_02",
    "HOUR_03",
    "HOUR_04",
    "HOUR_05",
    "HOUR_06",
    "HOUR_07",
    "HOUR_08",
    "HOUR_09",
    "HOUR_10",
    "HOUR_11",
    "HOUR_12",
    "HOUR_13",
    "HOUR_14",
    "HOUR_15",
    "HOUR_16",
    "HOUR_17",
    "HOUR_18",
    "HOUR_19",
    "HOUR_20",
    "HOUR_21",
    "HOUR_22",
    "HOUR_23",
)


class ArmState(BaseModel):
    """Per-arm ridge-regression state.

    ``A`` is ``d*d`` floats row-major; ``b`` is ``d`` floats. Either list may be
    empty, meaning "no data yet": the arm falls back to its cold prior and scores
    its full exploration bonus.
    """

    A: list[float] = Field(default_factory=list)
    b: list[float] = Field(default_factory=list)


def _check_arm_map(arms: dict[ArmId, ArmState], d: int) -> None:
    """Every hour arm present, each with ``A`` of ``d*d`` and ``b`` of ``d`` floats."""
    missing = [arm for arm in HOUR_ARM_IDS if arm not in arms]
    if missing:
        raise ValueError(f"arms must hold all 24 hour arms, missing {missing[0]}")
    for arm, st in arms.items():
        if st.A and len(st.A) != d * d:
            raise ValueError(f"{arm}.A must have length d*d = {d * d}")
        if st.b and len(st.b) != d:
            raise ValueError(f"{arm}.b must have length d = {d}")


class UpdateRequest(BaseModel):
    """One observed start or move, folded into all 24 hour arms by its kernel."""

    ridge: float
    arm: ArmId  # the hour arm of the slot the reward is for
    x: list[float] = Field(min_length=1)
    reward: float
    arms: dict[ArmId, ArmState]

    @model_validator(mode="after")
    def _check_dims(self) -> UpdateRequest:
        _check_arm_map(self.arms, len(self.x))
        return self


class UpdateResponse(BaseModel):
    arms: dict[ArmId, ArmState]


class InitRequest(BaseModel):
    """A new student's starting state (``POST /v1/init``): the prior per hour arm."""

    ridge: float = Field(gt=0)


class InitResponse(BaseModel):
    arms: dict[ArmId, ArmState]
