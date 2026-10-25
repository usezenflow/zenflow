import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { QueueService } from "../queue/queue.service";
import { idempotencyKey } from "../queue/queue.types";
import { CALENDAR_QUEUE, type CalendarJobType } from "../queue/queues";

const BUCKET_MS = 5_000;
/** A user with no connection is not re-checked for this long, so plain writes stay cheap. */
const NO_CONNECTION_TTL_MS = 60_000;
const NO_CONNECTION_MAX = 10_000;

/** Asks the worker to sync or pull a user's calendar. Never throws: a missed request is caught by the sweep. */
@Injectable()
export class CalendarSyncTrigger {
  private readonly logger = new Logger(CalendarSyncTrigger.name);
  private readonly unconnected = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
  ) {}

  async request(
    userId: string,
    type: CalendarJobType = "sync",
    delayMs = 2_000,
  ): Promise<void> {
    try {
      const until = this.unconnected.get(userId);
      if (until && until > Date.now()) return;
      const connection = await this.prisma.calendarConnection.findUnique({
        where: { userId },
        select: { status: true },
      });
      if (connection?.status !== "ACTIVE") {
        if (this.unconnected.size >= NO_CONNECTION_MAX)
          this.unconnected.clear();
        this.unconnected.set(userId, Date.now() + NO_CONNECTION_TTL_MS);
        return;
      }
      await this.enqueue(userId, type, delayMs);
    } catch (error) {
      this.logger.warn(
        `Couldn't queue a calendar ${type} for ${userId}: ${(error as Error).message}`,
      );
    }
  }

  /** For callers that already know the user is connected (sweep, webhook, connect). */
  enqueue(userId: string, type: CalendarJobType, delayMs = 0) {
    this.unconnected.delete(userId);
    return this.queue.enqueue(
      CALENDAR_QUEUE,
      { userId, type },
      {
        jobId: idempotencyKey(
          "cal",
          type,
          userId,
          Math.floor(Date.now() / BUCKET_MS),
        ),
        delayMs,
      },
    );
  }
}
