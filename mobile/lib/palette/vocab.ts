import type { SessionType } from "@zenflow/shared";

/** Default length in minutes when nothing was stated and the title has no history. */
export const DEFAULT_MINUTES: Record<SessionType, number> = {
  TASK: 60,
  ASSIGNMENT: 60,
  EXAM: 120,
  LECTURE: 90,
  DND: 60,
};
