# Offline evaluation: L6, L24, L24N, H and H+K

Simulated students only. Methods and the simulator are in [eval-protocol.md](./eval-protocol.md). Metrics and their formulas are those of [heuristic-vs-linucb-report.md](./heuristic-vs-linucb-report.md) section 3. Full tables with intervals: [benchmark-1200-tables.md](./eval-data/benchmark-1200-tables.md). Run on 26 Oct 2026 on seeds 1200 to 1299.

## Result

- **In the signal world, the six-band L6 and the shipped L24N placer are both close to H+K.** L6 keeps 1.7 points more proposals than H+K (84.5% against 82.7%) with 3 fewer minutes of drag, and it has the same regret (0.169 against 0.173). L24N production has the lowest regret of the old arms (0.155 against 0.173), at the cost of 2.5 more minutes of drag and 0.2 more proposals to reach 60%.
- **In the headline world, H+K has the lowest regret of every arm.** Every arm keeps 100% of its proposals there, so the learning signal carries no preference information (section 5).
- **The reward v2 candidate is not shipped.** Its regret is 0.095 in the signal world. Its gain depends on two signals that are circular in the simulator (section 5).

## 1. Models

| Name | Meaning | Source |
|---|---|---|
| **H** | Heuristic: a table of favourite hours that learns from drags | Shipped |
| **H+K** | H with the hour kernel | Live A/B arm |
| **L6** | LinUCB over six time-of-day bands, with a favourite-hours term inside a band | Recovered from commit 38b4afd3 (21 Oct 2026). Section 2 |
| **L24** | LinUCB over 24 start-hour arms, no kernel | `L-hourly` |
| **L24K** | L24 with the hour kernel | `L-hourly-K` |
| **L24N reference** | L24K with unit-length day features, offline, no series or displacement | `L-hourly-K+N` |
| **L24N production** | The shipped placer: 24 hour arms with the kernel and unit-length day features, plus displacement, last resort and 409 handling | `L` |
| **Reward v2 candidate** | L24N production with the reward v2 signals (ADR-0045) | `Lv2-KDMC` |
| **Oracle** | Best free slot by the hidden utility | Ceiling |
| **Rand** | Random day and hour in the window | Floor |

L6, L24, L24K and L24N reference use the production learning rule for their arms. They do not take reward v2 signals. The candidate uses the same 24-arm LinUCB as L24N production with extra reward terms.

## 2. L6, recovered

L6 is the six-band placer at commit 38b4afd3 (21 Oct 2026). The package is copied as `services/bandit/evalx/l6` (imports renamed, simulator and entry-point code removed). The harness glue is in `services/bandit/evalx/l6_arm.py`. The arm is selected with the policy `LINUCB6` in the semester harness.

- Bands: `EARLY_MORNING` 00:00 to 08:00, `MORNING` 08:00 to 11:00, `MIDDAY` 11:00 to 14:00, `AFTERNOON` 14:00 to 17:00, `EVENING` 17:00 to 20:00, `NIGHT` 20:00 to 24:00.
- Learning: one LinUCB model per band, updated with the production v1 reward (KEPT +1, drag penalty on a MOVE). The favourite-hours table is updated as in the other arms.
- Deviation from 38b4afd3's harness: its request omitted the blocks a student had already placed. Here they occupy time, as they do for every other arm. Without this, L6 would double-book its own blocks.

## 3. Worlds

| World | Drag | Delete slot | Delete noise | Seeds | Students |
|---|---|---|---|---|---|
| Headline KEPT | 0 | 0 | 0 | 1200 to 1299 | 10,000 |
| Signal KEPT | 0.3 | 0.3 | 0 | 1200 to 1299 | 10,000 |

Under the KEPT signal, the learner hears KEPT for every block the student did not move, and nothing else. A block left in place counts as kept whether or not the student would have started it. Drag is the share of tasks a student may move when the slot is poor. Delete slot scales the delete chance with how poorly the hour fits.

The headline world has no moves and no deletes, so every arm keeps 100% of its proposals and every update is the same +1. The signal world adds moves and deletes.

## 4. Results

