import type { FocusCell } from "@zenflow/shared";
import { format, subDays } from "date-fns";

/** Fewer DONE events than this and the focus map stays a line of copy. */
export const FOCUS_MIN_DONE = 5;

const WEEKDAYS = 7;
const HOURS = 24;
const HEAT_LEVELS = 4;

/** Done counts as `grid[weekday][hour]`: weekday 0 is Monday, hour 0 midnight. */
export function focusGrid(cells: readonly FocusCell[]): number[][] {
  const grid = Array.from({ length: WEEKDAYS }, () =>
    new Array<number>(HOURS).fill(0),
  );
  for (const { weekday, hour, done } of cells) {
    if (weekday < 0 || weekday >= WEEKDAYS || hour < 0 || hour >= HOURS) continue;
    grid[weekday][hour] += done;
  }
  return grid;
}

export function focusTotal(cells: readonly FocusCell[]): number {
  return cells.reduce((sum, cell) => sum + cell.done, 0);
}

export function focusReady(cells: readonly FocusCell[]): boolean {
  return focusTotal(cells) >= FOCUS_MIN_DONE;
}

/** Busiest cell of a grid, or 0 when nothing is done. */
export function gridMax(grid: readonly (readonly number[])[]): number {
  let max = 0;
  for (const row of grid) for (const count of row) if (count > max) max = count;
  return max;
}

/** Heat bucket 0 (none) to 4 (the busiest cell), scaled to `max`. */
export function heatLevel(count: number, max: number): number {
  if (count <= 0 || max <= 0) return 0;
  return Math.min(HEAT_LEVELS, Math.ceil((count / max) * HEAT_LEVELS));
}

export interface BufferLabel {
  /** Catalogue key for `t()`. */
  key: string;
  values?: { days: number };
}

/** Chip copy for a buffer: how many whole days of prep are planned before the due time. */
export function bufferLabel(bufferDays: number | null): BufferLabel {
  if (bufferDays === null) return { key: "Nothing planned yet" };
  if (bufferDays < 1) return { key: "Prep ready, under a day" };
  if (bufferDays === 1) return { key: "Prep ready, 1 day" };
  return { key: "Prep ready, {days} days", values: { days: bufferDays } };
}

/** Minutes as hours to one decimal place. */
export function hoursOf(minutes: number): number {
  return Math.round(minutes / 6) / 10;
}

/** The recap window: `days` days ending on `now`'s wall-clock day, as `YYYY-MM-DD`. */
export function insightsWindow(
  now: Date,
  days = 7,
): { from: string; to: string } {
  return {
    from: format(subDays(now, days - 1), "yyyy-MM-dd"),
    to: format(now, "yyyy-MM-dd"),
  };
}
