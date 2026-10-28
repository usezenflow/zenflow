import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  Length,
  ValidateNested,
} from "class-validator";
import {
  MAX_BULK_SESSIONS,
  type BulkDeleteItem,
  type BulkDeleteKind,
  type BulkDeleteSessionsInput,
} from "@zenflow/shared";

export class BulkDeleteItemDto implements BulkDeleteItem {
  @IsIn(["session", "series", "timetable"])
  kind: BulkDeleteKind;

  @IsString()
  @Length(1, 200)
  id: string;

  @IsOptional()
  @IsIn(["all", "following"])
  scope?: "all" | "following";
}

/** `POST /sessions/bulk-delete`. Items run in order; a failing item does not stop the rest. */
export class BulkDeleteSessionsDto implements BulkDeleteSessionsInput {
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_BULK_SESSIONS)
  @ValidateNested({ each: true })
  @Type(() => BulkDeleteItemDto)
  items: BulkDeleteItemDto[];
}
