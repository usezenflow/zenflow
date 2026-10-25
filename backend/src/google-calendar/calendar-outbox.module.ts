import { Module } from "@nestjs/common";
import { NotificationsModule } from "../notifications/notifications.module";
import { PrismaModule } from "../prisma/prisma.module";
import { CalendarOutboxService } from "./calendar-outbox.service";
import { GOOGLE_CALENDAR_CORE } from "./google-calendar.providers";

/** The calendar outbox process (`ROLE=outbox`): syncs users marked dirty by the `Session` trigger. */
@Module({
  imports: [PrismaModule, NotificationsModule],
  providers: [...GOOGLE_CALENDAR_CORE, CalendarOutboxService],
})
export class CalendarOutboxModule {}
