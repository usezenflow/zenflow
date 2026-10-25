# Offline evaluation: hour-level LinUCB against a fair heuristic

Simulated study of how Zenflow should choose the start time of a study block. Methods, simulator and statistics are in [eval-protocol.md](./eval-protocol.md). All students are simulated, so the results show behaviour under stated assumptions, not real-world lift. Code `8e2406a6` plus uncommitted changes. Every table was re-run on 23 Oct 2026, and the archives in [eval-data](./eval-data/) are from those runs.

| Name | Meaning | Status |
|---|---|---|
| **H** | Heuristic: a table of preferred hours | Shipped before this change |
| **H+K** | H with the hour kernel and weekday pooling | Live A/B arm |
| **L6** | Six-band LinUCB | Retired; historical numbers only |
| **L24** | LinUCB with 24 start-hour arms, no kernel | Ladder step |
| **L24K** | L24 with the kernel (width 0.75 hours) | Ladder step |
| **L24N** | L24K with unit-length day features, implemented offline. The model under test. | Used in the main table and the ladder |
| **L24N production** | L24N in the shipped placer, with fallback routing (displacement, last resort, 409 handling) | Live A/B arm |

## Summary

- **L24N beats H+K** by +7.5 points against the offline reference on seeds 500 to 599, and by +7.0 for the production placer on seeds 600 to 699.
- **Robustness:** on seeds 700 to 799 the production L24N beats H+K in 13 of 16 worlds. The three losses are the hour mattering a quarter as much (−0.2 points) and the two harsh-mix worlds (−0.4 points each). Every lower bound is above −1.0. The same 13 and 3 appear on tuning seeds 100 to 109.
- **Ladder:** on seeds 700 to 799 the kernel adds +1.9 points to 24 arms, and unit-length day features add +1.2 more. Without the kernel, 24 arms are 2.4 points below the production placer.
- **The kernel helps the heuristic too.** H+K beats H by +3.3 points on seeds 700 to 799. Any claim against H must say which H it means.
- **L6 cannot be reproduced.** The current `L` arm runs the production placer. The six-band L6 numbers on seeds 500 to 599 are historical only, archived in [fresh-500-l6-historical](./eval-data/fresh-500-l6-historical-results.json), where `L` is the six-band model.

## How the arms relate

The ladder adds one piece at a time on seeds 700 to 799. Adherence is the share of tasks started.

| Arm | Adds to the row above | Adherence | Step |
|---|---|---|---|
| L24 | 24 start-hour arms, no kernel | 28.8% [28.4, 29.1] | |
| L24K | Kernel, width 0.75 hours | 30.7% [30.4, 31.1] | +1.9 [+1.8, +2.1] |
| L24N ref | Unit-length day features | 32.0% [31.6, 32.3] | +1.2 [+1.1, +1.4] |
| L24N production | Shipped placer, compared with the reference | 31.2% [30.9, 31.6] | −0.7 [−0.8, −0.6] |

