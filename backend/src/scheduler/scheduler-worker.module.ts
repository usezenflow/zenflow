import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { SpiritsModule } from "../spirits/spirits.module";
import { SchedulerModule } from "./scheduler.module";
import { MatrixDecayService } from "./io/matrix-decay.service";
import { SessionOutcomeService } from "./io/session-outcome.service";
import { SessionEventPartitionService } from "./io/session-event-partition.service";

/**
 * Worker-only scheduler crons (matrix decay, session-outcome sweep, SessionEvent partition upkeep), kept out
 * of {@link SchedulerModule} so API processes register none (ADR-0011).
 */
@Module({
  imports: [PrismaModule, SchedulerModule, SpiritsModule],
  providers: [
    MatrixDecayService,
    SessionOutcomeService,
    SessionEventPartitionService,
  ],
})
export class SchedulerWorkerModule {}
