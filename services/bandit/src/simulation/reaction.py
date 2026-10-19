"""How a student reacts to a proposal.

Three interaction styles are supported:

* **Dragger** (legacy parity): drags to the best-looking free slot on the same
  day when the perceived gain beats a threshold plus inertia.
* **Tapper**: sees a plan offer with two time chips (default + alternative),
  taps one or ignores it.
* **Ignorer**: accepts the default slot and may start it or let it lapse.

The random draws are keyed by (student, task, member), so both policy worlds
face identical luck.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from numpy.typing import NDArray

from src.core.constants import DAY_MS, MOVE_REWARD_SCALE_MINUTES, SLOT_MS

from .archetypes import StudentProfile
from .rng import stream

SLOTS_PER_DAY = DAY_MS // SLOT_MS

# Completion rewards (simulator-local; not part of the production reward contract).
STARTED_REWARD = 1.0
LAPSED_REWARD = -0.5
SKIPPED_REWARD = 0.0
WRONG_TIME_REWARD = -0.2

# Per-style chance the offer is actually seen (not ignored by notification fatigue).
_OFFER_SEEN_BASE = {"dragger": 0.75, "tapper": 0.90, "ignorer": 0.40}
# Per-style preference for the default option when utilities are close.
_DEFAULT_BIAS = {"dragger": 0.0, "tapper": 0.15, "ignorer": 0.35}
# Utility thresholds for the completion model.
_WRONG_TIME_THRESHOLD = -0.3
_START_UTILITY_OFFSET = 0.15


@dataclass(frozen=True)
class ReactionDraws:
    eps_prop: float
    u_act: float
    eps_slots: NDArray[np.float64]  # one noise value per 15-min slot of the day
    u_done: float  # uniform draw: does a started session get finished
    u_seen: float  # uniform draw: is the offer seen
    u_default: float  # uniform draw: default vs option for tappers
    u_skip: float  # uniform draw: skip vs lapse for non-starters
    u_complete: float  # uniform draw: finish after starting


@dataclass(frozen=True)
class Completion:
    started: bool
    done: bool
    skipped: bool
    wrong_time: bool

    @property
    def lapsed(self) -> bool:
        return not (self.started or self.skipped)

    def reward(self) -> float:
        if self.wrong_time:
            return WRONG_TIME_REWARD
        if self.done:
            return STARTED_REWARD  # done implies started
        if self.started:
            return STARTED_REWARD
        if self.skipped:
            return SKIPPED_REWARD
        return LAPSED_REWARD


def draw_reaction(
    seed: int, student_id: int, task_id: int, member: int
) -> ReactionDraws:
    rng = stream(seed, "reaction", student_id, task_id, member)
    return ReactionDraws(
        eps_prop=float(rng.standard_normal()),
        u_act=float(rng.random()),
        eps_slots=rng.standard_normal(SLOTS_PER_DAY),
        u_done=float(rng.random()),
        u_seen=float(rng.random()),
        u_default=float(rng.random()),
        u_skip=float(rng.random()),
        u_complete=float(rng.random()),
    )


def completes(utility: float, draws: ReactionDraws) -> bool:
    """Whether the student finishes a session they started."""
    p_done = min(0.95, max(0.05, 0.25 + 0.6 * utility))
    return draws.u_done < p_done


def completion_outcome(
    p: StudentProfile, draws: ReactionDraws, final_utility: float
) -> Completion:
    """STARTED/DONE/LAPSED/SKIPPED/WRONG_TIME for the placed slot.

    A slot far below the student's peak is marked wrong-time (no reward). A
    reasonable slot is started with probability rising in utility; otherwise the
    student either skips explicitly or lapses.
    """
    if final_utility < _WRONG_TIME_THRESHOLD:
        return Completion(False, False, False, True)

    p_seen = min(0.95, max(0.05, _OFFER_SEEN_BASE[p.interaction_style]))
    if draws.u_seen > p_seen:
        # Offer not surfaced at all → lapses unless the slot is excellent.
        p_start = min(0.95, max(0.0, 0.05 + 0.4 * final_utility))
    else:
        p_start = min(0.95, max(0.0, _START_UTILITY_OFFSET + 0.55 * final_utility))

    if p_start <= 0 or draws.u_act >= p_start:
        skipped = draws.u_skip < 0.15
        return Completion(False, False, skipped, False)

    done = completes(final_utility, draws)
    return Completion(True, done, False, False)


def decide(
    p: StudentProfile,
    draws: ReactionDraws,
    proposed_ms: int,
    proposed_utility: float,
    cand_starts_ms: NDArray[np.int64],
    cand_utilities: NDArray[np.float64],
) -> int | None:
    """New start if the student drags the proposal, else ``None`` (RETAINED)."""
    if p.interaction_style != "dragger":
        return None
    if cand_starts_ms.size == 0:
        return None
    slot_idx = (cand_starts_ms % DAY_MS) // SLOT_MS
    perceived = cand_utilities + p.noise_sd * draws.eps_slots[slot_idx]
    best = int(np.argmax(perceived))
    target = int(cand_starts_ms[best])
    if target == proposed_ms:
        return None
    gain = float(perceived[best]) - (proposed_utility + p.noise_sd * draws.eps_prop)
    drag_min = abs(target - proposed_ms) / 60_000
    needed = p.threshold + p.inertia * drag_min / MOVE_REWARD_SCALE_MINUTES
    if gain > needed and draws.u_act < p.p_edit:
        return target
    return None


def choose_offer(
    p: StudentProfile,
    draws: ReactionDraws,
    default_ms: int,
    default_utility: float,
    option_ms: int,
    option_utility: float,
) -> str | None:
    """Tapper chooses ``"default"``, ``"option"``, or ``None`` (ignore).

    The option is the alternative time chip. The choice is noisy utility
    comparison plus a style-specific bias toward the default.
    """
    if p.interaction_style != "tapper":
        return None

    noise = p.noise_sd
    perceived_default = default_utility + noise * draws.eps_prop
    perceived_option = (
        option_utility + noise * draws.eps_slots[(option_ms % DAY_MS) // SLOT_MS]
    )
    bias = _DEFAULT_BIAS["tapper"]
    diff = perceived_option - perceived_default - bias

    # Softmax-like choice probability with temperature from p_edit.
    temp = max(0.05, 0.5 - p.p_edit * 0.4)
    p_option = 1.0 / (1.0 + np.exp(-diff / temp))
    p_default = 1.0 / (1.0 + np.exp(diff / temp))

    u = draws.u_default
    if u < p_option:
        return "option"
    if u < p_option + p_default:
        return "default"
    return None


def reaction_label(completion: Completion, moved: bool) -> str:
    """Short label for logs: retained/moved/chose-option/lapsed/skipped/etc."""
    if completion.wrong_time:
        return "wrong_time"
    if moved:
        return "moved"
    if completion.lapsed:
        return "lapsed"
    if completion.skipped:
        return "skipped"
    if completion.done:
        return "done"
    if completion.started:
        return "started"
    return "retained"
