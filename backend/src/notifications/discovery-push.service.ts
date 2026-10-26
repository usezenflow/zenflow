import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { PrismaService } from "../prisma/prisma.service";
import { runCronJob } from "../observability/cron";
import { NotificationsService } from "./notifications.service";
import { NotificationEvent } from "./types";

const DAY_MS = 24 * 60 * 60_000;

/** Days after the first synced event on which each discovery push is due. */
export const DISCOVERY_PUSH_DAYS = [1, 3, 7] as const;

/** Copy for the push at the same index. Vietnamese copy lives in localize-notification.ts. */
const DISCOVERY_COPY = [
  {
    title: "Ask your assistant",
    content: "Try asking what is on your schedule this week.",
  },
  {
    title: "Add a task by chat",
    content: "Tell it what to do and when it is due.",
  },
  {
    title: "Undo a change",
    content: "Ask your assistant to undo its last change.",
  },
];

/**
 * Sends each user at most {@link DISCOVERY_PUSH_DAYS} discovery pushes, the
 * next one once its day has passed since the first calendar sync. The sent
 * count is read from the stored `discovery.*` rows, so a rerun sends nothing
 * twice.
 */
@Injectable()
export class DiscoveryPushService {
  private readonly logger = new Logger(DiscoveryPushService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async handleCron(): Promise<void> {
    await runCronJob("discovery-push", async () => {
      const count = await this.sweep();
      if (count > 0) this.logger.log(`Sent ${count} discovery push(es)`);
    });
  }

  /** Returns how many pushes were sent. `now` is injectable for tests. */
  async sweep(now = new Date()): Promise<number> {
    // shortcut: `syncedAt` is refreshed when a link is rewritten, so the
    // minimum can drift later than the first sync; add a first-sync column
    // when that matters.
    const [firsts, sent] = await Promise.all([
      this.prisma.calendarLink.groupBy({
        by: ["userId"],
        _min: { syncedAt: true },
      }),
      this.prisma.notification.groupBy({
        by: ["userId"],
        where: { eventName: { startsWith: "discovery." } },
        _count: { _all: true },
      }),
    ]);
    const sentByUser = new Map(sent.map((s) => [s.userId, s._count._all]));

    let count = 0;
    for (const { userId, _min } of firsts) {
      const firstSync = _min.syncedAt;
      const done = sentByUser.get(userId) ?? 0;
      if (!firstSync || done >= DISCOVERY_PUSH_DAYS.length) continue;
      const due = firstSync.getTime() + DISCOVERY_PUSH_DAYS[done] * DAY_MS;
      if (now.getTime() < due) continue;
      try {
        const row = await this.notifications.create(userId, {
          eventName: `discovery.${done + 1}`,
          ...DISCOVERY_COPY[done],
          sessionId: null,
          eventEndsAt: null,
          materializeSession: false,
        });
        this.notifications.notify(NotificationEvent.NEW_SESSION, row);
        count++;
      } catch (err) {
        this.logger.warn(
          `discovery push failed for ${userId}: ${(err as Error).message}`,
        );
      }
    }
    return count;
  }
}
