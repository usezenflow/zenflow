import type { Session, SessionType } from "@zenflow/shared";
import { isZonedToday, zonedDate } from "./tz";

/** Session types the Today card lists. DND blocks are protected time, not work. */
export const TODAY_TYPES: readonly SessionType[] = ["TASK", "ASSIGNMENT", "EXAM", "LECTURE"];

export interface TodayItem {
  id: string;
  title: string;
  type: SessionType;
  start: Date;
  end: Date;
  durationMinutes: number;
}

export interface TodayView {
  /** The open session to do now or next, or `null` when nothing is left today. */
  next: TodayItem | null;
  /** Open sessions after `next`, in start order. */
  later: TodayItem[];
}

/**
 * The Today card's model. Lists today's (user-tz) sessions that are not
 * skipped, and splits them into the next open one and the rest. A session is
 * open until its end, so an in-progress one stays `next`.
 */
export function buildToday(sessions: Session[], now: Date, tz: string): TodayView {
  const items: TodayItem[] = [];

  for (const s of sessions) {
    if (!TODAY_TYPES.includes(s.type)) continue;
    if (s.scheduledStartTime === null || s.skipped) continue;
    const start = new Date(s.scheduledStartTime);
    if (!isZonedToday(zonedDate(start, tz), tz)) continue;
    const end = new Date(start.getTime() + s.durationMinutes * 60_000);
    if (end.getTime() <= now.getTime()) continue;
    items.push({
      id: s.id,
      title: s.title,
      type: s.type,
      start,
      end,
      durationMinutes: s.durationMinutes,
    });
  }

  items.sort((a, b) => a.start.getTime() - b.start.getTime());
  return {
    next: items[0] ?? null,
    later: items.slice(1),
  };
}
