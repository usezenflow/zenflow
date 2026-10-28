import {
  addDays,
  isAfter,
  endOfMonth,
  isBefore,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from "date-fns";

/** Monday first grid of the month, padded with null; days outside `min` and `max` are flagged disabled. */
export function monthGrid(
  month: Date,
  min: Date | null,
  max: Date | null = null,
): { date: Date | null; disabled: boolean }[] {
  const first = startOfMonth(month);
  const lead = (first.getDay() + 6) % 7;
  const cells: { date: Date | null; disabled: boolean }[] = Array.from(
    { length: lead },
    () => ({ date: null, disabled: true }),
  );
  for (let d = first; d <= endOfMonth(month); d = addDays(d, 1))
    cells.push({ date: d, disabled:
        (!!min && isBefore(d, startOfDay(min))) ||
        (!!max && isAfter(d, startOfDay(max))),
    });
  return cells;
}

/** Earliest allowed time on `day`: the next 15 minute step after `min`, or midnight. */
export function earliestOn(day: Date, min: Date | null): number {
  if (!min || startOfDay(min) < startOfDay(day)) return 0;
  return Math.ceil((min.getHours() * 60 + min.getMinutes() + 1) / 15) * 15;
}

/** Day and minutes of day to a Date, clamped so it is never before `min`. */
export function compose(day: Date, minutes: number, min: Date | null): Date {
  const d = new Date(
    day.getFullYear(),
    day.getMonth(),
    day.getDate(),
    0,
    minutes,
  );
  return min && d < min
    ? new Date(
        day.getFullYear(),
        day.getMonth(),
        day.getDate(),
        0,
        earliestOn(day, min),
      )
    : d;
}

export { startOfWeek };