Metrics per the heuristic report. Intervals are 95% over students. Regret is per proposal: the hidden done chance of the best free start minus that of the proposed start. Kept excludes deleted and moved proposals. Drag is minutes moved per proposal. To 60% is the first proposal number n >= 10 where at least 6 of proposals n-9..n were kept, or the placement count if that never happens. First 10 and 40+ are regret over proposals 1 to 11 and over proposals 42 on.

### 4.1 Signal world (drag 0.3, delete slot 0.3)

| Arm | Regret | Kept | Drag (min) | To 60% | Regret, first 10 | Regret, 40+ |
|---|---|---|---|---|---|---|
| H | 0.215 [0.213, 0.218] | 76.5% [76.3, 76.6] | 50 [49, 50] | 10.7 [10.7, 10.8] | 0.235 [0.232, 0.237] | 0.206 [0.204, 0.209] |
| H+K | 0.173 [0.170, 0.175] | 82.7% [82.6, 82.9] | 28 [28, 28] | 10.3 [10.3, 10.4] | 0.209 [0.207, 0.212] | 0.160 [0.157, 0.162] |
| L6 | 0.169 [0.167, 0.171] | 84.5% [84.3, 84.6] | 25 [25, 26] | 10.6 [10.6, 10.6] | 0.213 [0.210, 0.216] | 0.155 [0.152, 0.157] |
| L24 | 0.174 [0.172, 0.177] | 81.2% [81.0, 81.4] | 39 [38, 39] | 10.5 [10.5, 10.5] | 0.198 [0.195, 0.201] | 0.163 [0.161, 0.165] |
| L24K | 0.158 [0.155, 0.160] | 83.9% [83.7, 84.1] | 28 [27, 28] | 10.4 [10.3, 10.4] | 0.180 [0.177, 0.183] | 0.148 [0.146, 0.150] |
| L24N reference | 0.157 [0.154, 0.159] | 83.1% [82.8, 83.3] | 34 [33, 35] | 10.6 [10.5, 10.6] | 0.189 [0.186, 0.192] | 0.142 [0.139, 0.145] |
| L24N production | 0.155 [0.153, 0.157] | 83.3% [83.1, 83.5] | 31 [30, 31] | 10.6 [10.5, 10.6] | 0.195 [0.192, 0.198] | 0.140 [0.137, 0.142] |
| Reward v2 candidate | 0.095 [0.094, 0.097] | 89.2% [89.1, 89.3] | 17 [16, 17] | 10.1 [10.0, 10.1] | 0.138 [0.136, 0.140] | 0.086 [0.084, 0.087] |
| Oracle | 0.000 | 95.1% | 4 | 10.0 | 0.000 | 0.000 |
| Rand | 0.341 [0.338, 0.344] | 60.1% [59.9, 60.3] | 79 [78, 80] | 13.2 [13.1, 13.4] | 0.332 [0.329, 0.335] | 0.338 [0.335, 0.341] |

Paired contrasts. Kept is in points. Drag is in minutes. To 60% is in proposals.

| Contrast | Regret | Kept | Drag | To 60% | First 10 | 40+ |
|---|---|---|---|---|---|---|
| H+K minus H | -0.04 [-0.04, -0.04] | +6.29 [+6.18, +6.39] | -21.73 [-22.14, -21.31] | -0.39 [-0.43, -0.35] | -0.03 [-0.03, -0.02] | -0.05 [-0.05, -0.05] |
| L6 minus H+K | -0.00 [-0.01, -0.00] | +1.71 [+1.55, +1.86] | -3.10 [-3.48, -2.68] | +0.28 [+0.24, +0.32] | +0.00 [+0.00, +0.01] | -0.01 [-0.01, -0.00] |
| L24 minus H+K | +0.00 [+0.00, +0.00] | -1.55 [-1.67, -1.42] | +10.41 [+10.00, +10.83] | +0.17 [+0.14, +0.20] | -0.01 [-0.01, -0.01] | +0.00 [+0.00, +0.01] |
| L24K minus H+K | -0.01 [-0.02, -0.01] | +1.14 [+0.99, +1.28] | -0.42 [-0.83, +0.02] | +0.05 [+0.01, +0.08] | -0.03 [-0.03, -0.03] | -0.01 [-0.01, -0.01] |
| L24N reference minus H+K | -0.02 [-0.02, -0.01] | +0.33 [+0.14, +0.50] | +5.59 [+4.90, +6.28] | +0.25 [+0.21, +0.29] | -0.02 [-0.02, -0.02] | -0.02 [-0.02, -0.02] |
| L24N production minus H+K | -0.02 [-0.02, -0.02] | +0.56 [+0.40, +0.72] | +2.51 [+2.05, +2.96] | +0.23 [+0.19, +0.27] | -0.01 [-0.02, -0.01] | -0.02 [-0.02, -0.02] |
| L6 minus L24N production | +0.01 [+0.01, +0.02] | +1.15 [+0.98, +1.33] | -5.61 [-6.10, -5.11] | +0.05 [-0.00, +0.10] | +0.02 [+0.02, +0.02] | +0.02 [+0.01, +0.02] |
| Candidate minus L24N production | -0.06 [-0.06, -0.06] | +5.87 [+5.71, +6.02] | -14.00 [-14.42, -13.58] | -0.51 [-0.55, -0.46] | -0.06 [-0.06, -0.05] | -0.05 [-0.06, -0.05] |

