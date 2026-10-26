# ADR-0045: Reward v2

**Status:** proposed
**Date:** 2026-10-26
**Issue:** none
**Supersedes (in part):** [ADR-0043](0043-delete-signal.md) for `DELETE_REWARD`

## Context
- The LinUCB reward is mostly KEPT (+1 for a silent, unmoved slot) and a drag penalty on the first MOVE. KEPT fires for slots the user never saw, so it tracks utility weakly.
- Other signals are in production and unused: a move's destination hour, a delete (ADR-0043, shadow), and an hour the user picks by hand.
- The simulator (`services/bandit/evalx`) could not measure these signals before, because its headline world had no moves and no deletes.

## Decision
- Reward v2 adds three signals to the LinUCB arm. Each stays off until the ship rule passes:
  - **Destination** (`REWARD_V2_ENABLED = false`): a first MOVE within the same local day also pays `REWARD_V2_DESTINATION = 2` to the hour arm the session moved to, on the proposal's day context.
  - **Delete** (`DELETE_REWARD_ENABLED = false`, ADR-0043): `DELETE_REWARD = -1` (was -0.25) on the placing arm. The event stores the reward it would pay from the first write, so shadow data accrues.
  - **Create:** a block the user makes by hand pays `+2` to its hour. Specified and simulated, not wired in production (see Consequences).
- KEPT stays at `1`. Tuning on seeds 100 to 109 lowered regret as KEPT rose from 0.1 to 1 and rose again above 1, so `REWARD_V2_KEPT = 1`. The plan's demotion to 0.25 is rejected by the data.
- Weights were tuned one at a time on seeds 100 to 109 with the drag and delete signals on. Move, create and delete each reached the edge of the searched range (2, 2 and -1), so their optimum may lie beyond it. Weights are frozen for the fresh-seed runs.
- A destination update and a delete update only run when their flag is on. While off, the delete event still stores its reward.

## Consequences
- Production: `onFirstMove` takes an optional destination. `SessionCrudService.remove` calls `SchedulingFeedbackService.onDelete` after commit. `onDelete` stores `rewardScore` and updates the arm only when `armDeleteReward` is non-zero.
- Create is not wired. A hand-made block has no `SlotProposal` and so no day context vector; the server would have to compute one.
- The simulator's hand-made block is an assumption: 10 % of tasks (`create_share`), placed at the student's best free hour on the proposal's day, observed without occupying the learner's calendar. Its prevalence is not measured.
- Pairwise picks through MCP, the assistant prompt, the mobile device-delete change and the observability panels are not part of this ADR and are not done.
- Results and the ship rule are in [offline-eval-report.md](../scheduler/offline-eval-report.md).

## Rollout
1. Ship with all flags off. Deletes are logged with their would-be reward.
2. Turn on destination and delete when the offline report passes the ship rule on the fresh seeds.
3. Create waits for its context vector.
