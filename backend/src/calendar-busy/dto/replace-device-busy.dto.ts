import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsISO8601,
  IsString,
  Length,
  ValidateNested,
} from "class-validator";

export class DeviceBusyBlockDto {
  @IsString()
  @Length(1, 200)
  externalKey!: string;

  @IsString()
  @Length(0, 200)
  title!: string;

  @IsISO8601()
  start!: string;

  @IsISO8601()
  end!: string;
}

/** Every timed event the phone shows as busy, within the sync window. */
export class ReplaceDeviceBusyDto {
  @IsArray()
  @ArrayMaxSize(2000)
  @ValidateNested({ each: true })
  @Type(() => DeviceBusyBlockDto)
  blocks!: DeviceBusyBlockDto[];
}
