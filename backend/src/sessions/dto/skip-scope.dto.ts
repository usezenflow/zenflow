import { IsIn, IsOptional } from "class-validator";
import type { SkipScope } from "../session-skip.service";

export class SkipScopeDto {
  /** Recurring occurrences only: `occurrence` (default), `following`, or `all`. */
  @IsOptional()
  @IsIn(["occurrence", "following", "all"])
  scope?: SkipScope;
}
