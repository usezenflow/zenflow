import { Transform, Type } from "class-transformer";
import {
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from "class-validator";

export const SESSION_TYPES = [
  "TASK",
  "ASSIGNMENT",
  "EXAM",
  "LECTURE",
  "DND",
] as const;
export const SESSION_SORTS = ["start", "duration", "deadline"] as const;

/** Largest `from`..`to` window, both ends inclusive. */
export const MAX_RANGE_DAYS = 30;

const csv = ({ value }: { value: unknown }) =>
  typeof value === "string"
    ? value
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : value;

/**
 * `GET /sessions`: sessions in a date range (user's timezone, both ends
 * inclusive, at most {@link MAX_RANGE_DAYS} days), filtered and sorted.
 * Unscheduled tasks always pass the range; the other filters still apply.
 */
export class ListSessionsDto {
  @IsDateString()
  @MaxLength(10)
  from: string;

  @IsDateString()
  @MaxLength(10)
  to: string;

  /** Case-insensitive regular expression over title, note and location. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;

  @IsOptional()
  @Transform(csv)
  @IsArray()
  @IsIn(SESSION_TYPES, { each: true })
  types?: (typeof SESSION_TYPES)[number][];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(15)
  @Max(1440)
  minDuration?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(15)
  @Max(1440)
  maxDuration?: number;

  @IsOptional()
  @IsDateString()
  @MaxLength(10)
  deadlineFrom?: string;

  @IsOptional()
  @IsDateString()
  @MaxLength(10)
  deadlineTo?: string;

  @IsOptional()
  @IsIn(SESSION_SORTS)
  sort?: (typeof SESSION_SORTS)[number] = "start";

  @IsOptional()
  @IsIn(["asc", "desc"])
  order?: "asc" | "desc";
}
