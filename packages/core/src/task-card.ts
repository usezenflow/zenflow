import type { SessionCardState, SessionType } from "@zenflow/shared";

interface StateInput {
  type: SessionType;
}

/**
 * Derive the visual card state for a session (see docs/design-system.md).
 *
 * The state is a pure function of the session `type` — there is no completion
 * or "overdue" lifecycle. Each fixed type gets its own colour so an
 * assignment, an exam and a lecture read as three different things rather than
 * one undifferentiated "fixed" slate; `DND` blocks get the muted
 * blocked-time treatment. A past-deadline session is NOT special-cased here —
 * it simply renders in its type colour. "conflict" isn't derived here either —
 * {@link withOverlap} folds it in afterward from a real client-side overlap
 * check.
 */
export function deriveState(t: StateInput): SessionCardState {
  switch (t.type) {
    case "DND":
      return "dnd";
    case "ASSIGNMENT":
      return "assignment";
    case "EXAM":
      return "exam";
    case "LECTURE":
      return "lecture";
    default:
      return "fluid"; // TASK — the only flexible, auto-scheduled type
  }
}

/**
 * Fold a manually-created overlap into a card's state. Two sessions scheduled
 * on top of each other are a conflict, so they render with the conflict
 * treatment — unless the card is a DND block (protected time can sit under a
 * live session without it being a clash).
 */
export function withOverlap(
  state: SessionCardState,
  overlapping: boolean,
): SessionCardState {
  if (!overlapping || state === "dnd") return state;
  return "conflict";
}
