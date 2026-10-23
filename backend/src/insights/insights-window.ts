import { BadRequestException } from "@nestjs/common";
import { addDaysStr, dayDiffStr, localDateStr } from "../scheduler/core/slot";

export const MAX_WINDOW_DAYS = 92;
/** Default window is 7 days inclusive: `to − 6` … `to`. */
const DEFAULT_LOOKBACK_DAYS = 6;

export interface DateWindow {
  /** Inclusive, 'YYYY-MM-DD' in the user's timezone. */
  from: string;
  /** Inclusive, 'YYYY-MM-DD' in the user's timezone. */
  to: string;
}

/** True for a real calendar date in 'YYYY-MM-DD' form (rejects 2026-02-30). */
export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

/**
 * Resolves the requested dates against the user's local today. `to` defaults
 * to today, `from` to six days before `to`. Rejects invalid dates, `from`
 * after `to`, and windows over {@link MAX_WINDOW_DAYS} inclusive days.
 */
export function resolveWindow(
  query: { from?: string; to?: string },
  timezone: string,
  now: Date,
): DateWindow {
  const to = query.to ?? localDateStr(now, timezone);
  const from = query.from ?? addDaysStr(to, -DEFAULT_LOOKBACK_DAYS);
  for (const value of [from, to]) {
    if (!isCalendarDate(value)) {
      throw new BadRequestException(`Invalid date ${value}`);
    }
  }
  if (from > to) {
    throw new BadRequestException("from must be on or before to");
  }
  if (dayDiffStr(from, to) + 1 > MAX_WINDOW_DAYS) {
    throw new BadRequestException(
      `Window must be ${MAX_WINDOW_DAYS} days or less`,
    );
  }
  return { from, to };
}
