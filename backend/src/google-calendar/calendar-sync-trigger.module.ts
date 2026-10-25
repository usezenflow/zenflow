import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { CalendarSyncTrigger } from "./calendar-sync-trigger.service";

/** Kept apart from the sync module so sessions can request a sync without a circular import. */
@Module({
  imports: [PrismaModule],
  providers: [CalendarSyncTrigger],
  exports: [CalendarSyncTrigger],
})
export class CalendarSyncTriggerModule {}
