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
import { SessionSkipService } from "./session-skip.service";
import { SessionStartService } from "./session-start.service";
import { SessionDoneService } from "./session-done.service";
import { PlacementChipsService } from "./placement-chips.service";
import { PlacementPlanService } from "./placement-plan.service";
import { ApiTokensModule } from "../api-access/api-tokens.module";

@Module({
  imports: [
    PrismaModule,
    TagsModule,
    SchedulerModule,
    RemindersModule,
    FilesModule,
    ApiTokensModule,
  ],
  controllers: [SessionsController],
  providers: [
    SessionsService,
    SessionCrudService,
    SeriesService,
    SessionUpdateService,
    SlotPickService,
    SessionSearchService,
    SessionSkipService,
    SessionStartService,
    SessionDoneService,
    PlacementChipsService,
    PlacementPlanService,
  ],
  exports: [SessionsService],
})
export class SessionsModule {}
