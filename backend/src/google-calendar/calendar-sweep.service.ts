import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { PrismaService } from "../prisma/prisma.service";
import { CalendarSyncTrigger } from "./calendar-sync-trigger.service";
import { GoogleCalendarConfig } from "./google-calendar.config";
import { RENEW_BEFORE_MS } from "./calendar-watch.service";

const STALE_MS = 4 * 60_000;
const BATCH = 500;

/**
 * Safety net on the watcher: re-syncs every connection that has not run
 * lately. It covers writers that do not request a sync (scheduler, ingestion)
 * and pushes Google never delivered.
 */
@Injectable()
export class CalendarSweepService {
  private readonly logger = new Logger(CalendarSweepService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly trigger: CalendarSyncTrigger,
    private readonly config: GoogleCalendarConfig,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async sweep(): Promise<void> {
    if (!this.config.available) return;
    const stale = await this.prisma.calendarConnection.findMany({
      where: {
        status: "ACTIVE",
        OR: [
          { lastSyncedAt: null },
          { lastSyncedAt: { lt: new Date(Date.now() - STALE_MS) } },
        ],
      },
      orderBy: { lastSyncedAt: { sort: "asc", nulls: "first" } },
      take: BATCH,
      select: { userId: true },
    });
    // Push channels lapse on Google's clock, not ours: renew before they do.
    const expiring = await this.prisma.calendarConnection.findMany({
      where: {
        status: "ACTIVE",
        channelExpiresAt: { lt: new Date(Date.now() + RENEW_BEFORE_MS) },
      },
      take: BATCH,
      select: { userId: true },
    });
    for (const { userId } of [...stale, ...expiring]) {
      try {
        await this.trigger.enqueue(userId, "pull");
        await this.trigger.enqueue(userId, "sync");
      } catch (error) {
        this.logger.warn(
          `Sweep enqueue failed for ${userId}: ${(error as Error).message}`,
        );
      }
    }
  }
}
