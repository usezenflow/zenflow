# ADR-0049: iOS local notification poll

**Status:** accepted
**Date:** 2026-10-28
**Issue:** none

## Context
- APNs needs a paid Apple Developer account. A free Apple ID (SideStore) cannot carry the push entitlement.
- Every push is server triggered; none is scheduled by time. Timed reminders already come from calendar event alarms ([ADR-0046](0046-phone-calendar-only.md)).

## Decision
- Amends [ADR-0033](0033-web-push.md) and ADR-0046. Backend push code is unchanged; APNs stays inert while `APNS_*` is unset.
- Mobile build env `APNS_ENABLED=true` sets `extra.iosRemotePush`. Default is off.
- iOS with it off registers no token. It runs an `expo-background-task` poll of `GET /notifications` and posts each new unread row as a local notification.
- The last seen `sentAt` is kept in SecureStore. The first run only seeds it. The SSE handler advances it so a foreground toast is not repeated.
- Android is unchanged.

## Consequences
- Server alerts on iOS are best effort. iOS picks when the task runs (at best hourly) and skips it after a force quit.
- Calendar alarms are unaffected and fire reliably.
- Notification action buttons (Reschedule, Keep, Prefer) still work on local notifications through the same categories.
