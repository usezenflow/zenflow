import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
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
import type {
  InfeasiblePolicy,
  UpdateScope,
  UpdateSessionInput,
} from "@zenflow/shared";
import { MAX_COMMUTE_MINUTES, TIME_GRANULARITY } from "../../common/constants";
import { IsRRule } from "../../common/validators/rrule.decorator";
import { INFEASIBLE_POLICIES } from "./create-session.dto";
import {
  MAX_REMINDER_MINUTES,
  MAX_REMINDERS_PER_SESSION,
} from "@zenflow/shared";

/**
 * Generic metadata / reschedule / resize update — one `PATCH /sessions/:id`
 * covers all of it. Every field is a plain diff applied directly. A change to a
 * scheduled TASK's `scheduledStartTime` / `durationMinutes` also emits a `MOVE`
 * SessionEvent (see `SessionsService.update`).
 */
export class UpdateSessionDto implements UpdateSessionInput {
  @IsOptional()
  @IsString()
  @MaxLength(60, { message: "Title must be at most 60 characters." })
  title?: string;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  note?: string | null;

  /** Free-text location (room / building). `null` clears it; omit to leave unchanged. */
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

  /** Where the commute starts. `null` clears it; omit to leave unchanged. */
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(200, { message: "Origin must be at most 200 characters." })
  originLocation?: string | null;

  /** Map point of the origin, set together with `originLocation`. `null` clears it. */
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

  /** Travel minutes between origin and location, each way. `null` clears it. */
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsInt()
  @Min(0)
  @Max(MAX_COMMUTE_MINUTES)
  commuteMinutes?: number | null;

  @IsOptional()
  @IsInt()
  @Min(TIME_GRANULARITY)
  @IsDivisibleBy(TIME_GRANULARITY)
  durationMinutes?: number;

  /** ISO-8601 deadline (TASK only). Omit to leave unchanged. */
  @IsOptional()
  @IsISO8601()
  deadline?: string;

  /** A prep `TASK` only: the lecture occurrence it prepares for. */
  @IsOptional()
  @IsISO8601()
  prepForOccurrenceStart?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  /** ISO-8601 instant — drag reschedule / resize both just move this. */
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsISO8601()
  scheduledStartTime?: string | null;

  /** RFC 5545 RRULE — for a recurring fixed session's series. `null` drops it. */
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsRRule()
  rrule?: string | null;

  /** Which series members a `scheduledStartTime`/`durationMinutes` change applies to. */
  @IsOptional()
  @IsIn(["occurrence", "following", "series"])
  scope?: UpdateScope;

  /**
   * With `scope: "following" | "series"`, leave any instance whose new landing
   * slot would overlap another session untouched instead of moving it there.
   * Ignored otherwise.
   */
  @IsOptional()
  @IsBoolean()
  skipConflicting?: boolean;

  /**
   * Answer to a prior 409 `SCHEDULE_INFEASIBLE`: `ACCEPT_CONFLICTS` places the
   * task before its deadline even overlapping other sessions;
   * `ACCEPT_LATE_DEADLINE` places it conflict-free after the deadline. Omit on
   * the first attempt.
   */
  @IsOptional()
  @IsIn(INFEASIBLE_POLICIES)
  infeasiblePolicy?: InfeasiblePolicy;

  /**
   * Minutes before start to remind the user (max 2, not for DND). Omit on
   * create for the default (60 min, non-DND); `[]` for none.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_REMINDERS_PER_SESSION)
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(MAX_REMINDER_MINUTES, { each: true })
  reminders?: number[];
}
