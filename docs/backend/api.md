# Backend API reference

For developers and API clients. Live schema: Swagger UI at `<API_URL>/api`.

## Conventions

- Prefix `/api/v1`. Every route except `POST /auth/otp/*` needs `CookieAuthGuard` (Redis session cookie).
- Success: `{ success: true, message?, data }` (`@zenflow/shared`).
- Error: `{ success: false, message, statusCode?, field? }`.
- `POST /auth/otp/verify` reads the `x-timezone` header.

## Auth (`/auth`)

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/auth/otp/request` | Email a 6-digit OTP. Rate-limited. 403 `EMAIL_DOMAIN_NOT_ALLOWED` outside `ALLOWED_EMAIL_DOMAINS` (prod: `dlu.edu.vn`) |
| POST | `/auth/otp/verify` | Verify, create the user if new, start the session. `LocalAuthGuard`, rate-limited |
| GET | `/auth/me` | Current user |
| POST | `/auth/logout` | Destroy the session |

## Users (`/users`)

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/users/me` | Profile |
| PATCH | `/users/update/basic-info` | Name, timezone, lang, `defaultReminderMinutes` |
| GET | `/users/me/preference-matrix` | 168-float matrix for the Insights heatmap |
| GET | `/users/me/student` | DLU profile (`StudentResponse`); `profile` is null until the first fetch lands |
| GET | `/users/me/marks` | Marks grouped by term, newest first; names are clean and `noCredit` flags the portal's red star (`StudentMarksResponse`) |
| GET | `/users/me/api-access` | `mcpUrl`, `restBaseUrl`, assistant `prompt` and the user's tokens (`ApiAccessResponse`) |
| POST | `/users/me/api-access/tokens` | `{ name }`. Returns `{ token, secret }`; the secret is shown once |
| DELETE | `/users/me/api-access/tokens/:id` | Revoke at once. `{ revoked: true }` |

## AI assistants (`/mcp`)

[ADR-0038](../adr/0038-personal-api-access.md), [ADR-0041](../adr/0041-mcp-oauth.md). Assistants sign in through OAuth; scripts can use a personal token from `/users/me/api-access` (`Authorization: Bearer zf_...`). OAuth access tokens are `zo_...`.

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/mcp` | Streamable HTTP MCP, stateless. Bearer only; a 401 carries `WWW-Authenticate: Bearer resource_metadata=...`. GET and DELETE answer 405 |

- Tools: `list_schedule`, `get_session`, `update_session`, `delete_sessions` (`dryRun` first), `create_tasks` (`dryRun` first; returns `proposedStart`, `proposedEnd`, `timezone`), `undo_last_change`, `sync_status`. Each calls the same service as the REST route and relays its error code.
- Bearer tokens are refused (403) on routes not marked for them. Cookie sessions are unchanged.
- Management routes above take the cookie only.

### OAuth (API origin root, outside `/api/v1`)

Mounted from the MCP SDK in `main.ts`; the provider is `src/oauth/`.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/.well-known/oauth-authorization-server` | Server metadata (PKCE `S256`, public clients) |
| GET | `/.well-known/oauth-protected-resource/api/v1/mcp` | Protected resource metadata |
| POST | `/register` | Dynamic client registration. Redirect URIs must be https or loopback |
| GET | `/authorize` | Validates the request, then sends the browser to the PWA consent screen |
| POST | `/token` | Code and refresh grants. Refresh tokens rotate; a spent one revokes its family |
| POST | `/revoke` | Revokes a token family |

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/oauth/consent?request=` | Who is asking (`OAuthConsentInfo`). Cookie session |
| POST | `/oauth/consent` | `{ request, approve }`. Returns `{ redirectUrl }` with a one-time code or `access_denied` |
| GET | `/oauth/apps` | Connected assistants |
| DELETE | `/oauth/apps/:clientId` | Disconnect one at once |

## Google Calendar (`/google-calendar`)

[ADR-0040](../adr/0040-google-calendar-sync.md). Off until configured; `GET` answers `available: false`.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/google-calendar` | Status (`GoogleCalendarStatus`) |
| POST | `/google-calendar/connect` | `{ url }` to send the browser to Google |
| GET | `/google-calendar/callback` | Public. Google's redirect; stores the token and returns to `PUBLIC_WEB_URL/?google=` |
| POST | `/google-calendar/sync` | Queue a sync now (202) |
| DELETE | `/google-calendar` | Revoke, remove the Zenflow calendar and forget the links |
| POST | `/google-calendar/webhook` | Public. Google's push; the channel token proves the sender |
| GET | `/users/me/insights` | `from`, `to` as `YYYY-MM-DD` (default last 7 days, max 92 inclusive); focus grid and recap for the window, buffers for exams and assignments due in the next 30 days (`InsightsResponse`) |

- `timezone` is set at signup (`x-timezone`) and editable. Changing it re-keys recurring `exdates`.
- `defaultReminderMinutes`: 0 none, default 10.
- Signup does not create `DND` blocks. Mobile onboarding creates 3 daily `DND` routines (sleep, lunch break, dinner).

## Sessions (`/sessions`)

