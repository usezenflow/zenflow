"""L-hourly: LinUCB over 24 start-hour arms with a kernel-weighted update (eval only).

The shipped LinUCB scores six time-of-day bands. Here each start hour is its own arm
``(A_h, b_h)``. A start at hour ``h`` updates every arm by the circular Gaussian
weight ``w(h' - h)`` of width ``sd`` (1 at the centre), so neighbouring hours share
evidence. ``sd=0`` leaves 24 independent arms.

A slot is scored by the UCB of its start hour, plus the same deadline, gap and
stability terms as ``best_linucb_slot``. The day context vector is the placer's
(``build_context_vector``), so the features are unchanged.

Three optional parts, each its own arm (plan steps 2 to 4):

* ``posterior`` (step 4): the prior is the posterior-mean chronotype curve over five
  archetypes instead of the matrix. Each start tempers the posterior.
* ``opens`` (step 2): app opens feed the posterior as pseudo-starts (weight 0.15 each,
  at most 3 starts in total). Only the caller decides which opens to pass in.
* ``features`` (step 3): a shared head over eight slot-level features (fatigue after
  and before fixed blocks, gap length, weekend shape). It adds ``z . beta`` to every
  slot score, so slots of one day can differ.

Not the production placer: the scan covers every day of the request, without the
placer's day selection, displacement, series or last-resort rules.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any

import numpy as np
from numpy.typing import NDArray

from src.core import constants as consts
from src.core.constants import DAY_MS, FEATURE_DIM, HOUR_MS, MS_PER_MINUTE, SLOT_MS
from src.core.context_vector import build_context_vector
from src.core.gap_quality import gap_quality_scores
from src.core.matrix_prior import (
    N0_WEEKDAY,
    N0_WEEKEND,
    PRIOR_BASE,
    PRIOR_SLOPE,
    REFERENCE_ISO_WEEKDAY,
    REFERENCE_ISO_WEEKEND,
    arm_share,
    reference_context,
)
from src.core.preference import WEEKEND_SCALE, kernel_hour_weights
from src.core.slot import ceil_to_slot, day_diff_str, iso_weekday, local_date_str
from src.core.slot_score import (
    deadline_penalty_scores,
    free_start_mask,
    proximity_stability_scores,
)

HOURS = 24
LR_PRIOR_PRECISION = 2.0
SLOT_DIM = 8  # the step 3 features
PSEUDO_WEIGHT = 0.15  # starts per open
PSEUDO_CAP = 3.0  # most pseudo-starts from opens, in starts
FATIGUE_MINUTES = 90
POSTERIOR_TEMPER = 0.7
POSTERIOR_FLOOR = 0.05
ARCHETYPE_SD_H = 3.0
# (peaks in hours, prior weight). Bimodal is the max of its two bumps.
ARCHETYPES: tuple[tuple[tuple[float, ...], float], ...] = (
    ((9.0,), 0.15),  # lark
    ((13.0,), 0.20),  # day
    ((20.0,), 0.35),  # evening
    ((22.5,), 0.15),  # owl
    ((10.0, 20.0), 0.15),  # bimodal
)
_TIE_DECIMALS = 9


def _archetype_curves() -> NDArray[np.float64]:
    """(5, 24) hourly liking of each archetype, centred on the hour, floor 0.05."""
    centres = np.arange(HOURS) + 0.5
    out = np.zeros((len(ARCHETYPES), HOURS))
    for k, (peaks, _) in enumerate(ARCHETYPES):
        bumps = []
        for p in peaks:
            d = (centres - p + HOURS / 2) % HOURS - HOURS / 2
            bumps.append(np.exp(-(d**2) / (2 * ARCHETYPE_SD_H**2)))
        out[k] = np.maximum(np.max(bumps, axis=0), POSTERIOR_FLOOR)
    return out


CURVES = _archetype_curves()
PRIOR_WEIGHTS = np.array([w for _, w in ARCHETYPES])


@dataclass(frozen=True)
class HourPick:
    start_ms: int
    hour: int
    vector: NDArray[np.float64]
    slot: NDArray[np.float64] = field(default_factory=lambda: np.zeros(SLOT_DIM))


class HourlyArms:
    def __init__(
        self,
        matrix: NDArray[np.float64],
        alpha: float,
        ridge: float,
        posterior: bool = False,
        features: bool = False,
        shared_alpha: float | None = None,
        hour_free: bool = False,
        start_model: bool = False,
        norm: bool = False,
        membership: str | None = None,
    ) -> None:
        self.hour_free = hour_free
        self.start_model = start_model
        # Logistic start model (plan step 5): diagonal Laplace posterior over
        # [intercept, 24 start hours, 8 slot features].
        self.lr_dim = 1 + HOURS + SLOT_DIM
        self.lr_mean = np.zeros(self.lr_dim)
        self.lr_prec = np.full(self.lr_dim, LR_PRIOR_PRECISION)
        self.rng = np.random.default_rng(0)
        self.norm = norm
        self.membership = membership
        self.dim = (
            FEATURE_DIM + 5
            if membership == "append"
            else 6
            if membership == "replace"
            else FEATURE_DIM
        )
        self.alpha = alpha
        self.shared_alpha = alpha if shared_alpha is None else shared_alpha
        self.ridge = ridge
        self.matrix = matrix
        self.posterior = posterior
        self.features = features
        self.post = PRIOR_WEIGHTS.copy()
        self.pseudo_total = 0.0
        self.a_prior, self.b_prior = self._prior()
        self.a = self.a_prior.copy()
        self.b = self.b_prior.copy()
        self.a_shared = np.identity(SLOT_DIM) * ridge
        self.b_shared = np.zeros(SLOT_DIM)
        if self.start_model:  # seed the hour weights from the same curve as the prior
            self.lr_mean[1 : 1 + HOURS] = np.log(np.maximum(self._shares()[0], 0.05))

    # --- prior ---------------------------------------------------------------

    def _shares(self) -> tuple[NDArray[np.float64], NDArray[np.float64]]:
        """(weekday, weekend) liking share over the peak for each start hour."""
        if not self.posterior:
            wd = np.array(
                [
                    arm_share(self.matrix, False, h * 60, (h + 1) * 60)
                    for h in range(HOURS)
                ]
            )
            we = np.array(
                [
                    arm_share(self.matrix, True, h * 60, (h + 1) * 60)
                    for h in range(HOURS)
                ]
            )
            return wd, we
        curve = self.post @ CURVES
        curve = curve / curve.max()
        return curve, WEEKEND_SCALE * np.roll(curve, 1)

    def _prior(self) -> tuple[NDArray[np.float64], NDArray[np.float64]]:
        a = np.stack([self.ridge * np.eye(self.dim) for _ in range(HOURS)])
        b = np.zeros((HOURS, self.dim))
        shares = self._shares()
        for (_, n0, iso), share in zip(
            (
                (False, N0_WEEKDAY, REFERENCE_ISO_WEEKDAY),
                (True, N0_WEEKEND, REFERENCE_ISO_WEEKEND),
            ),
            shares,
            strict=True,
        ):
            x = self._context(reference_context(iso))
            for h in range(HOURS):
                reward = PRIOR_BASE + PRIOR_SLOPE * share[h]
                a[h] += n0 * np.outer(x, x)
                b[h] += n0 * reward * x
        return a, b

    def _context(self, day_x: NDArray[np.float64]) -> NDArray[np.float64]:
        """Arm context: day features or membership (disjoint model), normed if asked."""
        if self.membership == "append":
            x = np.concatenate([day_x, self.post])
        elif self.membership == "replace":
            x = np.concatenate([self.post, [1.0]])
        else:
            x = day_x
        return x / np.linalg.norm(x) if self.norm else x

    def _reseed(self) -> None:
        """Swap the prior for the current posterior, keeping the real data."""
        data_a = self.a - self.a_prior
        data_b = self.b - self.b_prior
        self.a_prior, self.b_prior = self._prior()
        self.a = self.a_prior + data_a
        self.b = self.b_prior + data_b

    def observe_start(self, hour: int, weight: float = 1.0) -> None:
        """Temper the posterior by one start (or a pseudo-start of ``weight``)."""
        if not self.posterior:
            return
        lik = CURVES[:, hour] / CURVES.sum(axis=1)
        post = self.post * lik ** (POSTERIOR_TEMPER * weight)
        post = np.maximum(post / post.sum(), POSTERIOR_FLOOR)
        self.post = post / post.sum()
        self._reseed()

    def observe_open(self, hour: int) -> None:
        """An app open is weak evidence: a pseudo-start, capped in total."""
        room = PSEUDO_CAP - self.pseudo_total
        if room <= 0:
            return
        weight = min(PSEUDO_WEIGHT, room)
        self.pseudo_total += weight
        self.observe_start(hour, weight)

    def posterior_curve(self) -> NDArray[np.float64]:
        return self.post @ CURVES

    # --- scoring -------------------------------------------------------------

    def hour_scores(self, x: NDArray[np.float64]) -> NDArray[np.float64]:
        """UCB of ``x`` under every hour arm."""
        a_inv = np.linalg.inv(self.a)
        theta = np.einsum("hij,hj->hi", a_inv, self.b)
        mean = theta @ x
        width = np.sqrt(np.maximum(np.einsum("i,hij,j->h", x, a_inv, x), 0.0))
        return mean + self.alpha * width

    def shared_scores(self, z: NDArray[np.float64]) -> NDArray[np.float64]:
        """Shared-head UCB of each slot feature row ``z`` (n, SLOT_DIM)."""
        a_inv = np.linalg.inv(self.a_shared)
        beta = a_inv @ self.b_shared
        width = np.sqrt(np.maximum(np.einsum("ni,ij,nj->n", z, a_inv, z), 0.0))
        return z @ beta + self.shared_alpha * width

    def update(
        self,
        hour: int,
        x: NDArray[np.float64],
        reward: float,
        sd: float,
        slot: NDArray[np.float64] | None = None,
    ) -> None:
        w = kernel_hour_weights(sd, hour)
        self.a += w[:, None, None] * np.outer(x, x)
        self.b += (w * reward)[:, None] * x
        if reward > 0:
            self.observe_start(hour)
        if self.features and slot is not None:
            self.a_shared += np.outer(slot, slot)
            self.b_shared += reward * slot

    # --- placement -----------------------------------------------------------

    def _start_design(self, hours: NDArray[np.int64], z: NDArray[np.float64]):
        x = np.zeros((hours.size, self.lr_dim))
        x[:, 0] = 1.0
        x[np.arange(hours.size), 1 + hours] = 1.0
        x[:, 1 + HOURS :] = z
        return x

    def _start_logits(self, hours: NDArray[np.int64], z: NDArray[np.float64]):
        """One Thompson draw of the start logit for each candidate slot."""
        draw = self.lr_mean + self.rng.standard_normal(self.lr_dim) / np.sqrt(
            self.lr_prec
        )
        return 1.0 / (1.0 + np.exp(-(self._start_design(hours, z) @ draw)))

    def observe_label(self, hour: int, z: NDArray[np.float64], started: bool) -> None:
        """Fold one placed block (started or not) into the start model."""
        if not self.start_model:
            return
        x = self._start_design(np.array([hour]), z[None, :])[0]
        p = 1.0 / (1.0 + np.exp(-(x @ self.lr_mean)))
        self.lr_prec = self.lr_prec + p * (1 - p) * x * x
        self.lr_mean = self.lr_mean + (float(started) - p) * x / self.lr_prec

    def pick(
        self,
        body: dict[str, Any],
        extra: list[tuple[int, int]],
        prev_start_ms: int | None,
        fixed: dict[int, list[tuple[int, int]]] | None = None,
        placed: dict[int, list[tuple[int, int]]] | None = None,
    ) -> HourPick | None:
        """The best free start in ``body``'s days, scored by its hour arm.

        ``fixed`` and ``placed`` map a day start to its fixed and placed intervals (ms);
        the slot features read them. Both default to empty.
        """
        now = body["nowMs"]
        deadline = body["deadlineMs"]
        duration = body["member"]["durationMinutes"]
        duration_ms = duration * MS_PER_MINUTE
        overhang = duration_ms - SLOT_MS
        next_ms = ceil_to_slot(now)
        today = local_date_str(now, "UTC")
        remaining = max(0, math.floor((deadline - now) / DAY_MS))

        best: (
            tuple[float, int, int, NDArray[np.float64], NDArray[np.float64]] | None
        ) = None
        for day in body["days"]:
            d0, d1 = day["dayStartMs"], day["dayEndMs"]
            lower = max(ceil_to_slot(d0), next_ms)
            upper = min(d1 + overhang, deadline)
            if lower + duration_ms > upper:
                continue
            n = (upper - duration_ms - lower) // SLOT_MS + 1
            busy = [(o["startMs"], o["endMs"]) for o in day["occupied"]] + list(extra)
            mask = free_start_mask(lower, n, duration_ms, busy)
            if not mask.any():
                continue
            starts = lower + np.arange(n, dtype=np.int64)[mask] * SLOT_MS
            hours = ((starts - d0) // HOUR_MS).astype(np.int64)
            wl = {
                k: {"hours": v["hours"], "count": v["count"]}
                for k, v in day["workloadByType"].items()
            }
            x = build_context_vector(
                remaining_days_until_deadline=remaining,
                duration_minutes=duration,
                candidate_iso_weekday=iso_weekday(day["dayStr"]),
                candidate_days_from_now=max(0, day_diff_str(today, day["dayStr"])),
                workload_by_type=wl,
            )
            x = self._context(x)
            total = self.hour_scores(x)[hours]
            slot_z = np.zeros((starts.size, SLOT_DIM))
            if self.start_model:
                slot_z = slot_features(
                    starts,
                    duration_ms,
                    d0,
                    (fixed or {}).get(d0, []),
                    (placed or {}).get(d0, []),
                    day["dayStr"],
                )
                total = self._start_logits(hours, slot_z)
            if self.features:
                slot_z = slot_features(
                    starts,
                    duration_ms,
                    d0,
                    (fixed or {}).get(d0, []),
                    (placed or {}).get(d0, []),
                    day["dayStr"],
                )
                if self.hour_free:
                    slot_z[:, 6:] = 0.0  # the hour arms already carry the time of day
                total = total + self.shared_scores(slot_z)
            if consts.LINUCB_GAP_WEIGHT:
                total = total + consts.LINUCB_GAP_WEIGHT * gap_quality_scores(
                    (starts - d0) // MS_PER_MINUTE,
                    duration,
                    [
                        ((s - d0) // MS_PER_MINUTE, (e - d0) // MS_PER_MINUTE)
                        for s, e in busy
                    ],
                    0,
                    (d1 - d0) // MS_PER_MINUTE,
                )
            if consts.DEADLINE_PENALTY_WEIGHT:
                total = total + deadline_penalty_scores(
                    starts + duration_ms,
                    deadline,
                    consts.DEADLINE_PENALTY_WEIGHT,
                    consts.LINUCB_DEADLINE_HORIZON_HOURS,
                )
            if prev_start_ms is not None:
                total = total + proximity_stability_scores(
                    prev_start_ms, starts, next_ms
                )
            order = np.lexsort((starts, -np.round(total, _TIE_DECIMALS)))
            i = int(order[0])
            cand = (float(total[i]), int(starts[i]), int(hours[i]), x, slot_z[i])
            if best is None or (cand[0], -cand[1]) > (best[0], -best[1]):
                best = cand
        if best is None:
            return None
        _, start, hour, x, z = best
        return HourPick(start_ms=start, hour=hour, vector=x, slot=z)


def slot_features(
    starts: NDArray[np.int64],
    duration_ms: int,
    day_start: int,
    fixed: list[tuple[int, int]],
    placed: list[tuple[int, int]],
    day_str: str,
) -> NDArray[np.float64]:
    """(n, SLOT_DIM) per-slot features, from fixed blocks and placed blocks of one day.

    Columns: after_fixed, before_fixed, fixed_before_h, free_day, gap_len,
    adjacent_flex, cos_h x weekend sign, sin_h x weekend sign.
    """
    minute = MS_PER_MINUTE
    fixed_sorted = sorted(fixed)
    f_starts = np.array([a for a, _ in fixed_sorted], dtype=np.int64)
    f_ends = np.array([b for _, b in fixed_sorted], dtype=np.int64)
    busy = sorted([*fixed, *placed])
    b_starts = np.array([a for a, _ in busy], dtype=np.int64)
    b_ends = np.array([b for _, b in busy], dtype=np.int64)
    n = starts.size
    z = np.zeros((n, SLOT_DIM))
    ends = starts + duration_ms
    # Fixed blocks: last one that ended before the start, next one that starts after.
    z[:, 3] = 0.0 if fixed else 1.0
    if f_ends.size:
        prev_idx = np.searchsorted(f_ends, starts, side="right") - 1
        has_prev = prev_idx >= 0
        since = (starts - f_ends[np.clip(prev_idx, 0, None)]) / minute
        z[:, 0] = np.where(
            has_prev, np.exp(-np.maximum(since, 0) / FATIGUE_MINUTES), 0.0
        )
        next_idx = np.searchsorted(f_starts, starts, side="left")
        has_next = next_idx < f_starts.size
        until = (f_starts[np.clip(next_idx, None, f_starts.size - 1)] - starts) / minute
        z[:, 1] = np.where(
            has_next, np.exp(-np.maximum(until, 0) / FATIGUE_MINUTES), 0.0
        )
        cum = np.concatenate([[0], np.cumsum(f_ends - f_starts)])
        before_min = cum[np.searchsorted(f_starts, starts, side="left")] / minute
        z[:, 2] = np.clip(before_min / 60 / 8, 0, 1)
    # Gap containing the slot, bounded by busy blocks or the day edges.
    if b_ends.size:
        pe = np.searchsorted(b_ends, starts, side="right") - 1
        gap_lo = np.where(pe >= 0, b_ends[np.clip(pe, 0, None)], day_start)
        ns = np.searchsorted(b_starts, ends, side="left")
        gap_hi = np.where(
            ns < b_starts.size,
            b_starts[np.clip(ns, None, b_starts.size - 1)],
            day_start + DAY_MS,
        )
    else:
        gap_lo = np.full(n, day_start)
        gap_hi = np.full(n, day_start + DAY_MS)
    z[:, 4] = np.clip((gap_hi - gap_lo) / minute / 240, 0, 1)
    # Abutting a placed block.
    if placed:
        p_starts = np.array([a for a, _ in placed], dtype=np.int64)
        p_ends = np.array([b for _, b in placed], dtype=np.int64)
        touch = np.isin(starts, p_ends) | np.isin(ends, p_starts)
        z[:, 5] = touch.astype(np.float64)
    weekend = 1.0 if iso_weekday(day_str) >= 6 else -1.0
    hour_frac = (starts - day_start) / HOUR_MS
    z[:, 6] = np.cos(2 * np.pi * hour_frac / 24) * weekend
    z[:, 7] = np.sin(2 * np.pi * hour_frac / 24) * weekend
    return z
