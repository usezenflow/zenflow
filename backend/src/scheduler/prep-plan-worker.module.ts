import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { QueueModule } from "../queue/queue.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { SchedulerModule } from "./scheduler.module";
import { PrepPlanProcessor } from "./io/prep-plan.processor";
import { PrepPlanService } from "./io/prep-plan.service";
import { PrepSizingClient } from "./io/prep-sizing-client.service";

/** Consumer of the `prep-plan` queue; imported only by roles that consume it. */
@Module({
  imports: [PrismaModule, QueueModule, SchedulerModule, NotificationsModule],
  providers: [PrepPlanProcessor, PrepPlanService, PrepSizingClient],
})
export class PrepPlanWorkerModule {}
