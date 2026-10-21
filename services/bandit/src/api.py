"""FastAPI HTTP surface over the disjoint LinUCB model (:mod:`src.models.linucb`).

The service is **stateless**: every request carries the per-arm ridge-regression
state ``(A, b)``; ``POST /v1/update`` returns the new state for the NestJS backend
to persist (ADR-0001 §6.1). All scoring / update math is delegated to
:func:`src.models.linucb.score` and :func:`src.models.linucb.update`, which
mirror the model core exactly (Li et al., 2010, Algorithm 1):

* score  ``θ̂ᵀx + α·√(xᵀA⁻¹x)``  with ``θ̂ = A⁻¹b``
* update ``A += xxᵀ``, ``b += reward·x``

Request/response models live in :mod:`src.schemas`; the numpy glue and 422
guards in :mod:`src.serialization`. This module is only the app and its routes.
"""

from __future__ import annotations

import hmac
import itertools
import json
import logging
import math
import os
import threading
import time
from collections.abc import Awaitable, Callable

import numpy as np
from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse
from pydantic import ValidationError

from src.core.hybrid import Z_DIM, hybrid_update
from src.core.init_state import init_state
from src.core.matrix_prior import default_prior
from src.core.prep import prep_window
from src.core.slot import utc_offsets_ms
from src.models.linucb import update
from src.otel import setup_otel
from src.place import place as run_place
from src.schemas import (
    ArmState,
    InitRequest,
    InitResponse,
    UpdateRequest,
    UpdateResponse,
)
from src.schemas_place import PLACEMENT_CONTRACT_VERSION, PlaceRequest, PlaceResponse
from src.schemas_prep import PrepSizeRequest, PrepSizeResponse
from src.serialization import (
    all_finite,
    hydrate,
    hydrate_shared,
    require_422,
)
from src.telemetry import (
    update_duration,
)

log = logging.getLogger("zenflow.bandit")

#: ADR-0003 section 6: 2 MB request cap.
MAX_BODY_BYTES = 2 * 1024 * 1024
_WARM_ZONES = (
    "UTC",
    "America/New_York",
    "America/Los_Angeles",
    "Europe/London",
    "Europe/Paris",
    "Asia/Tokyo",
    "Asia/Ho_Chi_Minh",
    "Australia/Sydney",
)

app = FastAPI(title="Zenflow Bandit Service", version="0.2.0")
setup_otel(app)

_req_counter = itertools.count(1)  # deterministic generated ids (no RNG)


@app.middleware("http")
async def request_id_middleware(
    request: Request, call_next: Callable[[Request], Awaitable[Response]]
) -> Response:
    rid = request.headers.get("x-request-id") or f"req-{next(_req_counter)}"
    started = time.perf_counter()
    response = await call_next(request)
    response.headers["x-request-id"] = rid
    log.info(
        "request_id=%s %s %s status=%s ms=%.2f",
        rid,
        request.method,
        request.url.path,
        response.status_code,
        (time.perf_counter() - started) * 1000,
    )
    return response


def require_token(request: Request) -> None:
    """Optional shared-secret bearer auth (``BANDIT_SERVICE_TOKEN``).

    Unset/empty -> open (dev, tests). ``BANDIT_SERVICE_TOKEN_PREVIOUS`` is also
    accepted for zero-downtime rotation. ``/health`` and ``/ready`` don't use
    this dependency.
    """
    accepted = [
        t
        for t in (
            os.environ.get("BANDIT_SERVICE_TOKEN", ""),
            os.environ.get("BANDIT_SERVICE_TOKEN_PREVIOUS", ""),
        )
        if t
    ]
    if not accepted:
        return
    header = request.headers.get("authorization", "")
    scheme, _, presented = header.partition(" ")
    ok = scheme.lower() == "bearer" and any(
        hmac.compare_digest(presented.encode(), t.encode()) for t in accepted
    )
    if not ok:
        raise HTTPException(
            status_code=401,
            detail="missing or invalid bearer token",
            headers={"WWW-Authenticate": "Bearer"},
        )


_ready_lock = threading.Lock()
_ready = False


def _selftest_request() -> dict[str, object]:
    day = 1_767_571_200_000  # 2026-01-05T00:00Z
    return {
        "contractVersion": PLACEMENT_CONTRACT_VERSION,
        "requestId": "selftest",
        "mode": "PLACE",
        "nowMs": day,
        "timezone": "UTC",
        "deadlineMs": day + 3 * 86_400_000,
        "maxScanDays": 30,
        "members": [
            {
                "id": "selftest",
                "durationMinutes": 60,
                "primaryPolicy": "HEURISTIC",
                "computeBoth": False,
            }
        ],
        "fixedOccupied": [],
        "days": [
            {
                "dayStr": f"2026-01-{5 + i:02d}",
                "dayStartMs": day + i * 86_400_000,
                "dayEndMs": day + (i + 1) * 86_400_000,
                "occupied": [],
                "workloadByType": {},
            }
            for i in range(3)
        ],
        "user": {"preferenceMatrix": [0.0] * 168, "observationCount": 0},
    }


def ensure_ready() -> bool:
    """numpy import, tz offset-cache warm-up and one self-test placement."""
    global _ready
    if _ready:
        return True
    with _ready_lock:
        if _ready:
            return True
        try:
            first = 1_767_571_200_000 // 900_000
            for tz in _WARM_ZONES:
                utc_offsets_ms(first, 96 * 45, tz)
            res = run_place(PlaceRequest.model_validate(_selftest_request()))
            _ready = res.results[0].outcome == "PLACED"
        except Exception:  # readiness must never raise
            log.exception("readiness self-test failed")
            _ready = False
    return _ready


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/ready")
def ready() -> Response:
    if ensure_ready():
        return JSONResponse({"status": "ready"})
    return JSONResponse({"status": "not_ready"}, status_code=503)


