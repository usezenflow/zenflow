# Offline evaluation: which placer to keep

Simulated students only, run on 27 Oct 2026 with seeds 1300 to 1399. Method and assumptions: [eval-protocol.md](./eval-protocol.md). Full tables with intervals: [benchmark-1300-tables.md](./eval-data/benchmark-1300-tables.md).

## Summary

- **In the signal world, the shipped placer (L24N production) has the lowest regret of the shipped options.** It is slightly better than H+K, which is the live A/B arm, and it moves a few more blocks.
- **In the headline world, H+K is best.** Students never move blocks there, so the learner gets no information to learn from.
- **The reward v2 candidate is withdrawn.** Its earlier good result came from reward terms that are not in production. With production signals only, it matches L24N production exactly.

## What the eval does

Each simulated student lives through a 15-week semester with tasks and deadlines. A placer proposes a time for each study block. Two worlds:

- **Headline world:** students never move a block. The placer only learns that the student kept each block.
- **Signal world:** students sometimes drag a block to another time. The placer learns from those moves, so it has more to learn from.

Every placer sees the same students and the same random draws, so the differences come from the placers, not from luck.

## Metrics in plain words

| Metric | What it means | Better when |
|---|---|---|
| **Regret** | For each proposed block, how much worse it is than the best free slot. Measured as the chance the student would start the block there, versus the best slot. 0 means the placer always picked the best slot. Random placement scores 0.34 in the signal world and 0.41 in the headline world. | Lower |
| **Kept** | Share of proposed blocks the student left where they were. | Higher |
| **Drag** | Minutes the student moved a block, per proposal, on average. | Lower |
| **To 60%** | How many proposals it takes until 6 of the last 10 were kept. A measure of how fast the placer settles. | Lower |
| **First 10** | Regret over the first 11 proposals. Shows how the placer does before it has learned much. | Lower |
| **40+** | Regret from proposal 42 onward. Shows how the placer does once it has learned. | Lower |
| **Interval [a, b]** | A 95% range for the average over students. If two intervals do not overlap, the gap is likely real within these simulated students. | Narrower |
| **Contrast** | A difference between two placers on the same students, for example "H+K minus H". A negative regret contrast means the first placer is better. | Depends on the row |
| **Oracle** | A placer that knows each student's chances. This is the best possible, and it is not something we can build. | Reference |
| **Rand** | Picks a random day and hour. This is the worst reasonable placer, and it is the reference for "no learning". | Reference |

## Results: signal world

Students move blocks here, so the placers can learn.

| Placer | Regret | Kept | Drag (min) | To 60% |
|---|---|---|---|---|
| H (table of favourite hours) | 0.213 | 76.6% | 51 | 10.7 |
| H+K (H with a smoothing kernel, live A/B arm) | 0.171 | 82.9% | 28 | 10.4 |
| L6 (six time bands, retired) | 0.166 | 84.6% | 25 | 10.6 |
| **L24N production (shipped placer)** | **0.154** | **83.4%** | **31** | **10.6** |
| Production-signal candidate (same as L24N production) | 0.154 | 83.4% | 31 | 10.6 |
| Oracle | 0.000 | 95.1% | 4 | 10.0 |
| Rand | 0.341 | 59.9% | 81 | 13.3 |

What this says:

- L24N production is about 0.02 better than H+K on regret, and keeps 0.5 percentage points more blocks. It moves blocks about 2.6 minutes more per proposal. The gain is small.
- H is clearly behind the newer placers, by about 0.06 regret.
- L6 keeps the most blocks, but it is not better than L24N production on regret.

## Results: headline world

Students never move blocks, so every proposal is kept. Only regret differs.

| Placer | Regret |
|---|---|
| H+K | 0.282 |
| H | 0.286 |
| L24 (no smoothing) | 0.290 |
| L24N production | 0.313 |
| L6 | 0.333 |
| Rand | 0.409 |

H+K is best here. Without moves, the newer placers have nothing extra to learn from, so they spend effort exploring and end up worse.

## Why L24 and L6 differ

- **L24** has one learner per hour, with no smoothing across neighbouring hours. Each hour learns from its own few observations, so it learns slowly. It moves blocks about 11 minutes more per proposal than H+K.
- **L24K** adds smoothing, so a start at 10:00 also teaches 9:00 and 11:00. That fixes most of the gap: it keeps 1.2 points more blocks than H+K, with no extra drag.
- **L6** uses six broad time bands instead of 24 hours. It keeps more blocks, but its regret is no better than L24N production.

