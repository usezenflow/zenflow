import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { DevicesController } from "./devices.controller";
import { DevicesService } from "./devices.service";
import { NtfySender } from "./ntfy.sender";
import { PushService } from "./push.service";

@Module({
  imports: [PrismaModule],
  controllers: [DevicesController],
  providers: [DevicesService, PushService, NtfySender],
  exports: [PushService],
})
export class DevicesModule {}
