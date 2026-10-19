# ADR-0030: Deadline pressure and LMS auto-complete

**Status:** accepted
**Date:** 2026-10-19
**Issue:** none

## Context
- Placement only used the deadline to cap the scan window, so a task could land minutes before it was due at no cost.
- A submitted LMS assignment stamped `submittedAt` but never `completedAt` or a `COMPLETE` event, so it earned no sparks (ADR-0026) until checked off by hand.

## Decision
- Heuristic and LinUCB subtract `DEADLINE_PENALTY_WEIGHT` (0.2) scaled linearly to 0 over `DEADLINE_PENALTY_HORIZON_HOURS` (24) before the deadline, measured at the slot end. It is a slot-level term like gap quality: no feature, reward or arm-state change.
- `best_free_slot` takes an optional `deadline_ms`; the frozen TS fallback is unchanged.
- The materializer checks an ASSIGNMENT off (`completedAt` plus a `COMPLETE` event) the first time it sees the submission. A skipped or completed row is left alone, and a later manual un-check sticks.

## Consequences
- No `ARM_LAYOUT` bump, no arm reset and no replay: stored state stays valid. `paramsVersion` changes, so contract fixtures were regenerated.
- Rows submitted before this change need `pnpm --filter backend backfill:lms-complete`.
- `submitted` still depends on the Vietnamese "Thêm bài nộp" label in `parse-lms.ts`.
