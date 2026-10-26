# Reward v2 tuning, seeds 100 to 109

One weight changed at a time, the others at their defaults (kept 1, move 2, create 2, delete -1 after the sweep). Arm `Lv2-KDMC`, 1,000 students per setting (10 seeds × 100), drag 0.3 and delete slot 0.3. Regret is the mean over proposals, with 95% student-cluster intervals. Kept is the share of proposals not moved or deleted.

| Weight | Value | Regret | Kept |
|---|---|---|---|
| `v2_kept` | 0.1 | 0.161 [0.155, 0.167] | 83.2% |
| `v2_kept` | 0.25 | 0.148 [0.143, 0.153] | 84.9% |
| `v2_kept` | 0.5 | 0.135 [0.124, 0.145] | 87.3% |
| `v2_kept` | **1.0** | **0.132 [0.127, 0.138]** | 86.9% |
| `v2_kept` | 2.0 | 0.154 [0.147, 0.161] | 84.1% |
| `v2_move` | 0.25 | 0.151 [0.145, 0.156] | 84.4% |
| `v2_move` | 0.5 | 0.148 [0.143, 0.153] | 84.9% |
| `v2_move` | 1.0 | 0.146 [0.141, 0.151] | 85.3% |
| `v2_move` | **2.0** | **0.142 [0.137, 0.147]** | 85.8% |
| `v2_create` | 0.25 | 0.160 [0.155, 0.165] | 83.8% |
| `v2_create` | 0.5 | 0.148 [0.143, 0.153] | 84.9% |
| `v2_create` | 1.0 | 0.135 [0.130, 0.139] | 86.0% |
| `v2_create` | **2.0** | **0.121 [0.117, 0.126]** | 86.9% |
| `v2_delete` | -0.1 | 0.152 [0.147, 0.157] | 84.5% |
| `v2_delete` | -0.25 | 0.148 [0.143, 0.153] | 84.9% |
| `v2_delete` | -0.5 | 0.144 [0.139, 0.149] | 85.2% |
| `v2_delete` | **-1.0** | **0.140 [0.135, 0.144]** | 85.4% |

- KEPT has an interior optimum at 1, the value the simulator already used. The plan's demotion to 0.25 raises regret.
- Move, create and delete improve monotonically to the edge of the searched range. Their optimum may lie beyond it. Larger values were not searched, so the frozen values are not tuned optima.
- The frozen values are the best point in each search: kept 1, move 2, create 2, delete -1.