### 4.2 Headline world (no drag, no deletes)

| Arm | Regret | Kept | To 60% | Regret, first 10 | Regret, 40+ |
|---|---|---|---|---|---|
| H | 0.288 [0.284, 0.290] | 100% | 10.0 | 0.276 [0.273, 0.279] | 0.292 [0.288, 0.295] |
| H+K | 0.284 [0.281, 0.287] | 100% | 10.0 | 0.272 [0.269, 0.275] | 0.293 [0.290, 0.296] |
| L6 | 0.335 [0.331, 0.339] | 100% | 10.0 | 0.313 [0.309, 0.317] | 0.339 [0.335, 0.343] |
| L24 | 0.291 [0.289, 0.295] | 100% | 10.0 | 0.259 [0.256, 0.262] | 0.305 [0.301, 0.308] |
| L24K | 0.325 [0.321, 0.328] | 100% | 10.0 | 0.285 [0.281, 0.289] | 0.341 [0.337, 0.344] |
| L24N reference | 0.310 [0.306, 0.314] | 100% | 10.0 | 0.288 [0.285, 0.292] | 0.315 [0.311, 0.319] |
| L24N production | 0.313 [0.310, 0.317] | 100% | 10.0 | 0.297 [0.293, 0.301] | 0.314 [0.311, 0.318] |
| Reward v2 candidate | 0.179 [0.177, 0.182] | 100% | 10.0 | 0.238 [0.235, 0.242] | 0.159 [0.157, 0.162] |
| Oracle | 0.000 | 100% | 10.0 | 0.000 | 0.000 |
| Rand | 0.409 [0.405, 0.412] | 100% | 10.0 | 0.396 [0.393, 0.400] | 0.402 [0.398, 0.406] |

The candidate's regret here comes from the hand-made-block signal alone, which section 5 shows to be circular.

## 5. What explains the results

**Why L24 loses to H+K.** In the signal world L24 keeps 1.6 points fewer proposals than H+K and moves 10 minutes more per proposal. L24K, which adds the hour kernel, reverses both: it keeps 1.1 points more than H+K, with no extra drag. The kernel shares what a student does at one hour with its neighbours. Without it, each of the 24 hours must learn from its own few observations. The loss comes from learning slowly across hours, not from the reward.

**Why every learner loses in the headline world.** Every proposal is kept there, so the only reward is +1 for every placement. A bandit fed a constant reward learns nothing about which hour suits the student, and it spends its effort exploring. H+K keeps its favourite-hours table near the defaults, which already suit these students, so it does best. This is the cost of learning with no signal, which is what a student who never moves a block gives the learner.

**Why L6 is level with H+K.** L6 keeps 1.7 points more proposals and moves 3 minutes less than H+K. Its regret is the same. Against the shipped L24N placer it keeps 1.2 points more with 5.6 minutes less drag, and its regret is 0.014 higher.

