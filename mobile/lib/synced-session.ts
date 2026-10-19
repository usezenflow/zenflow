import type { Session } from "@zenflow/shared";

const SYNCED_TYPES: ReadonlySet<Session["type"]> = new Set(["LECTURE", "EXAM", "ASSIGNMENT"]);

/**
 * A timetable, exam or assignment written by the portal or LMS. The upstream
 * owns its time, title and place, so the student skips or completes it.
 */
export function isSyncedSession(session: Pick<Session, "source" | "type"> | null | undefined): boolean {
  return !!session && (session.source === "LMS" || session.source === "PORTAL") && SYNCED_TYPES.has(session.type);
}
