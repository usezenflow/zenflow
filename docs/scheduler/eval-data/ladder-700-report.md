# Eval: heuristic vs matrix-seeded LinUCB over a semester

Simulated students only. Their traits are assumptions, drawn per student.

Seeds 700 to 799, 10000 students, 15 weeks, 67 tasks per student of which 5.0 exam prep plans. Drag 0.00. Code `4e29cf58+dirty`, config `3a39936f4b8b6e9c`, 2026-10-23T00:46:01+00:00.

Adherence is the share of tasks the student started. A task with no placement counts as not started. Intervals read `mean [95% CI over students]`.

## Headline

| Arm | Adherence | Hours before deadline | Last day share | Conflict free | Events per student |
|---|---|---|---|---|---|
| H | 21.2% [20.9, 21.4] | 23.5 [23.3, 23.6] | 16% | 100% | 14.3 |
| L | 31.2% [30.9, 31.6] | 22.3 [22.2, 22.5] | 14% | 100% | 21.1 |
| Rand | 8.3% [8.2, 8.5] | 39.2 [39.0, 39.4] | 18% | 72% | 5.6 |
| Oracle | 46.0% [45.6, 46.4] | 16.0 [15.9, 16.1] | 30% | 100% | 30.9 |

Last day share is blocks ending within 24 hours of the deadline, over tasks with a window of 3 days or more. Events are starts, offer taps and drags. Margin for non inferiority: 3 points.

## Contrasts

Adherence difference in points: `mean [CI over students] / [CI over seeds]`. The p value is a paired sign flip test; Holm adjusts across this table.

| Contrast | Points | Relative | Students better | Students worse | p Holm | Verdict | Hours before deadline |
|---|---|---|---|---|---|---|---|
| L against H | +10.1 [+9.9, +10.3] / [+9.9, +10.3] | +48% | 86% | 10% | 0.004 | better | -1.1 [-1.2, -1.0] |
| hourly_K_vs_L | -0.5 [-0.6, -0.4] / [-0.6, -0.4] | -2% | 39% | 42% | 0.004 | slightly worse | +2.7 [+2.6, +2.7] |
| hourly_K_vs_hourly | +1.9 [+1.8, +2.1] / [+1.8, +2.0] | +7% | 56% | 24% | 0.004 | better | +2.1 [+2.1, +2.2] |
| hourly_vs_L | -2.5 [-2.6, -2.3] / [-2.6, -2.3] | -8% | 26% | 59% | 0.004 | slightly worse | +0.5 [+0.5, +0.6] |
| N_vs_K | +1.2 [+1.1, +1.4] / [+1.1, +1.4] | +4% | 47% | 31% | 0.004 | better | -2.3 [-2.4, -2.2] |
| N_vs_L | +0.7 [+0.6, +0.8] / [+0.6, +0.8] | +2% | 33% | 24% | 0.004 | better | +0.4 [+0.3, +0.4] |
| N_vs_HK | +7.5 [+7.3, +7.7] / [+7.3, +7.7] | +31% | 79% | 14% | 0.004 | better | -0.0 [-0.1, +0.0] |
| kernel_H | +3.3 [+3.2, +3.4] / [+3.2, +3.4] | +16% | 62% | 11% | 0.004 | better | -0.7 [-0.8, -0.7] |
| L_minus_HK | +6.7 [+6.6, +6.9] / [+6.6, +6.9] | +28% | 78% | 14% | 0.004 | better | -0.4 [-0.5, -0.3] |

## Who benefits

L minus H in adherence points, by student group. Better and worse are the shares of students whose own adherence is higher or lower under L.

| Group | Students | Points | Better | Worse |
|---|---|---|---|---|
| lark | 2008 | +10.0 [+9.5, +10.4] | 87% | 9% |
| day | 2439 | +11.3 [+10.9, +11.8] | 85% | 9% |
| evening | 3965 | +9.6 [+9.3, +9.9] | 86% | 10% |
| owl | 1588 | +9.3 [+8.8, +9.7] | 84% | 11% |
| low attention | 3333 | +5.1 [+4.9, +5.3] | 77% | 14% |
| middle attention | 3333 | +10.0 [+9.7, +10.3] | 88% | 8% |
| high attention | 3334 | +15.1 [+14.7, +15.5] | 91% | 7% |
| never answers offers | 3042 | +10.1 [+9.7, +10.4] | 86% | 9% |
| answers offers | 6958 | +10.1 [+9.8, +10.3] | 85% | 10% |

## By season and kind

| Arm | Regular | Midterm | Final | Exam prep | Assignment prep |
|---|---|---|---|---|---|
| H | 19.8% | 24.6% | 28.7% | 28.2% | 20.6% |
| L | 29.2% | 37.0% | 34.6% | 34.5% | 31.0% |
| Rand | 7.5% | 9.4% | 16.1% | 16.0% | 7.7% |
| Oracle | 43.6% | 52.2% | 57.0% | 56.5% | 45.0% |

## Learning

Regret is the running sum of the Oracle's start chance minus the arm's, per student. Early and late adherence are the first 10 and the last of the first 30 tasks.

| Arm | Regret at the last task | Adherence, tasks 1 to 10 | Adherence, tasks 21 to 30 |
|---|---|---|---|
| H | 16.66 | 18.7% | 21.7% |
| L | 9.88 | 23.9% | 32.8% |
| Rand | 25.34 | 7.4% | 8.4% |

## Limits

- Simulated students only; start curves and offer response are not calibrated.
- Prep tasks follow production sizing; the timetable is one weekly pattern.
- Rewards reach the learner at placement time, not after the block.
- Hybrid LinUCB and series are not in these arms.
- The pick model is assumed until classroom labels exist.
