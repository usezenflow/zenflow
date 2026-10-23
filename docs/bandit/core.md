# Bandit core and model reference

For developers changing `services/bandit/src/core/*`, the LinUCB model or the offline tooling. Entry point: [`services/bandit/README.md`](../../services/bandit/README.md). The model is in [ADR-0037](../adr/0037-hour-arms-and-heuristic-kernel.md); placement ownership is in [ADR-0003](../adr/0003-python-authoritative-placement.md).

## Model

- **Hour-arm LinUCB (L24N)**: 24 arms, one ridge regression each, scored `θ̂ᵀx + α·√(xᵀA⁻¹x)`.
  - `A = λI + Σ xxᵀ`, `b = Σ r·x`; `λ = 1.0`, `α = 0.15` (`BANDIT_RIDGE`, `BANDIT_ALPHA` in `backend/src/scheduler/constants.ts`, sent per request).
- **Arms** (`SchedulingArm` in `@zenflow/shared`): one per local start hour, `HOUR_00` to `HOUR_23`. A slot is scored by the arm of its start hour.
- **Kernel update**: a reward at hour `h` updates every arm `h'` with `A += w·xxᵀ`, `b += w·r·x`, where `w` is a circular Gaussian of width `KERNEL_SD = 0.75` hours centred on `h` (`src/core/hour_arms.py`).
- **Unit length**: the context is divided by its L2 length before scoring and before each update.
- **Cold arm** = the matrix prior for that hour (`src/core/matrix_prior.py`). The matrix is an input only here; the slot score does not read it.

## Context vector (`d = 7`, `src/core/context_vector.py`)

One vector per candidate day, shared by all 24 arms. The arm is never part of the vector.

| # | Feature | Encoding |
| - | --- | --- |
| 0 | remaining days until deadline | `clamp(x / MAX_SCAN_DAYS, 0, 1) * 2 - 1` |
| 1 | duration (minutes) | `clamp(x / DURATION_DIVISOR, 0, 1) * 2 - 1` |
| 2 | candidate days from now | `clamp(x / MAX_SCAN_DAYS, 0, 1) * 2 - 1` |
| 3 | candidate day is a weekend (ISO 6/7) | `+1` / `-1` |
| 4 | fixed-load hours (`LECTURE`+`EXAM`+`DND`) | `clamp(h / WORKLOAD_HOURS_DIVISOR, 0, 1)` |
| 5 | flexible-load hours (`TASK`+`ASSIGNMENT`) | `clamp(h / WORKLOAD_HOURS_DIVISOR, 0, 1)` |
| 6 | bias | `1` |

Constants: `MAX_SCAN_DAYS = 60`, `DURATION_DIVISOR = 480`, `WORKLOAD_HOURS_DIVISOR = 12`.

- Fixed divisors keep the vector stateless and reproducible.
- `d` fixes the width of each arm's `A` and `b` and of `SlotProposal.featureVector`. Changing it means resetting arm state and bumping `ARM_LAYOUT`.

## Scheduler core (`src/core/`)

- Pure numpy: `slot`, `context_vector`, `hour_arms`, `matrix_prior`, `preference`, `slot_score`, `linucb_best_slot`, `displacement`, `constants`.
- No I/O, clock or randomness; instants are epoch-ms ints. The 7x24 matrix is 168 floats.
- Python is the sole ranking implementation. A ranking change goes in `src/core/*` with pytest coverage and updated `packages/shared/contract/place/*.json` fixtures, never a TS port.

### `linucb_best_slot`

- Scores every feasible 15-min start on all days as `hourArm[startHour] + wG·gap + wD·deadline + wS·stability`.
  - `wG = LINUCB_GAP_WEIGHT`, `wD = DEADLINE_PENALTY_WEIGHT` (`constants.py`). A slot ending within 24 h of the deadline loses up to `wD`, linearly.
  - `wS = stability_weight(prevStart, now)`: `1.0` while the old start is <= 24h away, fading linearly to `0.05` at 7 days.
- Exact ties (within 1e-9) go to the earlier start.
- The scan is vectorized per day, with a prefix-sum for the free-start mask and `argmax` on scores rounded to 1e-9.

### Heuristic kernel (H+K)

- START and MOVE matrix updates (`reinforce_preference_smooth`, `reinforce_preference_move`) spread over neighbouring hours with the same kernel (width 0.75) and over the same weekday group (pool 1.0).
- The frozen TypeScript fallback has the same rule (`backend/src/scheduler/core/preference.ts`, `reinforcePreferenceSmooth`). The two must agree.

### Parity

- `tests/test_hour_arms.py` checks the prior, the kernel update and the hour mapping against the eval reference `evalx/hourly.py`.
- `tests/test_golden_ts.py` runs `backend/test/golden/scheduler-core.golden.json` for the frozen fallback. Regenerate with `pnpm --filter backend golden:export`.
- `tests/test_place_batch.py` checks the batched scorer against a per-day oracle.
