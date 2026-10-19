import { Module } from "@nestjs/common";
import { SessionsService } from "./sessions.service";
import { SessionCrudService } from "./session-crud.service";
import { SeriesService } from "./series.service";
import { SessionUpdateService } from "./session-update.service";
import { SlotPickService } from "./slot-pick.service";
import { SessionSearchService } from "./session-search.service";
import { SessionsController } from "./sessions.controller";
import { PrismaModule } from "../prisma/prisma.module";
import { TagsModule } from "../tags/tags.module";
import { RemindersModule } from "../reminders/reminders.module";
import { FilesModule } from "../files/files.module";
import { SchedulerModule } from "../scheduler/scheduler.module";
import { SpiritsModule } from "../spirits/spirits.module";
import { StreaksModule } from "../streaks/streaks.module";
import { SessionCheckOffService } from "./session-check-off.service";
import { PlacementPlanService } from "./placement-plan.service";

@Module({
  imports: [
    PrismaModule,
    TagsModule,
    SchedulerModule,
    RemindersModule,
    FilesModule,
    StreaksModule,
    SpiritsModule,
  ],
  controllers: [SessionsController],
  providers: [
    SessionsService,
    SessionCrudService,
    SeriesService,
    SessionUpdateService,
    SlotPickService,
    SessionSearchService,
    SessionCheckOffService,
    PlacementPlanService,
  ],
  exports: [SessionsService],
})
export class SessionsModule {}
