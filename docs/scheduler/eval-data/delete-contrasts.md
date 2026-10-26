# Delete scoring: paired contrasts

Output of `services/bandit/scripts/delete_contrasts.py` on the four runs below. Seeds 900 to 999, 10,000 students per level, 15 weeks. The calendar includes each student's DND blocks. `delete_slot` is 0.3 at every level, and each level reuses the same students and signal draws. Students move and delete placed plans, including exam and assignment prep. Synced timetable items, exams and assignments are fixed.

Runs:

```bash
cd services/bandit
for n in 0 0.1 0.2 0.3; do
  uv run python -m evalx run --seeds 100 --students 100 --seed-offset 900 \
    --arms H,H+K,L,L+D-0.1,L+D-0.25,L+D-0.5,H+M-0.03125,H+M-0.0625,H+M-0.125,H+K+M-0.03125,H+K+M-0.0625,H+K+M-0.125 \
    --config "{\"delete_noise\": $n, \"delete_slot\": 0.3}" --out <dir>/delete-noise-$n
done
uv run python scripts/delete_contrasts.py <dir>
```

A deleted or unplaced task counts as not started. Intervals resample students. p is a paired sign-flip test, Holm-adjusted within each table. "Deleted before start" is the share of all of a student's tasks deleted.


### p_noise 0: 100 seeds, 10000 students

| Arm | Adherence | Deleted before start |
|---|---|---|
| H | 17.84% | 18.41% |
| H+K | 18.82% | 17.53% |
| L | 16.27% | 18.97% |
| L+D-0.25 | 24.29% | 13.97% |
| H+M-0.0625 | 18.54% | 17.95% |
| H+K+M-0.0625 | 19.81% | 16.88% |

| Contrast | Points [CI over students] | Better / worse | p Holm |
|---|---|---|---|
| L+D-0.1 vs L | +6.93 [+6.71, +7.18] | 62% / 11% | 0.005 |
| L+D-0.25 vs L | +8.01 [+7.77, +8.27] | 66% / 11% | 0.005 |
| L+D-0.5 vs L | +9.39 [+9.13, +9.66] | 70% / 11% | 0.005 |
| H+M-0.03125 vs H | +0.52 [+0.49, +0.55] | 23% / 7% | 0.005 |
| H+M-0.0625 vs H | +0.70 [+0.66, +0.74] | 30% / 8% | 0.005 |
| H+M-0.125 vs H | +0.89 [+0.85, +0.93] | 36% / 9% | 0.005 |
| H+K+M-0.03125 vs H+K | +0.75 [+0.70, +0.80] | 25% / 6% | 0.005 |
| H+K+M-0.0625 vs H+K | +0.99 [+0.93, +1.04] | 32% / 8% | 0.005 |
| H+K+M-0.125 vs H+K | +1.46 [+1.39, +1.52] | 41% / 9% | 0.005 |
| L vs H (no delete learning) | -1.56 [-1.84, -1.28] | 46% / 48% | 0.005 |

### p_noise 0.1: 100 seeds, 10000 students

| Arm | Adherence | Deleted before start |
|---|---|---|
| H | 16.08% | 28.31% |
| H+K | 17.19% | 27.23% |
| L | 14.91% | 28.69% |
| L+D-0.25 | 22.01% | 23.82% |
| H+M-0.0625 | 16.86% | 27.72% |
| H+K+M-0.0625 | 18.21% | 26.49% |

