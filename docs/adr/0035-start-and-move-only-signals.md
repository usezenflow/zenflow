# ADR-0035: Learn from START and MOVE only

**Status:** accepted
**Date:** 2026-10-21
**Supersedes:** ADR-0023, ADR-0025, ADR-0030

## Context
- Completion check-off, wrong-time, lapse and the legacy RETAINED and MISSED signals were noisy. Mobile and PWA already showed no check-off UI.
- A lapse was inferred from silence, so an ignored proposal was penalised as a failure.
- The outcome sweep (30-minute cron) was an extra moving part for one signal.

## Decision
- Learning and metrics rest on three signals: START, MOVE (drag or resize) and the pairwise tap.
- START is rewarded when it is recorded (`+1`). There is no settlement cron.
- No LAPSED: an ignored proposal gives no signal.
- Skip stays as a calendar feature for non-TASK sessions (timetable, assignment, exam, DND). It writes no `SessionEvent` and is rejected for TASK with 400.
- Contract deltas:
  - Routes: `POST|DELETE /api/v1/sessions/:id/complete` removed. `POST|DELETE /api/v1/sessions/:id/skip` kept, non-TASK only.
  - `@zenflow/shared`: `SessionCheckOffResponse` replaced by `SessionSkipResponse` (`skip.ts`). `Session.completedAt` removed. `PolicyQuality.events` is `{START; MOVE}` and gains `due`. `PlacementFlexible.completed` removed.
  - Prisma: `SessionEventType` is `CREATE | MOVE | SYSTEM_MOVE | START`. `Session.completedAt`, `Session.retainedAt` and `SessionOccurrenceState.completedAt` removed, with their indexes.
  - Python `/v1/place`: `FlexibleWire.completed` removed.
- Migrations `20261021100000`–`20261021100002` delete old event rows and null `SlotProposal.firstModificationType` where it holds a removed value. They are destructive and irreversible. Back up first.
- A/B start rate: START over placed sessions whose slot has passed (`due`).

## Consequences
- Simpler scheduler: no outcome cron, no grace or cutoff constants.
- LinUCB and the heuristic learn only from a start (+1), a drag (graded negative) and a pairwise win or loss.
- Ignored proposals no longer count against a policy. The effect is measured in the eval.
- Migration steps: back up, apply, then deploy backend and bandit together, since the placer wire contract changes.
- Links: [data model](../backend/data-model.md), [scheduler](../backend/scheduler.md), [A/B testing](../scheduler/ab-testing.md).
