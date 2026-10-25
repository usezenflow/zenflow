import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { CalendarFeedService } from "./calendar-feed.service";
import {
  CalendarFeedController,
  CalendarFeedManageController,
} from "./calendar-feed.controller";

@Module({
  imports: [PrismaModule],
  controllers: [CalendarFeedController, CalendarFeedManageController],
  providers: [CalendarFeedService],
})
export class CalendarFeedModule {}
