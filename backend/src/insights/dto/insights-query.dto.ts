import { IsOptional, Matches, MaxLength } from "class-validator";

const DATE_FORMAT = /^\d{4}-\d{2}-\d{2}$/;

export class InsightsQueryDto {
  @IsOptional()
  @MaxLength(10)
  @Matches(DATE_FORMAT, { message: "from must be YYYY-MM-DD" })
  from?: string;

  @IsOptional()
  @MaxLength(10)
  @Matches(DATE_FORMAT, { message: "to must be YYYY-MM-DD" })
  to?: string;
}