The L6-to-L24 step cannot be measured on current code (see [Limits](#4-limits)).

## 1. Main results

Fresh seeds 500 to 599, 10,000 students, 15 weeks. Adherence is the share of a student's study tasks that were started. Intervals are 95% over students. The L24N row comes from the offline reference implementation.

| Arm | Adherence | Hours before deadline |
|---|---|---|
| H | 21.0% [20.7, 21.3] | 23.4 |
| H+K | 24.2% [23.9, 24.6] | 22.7 [22.6, 22.9] |
| L6 (historical) | 28.0% [27.6, 28.3] | 23.6 [23.4, 23.8] |
| L24N | 31.8% [31.4, 32.1] | 22.7 [22.5, 22.9] |

Paired contrasts, Holm-adjusted. All have p of 0.003 or less.

| Contrast | Points | Better | Worse |
|---|---|---|---|
| H+K against H | +3.2 [+3.1, +3.3] | 62% | 12% |
| L24N against H+K | +7.5 [+7.3, +7.7] | 80% | 14% |
| L24N against L6 (historical) | +3.8 [+3.6, +4.0] | 58% | 32% |
| L6 against H (historical) | +7.0 [+6.7, +7.2] | 72% | 22% |

Replication on seeds 400 to 499: L24N against L6 is +3.8 points (59% better, 32% worse, Holm-adjusted p < 0.001). This is historical, as above.

## 1a. Floor and ceiling

Fresh seeds 600 to 699, 10,000 students, same settings as section 1. Rand is the floor and Oracle the ceiling. "Gap closed" is the share of the Rand-to-Oracle gap an arm reaches.

| Arm | Adherence | Hours before deadline | Gap closed |
|---|---|---|---|
| Rand | 8.5% [8.3, 8.6] | 39.1 | 0% |
| H | 21.1% [20.8, 21.4] | 23.4 | 33% |
| H+K | 24.4% [24.1, 24.7] | 22.7 | 42% |
| L24N (production) | 31.4% [31.0, 31.7] | 22.3 | 60% |
| L24N (reference) | 32.0% [31.6, 32.3] | 22.7 | 62% |
| Oracle | 46.4% [46.0, 46.7] | 15.9 | 100% |

Paired contrasts: L24N (production) against H is +10.2 [+10.0, +10.4]. Against H+K it is +7.0 [+6.8, +7.1]. Reference against production is +0.6 [+0.5, +0.7]. All have p of 0.003 or less, Holm-adjusted.

## 1b. Ladder and learning

Held-out seeds 700 to 799, 10,000 students. Figures: [learning curve](./figures/learning-curve.png) and [regret](./figures/regret-curve.png).

| Arm | Adherence | Tasks 1 to 10 | Tasks 21 to 30 |
|---|---|---|---|
| Rand | 8.3% [8.2, 8.5] | 7.4% | 8.4% |
| H | 21.2% [20.9, 21.4] | 18.7% | 21.7% |
| H+K | 24.5% [24.1, 24.8] | 20.1% | 25.7% |
| L24 | 28.8% [28.4, 29.1] | 23.5% | 30.2% |
| L24K | 30.7% [30.4, 31.1] | 25.1% | 32.6% |
| L24N ref | 32.0% [31.6, 32.3] | 24.7% | 33.4% |
| L24N production | 31.2% [30.9, 31.6] | 23.9% | 32.8% |
| Oracle | 46.0% [45.6, 46.4] | 44.1% | 47.6% |

Paired contrasts, Holm-adjusted, all p of 0.005 or less.

| Contrast | Points |
|---|---|
| H+K against H | +3.3 [+3.2, +3.4] |
| L24N production against H | +10.1 [+9.9, +10.3] |
| L24N production against H+K | +6.7 [+6.6, +6.9] |
| L24K against L24 | +1.9 [+1.8, +2.1] |
| L24N ref against L24K | +1.2 [+1.1, +1.4] |
| L24N ref against production | +0.7 [+0.6, +0.8] |
| L24K against production | −0.5 [−0.6, −0.4] |

Regret against the Oracle: L24N (reference) and L24N (production) finish with the lowest regret of the learners, and H finishes with the most.

## 2. Robustness: L24N against H+K

Each world changes one assumption. The production placer against H+K on seeds 700 to 799, 2,000 students per world. The lower bound is the 95% interval's lower end, in points.

| World | H+K | L24N | L24N against H+K | Lower bound |
|---|---|---|---|---|
| Headline student and signal | 24.8% | 31.6% | +6.8 [+6.4, +7.2] | +6.5 |
| Hour matters half as much | 19.1% | 20.3% | +1.2 [+0.9, +1.5] | +0.9 |
| Hour matters a quarter as much | 16.7% | 16.5% | −0.2 [−0.4, +0.0] | −0.4 |
| 60% of real starts reach the learner | 24.0% | 30.4% | +6.3 [+5.9, +6.7] | +5.9 |
| 30% of real starts reach the learner | 22.8% | 28.0% | +5.2 [+4.7, +5.6] | +4.7 |
| 10% of non-starts logged as starts | 24.3% | 28.7% | +4.4 [+3.9, +4.8] | +3.9 |
| Rewards 3 tasks late | 24.6% | 31.1% | +6.4 [+6.1, +6.8] | +6.1 |
| Rewards 10 tasks late | 23.9% | 29.3% | +5.3 [+5.0, +5.7] | +5.0 |
| Peak hour shifts 3 hours once | 21.4% | 26.8% | +5.4 [+5.0, +5.7] | +5.0 |
| Peak hour walks 1 hour every 2 weeks | 22.5% | 28.3% | +5.9 [+5.5, +6.2] | +5.5 |
| Peak hour walks 2 hours every 2 weeks | 19.2% | 23.3% | +4.2 [+3.8, +4.5] | +3.8 |
| Walk 2 hours, L forgets 10% per update | 19.2% | 23.6% | +4.4 [+4.1, +4.8] | +4.1 |
| Typical mix | 17.6% | 18.7% | +1.1 [+0.9, +1.4] | +0.9 |
| Typical mix, forgets 5% per update | 17.6% | 18.7% | +1.2 [+0.9, +1.4] | +0.9 |
| Harsh mix | 15.6% | 15.3% | −0.3 [−0.4, −0.1] | −0.5 |
| Harsh mix, forgets 5% per update | 15.6% | 15.3% | −0.3 [−0.4, −0.1] | −0.4 |

[Forest plot](./figures/robustness-forest.png).

Reading:
- The lead is largest when the hour matters a lot and students are generous. It shrinks in the typical and harsh mixes, where both arms adhere less.
- The three losses are the quarter-weight world and the two harsh mixes, where the hour matters least and adherence is lowest.
- The lower bound stays above −1.0 in all 16 worlds.

The same comparison on tuning seeds 100 to 109 (2,000 students per world) gives 13 wins and the same three losses. Table archived in [robust-tuning-table.md](./eval-data/robust-tuning-table.md).

## 3. Kernel and pooling

A start at hour `h` updates neighbouring hours with a Gaussian weight, and a start on one weekday also updates the same group of weekdays. Both are parameter sharing.

- **Width 0.75 hours and pooling 1.0** are the values used by L24K, L24N and H+K in every run in this report.
- **Kernel:** on seeds 700 to 799 the kernel adds +1.9 points to 24 arms (section 1b). On the same seeds H+K beats H by +3.3.
- **Width:** 0.75 hours was chosen during tuning on an earlier variant. It has not been re-tuned on the fresh seeds, so it is a design choice, not a result of this report.
- L24 and L24N have no pooling step. Pooling applies to H+K only.

## 4. Limits

- **Simulated students only.** Start curves, willingness and offer response are assumed, not measured.
- **Two L24N implementations.** The main table and the ladder's L24N ref row use the offline reference (`evalx/hourly.py`), which has no series, displacement, last-resort or 409 rules. The production placer has them. The production rows appear in the floor and ceiling, the ladder, the robustness table and the parity check. On 1,000 students (seeds 500 to 509) the production placer gives 31.6% against 32.2% for the reference, and H+K gives 24.7%.
- **L6 cannot be reproduced.** The six-band code is gone from the repository, and the current `L` arm runs the 24-arm placer. Its 31.4% on seeds 600 to 699 is not the 28.0% on seeds 500 to 599. Its results are archived in [fresh-500-l6-historical](./eval-data/fresh-500-l6-historical-results.json) and are historical only. The L24N-against-L6 gap is not rechecked on current code, and the L6-to-L24 step is not measured.
- **Kernel width was tuned.** It was chosen on tuning seeds and is not re-tuned on the fresh seeds.
- **Latency.** Timed in `evalx.bench`: L24N place p95 is 0.98 ms (mean 0.82 ms, p99 1.09 ms), well within the placement SLA.
- **One timetable.** Each student has one weekly timetable with no rescheduled classes.

## 5. Seed ledger

| Seeds | Use | Status |
|---|---|---|
| 0 to 9, 300 to 309, 400 to 499 | Earlier comparisons | Spent |
| 100 to 109 | Tuning, first robustness pass | Tuning |
| 500 to 509 | Production check | Spent |
| 500 to 599 | Four-arm comparison | Spent |
| 600 to 699 | Floor and ceiling | Spent |
| 700 to 799 | Ladder and robustness | Spent, the latest held-out check. Re-run on 23 Oct 2026; the numbers match the earlier archive within rounding |

Use 800 and up for any new held-out check.

## 6. Conclusion and next steps

On simulated students, L24N places study blocks where students adhere more than with H or H+K. The gain holds on three held-out seed blocks: 500 to 599, 600 to 699 and 700 to 799. On seeds 700 to 799 it beats H+K in 13 of 16 worlds, and the three losses are the worlds where the hour matters least. The kernel and the unit-length day features add 3.2 points over the 24-arm model without them.

The result supports a live A/B test of L24N against H+K. It does not show real-world lift.

Next steps:
1. Live A/B of L24N against H+K, with the ship rule's latency check run first.
2. Measure L24N's kernel width on its own, on seeds 800 and up.
3. Collect pick labels to replace the assumed pick model.

## Run index

| Run | Seeds | Students | Arms | Output |
|---|---|---|---|---|
| H with kernel (tuning) | 100 to 109 | 200 | H, H+K, L6 | tuning |
| Robustness, L24N against H+K (tuning) | 100 to 109 | 2,000 per world | H+K, L24N | [robust-tuning-table.md](./eval-data/robust-tuning-table.md) |
| Fresh L24N against L6 | 400 to 499 | 10,000 | L6, L24N | [n-vs-l-400](./eval-data/n-vs-l-400-results.json) |
| Main comparison | 500 to 599 | 10,000 | H, H+K, L24N reference, L24N production | [fresh-500](./eval-data/fresh-500-results.json) |
| L6 historical | 500 to 599 | 10,000 | H, H+K, L6, L24N reference | [fresh-500-l6-historical](./eval-data/fresh-500-l6-historical-results.json) |
| Production check | 500 to 509 | 1,000 | L24N production, L24N reference, H+K | [parity-check](./eval-data/parity-check-results.json) |
| Floor and ceiling | 600 to 699 | 10,000 | H, H+K, L24N production, L24N reference, Oracle, Rand | [held-600](./eval-data/held-600-results.json) |
| Ladder | 700 to 799 | 10,000 | H, H+K, L24, L24K, L24N reference, L24N production, Oracle, Rand | [ladder-700](./eval-data/ladder-700-results.json) |
| Robustness, L24N against H+K | 700 to 799 | 2,000 per world | H+K, L24N production | [robust-700](./eval-data/robust-700-table.md) |

## Appendix: heuristic tuning

The heuristic's deadline penalty was tuned on tuning seeds. The best variant is 0.5 points above the shipped H, so H is not a weak baseline. Full grid: [heuristic-deadline-penalty.md](./eval-data/heuristic-deadline-penalty.md).