| Contrast | Points [CI over students] | Better / worse | p Holm |
|---|---|---|---|
| L+D-0.1 vs L | +6.18 [+5.95, +6.43] | 59% / 18% | 0.005 |
| L+D-0.25 vs L | +7.10 [+6.86, +7.37] | 62% / 19% | 0.005 |
| L+D-0.5 vs L | +8.12 [+7.87, +8.39] | 66% / 20% | 0.005 |
| H+M-0.03125 vs H | +0.63 [+0.60, +0.67] | 27% / 9% | 0.005 |
| H+M-0.0625 vs H | +0.79 [+0.74, +0.83] | 34% / 12% | 0.005 |
| H+M-0.125 vs H | +1.01 [+0.97, +1.06] | 40% / 12% | 0.005 |
| H+K+M-0.03125 vs H+K | +0.77 [+0.72, +0.83] | 28% / 8% | 0.005 |
| H+K+M-0.0625 vs H+K | +1.02 [+0.96, +1.08] | 35% / 11% | 0.005 |
| H+K+M-0.125 vs H+K | +1.63 [+1.55, +1.70] | 46% / 12% | 0.005 |
| L vs H (no delete learning) | -1.17 [-1.43, -0.90] | 47% / 46% | 0.005 |

### p_noise 0.2: 100 seeds, 10000 students

| Arm | Adherence | Deleted before start |
|---|---|---|
| H | 14.23% | 38.29% |
| H+K | 15.47% | 36.98% |
| L | 13.59% | 38.26% |
| L+D-0.25 | 19.72% | 33.60% |
| H+M-0.0625 | 15.09% | 37.53% |
| H+K+M-0.0625 | 16.57% | 36.10% |

| Contrast | Points [CI over students] | Better / worse | p Holm |
|---|---|---|---|
| L+D-0.1 vs L | +5.44 [+5.21, +5.67] | 56% / 22% | 0.005 |
| L+D-0.25 vs L | +6.13 [+5.88, +6.36] | 60% / 24% | 0.005 |
| L+D-0.5 vs L | +6.71 [+6.46, +6.97] | 63% / 25% | 0.005 |
| H+M-0.03125 vs H | +0.70 [+0.66, +0.75] | 31% / 11% | 0.005 |
| H+M-0.0625 vs H | +0.86 [+0.81, +0.90] | 37% / 13% | 0.005 |
| H+M-0.125 vs H | +1.13 [+1.08, +1.18] | 43% / 14% | 0.005 |
| H+K+M-0.03125 vs H+K | +0.79 [+0.74, +0.85] | 29% / 10% | 0.005 |
| H+K+M-0.0625 vs H+K | +1.10 [+1.04, +1.17] | 37% / 12% | 0.005 |
| H+K+M-0.125 vs H+K | +1.77 [+1.69, +1.85] | 48% / 13% | 0.005 |
| L vs H (no delete learning) | -0.65 [-0.89, -0.40] | 47% / 44% | 0.005 |

### p_noise 0.3: 100 seeds, 10000 students

| Arm | Adherence | Deleted before start |
|---|---|---|
| H | 12.37% | 48.27% |
| H+K | 13.68% | 46.74% |
| L | 12.19% | 47.87% |
| L+D-0.25 | 17.48% | 43.26% |
| H+M-0.0625 | 13.34% | 47.35% |
| H+K+M-0.0625 | 14.86% | 45.66% |

| Contrast | Points [CI over students] | Better / worse | p Holm |
|---|---|---|---|
| L+D-0.1 vs L | +4.81 [+4.59, +5.03] | 56% / 25% | 0.005 |
| L+D-0.25 vs L | +5.28 [+5.06, +5.51] | 59% / 26% | 0.005 |
| L+D-0.5 vs L | +5.28 [+5.03, +5.51] | 60% / 28% | 0.005 |
| H+M-0.03125 vs H | +0.81 [+0.76, +0.85] | 33% / 11% | 0.005 |
| H+M-0.0625 vs H | +0.97 [+0.92, +1.03] | 39% / 14% | 0.005 |
| H+M-0.125 vs H | +1.23 [+1.18, +1.29] | 45% / 15% | 0.005 |
| H+K+M-0.03125 vs H+K | +0.84 [+0.78, +0.90] | 31% / 10% | 0.005 |
| H+K+M-0.0625 vs H+K | +1.18 [+1.11, +1.25] | 39% / 11% | 0.005 |
| H+K+M-0.125 vs H+K | +2.01 [+1.93, +2.09] | 51% / 12% | 0.005 |
| L vs H (no delete learning) | -0.18 [-0.40, +0.03] | 49% / 42% | 0.119 |
