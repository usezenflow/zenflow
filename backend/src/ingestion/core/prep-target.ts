import type { PrepKind } from "@zenflow/shared";
import type { ParsedBlock } from "./types";

/**
 * Which new upstream items get an automatic prep plan (level-up plan, Phase 1).
 *
 * Only exams and assignments qualify. Lectures never do. The item's start is its
 * deadline.
 */
export interface PrepTarget {
  kind: PrepKind;
  deadline: Date;
}

export function prepTargetOf(
  block: Pick<ParsedBlock, "type" | "scheduledStartTime">,
  now: Date,
): PrepTarget | null {
  if (block.type !== "EXAM" && block.type !== "ASSIGNMENT") return null;
  if (block.scheduledStartTime.getTime() <= now.getTime()) return null;
  return { kind: block.type, deadline: block.scheduledStartTime };
}
