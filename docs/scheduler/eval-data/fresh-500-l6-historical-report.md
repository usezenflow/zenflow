# Eval: heuristic vs matrix-seeded LinUCB over a semester

Simulated students only. Their traits are assumptions, drawn per student.

Seeds 500 to 599, 10000 students, 15 weeks, 67 tasks per student of which 5.0 exam prep plans. Drag 0.00. Code `4e29cf58+dirty`, config `ff4788693dd60d5c`, 2026-10-22T11:04:48+00:00.

Adherence is the share of tasks the student started. A task with no placement counts as not started. Intervals read `mean [95% CI over students]`.

## Headline

| Arm | Adherence | Hours before deadline | Last day share | Conflict free | Events per student |
|---|---|---|---|---|---|
| H | 21.0% [20.7, 21.3] | 23.4 [23.3, 23.6] | 16% | 100% | 14.2 |
| L | 28.0% [27.6, 28.3] | 23.6 [23.4, 23.8] | 12% | 100% | 18.9 |

Last day share is blocks ending within 24 hours of the deadline, over tasks with a window of 3 days or more. Events are starts, offer taps and drags. Margin for non inferiority: 3 points.

## Contrasts

Adherence difference in points: `mean [CI over students] / [CI over seeds]`. The p value is a paired sign flip test; Holm adjusts across this table.

| Contrast | Points | Relative | Students better | Students worse | p Holm | Verdict | Hours before deadline |
|---|---|---|---|---|---|---|---|
| L against H | +7.0 [+6.7, +7.2] / [+6.7, +7.2] | +33% | 72% | 22% | 0.002 | better | +0.2 [+0.1, +0.2] |
| N_vs_L | +3.8 [+3.6, +4.0] / [+3.6, +4.0] | +14% | 58% | 32% | 0.002 | better | -0.9 [-0.9, -0.8] |
| N_vs_HK | +7.5 [+7.3, +7.7] / [+7.4, +7.7] | +31% | 80% | 14% | 0.002 | better | -0.0 [-0.1, +0.0] |
| kernel_H | +3.2 [+3.1, +3.3] / [+3.1, +3.3] | +15% | 62% | 12% | 0.002 | better | -0.7 [-0.7, -0.7] |

## Who benefits

L minus H in adherence points, by student group. Better and worse are the shares of students whose own adherence is higher or lower under L.

| Group | Students | Points | Better | Worse |
|---|---|---|---|---|
| lark | 2036 | +6.7 [+6.3, +7.1] | 76% | 17% |
| day | 2526 | +11.5 [+11.1, +11.9] | 85% | 11% |
| evening | 3953 | +4.9 [+4.5, +5.3] | 65% | 30% |
| owl | 1485 | +5.1 [+4.5, +5.7] | 67% | 29% |
| low attention | 3333 | +3.4 [+3.1, +3.6] | 65% | 26% |
| middle attention | 3333 | +6.9 [+6.5, +7.2] | 74% | 22% |
| high attention | 3334 | +10.6 [+10.2, +11.1] | 79% | 19% |
| never answers offers | 2997 | +7.3 [+6.9, +7.7] | 75% | 21% |
| answers offers | 7003 | +6.8 [+6.5, +7.1] | 71% | 23% |

## By season and kind

| Arm | Regular | Midterm | Final | Exam prep | Assignment prep |
|---|---|---|---|---|---|
| H | 19.6% | 24.5% | 28.4% | 27.7% | 20.5% |
| L | 26.4% | 32.8% | 29.5% | 29.5% | 27.8% |

## Limits

- Simulated students only; start curves and offer response are not calibrated.
- Prep tasks follow production sizing; the timetable is one weekly pattern.
- Rewards reach the learner at placement time, not after the block.
- Hybrid LinUCB and series are not in these arms.
- The pick model is assumed until classroom labels exist.
