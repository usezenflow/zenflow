import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import type { Job } from "bullmq";
import { KillSwitchService } from "../common/killswitch/killswitch.service";
import { PrismaService } from "../prisma/prisma.service";
import { QueueWorkers } from "../queue/queue-workers.service";
import { CALENDAR_QUEUE, type CalendarJobData } from "../queue/queues";
import { CalendarPullService } from "./calendar-pull.service";
import { CalendarSyncService } from "./calendar-sync.service";
import { CalendarSyncTrigger } from "./calendar-sync-trigger.service";
import { CalendarWatchService } from "./calendar-watch.service";
import { GoogleApiError } from "./google-calendar.client";
import { GoogleOAuthService } from "./google-oauth.service";

/** A sync of a large calendar can run for minutes; the lock is held that long. */
const LOCK_TIMEOUT_MS = 10 * 60_000;

/**
 * Consumer of the `calendar-sync` queue. A `sync` job writes the schedule to
 * Google and keeps the push channel alive; a `pull` job reads changes made in
 * Google. A rate limit or server error throws so BullMQ retries with backoff.
 */
@Injectable()
export class CalendarSyncProcessor implements OnModuleInit {
  private readonly logger = new Logger(CalendarSyncProcessor.name);

  constructor(
    private readonly workers: QueueWorkers,
    private readonly killSwitch: KillSwitchService,
    private readonly prisma: PrismaService,
    private readonly sync: CalendarSyncService,
    private readonly pull: CalendarPullService,
    private readonly watch: CalendarWatchService,
    private readonly oauth: GoogleOAuthService,
    private readonly trigger: CalendarSyncTrigger,
  ) {}

  onModuleInit(): void {
    this.workers.register(CALENDAR_QUEUE, (job) => this.process(job));
  }

  async process(job: Job<CalendarJobData>): Promise<void> {
    if (!(await this.killSwitch.isEnabled("notifications"))) {
      this.logger.warn(`calendar jobs paused, dropping ${job.id}`);
      return;
    }
    const { userId, type } = job.data;
    // One sync or pull per user at a time: a push and a sweep must not write the same events.
    await this.withUserLock(userId, async () => {
      if (type === "pull") {
        const result = await this.pull.pullUser(userId);
        if (result && result.restored + result.applied > 0)
          await this.trigger.enqueue(userId, "sync");
        return;
      }

      const summary = await this.sync.syncUser(userId);
      if (!summary) return;
      await this.keepChannel(userId);
      if (summary.retryable > 0) {
        throw new Error(
          `${summary.retryable} calendar writes deferred for ${userId}`,
        );
      }
    });
  }

  /** Holds a Postgres advisory lock for the user's calendar work until `fn` finishes. */
  private withUserLock<T>(userId: string, fn: () => Promise<T>): Promise<T> {
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`calendar:${userId}`}))`;
        return fn();
      },
      { timeout: LOCK_TIMEOUT_MS, maxWait: LOCK_TIMEOUT_MS },
    );
  }

  /** The channel is best effort: the sweep and pull job cover a missed push. */
  private async keepChannel(userId: string): Promise<void> {
    try {
      const connection = await this.prisma.calendarConnection.findUnique({
        where: { userId },
      });
      if (!connection || connection.status !== "ACTIVE") return;
      const token = await this.oauth.accessToken(
        userId,
        connection.refreshTokenEnc,
      );
      await this.watch.ensure(connection, token);
    } catch (error) {
      if (error instanceof GoogleApiError && error.authRevoked) {
        await this.sync.needsReconnect(userId, "Google access was revoked");
        return;
      }
      this.logger.warn(
        `Calendar channel for ${userId}: ${(error as Error).message}`,
      );
    }
  }
}
