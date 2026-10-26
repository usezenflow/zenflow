# ADR-0033: Web Push as a device platform

**Status:** superseded by [ADR-0047](0047-ntfy-push.md)
**Date:** 2026-10-20
**Issue:** none

## Context
- Push reached only native apps (FCM, APNs). The PWA had no way to get a notification while closed.
- A Web Push subscription is an endpoint URL plus two keys (`p256dh`, `auth`) that encrypt each payload.

## Decision
- `DevicePlatform` gains `WEB`. The subscription endpoint is stored in `UserDevice.pushToken`, so the unique upsert key and the dead-token prune work unchanged.
- `UserDevice.p256dh` and `UserDevice.auth` (nullable) hold the keys. They are set on `WEB` rows only. Migration `20261020120000_web_push_device`.
- `RegisterDeviceInput` carries `p256dh` and `auth`, `string | null`. The DTO requires them, non-empty, when `platform` is `WEB`. A `WEB` endpoint must be `https`.
- The VAPID public key is not secret. The web build reads it from `VITE_VAPID_PUBLIC_KEY`, so the API serves no key endpoint.
- `WebPushSender` uses the `web-push` package with `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT`. It self-disables without all three. Status 404 and 410 prune the endpoint.
- Every notification enqueues a `web` push job beside `fcm` and `apns`, under its own breaker.

## Consequences
- Rotating `VAPID_PRIVATE_KEY` invalidates every subscription. Browsers resubscribe.
- Any `https` endpoint a user registers is contacted by the API. Endpoint allowlisting is not done.
- Native clients send no keys and keep working unchanged.
- Each notification enqueues one more push job.
