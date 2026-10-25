import { IsBoolean, IsString, MaxLength } from "class-validator";
import type { OAuthConsentDecisionInput } from "@zenflow/shared";

export class ConsentDecisionDto implements OAuthConsentDecisionInput {
  @IsString()
  @MaxLength(4000)
  request!: string;

  @IsBoolean()
  approve!: boolean;
}
