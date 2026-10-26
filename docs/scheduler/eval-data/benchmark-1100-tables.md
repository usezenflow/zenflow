# Benchmark on fresh seeds 1100 to 1199

100 seeds, 100 students per seed (10,000 students per world). Adherence in % and hours before deadline, both with 95% intervals over students. The DONE world is the signal the old report measured; the KEPT worlds use the signal production sends (ADR-0042).

## DONE world (old signal)

| Arm | Adherence | Hours before deadline |
|---|---|---|
| H | 21.3% [21.0, 21.6] | 23.35 [23.17, 23.51] |
| H+K | 24.5% [24.2, 24.9] | 22.64 [22.46, 22.81] |
| L24 | 30.5% [30.1, 30.8] | 22.90 [22.70, 23.08] |
| L24K | 33.1% [32.7, 33.4] | 24.80 [24.59, 24.99] |
| L24N reference | 33.7% [33.3, 34.0] | 22.80 [22.63, 22.97] |
| L24N production (L) | 33.1% [32.7, 33.4] | 22.07 [21.89, 22.25] |
| Reward v2 candidate | not run | not run |
| Oracle | 46.2% [45.8, 46.6] | 15.94 [15.81, 16.08] |
| Rand | 8.4% [8.2, 8.5] | 39.14 [38.92, 39.33] |

| Contrast | Adherence difference (points) |
|---|---|
| L24N reference minus H+K | +9.12 [+8.94, +9.29] |
| L24N production minus H+K | +8.54 [+8.37, +8.74] |

## KEPT, headline (no drag, no deletes)

| Arm | Adherence | Hours before deadline |
|---|---|---|
| H | 19.9% [19.6, 20.1] | 22.08 [21.91, 22.24] |
| H+K | 20.2% [19.9, 20.4] | 22.31 [22.14, 22.48] |
| L24 | 19.1% [18.9, 19.4] | 25.49 [25.30, 25.66] |
| L24K | 16.0% [15.7, 16.3] | 28.60 [28.40, 28.79] |
| L24N reference | 17.1% [16.7, 17.5] | 24.69 [24.53, 24.84] |
| L24N production (L) | 16.7% [16.4, 17.0] | 24.37 [24.19, 24.56] |
| Reward v2 candidate | 29.0% [28.7, 29.3] | 23.82 [23.63, 24.00] |
| Oracle | 44.7% [44.3, 45.1] | 15.71 [15.57, 15.84] |
| Rand | 8.4% [8.2, 8.5] | 39.14 [38.92, 39.33] |

| Contrast | Adherence difference (points) |
|---|---|
| L24N reference minus H+K | -3.05 [-3.35, -2.76] |
| L24N production minus H+K | -3.45 [-3.76, -3.15] |
| Candidate minus L24N production | +12.32 [+12.09, +12.54] |
| Candidate minus H+K | +8.87 [+8.62, +9.11] |

## KEPT, signal world (drag 0.3, delete slot 0.3)

| Arm | Adherence | Hours before deadline |
|---|---|---|
| H | 25.9% [25.6, 26.2] | 21.32 [21.14, 21.49] |
| H+K | 29.5% [29.2, 29.9] | 21.40 [21.21, 21.58] |
| L24 | 28.8% [28.5, 29.2] | 22.77 [22.57, 22.95] |
| L24K | 30.5% [30.1, 30.8] | 25.03 [24.82, 25.22] |
| L24N reference | 30.4% [30.1, 30.8] | 22.45 [22.27, 22.61] |
| L24N production (L) | 30.6% [30.3, 31.0] | 21.49 [21.30, 21.67] |
| Reward v2 candidate | 35.8% [35.5, 36.2] | 20.87 [20.69, 21.05] |
| Oracle | 44.0% [43.7, 44.4] | 15.72 [15.58, 15.86] |
| Rand | 14.6% [14.5, 14.8] | 39.66 [39.46, 39.85] |

| Contrast | Adherence difference (points) |
|---|---|
| L24N reference minus H+K | +0.88 [+0.71, +1.06] |
| L24N production minus H+K | +1.11 [+0.95, +1.26] |
| Candidate minus L24N production | +5.18 [+5.02, +5.33] |
| Candidate minus H+K | +6.29 [+6.12, +6.46] |

## Historical only

L6 (six-band LinUCB) cannot be run: its code is gone from the repository. The 23 Oct archive gives 28.0% [27.6, 28.3] on seeds 500 to 599, from before the DONE to KEPT change, so it is not comparable with the rows above.

