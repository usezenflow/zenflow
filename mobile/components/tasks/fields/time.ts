import { zonedNow, zonedWallClockToUtc } from "@zenflow/core";
import { format as dateFnsFormat } from "date-fns";

/** Deadline time of day when a date is chosen without one: 23:59:59. */
export const END_OF_DAY = 23 * 60 + 59;
export const END_OF_DAY_SECONDS = 59;

/**
 * A wall-clock date (`YYYY-MM-DD`) and minutes of day, as one UTC instant.
 * `seconds` is 59 for an end-of-day deadline, which is how the server's
 * "today", "tomorrow" and "no rush" options are stamped.
 */
export function isoAt(date: string, minutes: number, tz: string, seconds = 0): string {
  const [y, m, d] = date.split("-").map(Number);
  const wall = new Date(y, m - 1, d, Math.floor(minutes / 60), minutes % 60, seconds, 0);
  return zonedWallClockToUtc(wall, tz).toISOString();
}

/** The user's calendar day for `tz`, as `YYYY-MM-DD`. */
export function todayIn(tz: string): string {
  return dateFnsFormat(zonedNow(tz), "yyyy-MM-dd");
}
