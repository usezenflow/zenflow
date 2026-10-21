# ADR-0036: One broad default matrix, no onboarding band, wider deadline reach

**Status:** accepted
**Date:** 2026-10-21

## Context
- The onboarding "when do you focus best?" answer seeded the preference matrix and LinUCB's cold arms. A university timetable forces study in the morning, afternoon and evening, so the answer adds little and costs a screen.
- The old default matrix peaked once at 09 to 11 and rated midday, late afternoon and evening near zero.
- Gap quality helped only the night student the band came from.
- A deadline penalty over the last 24 hours left blocks hugging the deadline.

## Decision
- One default matrix on both stacks (`backend/src/scheduler/core/preference.ts`, `services/bandit/src/core/preference.py`): weekday humps at 09 to 12 and 19 to 22, a dip after lunch, a weekend at 0.7x and one hour later.
- LinUCB cold arms start from that matrix (`src/core/matrix_prior.py`), 0.5 pseudo observations at each of a weekday and a weekend context.
- `focusBand` is removed from the schema, API, shared types and both onboarding flows. The quiet window is always 23:00 to 06:00.
- Onboarding keeps the LMS and portal, home location and notifications steps. The tags step is removed.
- `LINUCB_GAP_WEIGHT` is 0.
- LinUCB's deadline penalty reaches 48 hours (`LINUCB_DEADLINE_HORIZON_HOURS`). The heuristic keeps 24 hours.
- Migration `20261021110000_drop_user_focus_band` drops the column and enum. It is destructive and irreversible. Back up first.
- Four contract fixtures under `packages/shared/contract/place` and `tests/fixtures/golden/preference.json` are regenerated.

## Consequences
- Students inside the matrix humps gain; students outside them lose against cold LinUCB. See the [report](../scheduler/offline-eval-report.md).
- The deadline term costs simulated starts, since the simulated student opens the app near a deadline. It cuts blocks ending within 24 hours of a deadline from 16% to 3%.
- Existing users keep their stored matrices. Only empty or malformed ones fall back to the new default.
- Deploy backend and bandit together: the placer no longer accepts `focusBand`.
- Follow up: replace the matrix with a cohort prior at 20 students with data.
