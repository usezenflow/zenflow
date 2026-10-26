import { addDays } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";

const DAYS_AHEAD = 14;

/**
 * Dates the assistant must not compute itself: now, today, tomorrow, the week
 * and a 14-day table, all in the user's timezone with offsets.
 */
export function timeInfo(timezone: string, now: Date = new Date()) {
  const day = (d: Date) => ({
    date: formatInTimeZone(d, timezone, "yyyy-MM-dd"),
    weekday: formatInTimeZone(d, timezone, "EEEE"),
  });
  // shortcut: whole-day offsets from now, so a DST change within 1h of local midnight can misdate a row; use zoned dates if that matters.
  const noon = (n: number) => addDays(now, n);
  const isoWeekday = Number(formatInTimeZone(now, timezone, "i"));
  return {
    timezone,
    now: formatInTimeZone(now, timezone, "yyyy-MM-dd'T'HH:mm:ssXXX"),
    today: day(now),
    tomorrow: day(noon(1)),
    week: {
      start: day(noon(1 - isoWeekday)).date,
      end: day(noon(7 - isoWeekday)).date,
    },
    next14Days: Array.from({ length: DAYS_AHEAD }, (_, i) => day(noon(i))),
  };
}
