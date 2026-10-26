import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { BusyBlocksService } from "./busy-blocks.service";
import { DeviceCalendarController } from "./device-calendar.controller";

/** Busy time from the phone calendar. */
@Module({
  imports: [PrismaModule],
  controllers: [DeviceCalendarController],
  providers: [BusyBlocksService],
  exports: [BusyBlocksService],
})
export class CalendarBusyModule {}
