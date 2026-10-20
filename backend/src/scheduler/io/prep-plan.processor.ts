import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import type { Job } from "bullmq";
import type { User } from "../../../generated/prisma";
import { KillSwitchService } from "../../common/killswitch/killswitch.service";
import { NotificationEvent } from "../../notifications/types";
import { NotificationsService } from "../../notifications/notifications.service";
import { QueueWorkers } from "../../queue/queue-workers.service";
import { PREP_QUEUE, type PrepJobData } from "../../queue/queues";
import { PrismaService } from "../../prisma/prisma.service";
import {
  PrepPlanService,
  type PrepOffer,
  type PrepPlanOutcome,
} from "./prep-plan.service";

/** "18:00, Fri" in the student's timezone. */
function whenLabel(d: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("hour")}:${get("minute")}, ${get("weekday")}`;
}

/**
 * Consumer of the `prep-plan` queue (level-up plan, Phase 1). A parent that is
 * gone, or no longer an exam or assignment, is dropped without an attempt, and
 * so is one the student skipped. A plan placed between two good times raises a
 * `plan_offer.prep` notification so the student can pick.
 */
@Injectable()
export class PrepPlanProcessor implements OnModuleInit {
  private readonly logger = new Logger(PrepPlanProcessor.name);

  constructor(
    private readonly workers: QueueWorkers,
    private readonly killSwitch: KillSwitchService,
    private readonly prisma: PrismaService,
    private readonly prep: PrepPlanService,
    private readonly notifications: NotificationsService,
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
        skipped: true,
      },
    });
    if (!parent?.scheduledStartTime) return null;
    if (parent.skipped) return null;

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
    if (outcome.status === "PLACED" && outcome.offer) {
      await this.raiseOffer(
        user,
        parent.title,
        outcome.sessionId,
        outcome.offer,
      );
    }
    return outcome;
  }

  /**
   * The "keep or prefer" offer for a prep plan placed between two good times.
   * `keep` is the time the scheduler applied; `prefer` is the other policy's.
   */
  private async raiseOffer(
    user: User,
    parentTitle: string,
    prepId: string,
    offer: PrepOffer,
  ): Promise<void> {
    const slots = [offer.primary, offer.alternative];
    const [keep, prefer] = slots.map((d) => whenLabel(d, user.timezone));
    const row = await this.notifications.create(user.id, {
      eventName: "plan_offer.prep",
      title: "Pick a time for your prep",
      content: `${parentTitle}: keep ${keep}, or prefer ${prefer}`,
      sessionId: prepId,
      eventEndsAt: null,
      materializeSession: false,
      slotProposalId: offer.slotProposalId,
      offerSlots: slots,
    });
    this.notifications.notify(NotificationEvent.NEW_SESSION, row);
  }
}
