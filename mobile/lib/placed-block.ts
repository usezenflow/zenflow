import type { Session } from "@zenflow/shared";

/** Whether `now` falls inside a placed task's slot, `[start, end)`. */
export function isInPlacedBlock(
  session: Pick<Session, "type" | "scheduledStartTime" | "durationMinutes">,
  now: number,
): boolean {
  if (session.type !== "TASK" || !session.scheduledStartTime) return false;
  const start = new Date(session.scheduledStartTime).getTime();
  return now >= start && now < start + session.durationMinutes * 60_000;
}
