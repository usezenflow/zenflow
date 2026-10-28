# ADR-0043: Delete signal

**Status:** proposed
**Date:** 2026-10-26
**Issue:** none

## Context
- [ADR-0042](0042-kept-and-moved-signals.md) learns from KEPT and MOVE. A user who deletes a placed TASK produces no signal today, because deleted rows are excluded from the KEPT sweep.
- A delete says "not needed". Its reasons (class cancelled, done early, duplicate, re-asked through chat, mistake) are mostly independent of the slot, so it is weaker evidence than a move, which says "not here, there".
- Deletes can now come from the app, Google or the phone, so each one needs a source and a timing.

## Decision
- A delete is a signal only for a LinUCB-placed TASK with source USER or AUTO that was never moved. Everything else scores 0: system, ingestion or conflict deletes, other types, replaces (a session with the same title within 60 minutes), deletes after the slot began, deletes under 60 minutes before start, and deletes more than 24 hours after placement.
- Reward on the LinUCB arm: `DELETE_REWARD = -0.25`, equal to a 60 minute move (60 / 240). Heuristic placements update the preference matrix only, with `PREFERENCE_KEPT_WEIGHT x DELETE_REWARD = -0.0625` on the deleted slot, and only in the simulator.
- Shadow mode ships first: `DELETE_REWARD_ENABLED = false`, `PREFERENCE_DELETE_WEIGHT = 0`. The `DELETE` event stores the would-be reward in `SessionEvent.reward` and leaves `(A, b)` and the matrix alone. Each `DELETE` also stores its type, source, minutes to start, minutes since placement, placed-by-bandit flag and replaced flag.
- Enabling the arm reward needs the offline evaluation to pass. Arms: L (no delete signal), L+D(-0.1), L+D(-0.25), L+D(-0.5). The simulator's students delete with `p_delete = p_noise + p_slot`, where `p_noise` is slot independent and `p_slot` grows with the utility gap. The gate: L+D(-0.25) is not worse than L at 0 and 20 % noise (lower bound of the cluster-bootstrap CI no worse than -0.5 pt, Holm-corrected), and better when deletes depend on the slot. Otherwise deletes stay logged only.
- Priors are not measurements. The numbers are revisited once shadow data exists.

## Consequences
- The learner stays unchanged until the gate passes. Shadow data shows the delete rate by timing bucket before any reward is applied.
- The `DELETE` change-log row (Phase 3, `SessionEventType.DELETE`) becomes the evidence source. Its fields must be stored from the first write.
- Students move and delete placed plans, including exam and assignment prep. Synced timetable items, exams and assignments are fixed. The simulator never moves or deletes them.
- Migration: none beyond the change log. Existing `SessionEvent` rows keep `reward` as null.
