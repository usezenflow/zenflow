import { fromZonedTime } from "date-fns-tz";
import { localMinutesOfDay } from "../../scheduler/core/slot";

export function utcToMinutes(
  date: Date, // stored UTC date
  timezone: string, // e.g. "Europe/Paris"
): number {
  return localMinutesOfDay(date, timezone);
}

export function minutesToUtc(
  dateString: string,
  minutes: number,
  timezone: string,
): Date {
  const local = new Date(`${dateString}T00:00:00`);
  local.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return fromZonedTime(local, timezone);
}

export const clamp = (value: number, min: number, max: number) => {
  return Math.min(Math.max(value, min), max);
};
