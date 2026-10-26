# ADR-0042: Kept and moved signals

**Status:** accepted
**Date:** 2026-10-26
**Supersedes:** [ADR-0035](0035-start-and-move-only-signals.md)
**Issue:** none

## Context
- ADR-0035 learns from START. Production no longer writes START; the signal is KEPT, written by a sweep when an unmoved placement's slot passes.
- A user move re-entered placement: the next conflict or displacement could move the session again, which reads as a broken drag.
- A wrong placement was undone only through the group endpoint. The assistant had no way to revert the latest change.

## Decision
- Learning signals:
  - `KEPT` (+1): an engine-placed `TASK` (`source` USER or AUTO) whose slot began 15 minutes ago and was never moved. Written by `KeptSweepService`.
  - `MOVE` (graded, at most 0): a user drag or resize of a scheduled `TASK`.
  - `SYSTEM_MOVE` (0): a scheduler move. No preference update.
  - `CREATE` (0): a new session.
- A user move makes the row fixed. `isFlexible` (`scheduler/io/displacement.service.ts`) excludes rows with `lastMovedAt`, so placement and displacement never move them again.
- `dryRun` on `create_tasks` and `POST /sessions/bulk` returns `proposedStart`, `proposedEnd` and `timezone`. Nothing is written.
- `undo_last_change` (MCP) reverts the group of the newest `CREATE`, `MOVE` or `SYSTEM_MOVE` event through `PlacementPlanService.undo`.
- `sync_status` (MCP) returns the Google Calendar status: connection, last sync, pending change time, retry time, attempts and last error.
- Discovery pushes: up to three `discovery.N` notifications, due 1, 3 and 7 days after a user's first `CalendarLink`.
- Not built yet: `DELETE` and `EDIT` change-log rows, the delete reward (`DELETE_REWARD`, shadow mode), and system-move caps and pushes.

## Consequences
- The scheduler treats a moved `TASK` as fixed. A conflict that needs room is solved by moving the flexible tasks around it.
- A moved `TASK` gets no `KEPT` event, because the kept sweep skips rows with `lastMovedAt`. A move is graded only as `MOVE`.
- `undo_last_change` reverts one group. A second call finds the same group and restores nothing. Upgrade: mark reverted groups.
- Clients that read `BulkCreateItemResult` `PROPOSED` get two more fields.
- Links: [scheduler](../backend/scheduler.md), [ADR-0035](0035-start-and-move-only-signals.md).
