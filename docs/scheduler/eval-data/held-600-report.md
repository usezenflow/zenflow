# Eval: heuristic vs matrix-seeded LinUCB over a semester

Simulated students only. Their traits are assumptions, drawn per student.

Seeds 600 to 699, 10000 students, 15 weeks, 67 tasks per student of which 5.0 exam prep plans. Drag 0.00. Code `4e29cf58+dirty`, config `280161b870946e51`, 2026-10-23T00:41:24+00:00.

Adherence is the share of tasks the student started. A task with no placement counts as not started. Intervals read `mean [95% CI over students]`.

## Headline

| Arm | Adherence | Hours before deadline | Last day share | Conflict free | Events per student |
|---|---|---|---|---|---|
| H | 21.1% [20.8, 21.4] | 23.4 [23.2, 23.6] | 16% | 100% | 14.2 |
| L | 31.4% [31.0, 31.7] | 22.3 [22.1, 22.5] | 14% | 100% | 21.1 |
| Rand | 8.5% [8.3, 8.6] | 39.1 [38.9, 39.3] | 18% | 72% | 5.7 |
| Oracle | 46.4% [46.0, 46.7] | 15.9 [15.8, 16.1] | 30% | 100% | 31.1 |

Last day share is blocks ending within 24 hours of the deadline, over tasks with a window of 3 days or more. Events are starts, offer taps and drags. Margin for non inferiority: 3 points.

## Contrasts

Adherence difference in points: `mean [CI over students] / [CI over seeds]`. The p value is a paired sign flip test; Holm adjusts across this table.

| Contrast | Points | Relative | Students better | Students worse | p Holm | Verdict | Hours before deadline |
|---|---|---|---|---|---|---|---|
| L against H | +10.2 [+10.0, +10.4] / [+10.0, +10.4] | +48% | 86% | 9% | 0.002 | better | -1.1 [-1.2, -1.0] |
| N_vs_L | +0.6 [+0.5, +0.7] / [+0.5, +0.7] | +2% | 32% | 25% | 0.002 | better | +0.4 [+0.4, +0.5] |
| N_vs_HK | +7.6 [+7.4, +7.8] / [+7.4, +7.7] | +31% | 80% | 14% | 0.002 | better | +0.0 [-0.0, +0.1] |
| kernel_H | +3.3 [+3.2, +3.4] / [+3.2, +3.4] | +15% | 61% | 12% | 0.002 | better | -0.7 [-0.8, -0.7] |
| L_minus_HK | +7.0 [+6.8, +7.1] / [+6.8, +7.1] | +28% | 79% | 14% | 0.002 | better | -0.4 [-0.5, -0.3] |

## Who benefits

L minus H in adherence points, by student group. Better and worse are the shares of students whose own adherence is higher or lower under L.

| Group | Students | Points | Better | Worse |
|---|---|---|---|---|
| lark | 1919 | +10.0 [+9.6, +10.4] | 87% | 9% |
| day | 2546 | +11.9 [+11.5, +12.4] | 87% | 8% |
| evening | 4017 | +9.6 [+9.3, +9.9] | 85% | 10% |
| owl | 1518 | +9.4 [+8.9, +9.8] | 86% | 10% |
| low attention | 3333 | +5.1 [+4.9, +5.3] | 78% | 13% |
| middle attention | 3333 | +10.1 [+9.8, +10.5] | 88% | 9% |
| high attention | 3334 | +15.4 [+15.0, +15.8] | 92% | 6% |
| never answers offers | 2990 | +10.4 [+10.0, +10.7] | 86% | 9% |
| answers offers | 7010 | +10.2 [+9.9, +10.4] | 86% | 10% |

## By season and kind

| Arm | Regular | Midterm | Final | Exam prep | Assignment prep |
|---|---|---|---|---|---|
| H | 19.7% | 24.4% | 28.4% | 27.9% | 20.5% |
| L | 29.3% | 37.1% | 34.8% | 34.7% | 31.1% |
| Rand | 7.6% | 9.3% | 17.1% | 16.8% | 7.7% |
| Oracle | 43.9% | 52.3% | 57.8% | 56.9% | 45.3% |

## Learning

Regret is the running sum of the Oracle's start chance minus the arm's, per student. Early and late adherence are the first 10 and the last of the first 30 tasks.

| Arm | Regret at the last task | Adherence, tasks 1 to 10 | Adherence, tasks 21 to 30 |
|---|---|---|---|
| H | 16.92 | 18.7% | 21.6% |
| L | 10.01 | 24.0% | 33.0% |
| Rand | 25.47 | 7.4% | 8.5% |

## Limits

- Simulated students only; start curves and offer response are not calibrated.
- Prep tasks follow production sizing; the timetable is one weekly pattern.
- Rewards reach the learner at placement time, not after the block.
- Hybrid LinUCB and series are not in these arms.
- The pick model is assumed until classroom labels exist.
