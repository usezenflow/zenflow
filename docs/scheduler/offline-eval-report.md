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

## Decision

Keep L24N production as the shipped placer for now. It has the lowest regret of the options we ship, and the difference from H+K is small. Choosing it over H+K is a product call: H+K is simpler, and L24N moves blocks a bit more.

## Changes in this round

- The `Lv2-*` arms (the reward v2 candidate) use production signals only. Code: `services/bandit/evalx/semester.py`, function `v2_spec`.
- The report and the protocol are updated to match.
- New fresh seeds 1300 to 1399 are spent. The next held-out block is 1400 and up.

## Open items

1. Decide whether to ship L24N production over H+K. This is a product choice, not something the eval can settle.
2. If reward v2 is still wanted, test lower values on fresh seeds (1400 and up). First cut the links the simulator makes by construction, as the protocol's ship rule describes.
3. The ship rule's adherence check is not in this report. It needs its owners to confirm it (protocol section 7).
4. Device delete, pairwise picks and last-resort placement are unchanged from the earlier report. They are product decisions, not eval results.

## Limits

- Simulated students only. How often students move blocks, and when they do, is assumed.
- Both worlds use the production signals. Pairwise picks are not in these arms.
- L6 is recovered from a 21 Oct commit.
- The run used a working tree with uncommitted changes (`d27a8d0f+dirty`).
