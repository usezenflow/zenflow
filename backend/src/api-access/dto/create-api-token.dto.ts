import { Transform } from "class-transformer";
import { IsString, Length } from "class-validator";
import type { CreateApiTokenInput } from "@zenflow/shared";

export class CreateApiTokenDto implements CreateApiTokenInput {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.trim() : value,
  )
  @IsString()
  @Length(1, 60)
  name: string;
}
