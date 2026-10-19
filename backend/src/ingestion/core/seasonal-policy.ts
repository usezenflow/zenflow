import { fromZonedTime } from "date-fns-tz";
import { isoWeekStart, type ResolvedSemester, type TermId } from "./semester";

/**
 * The seasonal half of the rolling schedule: which kinds are live right now and how
 * their next run is timed. `schedule-plan.ts` holds the arithmetic every kind shares;
 * this holds the rules that depend on the academic calendar and on how much has
 * already been fetched.
 *
 * Pure: `now` is always a parameter and the timezone is always explicit.
 */

/** Overrides a test or benchmark sets to compress the calendar; production leaves them unset. */
export interface SeasonOverrides {
  /** Exam window: `open` or `closed` regardless of the date; `auto` follows the calendar. */
  examWindow: "auto" | "open" | "closed";
  /** Replaces "start of the next ISO week" as the steady-state timetable cadence. */
  timetableWeeklyMs: number | null;
  /** Replaces the one-week wait between the first exam ending and marks becoming due. */
  marksAfterExamsMs: number;
}

export const DEFAULT_OVERRIDES: SeasonOverrides = {
  examWindow: "auto",
  timetableWeeklyMs: null,
  marksAfterExamsMs: 7 * 24 * 60 * 60_000,
};

/** Share of students whose discovery covers the term before the timetable drops to weekly. */
export const TIMETABLE_STEADY_COVERAGE = 0.95;

/** Month (1-12) an exam window opens, per term. The window then runs to the term's end. */
export const EXAM_START_MONTH: Record<TermId, number> = {
  HK01: 10,
  HK02: 3,
  HK03: 6,
};

/** First instant of the exam window of `term`: day 1 of its start month, 00:00 in `tz`. */
export function examWindowStart(term: ResolvedSemester, tz: string): Date {
  const month = EXAM_START_MONTH[term.semester];
  const startYear = Number(term.academicYear.slice(0, 4));
  // HK01 starts in July and its exams in October of the same year; the later terms run
  // into the next calendar year.
  const year = term.semester === "HK01" ? startYear : startYear + 1;
  const day = `${year}-${String(month).padStart(2, "0")}-01`;
  return isoDayStart(day, tz);
}

function isoDayStart(dateStr: string, tz: string): Date {
  return fromZonedTime(`${dateStr}T00:00:00.000`, tz);
}

/** Is the exam fetch live? Open from the window start to the end of the term. */
export function examWindowOpen(
  now: Date,
  term: ResolvedSemester,
  tz: string,
  overrides: SeasonOverrides = DEFAULT_OVERRIDES,
): boolean {
  if (overrides.examWindow !== "auto") return overrides.examWindow === "open";
  return now >= examWindowStart(term, tz) && now <= term.endDate;
}

/**
 * Has the exam response covered every section the student is enrolled in? The ground
 * truth for "enough exams are fetched" is enrolment discovery: an enrolled section with
 * no exam in the response keeps the fetch going.
 */
export function examsCoverEnrolment(
  enrolledSectionIds: readonly string[],
  examSectionIds: ReadonlySet<string>,
): boolean {
  return (
    enrolledSectionIds.length > 0 &&
    enrolledSectionIds.every((id) => examSectionIds.has(id))
  );
}

/**
 * When a just-claimed timetable row is due again: rolling every `rollingMs` until
 * discovery covers {@link TIMETABLE_STEADY_COVERAGE} of students, then once at the
 * start of each ISO week.
 */
export function timetableNextDue(input: {
  now: Date;
  tz: string;
  rollingMs: number;
  discoveredShare: number;
  overrides?: SeasonOverrides;
}): Date {
  const { now, tz, rollingMs, discoveredShare } = input;
  const overrides = input.overrides ?? DEFAULT_OVERRIDES;
  if (discoveredShare < TIMETABLE_STEADY_COVERAGE) {
    return new Date(now.getTime() + rollingMs);
  }
  if (overrides.timetableWeeklyMs !== null) {
    return new Date(now.getTime() + overrides.timetableWeeklyMs);
  }
  const thisMonday = isoWeekStart(now, tz);
  return new Date(thisMonday.getTime() + 7 * 24 * 60 * 60_000);
}

/**
 * Are marks due for a student? From `marksAfterExamsMs` after their first exam of the
 * term ended; a student with no exam yet has nothing to wait for and is not due.
 */
export function marksEligible(input: {
  now: Date;
  firstExamEndsAt: Date | null;
  overrides?: SeasonOverrides;
}): boolean {
  const { now, firstExamEndsAt } = input;
  const overrides = input.overrides ?? DEFAULT_OVERRIDES;
  if (!firstExamEndsAt) return false;
  return (
    now.getTime() >= firstExamEndsAt.getTime() + overrides.marksAfterExamsMs
  );
}
