# ADR-0047: Push through self-hosted ntfy

**Status:** accepted
**Date:** 2026-10-26
**Issue:** none
**Supersedes:** [ADR-0033](0033-web-push.md), [ADR-0034](0034-pwa-offline-calendar-cache.md)

## Context
- APNs needs the paid Apple Developer Program. Zenflow ships IPAs by free sideloading, so iOS gets no remote push.
- The ntfy iOS app and its relay already hold the APNs entitlement.
- The PWA is archived ([ADR-0046](0046-phone-calendar-only.md)), so web push has no client.

## Decision
- One delivery path. APNs, FCM and Web Push senders and their env vars are removed.
- The app generates a random topic, keeps it in SecureStore and registers it as `UserDevice.pushToken`. The topic is the secret.
- `NtfySender` posts to `{NTFY_BASE_URL}/{topic}` with title, body, priority and a `Click` deep link, authenticated with `NTFY_TOKEN`.
- ntfy runs as the `ntfy` service in `backend/compose.prod.yml` and `compose.staging.yml`, behind nginx at `ntfy.usezenflow.com`. Config: [`backend/ntfy/server.yml`](../../backend/ntfy/server.yml).
- `upstream-base-url: https://ntfy.sh` lets the free relay wake iOS with content-free pings. `auth-default-access: deny-all`; `zenflow-publisher` has write-only access, `zenflow-reader` read-only access for the subscribe link.
- Env vars: backend `NTFY_BASE_URL` and `NTFY_TOKEN`; ntfy container `NTFY_AUTH_USERS` and `NTFY_AUTH_TOKENS` (Vault set `ntfy`).

## Consequences
- Notifications come from the ntfy app. Tapping one opens Zenflow through the deep link.
- Students install ntfy and subscribe once. Android needs no Google services (F-Droid build).
- The `WEB` enum value stays; `p256dh` and `auth` are dropped by migration.
- The ntfy.sh relay has rate limits on poll pings. Check them against the student count.
