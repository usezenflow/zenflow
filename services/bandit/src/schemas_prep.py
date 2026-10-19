"""Wire contract for ``POST /v1/prep/size`` (level-up plan, Phase 1).

Camel-case JSON like ``schemas_place.py``. Requests are strict so drift fails
loudly. Instants are epoch-ms integers.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

MAX_MARKS = 500


class _Req(BaseModel):
    model_config = ConfigDict(extra="forbid", alias_generator=to_camel)


class _Resp(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class MarkWire(_Req):
    # Free text from DLU; the scorer reads the first letter and ignores the rest.
    letter: str | None = Field(default=None, max_length=8)
    credits: int = Field(ge=0, le=60)


class PrepSizeRequest(_Req):
    kind: Literal["EXAM", "ASSIGNMENT"]
    now_ms: int
    deadline_ms: int
    marks: list[MarkWire] = Field(default_factory=list, max_length=MAX_MARKS)
    avg_gpa4: float | None = Field(default=None, ge=0, le=4)


class PrepSizeResponse(_Resp):
    weak: float
    duration_minutes: int
    window_start_ms: int
    deadline_ms: int
    feasible: bool
