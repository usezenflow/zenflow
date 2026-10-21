import {
  PREFERENCE_MATRIX_LENGTH,
  PREFERENCE_SLOTS_PER_DAY,
} from "@zenflow/shared";
import { clamp, utcToMinutes } from "../../common/utils";
import { PREFERENCE_LEARNING_RATE } from "../constants";
import { dragDistanceReward } from "./reward";
import { isoWeekday, localDateStr } from "./slot";

/**
 * Preference-matrix helpers — pure, no I/O, no clock, no randomness
 * (CLAUDE.md invariant 2). The matrix is a flat **168** signed floats:
 * 7 ISO weekdays × 24 one-hour buckets, row-major by weekday
 * (`@zenflow/shared`'s `PREFERENCE_MATRIX_LENGTH` / `PREFERENCE_SLOTS_PER_DAY`).
 * Slot scoring built on these lives in `slot-score.ts`.
 */

/**
 * Flat-array index into the 7×24 signed preference matrix, 7 ISO weekdays
 * (Mon = 1 … Sun = 7) × 24 one-hour buckets, row-major by weekday.
 */
export function matrixIndex(isoWeekdayNum: number, hour: number): number {
  return (isoWeekdayNum - 1) * PREFERENCE_SLOTS_PER_DAY + hour;
}

/**
 * Weekday liking by clock hour: a late morning hump, a post-lunch dip, an
 * afternoon shoulder and an evening hump. Hours not listed are 0. Assumed, not
 * measured. Mirrors `services/bandit/src/core/preference.py`.
 */
const WEEKDAY_HOURLY: Readonly<Record<number, number>> = {
  6: 0.2,
  7: 0.2,
  8: 0.4,
  9: 0.8,
  10: 0.8,
  11: 0.8,
  12: 0.4,
  13: 0.3,
  14: 0.3,
  15: 0.6,
  16: 0.6,
  17: 0.5,
  18: 0.5,
  19: 0.8,
  20: 0.8,
  21: 0.8,
  22: 0.4,
};
/** Weekends are lazier and later: the weekday curve scaled and shifted. */
const WEEKEND_SCALE = 0.7;
const WEEKEND_SHIFT_HOURS = 1;

/**
 * Cold-start default population, used whenever a user's stored
 * `preferenceMatrix` is empty/unset (length !== {@link PREFERENCE_MATRIX_LENGTH}):
 * two humps per weekday (09 to 12, 19 to 22), a dip after lunch, and a weekend
 * that is 0.7x and one hour later. Never negative.
 */
export function defaultPreferenceMatrix(): number[] {
  const matrix = new Array<number>(PREFERENCE_MATRIX_LENGTH).fill(0);
  for (let wd = 1; wd <= 7; wd++) {
    for (let hour = 0; hour < 24; hour++) {
      matrix[matrixIndex(wd, hour)] =
        wd <= 5
          ? (WEEKDAY_HOURLY[hour] ?? 0)
          : WEEKEND_SCALE *
            (WEEKDAY_HOURLY[(hour - WEEKEND_SHIFT_HOURS + 24) % 24] ?? 0);
    }
  }
  return matrix;
}

/** The stored matrix if well-formed, else the {@link defaultPreferenceMatrix} fallback. */
export function effectivePreferenceMatrix(prefMatrix: number[]): number[] {
  return prefMatrix.length === PREFERENCE_MATRIX_LENGTH
    ? prefMatrix
    : defaultPreferenceMatrix();
}

/** Preference-matrix value of the hour bucket `instant` falls in, in `timezone`. */
export function preferenceScoreAt(
  matrix: number[],
  instant: Date,
  timezone: string,
): number {
  const dateStr = localDateStr(instant, timezone);
  const wd = isoWeekday(dateStr);
  const hour = Math.floor(utcToMinutes(instant, timezone) / 60);
  return matrix[matrixIndex(wd, hour)] ?? 0;
}

/** Flat matrix index of the local hour bucket containing `atMs`. */
function cellIndexAt(atMs: number, timezone: string): number {
  return matrixIndex(
    isoWeekday(localDateStr(new Date(atMs), timezone)),
    Math.floor(utcToMinutes(new Date(atMs), timezone) / 60),
  );
}

/**
 * Nudges the ONE hour bucket containing `atMs` by `PREFERENCE_LEARNING_RATE ·
 * delta` (`delta` in `[-1, 1]`), clamped to `[-1, 1]`. Returns a NEW array.
 */
export function reinforcePreferenceCell(
  matrix: number[],
  atMs: number,
  timezone: string,
  delta: number,
  rate: number = PREFERENCE_LEARNING_RATE,
): number[] {
  const next = [...effectivePreferenceMatrix(matrix)];
  const idx = cellIndexAt(atMs, timezone);
  next[idx] = clamp(next[idx] + rate * delta, -1, 1);
  return next;
}

/**
 * First move of a placed session: lowers the old hour and raises the new hour
 * by `η·g`, `g = -dragDistanceReward(drag)` in `[0, 1]`. No-op for a zero-distance
 * move or one inside a single hour bucket. Returns a NEW array.
 */
export function reinforcePreferenceMove(
  matrix: number[],
  oldStartMs: number,
  newStartMs: number,
  timezone: string,
  dragDistanceMinutes: number,
  rate: number = PREFERENCE_LEARNING_RATE,
): number[] {
  const grade = -dragDistanceReward(dragDistanceMinutes);
  const sameCell =
    cellIndexAt(oldStartMs, timezone) === cellIndexAt(newStartMs, timezone);
  if (grade === 0 || sameCell) return [...effectivePreferenceMatrix(matrix)];

  const lowered = reinforcePreferenceCell(
    matrix,
    oldStartMs,
    timezone,
    -grade,
    rate,
  );
  return reinforcePreferenceCell(lowered, newStartMs, timezone, grade, rate);
}
