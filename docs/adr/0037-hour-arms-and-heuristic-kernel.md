# ADR-0037: Hour arms and the heuristic kernel as the live A/B

**Status:** accepted
**Date:** 2026-10-22
**Issue:** none

## Context
- The six time-of-day arms (ADR-0012) cap the hour resolution of LinUCB. The offline study ([report](../scheduler/offline-eval-report.md)) found 24 start-hour arms with a kernel update (L24N) beat the six-band model by +3.8 points on fresh seeds 500 to 599, and beat a heuristic that also has the kernel (H+K) by +7.5.
- H+K is the fair heuristic control: the same kernel and weekday pooling on the heuristic's preference matrix. It beats the plain heuristic by +3.2 points, so any comparison against H must name which H.
- The production database holds no data, so arm state can be replaced without migrating learned values.

## Decision
- **Arms.** `SchedulingArm` has 24 values, `HOUR_00` to `HOUR_23`, one per local start hour. A slot is scored by the UCB of its start hour, plus the gap, deadline and stability terms (`services/bandit/src/core/linucb_best_slot.py`).
- **Kernel.** A reward at hour `h` updates every hour arm, weighted by a circular Gaussian of width 0.75 hours (`services/bandit/src/core/hour_arms.py`). The context is divided by its L2 length before scoring and each update.
- **Prior.** A cold arm starts at its matrix prior (`matrix_prior`), per hour.
- **Heuristic kernel.** START and MOVE matrix updates spread over neighbouring hours (width 0.75) and the same weekday group (pool 1.0). The Python core (`reinforce_preference_smooth`) and the frozen TypeScript fallback (`backend/src/scheduler/core/preference.ts`) use the same rule.
- **Live A/B.** `SchedulingModel.HEURISTIC` is H+K and `SchedulingModel.LINUCB` is L24N. The 50/50 split in `ExperimentService` is unchanged.
- **Hybrid model removed.** The shared `beta` head and its cross features are removed from the contract, the placer and the stored state.
- **Contract deltas.**
  - `/v1/update` takes `arms` (all 24) and `arm` (the played hour). It returns `arms` (all 24).
  - `/v1/init` takes `ridge` only and returns 24 arms.
  - `/v1/place` `bandit.state` holds all 24 arms. `LinucbPick` has no `crossFeatures`.
  - `@zenflow/shared`: `SCHEDULING_ARMS` has 24 values. `BanditUpdateRequest` and `BanditUpdateResponse` carry `arms`.
- **Prisma.** `SchedulingArm` has 24 values. `BanditArmState` loses `version`. Migration `20261022130000_hour_arms` deletes arm state and clears `SlotProposal.selectedArm`.
- **Model version.** `ARM_LAYOUT` is `hours24-v1`, stamped into `paramsVersion` and checked by the backend.

## Consequences
- Easier: one arm per hour matches the kernel's resolution; the update is a single overwrite of 24 rows.
- Harder: each student stores 24 arms of `d·d + d` floats, 1,344 numbers at `d = 7`. The arm labels in `SlotProposal` before this change are cleared, so the old six-band analysis cannot be re-run from the database.
- The six-band model (L6) is no longer in production. Its results stay in the offline report and in git history.
- The placement harness `L` arm now runs the production placer, so it is L24N. Earlier L6 numbers come from the pre-port code.
- The frozen fallback now carries the H+K rule. A change to the rule must be made in Python and in `preference.ts`, and the golden fixtures must agree.
- Migration: none for existing users, since production holds no data. Any database that already has six-band rows must run the migration, which discards them.