class ContractVersionError(Exception):
    def __init__(self, got: object) -> None:
        super().__init__(f"unsupported contractVersion {got!r}")
        self.got = got


@app.exception_handler(ContractVersionError)
async def _contract_version_handler(
    _: Request, exc: ContractVersionError
) -> JSONResponse:
    """ADR-0003 3.4: ``422 {"code": "CONTRACT_VERSION"}`` (matches PlaceErrorBody)."""
    return JSONResponse(
        status_code=422,
        content={
            "code": "CONTRACT_VERSION",
            "supported": PLACEMENT_CONTRACT_VERSION,
            "got": exc.got,
        },
    )


@app.post("/v1/place", dependencies=[Depends(require_token)])
async def place(request: Request) -> PlaceResponse:
    """Authoritative placement (ADR-0003). ``timingsMs.decode`` = body parse."""
    declared = request.headers.get("content-length")
    if declared is not None and declared.isdigit() and int(declared) > MAX_BODY_BYTES:
        raise HTTPException(status_code=413, detail="payload too large")
    body = await request.body()
    if len(body) > MAX_BODY_BYTES:
        raise HTTPException(status_code=413, detail="payload too large")
    t0 = time.perf_counter()
    try:
        req = PlaceRequest.model_validate_json(body)
    except ValidationError as exc:
        try:
            got = json.loads(body).get("contractVersion")
        except (ValueError, AttributeError):
            got = None
        if got is not None and got != PLACEMENT_CONTRACT_VERSION:
            raise ContractVersionError(got) from exc
        raise HTTPException(
            status_code=422,
            detail=exc.errors(
                include_url=False, include_context=False, include_input=False
            ),
        ) from exc
    decode_s = time.perf_counter() - t0
    if req.contract_version != PLACEMENT_CONTRACT_VERSION:
        raise ContractVersionError(req.contract_version)
    res = await run_in_threadpool(run_place, req, decode_s)
    log.info(
        "request_id=%s place mode=%s members=%d outcomes=%s total_ms=%.2f",
        req.request_id,
        req.mode,
        len(req.members),
        ",".join(r.outcome for r in res.results),
        res.timings_ms.total,
    )
    return res


@app.post("/v1/prep/size", dependencies=[Depends(require_token)])
def size_prep(request: PrepSizeRequest) -> PrepSizeResponse:
    """Size and window one prep plan from the student's marks (level-up Phase 1)."""
    window = prep_window(
        request.kind,
        [(m.letter, m.credits) for m in request.marks],
        request.avg_gpa4,
        request.now_ms,
        request.deadline_ms,
    )
    return PrepSizeResponse(
        weak=window.weak,
        duration_minutes=window.duration_minutes,
        window_start_ms=window.window_start_ms,
        deadline_ms=window.deadline_ms,
        feasible=window.feasible,
    )


@app.post("/v1/update", dependencies=[Depends(require_token)])
def update_arm(request: UpdateRequest) -> UpdateResponse:
    """Fold one ``(context, reward)`` observation into an arm and return the new state.

    An empty ``state.A``/``state.b`` (first-ever observation for this arm)
    starts at the ridge prior (:func:`hydrate`, the same cold arm ``/v1/place``
    scores from) before the update, so the updated matrix is what comes back for
    the backend to persist.
    """
    require_422(
        math.isfinite(request.ridge) and request.ridge > 0.0, "ridge must be > 0"
    )
    require_422(math.isfinite(request.reward), "reward must be finite")
    require_422(all_finite(request.x), "x must be finite")
    require_422(
        all_finite(request.state.A) and all_finite(request.state.b),
        "state must be finite",
    )

    started = time.perf_counter()
    d = len(request.x)
    x: np.ndarray = np.asarray(request.x, dtype=np.float64)
    prior = default_prior(d, request.ridge).get(request.arm)
    a, b = hydrate(request.state, d, request.ridge, prior)
    if request.z is None:
        new_a, new_b = update(a, b, x, request.reward)
        update_duration.record(time.perf_counter() - started)
        return UpdateResponse(A=new_a.reshape(-1).tolist(), b=new_b.tolist())

    require_422(len(request.z) == Z_DIM, f"z must have {Z_DIM} features")
    require_422(all_finite(request.z), "z must be finite")
    shared_a, shared_b = hydrate_shared(request.shared, request.ridge, Z_DIM)
    (sa, sb), (new_a, new_b) = hybrid_update(
        shared_a,
        shared_b,
        a,
        b,
        x,
        np.asarray(request.z, dtype=np.float64),
        request.reward,
    )
    update_duration.record(time.perf_counter() - started)
    return UpdateResponse(
        A=new_a.reshape(-1).tolist(),
        b=new_b.tolist(),
        shared=ArmState(A=sa.reshape(-1).tolist(), b=sb.tolist()),
    )


@app.post("/v1/init", dependencies=[Depends(require_token)])
def init_student(request: InitRequest) -> InitResponse:
    """Starting state for a new student: matrix prior per arm, marks prior on beta."""
    require_422(
        math.isfinite(request.ridge) and request.ridge > 0.0, "ridge must be > 0"
    )
    has_marks = bool(request.marks) or request.avg_gpa4 is not None
    state = init_state(request.ridge, has_marks)
    return InitResponse(
        arms={
            arm: ArmState(A=p.A.reshape(-1).tolist(), b=p.b.tolist())
            for arm, p in state.arms.items()
        },
        shared=ArmState(
            A=state.shared_a.reshape(-1).tolist(), b=state.shared_b.tolist()
        ),
    )
