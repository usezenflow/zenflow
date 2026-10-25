import { Module } from "@nestjs/common";
import { NotificationsModule } from "../notifications/notifications.module";
import { PrismaModule } from "../prisma/prisma.module";
import { QueueModule } from "../queue/queue.module";
import { SessionsModule } from "../sessions/sessions.module";
import { CalendarSyncProcessor } from "./calendar-sync.processor";
import { CalendarSyncTriggerModule } from "./calendar-sync-trigger.module";
import { GOOGLE_CALENDAR_CORE } from "./google-calendar.providers";

/** Consumer of the `calendar-sync` queue; imported only by roles that consume it. */
@Module({
  imports: [
    PrismaModule,
    QueueModule,
    NotificationsModule,
    SessionsModule,
    CalendarSyncTriggerModule,
  ],
  providers: [...GOOGLE_CALENDAR_CORE, CalendarSyncProcessor],
})
export class CalendarWorkerModule {}
