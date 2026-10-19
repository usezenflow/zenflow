import { Transform } from "class-transformer";
import {
  Equals,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  Length,
} from "class-validator";
import {
  COMMUTE_TRANSPORTS,
  DEFAULT_REMINDER_CHOICES,
  FOCUS_BANDS,
  LANGS,
  type CommuteTransport,
  type FocusBand,
  type DefaultReminderChoice,
  type Lang,
  type UpdateUserInput,
} from "@zenflow/shared";
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

  @IsIn(DEFAULT_REMINDER_CHOICES)
  @IsOptional()
  defaultReminderMinutes?: DefaultReminderChoice;

  @IsIn(COMMUTE_TRANSPORTS)
  @IsOptional()
  defaultTransport?: CommuteTransport;

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

  /** Onboarding answer; seeds the preference matrix while it is still the default. */
  @IsIn(FOCUS_BANDS)
  @IsOptional()
  focusBand?: FocusBand;
}
