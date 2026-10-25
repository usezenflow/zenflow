import { Module } from "@nestjs/common";
import { PublicUrls } from "../common/config/public-urls";
import { PrismaModule } from "../prisma/prisma.module";
import { CalendarSweepService } from "./calendar-sweep.service";
import { CalendarSyncTriggerModule } from "./calendar-sync-trigger.module";
import { GoogleCalendarConfig } from "./google-calendar.config";

/** The cron that re-syncs stale connections; registered on the watcher only. */
@Module({
  imports: [PrismaModule, CalendarSyncTriggerModule],
  providers: [CalendarSweepService, GoogleCalendarConfig, PublicUrls],
})
export class CalendarSweepModule {}
