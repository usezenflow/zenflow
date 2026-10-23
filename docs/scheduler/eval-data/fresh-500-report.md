# Eval: heuristic vs matrix-seeded LinUCB over a semester

Simulated students only. Their traits are assumptions, drawn per student.

Seeds 500 to 599, 10000 students, 15 weeks, 67 tasks per student of which 5.0 exam prep plans. Drag 0.00. Code `4e29cf58+dirty`, config `73b5b14c44b5bd0a`, 2026-10-23T00:37:47+00:00.

Adherence is the share of tasks the student started. A task with no placement counts as not started. Intervals read `mean [95% CI over students]`.

## Headline

| Arm | Adherence | Hours before deadline | Last day share | Conflict free | Events per student |
|---|---|---|---|---|---|
| H | 21.0% [20.7, 21.3] | 23.4 [23.3, 23.6] | 16% | 100% | 14.2 |
| L | 31.0% [30.7, 31.4] | 22.4 [22.2, 22.5] | 14% | 100% | 20.9 |

Last day share is blocks ending within 24 hours of the deadline, over tasks with a window of 3 days or more. Events are starts, offer taps and drags. Margin for non inferiority: 3 points.

## Contrasts

Adherence difference in points: `mean [CI over students] / [CI over seeds]`. The p value is a paired sign flip test; Holm adjusts across this table.

| Contrast | Points | Relative | Students better | Students worse | p Holm | Verdict | Hours before deadline |
|---|---|---|---|---|---|---|---|
| L against H | +10.0 [+9.8, +10.2] / [+9.8, +10.2] | +48% | 85% | 9% | 0.002 | better | -1.1 [-1.2, -1.0] |
| N_vs_L | +0.7 [+0.6, +0.9] / [+0.6, +0.8] | +2% | 32% | 24% | 0.002 | better | +0.3 [+0.3, +0.4] |
| N_vs_HK | +7.5 [+7.3, +7.7] / [+7.4, +7.7] | +31% | 80% | 14% | 0.002 | better | -0.0 [-0.1, +0.0] |
| kernel_H | +3.2 [+3.1, +3.3] / [+3.1, +3.3] | +15% | 62% | 12% | 0.002 | better | -0.7 [-0.7, -0.7] |
| L_minus_HK | +6.8 [+6.6, +7.0] / [+6.6, +7.0] | +28% | 79% | 14% | 0.002 | better | -0.4 [-0.4, -0.3] |

## Who benefits

L minus H in adherence points, by student group. Better and worse are the shares of students whose own adherence is higher or lower under L.

| Group | Students | Points | Better | Worse |
|---|---|---|---|---|
| lark | 2036 | +9.9 [+9.5, +10.4] | 86% | 9% |
| day | 2526 | +11.7 [+11.3, +12.1] | 87% | 6% |
| evening | 3953 | +9.5 [+9.1, +9.8] | 84% | 11% |
| owl | 1485 | +8.6 [+8.1, +9.0] | 83% | 12% |
| low attention | 3333 | +5.0 [+4.7, +5.2] | 77% | 14% |
| middle attention | 3333 | +10.0 [+9.7, +10.3] | 87% | 8% |
| high attention | 3334 | +15.0 [+14.6, +15.4] | 91% | 6% |
| never answers offers | 2997 | +10.0 [+9.7, +10.4] | 86% | 9% |
| answers offers | 7003 | +10.0 [+9.7, +10.2] | 85% | 10% |

## By season and kind

| Arm | Regular | Midterm | Final | Exam prep | Assignment prep |
|---|---|---|---|---|---|
| H | 19.6% | 24.5% | 28.4% | 27.7% | 20.5% |
| L | 29.0% | 36.9% | 34.5% | 34.3% | 30.8% |

## Limits

- Simulated students only; start curves and offer response are not calibrated.
- Prep tasks follow production sizing; the timetable is one weekly pattern.
- Rewards reach the learner at placement time, not after the block.
- Hybrid LinUCB and series are not in these arms.
- The pick model is assumed until classroom labels exist.
