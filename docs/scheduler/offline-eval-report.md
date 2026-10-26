# Offline evaluation: reward v2 for the LinUCB placer

**Result.** The old arms reproduce the old report's gain only under the DONE signal the simulator used until 25 Oct 2026. Under the KEPT signal production sends, L24N beats H+K by 0.9 to 1.1 points in the signal world and loses by 3 points in the headline world. The reward v2 candidate beats the shipped placer (L24N production) by 5.2 points in the signal world, but two of its signals are circular (section 4.2). It is not shipped. All reward v2 flags stay off.

Simulated students only. Methods and simulator are in [eval-protocol.md](./eval-protocol.md). Metric definitions follow [heuristic-vs-linucb-report.md](./heuristic-vs-linucb-report.md) section 3, with the changes listed in section 3. Run on 26 Oct 2026. Decision record: [ADR-0045](../adr/0045-reward-v2.md). Full tables: [benchmark-1100-tables.md](./eval-data/benchmark-1100-tables.md).

## Benchmark: the old arms in three worlds

Fresh seeds 1100 to 1199, 10,000 students per world. Adherence in percent, with 95% intervals over students. Oracle and Rand are the bounds.

| Arm | DONE world (old signal) | KEPT, headline (no drag, no deletes) | KEPT, signal world (drag 0.3, delete slot 0.3) |
|---|---|---|---|
| H | 21.3 [21.0, 21.6] | 19.9 [19.6, 20.1] | 25.9 [25.6, 26.2] |
| H+K | 24.5 [24.2, 24.9] | 20.2 [19.9, 20.4] | 29.5 [29.2, 29.9] |
| L6 | not run (code removed; 28.0 on seeds 500 to 599, historical) | not run | not run |
| L24 (24 hour arms, no kernel) | 30.5 [30.1, 30.8] | 19.1 [18.9, 19.4] | 28.8 [28.5, 29.2] |
| L24K (kernel) | 33.1 [32.7, 33.4] | 16.0 [15.7, 16.3] | 30.5 [30.1, 30.8] |
| L24N reference (kernel and unit-length day features, offline) | 33.7 [33.3, 34.0] | 17.1 [16.7, 17.5] | 30.4 [30.1, 30.8] |
| L24N production (`L`, shipped placer) | 33.1 [32.7, 33.4] | 16.7 [16.4, 17.0] | 30.6 [30.3, 31.0] |
| Reward v2 candidate (`Lv2-KDMC`) | not run | 29.0 [28.7, 29.3] | 35.8 [35.5, 36.2] |
| Oracle | 46.2 [45.8, 46.6] | 44.7 [44.3, 45.1] | 44.0 [43.7, 44.4] |
| Rand | 8.4 [8.2, 8.5] | 8.4 [8.2, 8.5] | 14.6 [14.5, 14.8] |

Contrasts, adherence in points:

| Contrast | DONE world | KEPT, headline | KEPT, signal world |
|---|---|---|---|
| L24N reference minus H+K | +9.12 [+8.94, +9.29] | -3.05 [-3.35, -2.76] | +0.88 [+0.71, +1.06] |
| L24N production minus H+K | +8.54 [+8.37, +8.74] | -3.45 [-3.76, -3.15] | +1.11 [+0.95, +1.26] |
| Candidate minus L24N production | not run | +12.32 [+12.09, +12.54] | +5.18 [+5.02, +5.33] |
| Candidate minus H+K | not run | +8.87 [+8.62, +9.11] | +6.29 [+6.12, +6.46] |

The candidate's +12.3 in the headline world comes from the hand-made-block signal alone, which section 4.2 shows is circular. It is not evidence of a gain.

Hours before deadline for every row is in [benchmark-1100-tables.md](./eval-data/benchmark-1100-tables.md). The candidate places blocks about 0.6 hours closer to the deadline than L24N production in the signal world.

## Why the old result no longer holds

