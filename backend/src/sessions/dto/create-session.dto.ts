import {
  ArrayMaxSize,
  IsArray,
  IsDivisibleBy,
  IsEmail,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateIf,
} from "class-validator";
import { Transform } from "class-transformer";
import { MAX_ATTENDEES, TIME_GRANULARITY } from "../../common/constants";
import { IsRRule } from "../../common/validators/rrule.decorator";
import { IsFeasibleTaskWindow } from "../../common/validators/feasible-task-window.decorator";
import {
  DEFAULT_REMINDER_CHOICES,
  type InfeasiblePolicy,
  type SessionType,
} from "@zenflow/shared";

export const INFEASIBLE_POLICIES: InfeasiblePolicy[] = [
  "ACCEPT_CONFLICTS",
  "ACCEPT_LATE_DEADLINE",
];

/** Trims and lowercases invitee emails and drops repeats. Other values reach the validators unchanged. */
export const normalizeAttendees = ({ value }: { value: unknown }): unknown =>
  Array.isArray(value)
    ? [
        ...new Set(
          (value as unknown[]).map((v) =>
            typeof v === "string" ? v.trim().toLowerCase() : v,
          ),
        ),
      ]
    : value;

/** Invitee emails for group study. Pushed to Google only. */
export function AttendeesField() {
  return (target: object, key: string) => {
    IsOptional()(target, key);
    IsArray()(target, key);
    ArrayMaxSize(MAX_ATTENDEES)(target, key);
    IsEmail({}, { each: true })(target, key);
    Transform(normalizeAttendees)(target, key);
  };
}

export const SESSION_TYPES: SessionType[] = [
  "TASK",
  "ASSIGNMENT",
  "EXAM",
  "LECTURE",
  "DND",
];

/**
 * The 3-tab create form, flattened. `type` discriminates:
 *
 * - `TASK` — requires `deadline`; the engine places it.
 * - `ASSIGNMENT` / `EXAM` / `LECTURE` / `DND` — require `scheduledStartTime`; no
 *   deadline; may carry an `rrule` recurrence (a weekly lecture, a nightly DND).
 */
export class CreateSessionDto {
  /**
   * Answer to a prior 409 `SCHEDULE_INFEASIBLE`: `ACCEPT_CONFLICTS` places the
   * task before its deadline even overlapping other sessions;
   * `ACCEPT_LATE_DEADLINE` places it conflict-free after the deadline. Omit on
   * the first attempt.
   */
  @IsOptional()
  @IsIn(INFEASIBLE_POLICIES)
  infeasiblePolicy?: InfeasiblePolicy;

  @IsIn(SESSION_TYPES)
  type: SessionType;

  @IsString()
  @MaxLength(60, { message: "Title must be at most 60 characters." })
  title: string;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  note?: string | null;

  /** Free-text location (room / building) — optional for every session type. */
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(200, { message: "Location must be at most 200 characters." })
  location?: string | null;

  /** Minutes before start; `null` or omitted uses the user's default. */
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsIn(DEFAULT_REMINDER_CHOICES)
  reminderMinutes?: number | null;

  @AttendeesField()
  attendees?: string[];

  /** Session duration in minutes (always a positive multiple of 15, required). */
  @IsInt()
  @Min(TIME_GRANULARITY)
  @IsDivisibleBy(TIME_GRANULARITY)
  durationMinutes: number;

  /**
   * ISO-8601 deadline — required for a `TASK`, absent for fixed types.
   * `@IsFeasibleTaskWindow` additionally rejects a deadline that leaves no
   * time to fit `durationMinutes` before it (a
   * coarse, necessary-not-sufficient check — see that decorator's doc).
   */
  @ValidateIf((o: CreateSessionDto) => o.type === "TASK")
  @IsISO8601()
  @IsFeasibleTaskWindow()
  deadline?: string;

  /** ISO-8601 start — required for the fixed types (`ASSIGNMENT`/`EXAM`/`LECTURE`/`DND`). */
  @ValidateIf((o: CreateSessionDto) => o.type !== "TASK")
  @IsISO8601()
  scheduledStartTime?: string;

  /** RFC 5545 RRULE — any fixed type, optional (one-off when omitted). */
  @ValidateIf((o: CreateSessionDto) => o.type !== "TASK" && o.rrule != null)
  @IsRRule()
  rrule?: string | null;

  /**
   * The lecture, exam or assignment this `TASK` prepares for. A recurring
   * lecture occurrence id (`<seriesId>::<startISO>`) pins that occurrence.
   */
  @ValidateIf((o: CreateSessionDto) => o.type === "TASK")
  @IsOptional()
  @IsString()
  prepForSessionId?: string;
}
