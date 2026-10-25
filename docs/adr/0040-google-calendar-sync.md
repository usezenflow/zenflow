# ADR-0040: Google Calendar sync

**Status:** accepted
**Date:** 2026-10-25
**Issue:** none

## Context
- [ADR-0039](0039-thin-layer-calendar-native.md) leaves calendar display, reminders and location to Google Calendar and the phone's calendar app.
- Session writers are spread across the API, scheduler and ingestion, so no single hook sees every change.
- Google pushes carry no body, channels expire after at most a week, and nothing renews them.

## Decision
- Zenflow is the source of truth. A user's Google calendar is a projection into a secondary "Zenflow" calendar, scope `calendar.app.created`.
- Sync diffs state instead of reacting to events. `CalendarSyncService` builds the wanted events, compares each to the hash last written (`CalendarLink.payloadHash`) and writes only differences, so every writer is covered and a repeat run does nothing.
- Mapping keys: the Google event id is the session or series id without dashes, so a create is idempotent. `extendedProperties.private.zf` holds the Zenflow id. A recurring series is one Google event with `RRULE` and `EXDATE`.
- Triggers: `SessionsService` writes queue a debounced `calendar-sync` job; a watcher cron re-syncs every connection not synced for 4 minutes and pulls changes, covering scheduler, ingestion and missed pushes.
- Google to Zenflow: `events.watch` pushes queue a `pull` job. It reads changes with a sync token and applies a drag or delete through `SessionsService`. Echoes of our own writes are ignored by etag. Zenflow wins when it changed after the last write, and an ingested timetable item is written back instead of moved.
- Failures: 429 and 5xx retry with BullMQ backoff; a revoked grant marks the connection `NEEDS_RECONNECT` and raises one `calendar.reconnect` notification.
- Tokens: refresh tokens are AES-256-GCM encrypted with `GOOGLE_TOKEN_ENCRYPTION_KEY`. The queue `calendar-sync` is consumed by `worker-notify`.
- Models: `CalendarConnection`, `CalendarLink`. Routes: [api.md](../backend/api.md#google-calendar-google-calendar). Env: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_TOKEN_ENCRYPTION_KEY`, `PUBLIC_API_URL`, `PUBLIC_WEB_URL`.

## Consequences
- Phones show the schedule once Google is added to the phone. Latency is the sync cadence plus Google's own refresh.
- Moves of single instances of a recurring event in Google are not read back.
- Whether `calendar.app.created` needs Google's app verification is not confirmed; check before opening to all users.
- The mobile app can also write a local calendar with `expo-calendar`. Users with Google on the phone should not turn both on.
