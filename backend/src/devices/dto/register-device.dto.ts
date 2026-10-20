import { IsEnum, IsNotEmpty, IsString, ValidateIf } from "class-validator";
import type { RegisterDeviceInput } from "@zenflow/shared";
import { DevicePlatform } from "../../../generated/prisma";

/** Body for `POST /devices`. The subscription keys are required only for `WEB`. */
export class RegisterDeviceDto implements RegisterDeviceInput {
  @IsEnum(DevicePlatform)
  platform!: DevicePlatform;

  @IsString()
  @IsNotEmpty()
  pushToken!: string;

  @ValidateIf((o: RegisterDeviceDto) => o.platform === DevicePlatform.WEB)
  @IsString()
  @IsNotEmpty()
  p256dh!: string | null;

  @ValidateIf((o: RegisterDeviceDto) => o.platform === DevicePlatform.WEB)
  @IsString()
  @IsNotEmpty()
  auth!: string | null;
}
