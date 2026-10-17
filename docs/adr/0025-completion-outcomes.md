# ADR-0025: Completion outcomes: started, done, lapsed

**Status:** accepted, amends ADR-0023
**Date:** 2026-10-17

## Context

ADR-0023 settled an unmoved placement as `COMPLETED` (+1), `SKIPPED` (-1) or
`MISSED` (-1). A check-off before the start counted as `MISSED`, and skip and
miss had the same penalty. Lazy students who never check off were scored the
same as students who ignored a block, and the signal was almost always -1.

## Decision

Settled outcomes, all decided by `completionOutcome` (TS) and `completion_outcome`
(Python):

| Outcome | Rule | Reward | Event |
| --- | --- | --- | --- |
| `DONE` | check-off at or after start | +1 | `COMPLETE` |
| `STARTED` | start in `[start, end)`, no check-off | +1 | `START` |
| `SKIPPED` | user skip | 0 | `SKIP` |
| `WRONG_TIME` | check-off before start, none after | 0 | `WRONG_TIME` |
| `LAPSED` | no start or check-off | -0.25 | `LAPSED` |

- `DONE`, `STARTED` and `SKIPPED` settle at `end + grace`. `WRONG_TIME` and
  `LAPSED` settle at `end + cutoff`.
- `MISSED` is no longer written. Existing rows keep it and still count as observations.
- `DONE` alone reinforces the preference matrix.
- `STARTED` needs a start timestamp. No start action exists yet, so the
  settler passes `null` and the outcome is unreachable until one lands (level-up plan, focus timer #262).

Schema: `SessionEventType` gains `START`, `WRONG_TIME`, `LAPSED`
(migration `20261017170000_phase0_schema`).

## Consequences

- Skipped placements no longer count toward the observation count. Their reward is 0, and
  `rewardEventWhere` only counts a check-off or skip with a non-zero reward.
- Lapses cost less than the old -1, so the bandit penalises ignored blocks less than
  a deliberate skip used to be penalised. Expect different arm values for existing users.
- Python `constants.py` and TS `scheduler/constants.ts` carry the same values.
