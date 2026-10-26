import { IsIn, IsString, Matches } from "class-validator";
import { NTFY_TOPIC_RE, type RegisterDeviceInput } from "@zenflow/shared";
import { DevicePlatform } from "../../../generated/prisma";

/** Body for `POST /devices`. `pushToken` is the device's ntfy topic. */
export class RegisterDeviceDto implements RegisterDeviceInput {
  @IsIn([DevicePlatform.IOS, DevicePlatform.ANDROID])
  platform!: DevicePlatform;

  @IsString()
  @Matches(NTFY_TOPIC_RE)
  pushToken!: string;
}
