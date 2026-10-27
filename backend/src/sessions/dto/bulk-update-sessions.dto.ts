import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsString,
  Length,
  ValidateNested,
} from "class-validator";
import { MAX_BULK_SESSIONS, type BulkUpdateSessionsInput } from "@zenflow/shared";
import { UpdateSessionDto } from "./update-session.dto";

export class BulkUpdateItemDto {
  @IsString()
  @Length(1, 200)
  id: string;

  @ValidateNested()
  @Type(() => UpdateSessionDto)
  patch: UpdateSessionDto;
}

/** `POST /sessions/bulk-update`. Items run in order; a failing item does not stop the rest. */
export class BulkUpdateSessionsDto implements BulkUpdateSessionsInput {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_BULK_SESSIONS)
  @ValidateNested({ each: true })
  @Type(() => BulkUpdateItemDto)
  items: BulkUpdateItemDto[];
}
