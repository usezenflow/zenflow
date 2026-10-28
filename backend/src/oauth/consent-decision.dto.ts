import { IsBoolean, IsString, MaxLength } from "class-validator";
import type { OAuthConsentDecisionInput } from "@zenflow/shared";

export class ConsentDecisionDto implements OAuthConsentDecisionInput {
  @IsString()
  @MaxLength(32)
  code!: string;

  @IsBoolean()
  approve!: boolean;
}
