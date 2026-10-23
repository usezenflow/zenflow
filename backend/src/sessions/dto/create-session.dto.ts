import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsDivisibleBy,
  IsIn,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from "class-validator";
import { MAX_COMMUTE_MINUTES, TIME_GRANULARITY } from "../../common/constants";
import { IsRRule } from "../../common/validators/rrule.decorator";
import { IsFeasibleTaskWindow } from "../../common/validators/feasible-task-window.decorator";
import {
  MAX_REMINDER_MINUTES,
  MAX_REMINDERS_PER_SESSION,
  type InfeasiblePolicy,
  type SessionType,
} from "@zenflow/shared";

export const INFEASIBLE_POLICIES: InfeasiblePolicy[] = [
  "ACCEPT_CONFLICTS",
  "ACCEPT_LATE_DEADLINE",
];

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

  /** Map point of the location, set together with `location`. `null` clears it. */
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsNumber()
  @Min(-90)
  @Max(90)
  locationLat?: number | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsNumber()
  @Min(-180)
  @Max(180)
  locationLng?: number | null;

  /** Where the commute starts, with its map point and travel minutes each way. */
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(200, { message: "Origin must be at most 200 characters." })
  originLocation?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsNumber()
  @Min(-90)
  @Max(90)
  originLat?: number | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsNumber()
  @Min(-180)
  @Max(180)
  originLng?: number | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsInt()
  @Min(0)
  @Max(MAX_COMMUTE_MINUTES)
  commuteMinutes?: number | null;

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

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  /**
   * Minutes before start to remind the user (max 2, not for DND). Omit on
   * create for the default (60 min, non-DND); `[]` for none.
   */
  /**
   * The lecture, exam or assignment this `TASK` prepares for. A recurring
   * lecture occurrence id (`<seriesId>::<startISO>`) pins that occurrence.
   */
  @ValidateIf((o: CreateSessionDto) => o.type === "TASK")
  @IsOptional()
  @IsString()
  prepForSessionId?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_REMINDERS_PER_SESSION)
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(MAX_REMINDER_MINUTES, { each: true })
  reminders?: number[];
}