Drag, resize and reschedule are all `PATCH /sessions/:id` (a `MOVE` signal).

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/sessions` | Create. `TASK` takes the best free slot (or a materialized series). Fixed and `DND` take the given time and optional `rrule` |
| GET | `/sessions?view=&date=` | `day`, `week` or `month` window plus unplaced. Series fan out to virtual rows |
| GET | `/sessions/suggestions?q=&limit=` | Title autocomplete, newest first |
| GET | `/sessions/search?q=&anchor=&cursor=&direction=&limit=` | Search title, note text, location and tags. Pages by start time from `anchor` (default now) |
| GET | `/sessions/deadline-options?anchor=` | Six deadline quick-chip instants |
| GET | `/sessions/:id` | Detail. Occurrence id: `<seriesId>::<startISO>` (URL-encoded) |
| PATCH | `/sessions/:id` | Metadata, drag, resize, `rrule`. `scope` and `skipConflicting` narrow a recurring-series change |
| DELETE | `/sessions/:id` | Soft-delete. On an occurrence id, adds to `exdates` |
| DELETE | `/sessions/series/:seriesId` | Delete the series |
| DELETE | `/sessions/series/:seriesId/truncate?from=` | Recurring: pull `UNTIL` back ("this and following") |
| DELETE | `/sessions/series/:seriesId/from/:sessionId` | Materialized `TASK` series: delete that sitting and later ones |
| DELETE | `/sessions/timetable-group/:sessionId[/from]` | Portal `LECTURE`s only: soft-delete a section's meetings |
| POST | `/sessions/timetable-group/:sessionId/skip` | Portal `LECTURE`s only: skip every meeting in the section. `{ skippedSessionIds }` |
| POST | `/sessions/timetable-group/:sessionId/skip/from` | Portal `LECTURE`s only: skip that meeting and every later one. `{ skippedSessionIds }` |
| POST | `/sessions/placement/confirm` | `{ planId }`: apply a plan the scheduler held for confirmation. Atomic, single use. `201` with `{ session, displacedSessions, undoGroupId }`. `409 PLACEMENT_STALE` when the plan no longer holds |
| POST | `/sessions/undo/:groupId` | Revert every move and create of one undo group. `201` with `{ undoGroupId, restored, removedSessionIds, skippedSessionIds }` |
| POST | `/sessions/:id/slot-pick` | `{ slotProposalId, chose }`: record a pairwise A/B pick ([ab-testing](../scheduler/ab-testing.md)). An `alternative` pick returns `undoGroupId` |
| POST | `/sessions/:id/start` | Record that the app is open inside a placed task's slot. One per slot. Returns `{ recorded }` |
| POST | `/sessions/:id/skip` | Mark a non-TASK session skipped. Writes no event. TASK returns `400`. Idempotent. Accepts `scope` on an occurrence |
| DELETE | `/sessions/:id/skip` | Undo a skip. Same rules |

- **Placement reason (#254):** `placementReason` (`PREFERRED_HOUR` | `BEFORE_DEADLINE` | `ONLY_FREE_SLOT` | `NEAR_CLASS` | `MOVED_FOR_DEADLINE` | `BEST_AVAILABLE`, or `null`) says why the scheduler picked the start. It is `null` once the start has moved, or for a fallback placement. See [bandit placement](../bandit/placement.md#reason-codes).
- **Confirmation:** a create or deadline change whose only plan moves a `CHOSEN` session is not applied.
  - `POST /sessions` answers `409` with `code: "NEEDS_CONFIRMATION"` and `data.plan` (`{ id, sessionId, start, moves[], expiresAt }`). Confirm with `POST /sessions/placement/confirm`.
  - A deadline `PATCH` answers `200` with `placementPlan` set. The session keeps its start; the deadline is saved.
- **Occurrence move:** `PATCH /sessions/<seriesId>::<startISO>` with `scope: "occurrence"` and a `scheduledStartTime` or `durationMinutes` change excludes that occurrence from the series and returns it as a one-off `Session`. The series keeps its time. Metadata stays series-wide, and a PATCH that also sends `rrule` is a series change.
- **Undo:** each request that moves sessions returns `undoGroupId`. `POST /sessions/undo/:groupId` reverts that group only. A create in the group is removed (soft delete).
- **Sync conflicts:** `POST /notifications/:id/reschedule-conflicts` re-places each conflicting task. Its `undoGroupId` covers the call.
- **Infeasible deadline:** displacement repacks flexible tasks on the deadline day (EDF, `SYSTEM_MOVE` events, `displacedSessions[]`).
- If that fails: `409 SCHEDULE_INFEASIBLE` with `options: ["ACCEPT_CONFLICTS","ACCEPT_LATE_DEADLINE"]`. The client retries with `infeasiblePolicy`.
- Every `Session` carries `late: boolean`.
- **Search:** every word of `q` must match, ignoring case and accents (including đ); empty `q` lists all. `direction` is `forward` (start at or after) or `backward` (before); each page is ascending.
- Search returns `{ sessions, nextCursor }`; pass `nextCursor` with the same `direction`. Recurring series add occurrences up to a year past the cursor once stored rows run out. Unscheduled rows are skipped.
- **Skipped:** every `Session` carries `skipped`. Skip routes return `SessionSkipResponse` (`{ session }`) and accept an occurrence id. The representative row id of a recurring series is a 400. Learning signals are START and MOVE only ([ADR-0035](../adr/0035-start-and-move-only-signals.md)).

## Integrations (`/integrations`)

A student's LMS or portal login for ingestion. Credentials are never returned.

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/integrations` | Connect `{ provider, username, password }`: live-login probe, then encrypt and upsert. 400 `STUDENT_ID_MISMATCH` when a `@dlu.edu.vn` account sends a username other than its own student ID |
| GET | `/integrations` | `[{ provider, connected, lastVerifiedAt, lastSyncedAt, lastSyncStatus, lastSuccessAt, failing }]` |
| PATCH | `/integrations/:provider` | Update credentials (same student ID rule, probe, then write) |
| DELETE | `/integrations/:provider` | Disconnect. Idempotent, keeps the encryption key |
| POST | `/integrations/:provider/sync` | Queue fetch jobs and wait up to `SYNC_MANUAL_WAIT_MS` |