## The reward v2 candidate

The earlier candidate (seeds 1200 to 1299) gave the learner extra credit for three things: a move to a new hour, deleting a block, and a block the student makes by hand. Those extra signals made it look much better (regret 0.095).

With only the production signals, the same learner gives the same result as L24N production (regret 0.154). So the gain came entirely from the extra signals.

Two of the extra signals are unreliable in this simulator:

- **Deletes** depend on how poor the hour is, which is also what regret measures. The simulator therefore agrees with itself.
- **Hand-made blocks** are placed at the student's best hour by default in the simulator. This assumption is not measured.

The earlier coupling checks predate the current metrics and have not been rerun. The candidate is not shipped, and it is not being tested further in this round.

## Rerun on seeds 1400 to 1499 (28 Oct 2026)

Signals tested: KEPT at 1, 0.5 and 0.25, delete at -0.2 with deletes decoupled from slot quality, and move destination at 0.5. Signal world uses drag 0.3 and `delete_slot` 0, `delete_noise` 0.3.

| Arm | Regret | Kept | Drag (min) | Versus L |
|---|---|---|---|---|
| L (KEPT 1) | 0.160 | 65.4% | 29 | baseline |
| KEPT 0.5 | 0.154 | 65.8% | 26 | regret -0.006, kept +0.4 points |
| KEPT 0.25 | 0.173 | 64.8% | 33 | regret +0.013, kept -0.6 points |
| Delete -0.2 | 0.181 | 64.1% | 38 | regret +0.021, kept -1.3 points |
| Move destination 0.5 | 0.148 | 66.2% | 23 | regret -0.012, kept +0.8 points |
| Delete and move | 0.164 | 65.3% | 30 | no gain |

Headline world (no drag, no deletes): KEPT 0.5 gives regret 0.312 and KEPT 0.25 gives 0.315, against 0.316 for KEPT 1.

What this says:
- Deletes hurt, even with the circular link cut. Random deletes teach the learner the wrong thing.
- KEPT 0.5 is a small gain. Its interval does not overlap with KEPT 1, but the ship rule also needs adherence, which this run does not report.
- Move destination pulls toward the student's peak by construction, and the eval has no knob to cut that link, so rule 6 cannot be checked for it yet.
- None of the candidates clears rule 1 (+1.0 points adherence) on the data we have.

## Decision

L24N production stays the shipped placer. Its regret is the lowest of the shipped options, and the gap to H+K is small. Choosing it over H+K is a product call.

Shipped locally on 28 Oct 2026, not yet verified against the ship rule:
- KEPT reward 0.5 (`SESSION_KEPT_REWARD` and the Python mirror `KEPT_REWARD`). This also changes the heuristic's table update, which is scaled by the same constant. The eval tested KEPT 0.5 for the LinUCB arm only, so the heuristic side is unmeasured.
- Delete reward off (`DELETE_REWARD_ENABLED = false`). The value stays -0.2 and is logged with each delete.
- The golden scheduler fixture is regenerated for the KEPT change.

## Changes in this round

- The `Lv2-*` arms use the signal values in `run.CFG` (`v2_kept`, `v2_delete`, `v2_move`). Code: `services/bandit/evalx/semester.py`, `services/bandit/evalx/run.py`.
- The move destination is restored in the eval at 0.5, and the create term is removed.
- Seeds 1400 to 1499 are spent.

## Open items

1. Verify KEPT 0.5 against the ship rule: adherence, the worse share, the robustness worlds, and a lazy-student world. Until then it is unvalidated.
2. Measure the heuristic side of the KEPT change, which the eval does not cover.
3. Decide whether delete scoring returns. The eval says no at -0.2 in the decoupled world. Its coupled world has not been run.
4. Decide whether to ship L24N production over H+K. This is a product choice, not something the eval can settle.
5. Device delete, pairwise picks and last-resort placement are unchanged. They are product decisions, not eval results.

## Limits

- Simulated students only. How often students move blocks, and when they do, is assumed.
- Both worlds use the production signals. Pairwise picks are not in these arms.
- L6 is recovered from a 21 Oct commit.
- The run used a working tree with uncommitted changes (`d27a8d0f+dirty`).
