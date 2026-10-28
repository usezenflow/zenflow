import { Type } from "class-transformer";
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  Max,
  MaxLength,
  Min,
} from "class-validator";
import type { ReplanChange } from "../replan.service";

/** `from`..`to` in the user's timezone, both ends inclusive; the list service caps the span. */
export class InsightRangeDto {
  @IsDateString()
  @MaxLength(10)
  from: string;

  @IsDateString()
  @MaxLength(10)
  to: string;
}

export class FreeSlotsDto extends InsightRangeDto {
  @Type(() => Number)
  @IsInt()
  @Min(15)
  @Max(480)
  durationMinutes: number;
}

export class ReplanDto extends InsightRangeDto {
  @IsOptional()
  @IsIn(["free", "balanced"])
  change?: ReplanChange;
}
