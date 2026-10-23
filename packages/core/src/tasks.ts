import * as z from "zod";
import {
  DAILY_HORIZON,
  MAX_REMINDERS_PER_SESSION,
  MAX_REMINDER_MINUTES,
  SLOT_MINUTES,
  type Session,
} from "@zenflow/shared";

/**
 * Session validation schema — the single source of truth for the create/edit
 * session form contract, consumed by `mobile/`.
 *
 * The create form is a 3-tab affair keyed on `type`:
 *
 * - **Task** — flexible study work: `duration` + `deadline`.
 * - **Fixed** (`ASSIGNMENT` / `EXAM` / `LECTURE`) — a pinned calendar event:
 *   `date` + `startTime` + `endTime` (the client derives `durationMinutes`).
 * - **Do Not Disturb** — a fixed block with an optional `rrule` recurrence.
 *
 * It is one flat object (not a discriminated union) so it wires cleanly into
 * React Hook Form; `superRefine` enforces the per-`type` required fields.
 */
export const MAX_TITLE_LENGTH = 60;

export const SESSION_FORM_TYPES = [
  "TASK",
  "ASSIGNMENT",
  "EXAM",
  "LECTURE",
  "DND",
] as const;
export type SessionFormType = (typeof SESSION_FORM_TYPES)[number];

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** "HH:mm" → minutes since midnight. */
export function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

export const sessionSchema = z
  .object({
    type: z.enum(SESSION_FORM_TYPES),
    title: z
      .string()
      .min(1, { error: "Session name is required" })
      .max(MAX_TITLE_LENGTH, {
        error: `Title must be at most ${MAX_TITLE_LENGTH} characters.`,
      }),
    tags: z.array(z.string()).default([]),
    note: z.string().optional(),
    /** Free-text location (room / building). Optional for every session type. */
    location: z.string().optional(),
    /** Map point of `location`, when it was picked on the map. */
    locationLat: z.number().nullable().optional(),
    locationLng: z.number().nullable().optional(),
    /** Where the commute starts, its map point and travel minutes each way. */
    originLocation: z.string().nullable().optional(),
    originLat: z.number().nullable().optional(),
    originLng: z.number().nullable().optional(),
    commuteMinutes: z.number().nullable().optional(),

    // TASK-only
    duration: z
      .int()
      .min(SLOT_MINUTES, {
        error: `Session duration must be at least ${SLOT_MINUTES} minutes`,
      })
      .max(DAILY_HORIZON, { error: "Session duration must be at most 24 hours" })
      .optional(),
    deadline: z.string().optional(),

    /**
     * Minutes-before-start reminders (max `MAX_REMINDERS_PER_SESSION`). Omitted
     * = server default (one hour before, non-DND). Never sent for DND.
     */
    reminders: z
      .array(z.int().min(0).max(MAX_REMINDER_MINUTES))
      .max(MAX_REMINDERS_PER_SESSION)
      .optional(),

    // Fixed / DND
    date: z.string().optional(),
    startTime: z.string().optional(),
    endTime: z.string().optional(),

    // DND-only
    rrule: z.string().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.type === "TASK") {
      const durationOk = v.duration != null;
      if (!durationOk) {
        ctx.addIssue({
          code: "custom",
          message: "Pick a duration",
          path: ["duration"],
        });
      }
      const deadlineOk = !!v.deadline && !Number.isNaN(Date.parse(v.deadline));
      if (!deadlineOk) {
        ctx.addIssue({
          code: "custom",
          message: "Pick a deadline",
          path: ["deadline"],
        });
      }
      // Coarse feasibility guard (issue #33): reject up front when there
      // isn't even enough raw time to fit every sitting back-to-back before
      // the deadline — mirrors the backend's `@IsFeasibleTaskWindow` (a
      // necessary, not sufficient, check; the placer's own pre-flight still
      // catches "the arithmetic fits but every day is already full"). The
      // `"\n"` splits toast title from description (`splitToastMessage`).
      if (durationOk && deadlineOk) {
        const neededMs = (v.duration as number) * 60_000;
        if (Date.now() + neededMs > Date.parse(v.deadline as string)) {
          ctx.addIssue({
            code: "custom",
            message:
              "Not enough time left before this deadline\nChoose a later deadline to leave room for this session.",
            path: ["deadline"],
          });
        }
      }
      return;
    }

    // Fixed types + DND
    if (!v.date || !YMD.test(v.date)) {
      ctx.addIssue({ code: "custom", message: "Pick a date", path: ["date"] });
    }
    if (!v.startTime || !HHMM.test(v.startTime)) {
      ctx.addIssue({
        code: "custom",
        message: "Pick a start time",
        path: ["startTime"],
      });
    }
    if (!v.endTime || !HHMM.test(v.endTime)) {
      ctx.addIssue({
        code: "custom",
        message: "Pick an end time",
        path: ["endTime"],
      });
      return;
    }
    if (v.startTime && HHMM.test(v.startTime)) {
      const start = hhmmToMinutes(v.startTime);
      const end = hhmmToMinutes(v.endTime);
      if (end <= start) {
        ctx.addIssue({
          code: "custom",
          message: "End time must be after start time",
          path: ["endTime"],
        });
      } else if ((end - start) % SLOT_MINUTES !== 0) {
        ctx.addIssue({
          code: "custom",
          message: `Duration must be a multiple of ${SLOT_MINUTES} minutes`,
          path: ["endTime"],
        });
      }
    }
  });

export type SessionFormValues = z.infer<typeof sessionSchema>;

/**
 * The edit form never changes `type`, so it validates the same flat shape.
 * Kept as a separate export in case the edit surface needs to diverge.
 */
export const editSessionSchema = sessionSchema;
export type EditSessionFormValues = SessionFormValues;

/**
 * Client-side signal for why a session's placement is unusual — the backend
 * doesn't return *why* a concrete placement was chosen, so callers derive
 * this themselves to annotate a success/conflict toast after create/update.
 * `null` when the session has no placement at all — nothing to qualify.
 */
export type PlacementQualifier = "onTime" | "pastDeadline";

export function placementQualifier(
  session: Session,
  _user: { timezone: string },
): PlacementQualifier | null {
  if (!session.scheduledStartTime) return null;

  const start = new Date(session.scheduledStartTime);
  if (session.deadline && start > new Date(session.deadline))
    return "pastDeadline";

  return "onTime";
}

/**
 * Which kind of series (if any) a session belongs to (CLAUDE.md invariant #4).
 * `seriesId` is set for both:
 * - a recurring **fixed** series (`rrule` set) — virtual occurrences; scope
 *   choices are "this occurrence" / truncate the rrule / delete the series.
 *
 * A portal-ingested `LECTURE` meeting instead carries `timetableGroupId` (no
 * `seriesId`/`rrule` of its own) — the grouping key behind the
 * `DELETE /sessions/timetable-group/:sessionId[/from]` routes. Scope choices
 * there are delete-only ("this meeting" / "this and later" / the whole
 * section); there's no group-wide reschedule endpoint, so this kind is only
 * meaningful for the delete-scope dialog.
 *
 * `"none"` covers a one-off fixed session or a single-sitting TASK — no scope
 * choice needed, delete is always just that one row.
 */
export type SeriesKind = "none" | "recurring" | "timetable";

export function getSeriesKind(
  session: Pick<Session, "seriesId" | "rrule" | "timetableGroupId">,
): SeriesKind {
  if (!session.seriesId && session.timetableGroupId) return "timetable";
  if (!session.seriesId) return "none";
  return "recurring";
}
