# ADR-0025: Completion outcomes: started, done, lapsed

**Status:** accepted, amends ADR-0023; amended 2026-10-20 (check-off no longer rewards)
**Date:** 2026-10-17

## Context

ADR-0023 settled an unmoved placement as `COMPLETED` (+1), `SKIPPED` (-1) or
`MISSED` (-1). A check-off before the start counted as `MISSED`, and skip and
miss had the same penalty. Lazy students who never check off were scored the
same as students who ignor## Decision

Settled outcomes, decided by `completionOutcome` (TS) and `completion_outcome`
(Python):

| Outcome | Rule | Reward | Event |
| --- | --- | --- | --- |
| `STARTED` | app opened in `[start, end)` | +1 | `START` |
| `LAPSED` | no start | -0.25 | `LAPSED` |

- `STARTED` settles at `end + grace`. `LAPSED` settles at `end + cutoff`.
- The `START` event is written by `POST /sessions/:id/start`, sent by the app while
  it is open inside a placed task's slot. One per slot. The first one in the slot
  carries the reward.
- Settlement covers user-created and system-placed (prep) tasks: `source` `USER` or `AUTO`.
- Check-off no longer rewards. `COMPLETE`, `SKIP`, `DONE`, `SKIPPED` and `WRONG_TIME`
  are not produced by settlement. The check-off endpoints stay until the data
  freeze, then go.
- LMS submission does not check an assignment off. Its prep plans are not retired.
- `MISSED`, `DONE`, `SKIPPED` and `WRONG_TIME` rows written earlier keep their
  rewards and still count as observations.

Schema: `SessionEventType` gains `START`, `WRONG_TIME`, `LAPSED`
(migration `20261017170000_phase0_schema`).

## Consequences

- Placements the student never opens in their slot lapse. Expect a lapse rate
  close to the share of blocks the app is not opened in.
- Skipped placements no longer count toward the observation count. Their reward is 0, and
  `rewardEventWhere` only counts a check-off or skip with a non-zero reward.
- Lapses cost less than the old -1, so the bandit penalises ignored blocks less than
  a deliberate skip used to be penalised. Expect different arm values for existing users.
- Python `constants.py` and TS `scheduler/constants.ts` carry the same values.