**Why the candidate is not shipped.** The candidate is the same 24-arm LinUCB as L24N production, with four reward terms: KEPT stays +1, a move also pays +2 to the destination hour, a delete pays -1 to the placing hour, and a hand-made block pays +2 to its hour. Two of these are circular in the simulator. Deletes depend on the slot quality that the regret measures, and hand-made blocks land at the student's best hour by default. Earlier coupling checks, in the reward v2 archive ([reward-v2-tables.md](./eval-data/reward-v2-tables.md)), showed that the gain disappears when those links are cut. Those checks used adherence and the earlier metric set. They have not been rerun with the heuristic metrics.

## 6. Production state

- Unchanged: the L24N production placer and the H and H+K arms.
- Reward v2 is in production code behind flags that stay off: `REWARD_V2_ENABLED` (a move also pays the destination hour) and `DELETE_REWARD_ENABLED` (deletes are logged with their would-be reward and do not teach the arm). The TS fallback honours `notBefore` and `window` (commit 5c956f24).
- Not implemented, and why:
  - **Last-resort placement honouring the task window.** `lastResortStart` ignores `notBefore` and `window`. The fix is to avoid the blocked time and warn when no slot is left. Not done in this round.
  - **Device delete.** A delete made on the phone is restored, not reported. Reporting it needs a contract change: the delete endpoint always records the origin ZENFLOW, so a device origin needs a new field. This needs a decision on the public API.
  - **MCP pairwise picks.** Two candidates in previews, the confirm call that records the pick, and a `pickReason` column. This changes what the assistant asks and adds a migration. Not built, pending a decision.
  - **Hand-made block wiring.** A hand-made block needs a day context vector that the server does not compute. Not built.
  - **Divergence and pick share.** These need paired offers, which exist only in the pairwise flow above.

## 7. Limits

- Simulated students only. Start curves, moves, deletes and hand-made blocks are assumptions. Nothing here measures real behaviour.
- Both worlds use the KEPT signal, which production sends.
- L6 is recovered from a 21 Oct commit. Its placer is that commit's code, with the one deviation in section 2.
- The protocol's ship rule still uses adherence. This report follows the heuristic report's metrics and omits adherence and lead time, as requested.
- Placer timing (the rule's p95 under 1 ms) was not re-measured in this round.

## 8. Seed ledger

| Seeds | Use | Status |
|---|---|---|
| 100 to 109 | Tuning | Spent for tuning |
| 800 to 899 | Reward v2 ladder and coupling checks | Spent |
| 900 to 999 | Delete scoring (ADR-0043) | Spent |
| 1000 to 1099 | Reward v2 robustness | Spent |
| 1100 to 1199 | Benchmark, two KEPT worlds | Spent |
| 1200 to 1299 | L6, the L24 family and the candidate, heuristic metrics | Spent 26 Oct 2026 |
| 1300 and up | Next held-out block | Free |

## 9. Run index

| Run | Seeds | Students | Arms | Output |
|---|---|---|---|---|
| Headline KEPT | 1200 to 1299 | 10,000 | H, H+K, L6, L24, L24K, L24N reference, L24N production, candidate, Oracle, Rand | [benchmark-1200-tables.md](./eval-data/benchmark-1200-tables.md) |
| Signal KEPT | 1200 to 1299 | 10,000 | Same arms | [benchmark-1200-tables.md](./eval-data/benchmark-1200-tables.md) |

Commands (cwd `services/bandit`):

```bash
uv run python -m evalx run --seeds 100 --seed-offset 1200 --students 100 --arms H,H+K,L6,L-hourly,L-hourly-K,L-hourly-K+N,L,Lv2-KDMC,Oracle,Rand --config '{}'
uv run python -m evalx run --seeds 100 --seed-offset 1200 --students 100 --arms H,H+K,L6,L-hourly,L-hourly-K,L-hourly-K+N,L,Lv2-KDMC,Oracle,Rand --config '{"drag":0.3,"delete_slot":0.3}'
uv run python -m evalx.proposal summary --parts <parts dir> --arms ... --pairs H+K:H,L6:H+K,...
```

## 10. Next steps

1. Decide which placer to keep among H+K, L6 and L24N production. Under these metrics L24N production has the lowest regret, L6 keeps the most proposals, and H+K is the simplest. The choice depends on whether regret or kept matters more to students.
2. Decide the open production items in section 6, starting with the device-delete contract and the pairwise flow, since both change what users and the assistant see.
3. Check the ship rule's adherence check with its owners. This report omits adherence, which the protocol still uses.
