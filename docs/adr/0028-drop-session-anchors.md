# ADR-0028: Drop session anchors

**Status:** accepted
**Date:** 2026-10-19
**Issue:** none

## Context
- Students rarely drag or pin plans, so `CHOSEN` and `PINNED` ([ADR-0022](0022-anchor-levels-and-cost-based-displacement.md)) added state nobody sets and a confirmation step nobody wants.

## Decision
- Remove `Session.anchor`, `Session.anchoredAt` and the `SessionAnchor` enum (migration `drop_session_anchor`).
- Remove `POST` and `DELETE /sessions/:id/pin`, `SessionAnchorService`, and the `anchor` fields on `Session`, `PlacementPlanMove`, `PlacementFlexible` and `PlacementMove`.
- Remove `chosenMoves` from `InfeasibleContext`. Every flexible plan moves freely unless frozen (completed, started or starting within 2 h).
- Move cost is 1 plus hours moved, plus 10 when the local day changes. The cascade runs once, in deadline order.
- Python no longer returns `NEEDS_CONFIRMATION`. The plan store, confirm route and Make room sheet stay in place but are unreachable.

## Consequences
- Supersedes ADR-0022. A time the user sets by hand can later be moved to make room.
- Follow up: remove `PlacementPlan`, `POST /sessions/placement/confirm` and the Make room sheet.
