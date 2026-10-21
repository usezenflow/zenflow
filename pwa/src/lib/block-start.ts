import type { Session } from "@zenflow/shared";
import { recordSessionStart } from "@/api/tasks";

/** A TASK whose slot the given instant falls in. Only these record a START. */
export function isInPlacedBlock(
  session: Pick<Session, "type" | "scheduledStartTime" | "durationMinutes">,
  now: number,
): boolean {
  if (session.type !== "TASK" || !session.scheduledStartTime) return false;
  const start = new Date(session.scheduledStartTime).getTime();
  return now >= start && now < start + session.durationMinutes * 60_000;
}

const sent = new Set<string>();

/**
 * Records a START for each placed block the instant falls in. One request per
 * slot; a failed request is retried on the next check.
 */
export function recordBlockStarts(sessions: Session[], now = Date.now()): void {
  for (const s of sessions) {
    const key = `${s.id}|${s.scheduledStartTime}`;
    if (sent.has(key) || !isInPlacedBlock(s, now)) continue;
    sent.add(key);
    recordSessionStart(s.id).catch(() => sent.delete(key));
  }
}
