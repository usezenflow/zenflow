# ADR-0026: Spirit eggs hatch from starts

**Status:** superseded by ADR-0032
**Date:** 2026-10-18

## Context

The Spirits tab rewards the habit loop: starting a block is the hard part, so
the reward follows the start, not the check-off (ADR-0025). Sparks must not be
farmed by starting the same block repeatedly, and the roll must not be
predictable from the client.

## Decision

- **Sparks** come from `START` session events (ADR-0025). Settling happens on
  read in `GET /spirits`, so the scheduler is untouched. Each start grants at
  most one spark (`SparkLedger.sessionEventId` is unique), and at most three
  sparks per user day in the user's timezone.
- **Prep plans** also spark: a `COMPLETE` event on a session with
  `prepForSessionId`, checked off at or after its slot start. One spark per plan
  (`SparkLedger.sessionId` is unique per user), sharing the daily cap. Prep
  plans are excluded from outcome settlement, so they do not feed the bandit.
- **Assignments** spark when an ingested one (LMS) is completed. A prep plan for an
  assignment shares the assignment's `SparkLedger.sessionId`, so the pair pays one
  spark. A student-made assignment never sparks.
- **Egg** takes five sparks to become `READY`. The first egg counts starts
  from account creation, inside a 14 day window. Later eggs count from their
  own creation.
- **Hatch** (`POST /eggs/:id/hatch`) rolls a species with HMAC-SHA256 over
  `userId:eggId` keyed by `SPIRIT_ROLL_SECRET`. A species' chance is
  proportional to `1 / rarity weight`. After ten hatches without a legendary,
  the next roll is forced to a legendary.
- **Power** is the sum of rarity weights over distinct owned species, computed
  server side. Perk thresholds come from `docs/mobile/spirits.md`.
- **Tables:** `Egg`, `Spirit`, `SparkLedger` (migration `20261018120000_spirits`).
- **Contract:** `SpiritsResponse`, `SpiritHatchResponse` in `@zenflow/shared`.
- **Env:** `SPIRIT_ROLL_SECRET`, required when `NODE_ENV=production`.

## Consequences

- Starts before the Spirits tab was first opened still count, within 14 days.
- Rolls are reproducible for a given egg and secret, which makes them testable,
  but the secret must stay server side and rotate only with a migration plan.
- Changing the roll weights changes outcomes for unhatched eggs.
- Equip and the abilities' effects are not built. The companion is the
  strongest owned spirit, and abilities show as coming soon.

**Addendum (2026-10-21, ADR-0035):** ADR-0035 removes check-off as a signal. This record was already superseded by ADR-0032.
