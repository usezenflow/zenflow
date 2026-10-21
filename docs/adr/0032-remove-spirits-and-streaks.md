# ADR-0032: Remove spirits and streaks

**Status:** accepted
**Date:** 2026-10-19
**Issue:** none

## Context
- Few students used the Zendeck tab or kept a streak, and the perks it promised were never built.
- Both added tables, a module and a package that every start and check-off touched.

## Decision
- Remove the spirits module, `Egg`, `Spirit` and `SparkLedger`, `@zenflow/spirits`, the Zendeck tab and its API.
- Remove the streaks module, `UserStreak`, `GET /users/me/streak` and the badge.
- `POST|DELETE /sessions/:id/complete|skip` return `{ session }` only.
- Supersedes ADR-0026.

## Consequences
- Old app builds that read `streak` from a check-off get `undefined` and show no badge.
- Hatched spirits and streak history are dropped by the migration `drop_spirits_and_streaks`.

**Addendum (2026-10-21, ADR-0035):** ADR-0035 removes the check-off routes and COMPLETE events. The skip route stays for non-TASK sessions.