- Commit 984b628d (25 Oct 2026, "refactor(bandit): update evaluation harness and placement code") changed what the learner hears. Before it, a block the student completed (DONE) paid +1, and silence paid nothing. After it, every block left unmoved is KEPT and pays +1, whether the student did it or not. The commit also changed the student sampler, so H moved too.
- Production sends KEPT (ADR-0042). The KEPT worlds are therefore the ones to judge against. The DONE world is what the old report measured.
- The change is the cause, and the DND calendar is not. The old numbers reproduce at 8e2406a6 (H 20.8, H+K 24.1, L 31.5 on seeds 1100 to 1109). They reproduce at its descendant e1b86433 (H 21.1, H+K 24.5, L 33.3). At 984b628d they drop (H 19.6, H+K 19.5, L 16.2). With DND blocks on and off, the ranking of L24N and H+K does not change (on: 17.2 and 19.8; off: 16.4 and 19.5).
- Under KEPT, a silent block pays the learner as if it were a good slot. The learner is then rewarded for slots the student never looked at, which is the concern the reward v2 work set out to address.

## Models

| Name | Meaning | Status |
|---|---|---|
| **H** | Heuristic: a table of preferred hours | Shipped |
| **H+K** | H with the hour kernel | Live A/B arm |
| **L6** | Six-band LinUCB | Retired. Code removed. Historical numbers only |
| **L24** | LinUCB with 24 start-hour arms, no kernel (`L-hourly`) | Ladder step |
| **L24K** | L24 with the kernel (`L-hourly-K`) | Ladder step |
| **L24N reference** | L24K with unit-length day features (`L-hourly-K+N`), offline, no series or displacement | Reference |
| **L24N production** (`L`) | L24N in the shipped placer, with displacement, last resort and 409 handling | Shipped placer, the control |
| **Reward v2 candidate** (`Lv2-KDMC`) | L24N production with reward v2 (KEPT, delete, move destination and hand-made block) | Candidate, not shipped |
| **Lv2-KD**, **Lv2-KDM**, **Lv2-DMC**, **Lv2-M** | Ablations of the candidate | Diagnostics |
| **Oracle**, **Rand** | Best free slot by hidden utility; random day and hour | Ceiling, floor |

The v1 production arm `L` learns from KEPT (+1), MOVE (drag penalty on the origin hour) and nothing else. The hourly arms (L24, L24K, L24N reference) do not take reward v2 signals.

## 2. Signals and reward v2

| Signal | Reward v2 update | Weight (tuned) | Production code | Flag | Status |
|---|---|---|---|---|---|
| KEPT (silence) | +1 on the placed hour (unchanged) | 1 | `scheduling-feedback`, `kept-sweep` | none | Unchanged |
| MOVE, origin | Drag penalty, as in v1 | `drag_distance_reward` | `onFirstMove` | none | Unchanged |
| MOVE, destination | +2 on the hour the block moved to, same local day | 2 | `onFirstMove` with `move` | `REWARD_V2_ENABLED` | Wired, off |
| DELETE | -1 on the placing hour | -1 | `SessionCrudService.remove`, `onDelete` | `DELETE_REWARD_ENABLED` | Wired in shadow mode: the event stores the reward, the arm does not learn |
| CREATE by hand | +2 on the hour the user picked | 2 | not wired | none | Simulated only. A hand-made block has no proposal, so no day context vector |
| Quick move, timing | Not modelled | n/a | n/a | n/a | Not done |

Definitions of the reward v2 weights are in [ADR-0045](../adr/0045-reward-v2.md). The simulator takes its weights from `run.CFG` (`v2_*`).

## 3. How to read the numbers

Every figure is a pooled average over proposals, unless marked as a mean over students. A **proposal** is a placed task. Intervals resample students (2,000 draws). Paired contrasts resample the same students for both arms.

| Metric | Formula | In plain words | Better is |
|---|---|---|---|
| **Regret** | mean over proposals of `p(best) - p(proposed)` | How much worse the proposed slot is than the best free slot in the window. `p` is the simulator's hidden done chance, the stand-in for utility. | lower |
| **Kept** | `(number of proposals with neither a move nor a delete) / (number of proposals)` | The share the student leaves alone. Deleted proposals count as not kept. | higher |
| **Drag** | mean over proposals of minutes moved | Average minutes moved per proposal. A kept proposal counts as 0. | lower |
| **Adherence** | mean over students of the share of tasks started | The offline report's primary metric. | higher |
| **Proposals to 60%** | first n >= 10 where at least 6 of proposals n-9..n were kept, else the placement count; averaged over students | How fast a student's recent proposals are mostly kept | lower |
| **Proposals to 90%** | as above with 9 of 10 | A stricter version. It separates arms that all reach 60% at once. | lower |
| **Hours before deadline** | mean over proposals of hours from the placed block's end to the deadline | Lead time. A ship criterion: it must not shrink. | higher |
| **Regret, first 10** | regret over proposals 1 to 11 | Regret while the system knows little | lower |
| **Regret, 40+** | regret over proposals 42 on | Regret after many reactions | lower |

