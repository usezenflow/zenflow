import { Module } from "@nestjs/common";
import { OutboundBreakerModule } from "../common/outbound-breaker.module";
import { DevicesModule } from "../devices/devices.module";
import { QueueModule } from "../queue/queue.module";
import { PrismaModule } from "../prisma/prisma.module";
import { NotifyProcessor } from "./notify.processor";

/** Consumer of the `notify` queue; imported only by roles that consume it. */
@Module({
  imports: [PrismaModule, QueueModule, OutboundBreakerModule, DevicesModule],
  providers: [NotifyProcessor],
})
export class NotifyWorkerModule {}
