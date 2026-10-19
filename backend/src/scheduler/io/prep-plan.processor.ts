import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import type { Job } from "bullmq";
import { KillSwitchService } from "../../common/killswitch/killswitch.service";
import { QueueWorkers } from "../../queue/queue-workers.service";
import { PREP_QUEUE, type PrepJobData } from "../../queue/queues";
import { PrismaService } from "../../prisma/prisma.service";
import { PrepPlanService, type PrepPlanOutcome } from "./prep-plan.service";

/**
 * Consumer of the `prep-plan` queue (level-up plan, Phase 1). A parent that is
 * gone, already submitted, or no longer an exam or assignment is dropped
 * without an attempt, and so is one the student skipped.
 */
@Injectable()
export class PrepPlanProcessor implements OnModuleInit {
  private readonly logger = new Logger(PrepPlanProcessor.name);

  constructor(
    private readonly workers: QueueWorkers,
    private readonly killSwitch: KillSwitchService,
    private readonly prisma: PrismaService,
    private readonly prep: PrepPlanService,
  ) {}

  onModuleInit(): void {
    this.workers.register(PREP_QUEUE, (job) => this.process(job));
  }

  async process(job: Job<PrepJobData>): Promise<PrepPlanOutcome | null> {
    if (!(await this.killSwitch.isEnabled("ingestion"))) {
      this.logger.warn(`ingestion disabled, dropping prep job ${job.id}`);
      return null;
    }
    const { userId, parentSessionId } = job.data;
    const parent = await this.prisma.session.findFirst({
      where: {
        id: parentSessionId,
        userId,
        deleted: false,
        type: { in: ["EXAM", "ASSIGNMENT"] },
      },
      select: {
        id: true,
        title: true,
        type: true,
        scheduledStartTime: true,
        submittedAt: true,
        skipped: true,
      },
    });
    if (!parent?.scheduledStartTime) return null;
    if (parent.submittedAt || parent.skipped) return null;

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) return null;

    const outcome = await this.prep.planFor(
      user,
      {
        id: parent.id,
        title: parent.title,
        kind: parent.type as "EXAM" | "ASSIGNMENT",
        deadline: parent.scheduledStartTime,
      },
      new Date(),
    );
    this.logger.log(`prep for ${parent.id}: ${outcome.status}`);
    return outcome;
  }
}
