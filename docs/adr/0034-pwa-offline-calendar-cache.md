# ADR-0034: PWA offline calendar cache (IndexedDB, read-only)

**Status:** accepted
**Date:** 2026-10-20
**Issue:** n/a

## Context
The pwa precaches the app shell only. Calendar data comes from the API on every load, so a reload offline shows
an error and a returning user is sent to `/login`, because `WithAuth` cannot reach `GET /auth/me`. The mobile app
solved this in [ADR-0006](0006-mobile-offline-calendar-cache.md) with a read-only cache. The web app follows the
same rules.

## Decision
- Persist fetched day, week and month views to IndexedDB (`idb-keyval`, store `zenflow-offline`). Keys are
  namespaced by user id. Capped at 160 entries and 30 days, oldest first.
- Persist the signed-in user to the same store. `WithAuth` uses it when `GET /auth/me` fails without an HTTP answer
  or with a 5xx. A 401 or 403 still signs out and wipes the cache.
- The calendar paints saved data first, then revalidates. A failed fetch with saved data on screen keeps it and
  shows an offline banner instead of an error toast.
- Warm the cache on mount and on `online`: previous, current and next month, and each day of the current week
  (`lib/offline/warm-calendar.ts`).
- Offline is read-only. Writes fail through the existing save-error path. No offline queue.
- Precache fonts and the web manifest, so the shell and Geist load offline.
- Logout wipes the cache. Not encrypted: it holds the user's own schedule, and the session cookie stays HTTP-only.
- No API, `@zenflow/shared` or backend change.

## Consequences
- A reload offline renders the app with the last-seen days. Cold start offline does not reach `/login` for a user
  who has signed in on this device.
- A schema change bumps the cache key prefix, which drops old data.
- Edits made offline fail. A mutation queue needs its own design, as in ADR-0006.
- Private windows and blocked storage: the cache calls are wrapped, and the app runs without it.
