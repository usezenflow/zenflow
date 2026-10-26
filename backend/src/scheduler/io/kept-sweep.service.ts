import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import {
  SessionEventType,
  SessionSource,
  SessionType,
} from "../../../generated/prisma";
import { PrismaService } from "../../prisma/prisma.service";
import { runCronJob } from "../../observability/cron";
import { recordSessionEvent } from "../../sessions/session-events";
import {
  KEPT_GRACE_MS,
  KEPT_LOOKBACK_MS,
  PREFERENCE_KEPT_WEIGHT,
  SESSION_KEPT_REWARD,
} from "../constants";
import { keptReward } from "../core/reward";
import { SchedulingFeedbackService } from "./scheduling-feedback.service";

/** Placements handled per run, so one run never grows without bound. */
const BATCH_SIZE = 200;

/**
 * Settles the recommendation signal. An engine-placed TASK whose slot began and
 * was never moved is `KEPT`: one event, rewarded in LinUCB and in the
 * preference matrix. A move is graded where it happens (`MOVE`), so the two
 * signals never overlap. Running again changes nothing: a placement with a
 * `KEPT` event is skipped.
 */
@Injectable()
export class KeptSweepService {
  private readonly logger = new Logger(KeptSweepService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly feedback: SchedulingFeedbackService,
  ) {}

  @Cron(CronExpression.EVERY_10_MINUTES)
  async handleCron(): Promise<void> {
    await runCronJob("kept-sweep", async () => {
      const count = await this.sweep();
      if (count > 0) this.logger.log(`Settled ${count} kept placement(s)`);
    });
  }

  /** Returns how many placements were settled. `now` is injectable for tests. */
  async sweep(now = new Date()): Promise<number> {
    const rows = await this.prisma.session.findMany({
      where: {
        type: SessionType.TASK,
        deleted: false,
        source: { in: [SessionSource.USER, SessionSource.AUTO] },
        lastMovedAt: null,
        scheduledStartTime: {
          gte: new Date(now.getTime() - KEPT_LOOKBACK_MS),
          lt: new Date(now.getTime() - KEPT_GRACE_MS),
        },
        events: { none: { eventType: SessionEventType.KEPT } },
      },
      select: {
        id: true,
        userId: true,
        type: true,
        durationMinutes: true,
        scheduledStartTime: true,
        user: { select: { timezone: true } },
      },
      orderBy: { scheduledStartTime: "asc" },
      take: BATCH_SIZE,
    });

    let settled = 0;
    for (const row of rows) {
      try {
        await this.settle(row, now);
        settled++;
      } catch (err) {
        this.logger.warn(
          `kept settle failed for ${row.id}: ${(err as Error).message}`,
        );
      }
    }
    return settled;
  }

  private async settle(
    row: {
      id: string;
      userId: string;
      type: SessionType;
      durationMinutes: number;
      scheduledStartTime: Date | null;
      user: { timezone: string };
    },
    now: Date,
  ): Promise<void> {
    const start = row.scheduledStartTime!;
    const event = await this.prisma.sessionEvent.create({
      data: {
        sessionId: row.id,
        userId: row.userId,
        eventType: SessionEventType.KEPT,
        newSnapshot: {
          scheduledStartTime: start.toISOString(),
          durationMinutes: row.durationMinutes,
          type: row.type,
        },
        rewardScore: keptReward(),
        occurredAt: now,
      },
      select: { id: true },
    });
    recordSessionEvent(SessionEventType.KEPT);
    await this.feedback.applyDelayedReward(
      row.userId,
      row.id,
      event.id,
      keptReward(),
      null,
    );
    await this.feedback.reinforcePreferenceMatrix(
      row.userId,
      start.getTime(),
      row.user.timezone,
      PREFERENCE_KEPT_WEIGHT * SESSION_KEPT_REWARD,
    );
  }
}