- `lastSyncedAt`: newest run, any outcome. `lastSuccessAt`: when every data pass last came back clean (show as "last synced"). `failing`: a data pass has consecutive failures.
- Sync responses: `200` or `201` with status, `202` with `syncPending: true` if still running, `404` not connected, `409` already running, `429` + `Retry-After` in cooldown, `502` a pass failed, `503 UPSTREAM_UNAVAILABLE` + `Retry-After` while the breaker is open.
- Limits: [ingestion.md](ingestion.md#manual-sync).

## Notifications (`/notifications`)

The ingestion inbox, written by the materializer. `eventName` (for example `assignment.created`) is the only machine-readable class. Clients derive `CREATED`, `UPDATED`, `REMOVED`, `CONFLICT` and category with `@zenflow/shared` helpers.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/notifications?limit=&offset=` | Newest first. `unreadCount` covers the whole inbox |
| PATCH | `/notifications/:id/read` | Stamp `readAt` |
| PATCH | `/notifications/:id/action-taken` | Stamp `actionTakenAt` |
| DELETE | `/notifications/:id` | Dismiss (hard delete) |
| POST | `/notifications/:id/reschedule-conflicts` | `*_CONFLICT` rows: re-place every clashing task (EDF) |
| GET | `/notifications/stream` | `@Sse` live feed |
| POST | `/notifications/dev/raise` | Dev only (404 in production) |

- Copy follows `User.lang` (`VI_VN` or `EN_US`) for inbox, SSE, push and OTP email (new addresses get English). Rows keep canonical English and are translated on delivery. Templates: [`localize-notification.ts`](../../backend/src/notifications/localize-notification.ts).
- SSE crosses processes over Redis pub/sub ([ADR-0018](../adr/0018-redis-pubsub-instance.md)). Delivery is at-most-once, so clients refetch on reconnect and dedupe by notification id.
- `NotificationsService.notify()` publishes to SSE and enqueues one `push` job per provider on `notify` (job id from the row id). A watcher sweep re-enqueues rows with no job.
- Test without a sync: `pnpm --filter backend exec ts-node scripts/send-test-notification.ts <userId> [count]`.

## Devices (`/devices`)

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/devices` | Register or refresh one device (`RegisterDeviceInput`). Upserts on `pushToken`. Returns `{ id }` |
| DELETE | `/devices` | Unregister by `pushToken`. Idempotent |

- `platform` is `IOS`, `ANDROID` or `WEB`. A `WEB` row needs an `https` `pushToken` (the subscription endpoint) and non-empty `p256dh` and `auth`. Native platforms omit the keys.
- Push runs as `notify:push` jobs in `worker-notify` (backoff, then `notify.dlq`; `fcm`, `apns` and `web` breakers). A provider with no env is disabled. Dead tokens are pruned on send.

## Rate limits

LimitKit, helper `slidingWindowRule()` in `common/rate-limit/`. Env: [config.md](config.md#rate-limits).

| Endpoint | Rule (sliding window) | Over limit |
| --- | --- | --- |
| `POST /auth/otp/request` | IP 5/min and 20/h, email 3 per 15 min | `429` |
| `POST /auth/otp/verify` | IP 20/min, email 10 per 10 min | `429` |

- The email key is normalized (trim, lower-case, `+tag` stripped, Gmail dots dropped).
- Manual sync is a cooldown, not a LimitKit rule: [ingestion.md](ingestion.md#manual-sync).
- **Fail open:** `ResilientStore` (`common/rate-limit/resilient-store.ts`) races each call against `RATE_LIMIT_STORE_TIMEOUT_MS` (250). A timeout or error allows the request.
  - A `CircuitBreaker` (`common/circuit-breaker.ts`) opens after 5 failures, probes after 15 s, backs off to 60 s.
  - Warnings: one per 30 s. Counter `rate_limit.store.fail_open` has a `reason` label.
  - Tests use the in-memory store.
- Eviction and persistence: [ADR-0005](../adr/0005-rate-limit-store-lru-rdb.md).
