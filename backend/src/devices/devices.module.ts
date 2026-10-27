import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { ApnsSender } from "./apns.sender";
import { DevicesController } from "./devices.controller";
import { DevicesService } from "./devices.service";
import { FcmSender } from "./fcm.sender";
import { PushService } from "./push.service";
import { WebPushSender } from "./web-push.sender";

@Module({
  imports: [PrismaModule],
  controllers: [DevicesController],
  providers: [
    DevicesService,
    PushService,
    FcmSender,
    ApnsSender,
    WebPushSender,
  ],
  exports: [PushService],
})
export class DevicesModule {}
