import { addDays, addMonths, isAfter, startOfDay } from "date-fns";
import {
  deadlineOf,
  notBeforeOf,
  repeatEnd,
  repeatOf,
  type Understood,
} from "./understand";

/** Furthest deadline a line may ask for. */
export const MAX_DEADLINE_MONTHS = 3;

/**
 * Something a line asks for twice over, or too far out:
 * - far: the deadline is past `MAX_DEADLINE_MONTHS`
 * - repeatSplit: a repeat and blocks cannot both apply
 * - endBeforeStart: the earliest start (or first repeat) is not before the end
 */
export type Clash = "far" | "repeatSplit" | "endBeforeStart";

/** End of the last day a deadline may fall on. */
const lastDay = (now: Date) =>
  addDays(startOfDay(addMonths(now, MAX_DEADLINE_MONTHS)), 1);

/** The end a line states: the repeat's last day, or the deadline. */
const endOf = (u: Understood, now: Date) =>
  u.repeat ? repeatEnd(u) : deadlineOf(u, now);

export function clashOf(u: Understood, now: Date): Clash | null {
  const end = endOf(u, now);
  if (end && isAfter(end, lastDay(now))) return "far";
  if (u.repeat && (u.split ?? 0) >= 2) return "repeatSplit";
  if (!end) return null;
  if (u.repeat) {
    const rep = repeatOf(u, now);
    return rep?.start || rep?.deadlines.length ? null : "endBeforeStart";
  }
  const first = notBeforeOf(u, now);
  return first && first >= end ? "endBeforeStart" : null;
}

/** The line with the chosen reading kept and the other dropped. */
export function settle(
  u: Understood,
  keep: "nudge" | "end" | "start" | "repeat" | "split",
  now: Date,
): Understood {
  const clock = u.repeat ? u.time : undefined;
  switch (keep) {
    case "nudge":
      return {
        ...u,
        day: startOfDay(addMonths(now, MAX_DEADLINE_MONTHS)),
        time: clock,
      };
    case "repeat":
      return { ...u, split: undefined };
    case "split":
      return { ...u, repeat: undefined };
    case "start":
      return { ...u, day: undefined, time: clock };
    case "end":
      return { ...u, from: undefined };
  }
}
