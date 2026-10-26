import { Module } from "@nestjs/common";
import { CalendarBusyModule } from "../calendar-busy/calendar-busy.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { PrismaModule } from "../prisma/prisma.module";
import { SessionsModule } from "../sessions/sessions.module";
import { CalendarSyncTriggerModule } from "./calendar-sync-trigger.module";
import { GoogleCalendarController } from "./google-calendar.controller";
import { GOOGLE_CALENDAR_CORE } from "./google-calendar.providers";
import { GoogleCalendarService } from "./google-calendar.service";

/** API side: connect, status, disconnect, the OAuth redirect and the push webhook. */
@Module({
  imports: [
    PrismaModule,
    NotificationsModule,
    SessionsModule,
    CalendarSyncTriggerModule,
    CalendarBusyModule,
  ],
  controllers: [GoogleCalendarController],
  providers: [...GOOGLE_CALENDAR_CORE, GoogleCalendarService],
  exports: [GoogleCalendarService],
})
export class GoogleCalendarModule {}
