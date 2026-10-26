import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { NotificationsModule } from "./notifications.module";
import { DiscoveryPushService } from "./discovery-push.service";

/** Watcher-only cron: registers in the process that runs the other crons (ADR-0011). */
@Module({
  imports: [PrismaModule, NotificationsModule],
  providers: [DiscoveryPushService],
})
export class DiscoveryPushModule {}
