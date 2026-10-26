import { Module } from "@nestjs/common";
import { SessionsService } from "./sessions.service";
import { SessionCrudService } from "./session-crud.service";
import { SeriesService } from "./series.service";
import { SessionUpdateService } from "./session-update.service";
import { SlotPickService } from "./slot-pick.service";
import { SessionsController } from "./sessions.controller";
import { PrismaModule } from "../prisma/prisma.module";
import { SchedulerModule } from "../scheduler/scheduler.module";
import { PlacementChipsService } from "./placement-chips.service";
import { PlacementPlanService } from "./placement-plan.service";
import { ReplanService } from "./replan.service";
import { ApiTokensModule } from "../api-access/api-tokens.module";
import { CalendarSyncTriggerModule } from "../google-calendar/calendar-sync-trigger.module";

@Module({
  imports: [
    PrismaModule,
    SchedulerModule,
    ApiTokensModule,
    CalendarSyncTriggerModule,
  ],
  controllers: [SessionsController],
  providers: [
    SessionsService,
    SessionCrudService,
    SeriesService,
    SessionUpdateService,
    SlotPickService,
    PlacementChipsService,
    PlacementPlanService,
    ReplanService,
  ],
  exports: [SessionsService, PlacementPlanService, ReplanService],
})
export class SessionsModule {}
