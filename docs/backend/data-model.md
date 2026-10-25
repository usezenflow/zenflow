# Backend data model

For: developers changing the schema or reading Session data. Source of truth: [`schema.prisma`](../../backend/prisma/schema.prisma) (client generated to `generated/prisma`).

| Table | Purpose | Notes |
| --- | --- | --- |
| `User` | Account and scheduling profile | `preferenceMatrix`: 168 signed floats (7x24), decayed nightly, lazily seeded. The scheduler places across the full 24 h grid (no `workStart`/`workEnd`/`workDays`). |
| `Session` | Every calendar item | See below. |
| `SessionSeries` | Recurring or `TASK` series | A recurring fixed session is one series plus one representative row, fanned to occurrences at read time. |
| `SessionOccurrenceState` | Skipped state of one recurring occurrence | Unique `[seriesId, occurrenceStart]`; a row exists only while the occurrence is skipped. |
| `SessionEvent` | Append-only audit trail (ML input) | `eventType`: `CREATE`, `MOVE`, `SYSTEM_MOVE` (scheduler-initiated, reward 0), `START` (app open inside a placed TASK's slot, reward `+1` on record, [ADR-0035](../adr/0035-start-and-move-only-signals.md)). `rewardScore` feeds LinUCB. Monthly range partitions on `occurredAt`, 12 months kept ([ADR-0016](../adr/0016-telemetry-retention-and-partitioning.md)); PK is `(id, occurredAt)`. |
| `Tag` | Per-user label | Wire format is `Session.tags: string[]`; unknown names are upserted per user. |
| `CalendarConnection`, `CalendarLink` | Google Calendar sync ([ADR-0040](../adr/0040-google-calendar-sync.md)) | One connection per user: encrypted refresh token, sync token, push channel. `CalendarLink` maps a session or series to its Google event (`eventId` is the id without dashes) and keeps the hash last written. No foreign key to `Session`, so a hard delete can still remove the event. |
| `OAuthClient`, `OAuthToken` | AI assistant sign-in ([ADR-0041](../adr/0041-mcp-oauth.md)) | Clients are registered dynamically. Codes, access and refresh tokens share one table, stored as HMAC; `familyId` revokes a chain together. |
| `File`, `UserDevice` | Uploads, push registrations | `UserDevice.pushToken` is unique (upsert key). `WEB` rows store the Web Push endpoint in `pushToken` and its keys in `p256dh` and `auth`. |
| `Integration`, `UserEncryptionKey` | Encrypted DLU credentials | Master keys are env-only, never in the DB. |
| `StudentProfile`, `StudyProgram`, `StudentMark`, `StudentTermResult` | DLU profile, programs, graded courses and per-term GPA | Normalised fields only (no phone, birthday or raw payload). `StudentMark` is unique `[userId, scheduleStudyUnitId]`, the portal section id. |
| `SyncRun`, `SyncRunUnit` | One fan-out pass and its week or month jobs | Settles the schedule row when the last unit reports. `notifiedAt` is the once-per-run notice. |
| `PortalWeekCoverage`, `LmsCourseWindow`, `LmsCourseSeen` | Per-week and per-month cache state | Replace single watermarks and fingerprints, so jobs for different weeks or months do not overwrite each other. `LmsCourse.occurrences*` and `LmsCourseEnrollment.seenFingerprint` are no longer read. |
| DLU tables: `LmsCourse`, `PortalSection`, `*SyncJob(Item)`, `Notification`, `IngestionSchedule`, `*Enrollment`, `*Occurrence` | Ingestion catalog, job tracking, cross-student cache | See [ingestion.md](ingestion.md). |

## Session

- `type`: `TASK` (engine-placed), `ASSIGNMENT`, `EXAM`, `LECTURE`, `DND` (user-pinned).
- `source`: `USER`, `LMS`, `PORTAL`.
- `deleted` is a soft-delete flag. Every scheduling and calendar read filters it, except the materializer's idempotency lookup.
- `scheduledStartTime` is never null on a live `TASK` ([never unplaced](scheduler.md#python-authoritative-placement)).
- `syncConfirmedAt` / `syncMissedAt` implement the two-run confirm/miss gate for ingested rows.
- `skipped` is the skipped state of a non-TASK session. Skipping writes no event. A recurring occurrence keeps its state in `SessionOccurrenceState` instead of being materialized, so series-wide edits still reach it.
- Indexes: `[userId, deadline]`, `[userId, scheduledStartTime]`, `[userId, seriesId, createdAt asc]`, `[userId, scheduleStudyUnitId]`, unique `[userId, externalKey]`.
- `POST /sessions` creates one row. A recurring fixed session creates one `SessionSeries` plus a representative row.
- See invariant 4 in [AGENTS.md](../../AGENTS.md) and [ADR-0002](../adr/0002-scheduling-simplification.md) section 2.4.