**Adherence and kept are different measures.** Both drop when a student ignores a block, but they use different denominators. Kept divides by placed proposals. Adherence divides by all tasks in the semester, so a task that was never placed counts as not started. Adherence is the offline report's primary metric and the ship rule uses it, so it stays.

Changes from the heuristic report: regret uses the hidden done chance as utility, and deleted proposals are not kept. The heuristic report defines kept as not moved and had no deletes. "To 60%" saturates near 10 in this world, since nearly every arm keeps 80% or more, so "to 90%" is reported too.

## Worlds and coupling

Each run uses the same students, calendars, tasks and random draws. Only the named knobs change.

| World | Drag | Delete slot | Delete noise | Create share | Create fit | Seeds, students | Used for |
|---|---|---|---|---|---|---|---|
| No signal | 0 | 0 | 0 | 0.1 | 1 | 800 to 899, 10,000 | Reference: no moves, no deletes |
| Signal (coupled) | 0.3 | 0.3 | 0 | 0.1 | 1 | 800 to 899, 10,000 | Headline |
| Decoupled deletes | 0.3 | 0 | 0.3 | 0.1 | 1 | 800 to 899, 10,000 | Deletes independent of slot |
| Random hand-made blocks | 0.3 | 0.3 | 0 | 0.1 | 0 | 800 to 899, 10,000 | Hand-made blocks at a random free hour |
| Both decoupled | 0.3 | 0 | 0.3 | 0.1 | 0 | 800 to 899, 10,000 | Both circular links cut |
| Move only, decoupled | 0.3 | 0 | 0.3 | 0.1 | 1 | 800 to 899, 10,000 | Move destination alone |
| 15 reality worlds | 0.3 | 0.3 | 0 | 0.1 | 1 | 1000 to 1099, 2,000 per world | Robustness, [section 4.4](#44-robustness) |

Drag is the share of tasks a student may move when the slot is poor (`u_drag < drag`). Delete slot scales the delete chance with how poorly the hour fits. Delete noise is a slot-independent delete chance. Create share is the share of tasks the student also makes by hand. Create fit is the share of hand-made blocks placed at the student's best hour.

**Why the coupling checks matter.** The simulator's deletes depend on the slot quality (`delete_slot`), and its hand-made blocks land at the best hour (`create_fit = 1`). The learner's reward is graded on the same quality. A learner that learns from those signals is partly learning the answer key. The checks cut those links and see whether the gain remains.

**Limit of the move signal.** The simulator moves a dragged block toward the student's peak hour by construction, so the destination update points at the peak. Real students may move blocks for other reasons. This cannot be tested here.

## 4. Results

### 4.1 Ladder, KEPT signal world

Seeds 800 to 899, 10,000 students, drag 0.3, delete slot 0.3.

| Contrast | Regret | Kept | Drag | Adherence | To 90% | Hours before deadline |
|---|---|---|---|---|---|---|
| H+K minus H | -0.04 [-0.04, -0.04] | +6.19 pts [+6.08, +6.29] | -21.66 [-22.09, -21.25] | +3.62 pts [+3.52, +3.72] | -5.49 | +0.05 [+0.00, +0.10] |
| L minus H+K | -0.02 [-0.02, -0.02] | +0.52 pts [+0.35, +0.68] | +2.66 [+2.18, +3.12] | +1.12 pts [+0.97, +1.27] | +0.39 | +0.14 [+0.08, +0.20] |
| Lv2-KD minus L | -0.03 [-0.03, -0.03] | +2.94 pts [+2.81, +3.08] | -6.68 [-7.08, -6.27] | +2.62 pts [+2.49, +2.75] | -3.09 | -0.63 [-0.67, -0.59] |
| Lv2-KDM minus Lv2-KD | -0.01 [-0.01, -0.01] | +1.83 pts [+1.74, +1.92] | -6.15 [-6.41, -5.90] | +1.07 pts [+0.99, +1.16] | -2.23 | -0.03 [-0.07, -0.00] |
| Lv2-KDMC minus Lv2-KDM | -0.02 [-0.02, -0.02] | +1.17 pts [+1.12, +1.22] | -1.55 [-1.68, -1.42] | +1.50 pts [+1.43, +1.57] | -0.76 | -0.04 [-0.07, -0.01] |
| **Lv2-KDMC minus L** | **-0.06 [-0.06, -0.06]** | **+5.94 pts [+5.79, +6.10]** | **-14.38 [-14.82, -13.96]** | **+5.20 pts [+5.04, +5.35]** | **-6.08** | **-0.71 [-0.76, -0.66]** |

The ladder adds one signal per step. Deletes give the step from L to KD, moves the step to KDM, and hand-made blocks the step to KDMC. The candidate's gain sits in the signal world, where two signals are circular. [Section 4.2](#42-coupling-checks) tests them.

### 4.2 Coupling checks

Each row is a run on seeds 800 to 899. Contrasts are paired against the arm named in the row. Drag is minutes per proposal, adherence is in points.

| Check | Contrast | Regret | Drag (min) | Adherence | Better / worse share |
|---|---|---|---|---|---|
| Signal world (headline) | Lv2-KDMC minus L | -0.06 | -14.38 [-14.82, -13.96] | +5.20 pts [+5.04, +5.35] | 69% / 14% |
| No signal (no moves, no deletes) | Lv2-KDMC minus L | -0.13 | 0 | +12.00 pts | 88% / 5% |
| Decoupled deletes | Lv2-KD minus L | +0.05 | +24.22 [+23.49, +24.96] | **-2.93 pts** [-3.07, -2.80] | |
| Decoupled deletes | Lv2-KDMC minus L | -0.03 | -7.19 [-7.69, -6.67] | +1.52 pts [+1.40, +1.63] | 49% / 34% |
| Random hand-made blocks | Lv2-KDMC minus Lv2-KDM | +0.02 | +6.70 [+6.51, +6.92] | **-1.61 pts** [-1.69, -1.54] | |
| Random hand-made blocks | Lv2-KDM minus L | -0.04 | -12.83 [-13.26, -12.43] | +3.70 pts [+3.56, +3.83] | |
| Both decoupled | Lv2-KDMC minus L | +0.02 | +8.70 [+8.17, +9.26] | **-1.38 pts** [-1.50, -1.26] | 32% / 55% |
| Move only, decoupled deletes | Lv2-M minus L | -0.03 | -13.23 [-13.72, -12.74] | +1.62 pts [+1.50, +1.73] | 48% / 31% |

Reading the table:

- The no-signal row has no moves or deletes (kept is 100% for every arm). Its gain is from hand-made blocks alone, and it disappears when they are placed at random (random hand-made blocks row, and the both-decoupled row).
- Deletes help only while they track slot quality. With slot-independent deletes, learning from them costs adherence and adds drag.
- The move destination update still helps alone (move-only row). Its per-student split is mixed: 31% of students are worse.

The full tables with intervals are in [reward-v2-tables.md](./eval-data/reward-v2-tables.md).

### 4.3 Chronotype, signal world

Chronotype labels come from the simulator: lark (early bird), day (midday), evening, owl (night owl).

| Chronotype | Regret H+K | Regret L | Regret candidate | Drag H+K | Drag L | Drag candidate | Adherence H+K | Adherence L | Adherence candidate |
|---|---|---|---|---|---|---|---|---|---|
| Lark | 0.178 | 0.137 | 0.083 | 27 | 16 | 7 | 28.3% | 31.8% | 36.1% |
| Day | 0.257 | 0.227 | 0.108 | 29 | 27 | 8 | 18.1% | 21.0% | 31.7% |
| Evening | 0.113 | 0.114 | 0.083 | 28 | 37 | 23 | 36.8% | 35.7% | 38.4% |
| Owl | 0.193 | 0.177 | 0.131 | 30 | 42 | 27 | 29.7% | 30.7% | 34.4% |

The candidate has the lowest regret and the least drag in every chronotype. The gap is widest for day students (regret 0.227 to 0.108, adherence +10.7 points).

### 4.4 Robustness

Fifteen reality worlds from [the protocol](./eval-protocol.md#8-robustness-worlds), seeds 1000 to 1099, 2,000 students per world, drag 0.3 and delete slot 0.3. The candidate against L: adherence in points, drag in minutes per proposal, with 95% intervals. The lower bound is the adherence interval's lower end.

| World | Adherence, candidate minus L | Lower bound | Regret | Drag (min) | Lead time |
|---|---|---|---|---|---|
| Headline student and signal | +5.11 [+4.79, +5.47] | +4.79 | -0.06 | -14.40 | -0.63 |
| Hour matters half as much | +2.07 [+1.88, +2.27] | +1.88 | -0.03 | -14.62 | -0.49 |
| Hour matters a quarter as much | +2.21 [+2.08, +2.36] | +2.08 | -0.03 | -38.57 | -0.85 |
| 60% of kept slots reach the learner | +4.76 [+4.44, +5.10] | +4.44 | -0.06 | -12.31 | -0.68 |
| 30% of kept slots reach the learner | +4.51 [+4.19, +4.82] | +4.19 | -0.06 | -11.54 | -0.84 |
| Rewards 3 tasks late | +4.96 [+4.64, +5.32] | +4.64 | -0.06 | -13.91 | -0.79 |
| Rewards 10 tasks late | +4.65 [+4.36, +4.95] | +4.36 | -0.06 | -14.04 | -1.02 |
| Peak hour shifts 3 hours once | +5.05 [+4.70, +5.41] | +4.70 | -0.06 | -15.76 | -0.43 |
| Peak hour walks 1 hour every 2 weeks | +5.01 [+4.67, +5.38] | +4.67 | -0.06 | -14.91 | -0.47 |
| Peak hour walks 2 hours every 2 weeks | +4.77 [+4.42, +5.13] | +4.42 | -0.06 | -15.77 | -0.30 |
| Walk 2 hours, L forgets 10% per update | +5.13 [+4.79, +5.49] | +4.79 | -0.06 | -15.37 | -0.47 |
| Typical mix | +1.95 [+1.75, +2.15] | +1.75 | -0.03 | -15.70 | -0.39 |
| Typical mix, L forgets 5% per update | +1.93 [+1.73, +2.13] | +1.73 | -0.03 | -15.47 | -0.38 |
| Harsh mix | +1.36 [+1.24, +1.48] | +1.24 | -0.02 | -33.70 | -1.97 |
| Harsh mix, L forgets 5% per update | +1.44 [+1.32, +1.55] | +1.32 | -0.02 | -33.67 | -2.14 |

The move-only arm in the same worlds is positive in 14 of 15 (one world's interval includes 0), with lower bounds above -0.6. Its drag falls by 8 to 42 minutes per proposal, and its lead time falls in all 15. Full tables: [reward-v2-robust-kdmc.md](./eval-data/reward-v2-robust-kdmc.md) and [reward-v2-robust-move.md](./eval-data/reward-v2-robust-move.md).

The lead-time drop is in every world, and it is the largest in the harsh mixes. The cause is not isolated in this report.

## 5. Ship rule

Applied to the candidate against its direct predecessor, L, as the [protocol](./eval-protocol.md#7-seeds-and-the-ship-rule) requires. The plan's lead-time check is added.

| Check | Rule | Result | Met |
|---|---|---|---|
| Adherence | At least +1.0 points, interval above zero | Signal world +5.20 [+5.04, +5.35] | Yes, in the coupled world only |
| Worse share | Does not rise | Signal 14% worse. Decoupled deletes 34% worse, both decoupled 55% worse | No |
| Robustness | Each world's lower bound above -1.0 | Lowest +1.24 (harsh mix) | Yes |
| Placer p95 | Under 1 ms (`evalx.bench`) | 1.04 ms and 1.07 ms in two runs, 20 students. The placer code was not changed in this work | No |
| Lead time (plan) | Must not shrink | -0.71 h in the signal world, down in 15 of 15 worlds | No |

The move-only arm fails the worse-share check (31% worse in the decoupled world) and the lead-time check (down in 15 of 15 worlds). It passes adherence and robustness. The p95 check applies to any candidate, since the placer is the same.

**Decision:** no reward v2 flag turns on. `REWARD_V2_ENABLED` and `DELETE_REWARD_ENABLED` stay `false`. The candidate is not ready.

## 6. Tuning

Seeds 100 to 109, one weight changed at a time with the others at their defaults. Full table: [reward-v2-tuning.md](./eval-data/reward-v2-tuning.md).

| Weight | Searched | Best (regret) | Note |
|---|---|---|---|
| KEPT | 0.1 to 2 | 1 (0.132) | Interior optimum at the value already in production. The demotion to 0.25 raises regret. |
| MOVE destination | 0.25 to 2 | 2 (0.142) | Edge of the range |
| CREATE | 0.25 to 2 | 2 (0.121) | Edge of the range |
| DELETE | -0.1 to -1 | -1 (0.140) | Edge of the range |

The frozen values are the best point in each search. Move, create and delete improved up to the edge of the range, so they are not tuned optima. The tuning seeds used the coupled signal world, so the tuned weights carry the coupling in [section 4.2](#42-coupling-checks).

## 7. Production state

Implemented and tested in the backend (`backend/src/scheduler`, `backend/src/sessions`):

- `constants.ts`: `REWARD_V2_ENABLED = false`, `REWARD_V2_KEPT = 1`, `REWARD_V2_DESTINATION = 2`. `DELETE_REWARD` moved from -0.25 to -1. Mirrored in `services/bandit/src/core/constants.py`.
- `core/reward.ts`: `keptReward()`, `localParts()` for the local date and hour.
- `io/scheduling-feedback.service.ts`: `onFirstMove` takes an optional destination and updates the hour arm when the flag is on. `onDelete` stores the delete reward on the event and updates the arm only while `DELETE_REWARD_ENABLED` is on.
- `io/kept-sweep.service.ts`: the event's `rewardScore` and the arm's KEPT reward use `keptReward()`. The preference-matrix update is unchanged.
- `sessions/session-crud.service.ts`: `remove` calls `onDelete` after the transaction commits.
- `sessions/session-update.service.ts`, `sessions/slot-pick.service.ts`: pass the move's start times.
- The fallback placer (`io/fallback-placer.service.ts`, `io/heuristic-placer.service.ts`) now applies `notBefore` and `window` when Python is down. Covered by new tests.
- Tests: `npx jest src/scheduler src/sessions src/common` (57 suites, 515 tests) and `tsc --noEmit` pass.

Simulator (`services/bandit/evalx`):

- Rows carry regret, drag and proposal summaries (`semester.py`). The aggregator is `evalx/proposal.py`.
- Reward v2 arms `Lv2-*` and the coupling knobs (`create_fit`, `create_share`, delete slot and noise).
- The evalx test run passes except `test_evalx.py::test_ceiling_and_floor_hold`. That test fails the same way on a clean checkout of HEAD (checked in a worktree), so it predates this work.

Not done. Each is listed here so it is not read as finished:

- **MCP pairwise picks** (two candidates in `create_tasks` and `update_session` previews, the confirm call that records the pick, the `pickReason` column) are not built. Also not done: the assistant prompt and its catalog, `api-access-prompt.spec.ts`, and removing the stale PWA and mobile taps.
- **Device delete** (`mobile/lib/device-calendar/moves.ts`) is not changed. A deleted device event is still re-created.
- **Divergence rate and pick share** are not measured. The simulator has no paired offers, so the ship rule's pick-share check cannot run.
- **Constraints in the simulator** (`notBefore`, `window`) are not blended in, so no evaluated arm honours them. The fallback fix is tested in unit tests only.
- **Last-resort placement** (`placeSingleDegraded`) still ignores constraints. It needs a decision: honour the bound, or surface a warning.
- **Create in production** is not wired. A hand-made block needs a day context vector that the server does not compute today.
- **Observability:** `scheduler.reward` metrics, `ab-report.ts`, `learning-quality.service.ts` and the Grafana panels are not extended.
- **ADR-0043** is unchanged. ADR-0045 supersedes it for the delete weight.
- **The plan's Step 0 archive check** compared modification times only. The old `evalx/out` archive (23 Oct) and the 26 Oct figures were not reconciled row by row.
- **The old heuristic-vs-LinUCB numbers** came from a simulator no longer in the repo. They are not comparable with this report and were not regenerated.

## 8. Limits

- **Signal changed on 25 Oct 2026.** Results before commit 984b628d use the DONE world. The ladder, the coupling checks and the robustness runs in this report use the KEPT world. The DONE world is shown only for comparison with the old report.

- **Simulated students only.** Start curves, deletes, hand-made blocks, drag and offer response are assumptions. Nothing here measures real behaviour.
- **Utility is the hidden done chance.** Regret and kept are measured against the simulator's own utility, which the learner tries to recover. Real utility is unknown.
- **Coupling.** Two of the signals depend on the utility by construction. The coupling checks reduce this but do not remove it. The move signal is coupled by construction too.
- **Lead time.** The cause of the lead-time drop is not isolated.
- **The 800 to 899 seeds were used for the ladder and then for the coupling checks.** The checks were chosen after seeing the ladder, so they are diagnostics, not a fresh decision. A decision on any candidate needs a new held-out block.
- **Placer timing.** p95 was 1.04 to 1.07 ms on this machine, 20 students, two runs. The protocol's threshold is 1 ms. The archived figures were 0.98 ms and 0.996 ms on earlier runs. The machines and loads differ, so the result on the reference machine is unknown.
- **Two L implementations.** The reference (`evalx/hourly.py`) and the production placer differ as the offline report describes. The results here use the production placer.

## 9. Seed ledger

| Seeds | Use | Status |
|---|---|---|
| 0 to 9, 300 to 309, 400 to 499 | Earlier comparisons | Spent |
| 100 to 109 | Tuning, reward v2 weights | Spent for tuning |
| 500 to 599, 600 to 699, 700 to 799 | Earlier held-out checks | Spent |
| 800 to 899 | Reward v2 ladder and coupling checks (KEPT world) | Spent. Ladder first, then diagnostics |
| 1100 to 1199 | Three-world benchmark against the old arms | Spent 26 Oct 2026 |
| 900 to 999 | Delete scoring (ADR-0043) | Spent |
| 1000 to 1099 | Reward v2 robustness | Spent |
| 1200 and up | Next held-out block | Free |

## 10. Run index

| Run | Seeds | Students | Arms | Output |
|---|---|---|---|---|
| Tuning, 17 settings | 100 to 109 | 1,000 per setting | Lv2-KDMC | [reward-v2-tuning.md](./eval-data/reward-v2-tuning.md) |
| Ladder, signal world | 800 to 899 | 10,000 | H, H+K, L, Lv2-KD, Lv2-KDM, Lv2-KDMC, Lv2-DMC, Oracle, Rand | [reward-v2-tables.md](./eval-data/reward-v2-tables.md) |
| No signal | 800 to 899 | 10,000 | H, H+K, L, Lv2-KDMC | [reward-v2-tables.md](./eval-data/reward-v2-tables.md) |
| Decoupled deletes | 800 to 899 | 10,000 | H+K, L, Lv2-KD, Lv2-KDM, Lv2-KDMC, Lv2-DMC | [reward-v2-tables.md](./eval-data/reward-v2-tables.md) |
| Random hand-made blocks | 800 to 899 | 10,000 | L, Lv2-KD, Lv2-KDM, Lv2-KDMC | [reward-v2-tables.md](./eval-data/reward-v2-tables.md) |
| Move only, decoupled | 800 to 899 | 10,000 | L, Lv2-M, Lv2-DMC | [reward-v2-tables.md](./eval-data/reward-v2-tables.md) |
| Both decoupled | 800 to 899 | 10,000 | L, Lv2-KD, Lv2-KDM, Lv2-KDMC | [reward-v2-tables.md](./eval-data/reward-v2-tables.md) |
| Robustness, candidate | 1000 to 1099 | 2,000 per world | H+K, L, Lv2-KDMC | [reward-v2-robust-kdmc.md](./eval-data/reward-v2-robust-kdmc.md) |
| Robustness, move only | 1000 to 1099 | 2,000 per world | L, Lv2-M | [reward-v2-robust-move.md](./eval-data/reward-v2-robust-move.md) |
| Placer timing | n/a | 20 | H, L | `evalx.bench`, two runs |

## 11. Next steps

1. Time the placer on the reference machine. The ship rule needs p95 under 1 ms.
2. Explain the lead-time drop. Check which hours move destinations land in, and whether the destination update moves placements toward the deadline.
3. Decide the move-destination candidate on new seeds (1100 and up), with its worse share and lead time reported. It is the only signal that survived the coupling checks.
4. Find a real check for deletes and hand-made blocks before they learn. Shadow data from the production delete event (already stored) can give that check. Hand-made blocks need a day context vector first.
5. Settle the last-resort constraint question, and then the pairwise MCP flow, which the plan requires before any pick-share metric exists.
