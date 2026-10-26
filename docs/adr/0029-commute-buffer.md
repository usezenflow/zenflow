# ADR-0029: Commute buffer

**Status:** superseded by [ADR-0039](0039-thin-layer-calendar-native.md)
**Date:** 2026-10-19
**Issue:** none

## Context
- A session with a start and a place needs travel time on both sides. The scheduler treated it as the block alone, so another session could start the minute a lecture ended across campus.
- `Session.originLocation` was commute display only and never read by the scheduler.

## Decision
- Add `Session.commuteMinutes` (nullable, 0 to 180): minutes to travel between the origin and the location, each way. The app sets it from the route it shows (`routeMinutes` for the chosen vehicle); the server stores it as given.
- `loadDayLoad` and `loadScheduleItems` widen each session's `occupied` interval by `commuteMinutes` before and after. Recurring series use the representative row's value. Workload, conflicts between fixed rows and the Python contract are unchanged: placers still receive plain intervals.
- `commuteMinutes` is the student's field, so synced sessions stay editable for it (see `synced-lock.ts`).
- `POST /sessions` accepts `originLocation`, `originLat`, `originLng` and `commuteMinutes` for a task.

## Consequences
- Other sessions are never placed inside the buffer. The session being placed does not yet reserve its own buffer.
- A stale value stays until the student edits the location again; changing only the vehicle in settings does not recompute.
- Migration `session_commute_minutes`.
