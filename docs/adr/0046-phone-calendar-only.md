# ADR-0046: Phone calendar only, no web app

**Status:** accepted
**Date:** 2026-10-26
**Issue:** none

## Context
- Google Calendar sync needs a verified OAuth client, which needs a Workspace account the project does not have.
- The mobile app already writes the schedule to the phone calendar and holds login, setup and settings.
- The PWA only did login, onboarding, settings and the assistant consent screen.

## Decision
- Supersedes [ADR-0040](0040-google-calendar-sync.md) and the web app in [ADR-0039](0039-thin-layer-calendar-native.md). The calendar is the phone's; `calendarTarget` is `NONE` or `DEVICE`.
- Removed: `backend/src/google-calendar/`, the `calendar-sync` queue and `outbox` role, discovery pushes, MCP `sync_status` and session `attendees`, `GOOGLE_*` env vars, `CalendarConnection`, `CalendarLink`, `CalendarSyncOutbox`, and the `GOOGLE` enum values.
- `pwa/` is archived at tag `archive/pwa`.
- Supersedes the consent screen in [ADR-0041](0041-mcp-oauth.md). `authorize` redirects to `GET /api/v1/oauth/connect`, a public page that shows an 8 character code and polls `/status`. The signed-in app enters the code (`GET`/`POST /oauth/consent`, `{ code, approve }`), and the page then redirects the browser with the one-time code. `OAuthConsent` gains `userCode`, `request` and `redirectUrl`.
- The MCP server icon is an inline SVG, not a hosted file.

## Consequences
- No browser login for assistants, and no web client to maintain.
- Web Push has no client. Its backend code remains.
- Approval needs the app, signed in, on a phone.
- Migration `drop_google_calendar` deletes Google busy blocks and resets Google targets to `NONE`; `oauth_user_code` drops pending consent requests.
