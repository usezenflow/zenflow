import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsOptional,
  ValidateNested,
} from "class-validator";
import { MAX_BULK_SESSIONS } from "@zenflow/shared";
import { CreateSessionDto } from "./create-session.dto";

/** `POST /sessions/bulk`. Items are placed in order; a failing item does not stop the rest. */
export class BulkCreateSessionsDto {
  /** Propose each start without writing anything. */
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_BULK_SESSIONS)
  @ValidateNested({ each: true })
  @Type(() => CreateSessionDto)
  items: CreateSessionDto[];
}
