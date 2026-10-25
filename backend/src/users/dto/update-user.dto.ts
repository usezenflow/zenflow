import { Transform } from "class-transformer";
import {
  Equals,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  Length,
} from "class-validator";
import { LANGS, type Lang, type UpdateUserInput } from "@zenflow/shared";
import { IsValidTimezone } from "../../common/validators/valid-timezone.decorator";

/** Partial update to a user's name and preferences. */
export class UpdateUserDto implements UpdateUserInput {
  @IsString()
  @Length(1, 60)
  @IsOptional()
  name?: string;

  @IsString()
  @Length(1, 50)
  @IsValidTimezone()
  @IsOptional()
  timezone?: string;

  @IsIn(LANGS)
  @IsOptional()
  lang?: Lang;

  /** `true` completes onboarding (idempotent). */
  @Equals(true)
  @IsOptional()
  onboarded?: true;

  // Keep the raw value: implicit conversion would turn any non-empty string into `true`.
  @Transform(
    ({ obj, key }: { obj: Record<string, unknown>; key: string }) => obj[key],
  )
  @IsBoolean()
  @IsOptional()
  allowNotifications?: boolean;
}
