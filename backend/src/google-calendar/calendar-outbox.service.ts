import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Client } from "pg";
import { databaseUrl } from "../common/config/connections";
import { PrismaService } from "../prisma/prisma.service";
import { CalendarSyncService } from "./calendar-sync.service";

/** Channel the `Session` trigger NOTIFYs when it marks a user dirty. */
export const OUTBOX_CHANNEL = "calendar_outbox";

const POLL_MS = 30_000;
const RECONNECT_MS = 5_000;
const BATCH = 20;
/** A claimed row is retried by another replica if this process dies mid-sync. */
const LEASE_S = 300;
const BASE_BACKOFF_MS = 30_000;
const MAX_BACKOFF_MS = 60 * 60_000;

/** Wait before the next try after `attempts` consecutive failures. */
export function backoffMs(attempts: number): number {
  return Math.min(
    MAX_BACKOFF_MS,
    BASE_BACKOFF_MS * 2 ** Math.max(0, attempts - 1),
  );
}

type OutboxRow = { userId: string; dirtyAt: Date; attempts: number };

/**
 * The calendar outbox process. Wakes on the `calendar_outbox` NOTIFY and on a
 * fixed poll (the poll covers a dropped LISTEN connection and notifications
 * sent while this process was down). Each claimed user is synced with
 * {@link CalendarSyncService.syncUser}; a row is removed only if the user was
 * not dirtied again during the sync, so no change is lost.
 */
@Injectable()
export class CalendarOutboxService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CalendarOutboxService.name);
  private listener?: Client;
  private timer?: NodeJS.Timeout;
  private reconnect?: NodeJS.Timeout;
  private draining?: Promise<void>;
  private closing = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly sync: CalendarSyncService,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.timer = setInterval(() => void this.drain(), POLL_MS);
    await this.listen();
    void this.drain();
  }

  async onModuleDestroy(): Promise<void> {
    this.closing = true;
    clearInterval(this.timer);
    clearTimeout(this.reconnect);
    await this.listener?.end().catch(() => undefined);
  }

  /** Runs one drain pass; overlapping calls share the pass in progress. */
  drain(): Promise<void> {
    this.draining ??= this.runPasses()
      .catch((error: unknown) => {
        this.logger.warn(`Calendar outbox pass failed: ${(error as Error).message}`);
      })
      .finally(() => {
        this.draining = undefined;
      });
    return this.draining;
  }

  private async runPasses(): Promise<void> {
    for (;;) {
      const batch = await this.claim();
      for (const row of batch) await this.process(row);
      if (batch.length < BATCH) return;
    }
  }

  private async listen(): Promise<void> {
    if (this.closing) return;
    const client = new Client({
      connectionString: databaseUrl((key) => this.config.get(key)),
    });
    const retry = () => {
      this.listener = undefined;
      if (this.closing) return;
      clearTimeout(this.reconnect);
      this.reconnect = setTimeout(() => void this.listen(), RECONNECT_MS);
    };
    client.on("error", (error) => {
      this.logger.warn(`LISTEN connection lost: ${error.message}`);
      void client.end().catch(() => undefined);
      retry();
    });
    client.on("notification", () => void this.drain());
    try {
      await client.connect();
      await client.query(`LISTEN ${OUTBOX_CHANNEL}`);
      this.listener = client;
    } catch (error) {
      this.logger.warn(
        `LISTEN unavailable, polling every ${POLL_MS / 1000}s: ${(error as Error).message}`,
      );
      void client.end().catch(() => undefined);
      retry();
    }
  }

  /** Leases up to {@link BATCH} due users. `SKIP LOCKED` keeps replicas from taking the same row. */
  private claim(): Promise<OutboxRow[]> {
    return this.prisma.$queryRaw<OutboxRow[]>`
      UPDATE "CalendarSyncOutbox"
      SET "claimedUntil" = now() + make_interval(secs => ${LEASE_S})
      WHERE "userId" IN (
        SELECT "userId" FROM "CalendarSyncOutbox"
        WHERE "nextAttemptAt" <= now()
          AND ("claimedUntil" IS NULL OR "claimedUntil" < now())
        ORDER BY "nextAttemptAt"
        LIMIT ${BATCH}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING "userId", "dirtyAt", "attempts"`;
  }

  private async process(row: OutboxRow): Promise<void> {
    try {
      const summary = await this.sync.syncUser(row.userId);
      if (summary === null) {
        // No active connection any more: nothing to keep in sync.
        await this.prisma.$executeRaw`
          DELETE FROM "CalendarSyncOutbox"
          WHERE "userId" = ${row.userId}`;
        return;
      }
      if (summary.failed > 0 || summary.retryable > 0) {
        throw new Error(
          `${summary.failed} failed, ${summary.retryable} retryable writes`,
        );
      }
      // Remove the row unless a change arrived during the sync; then keep it
      // and release the lease so the next pass picks it up at once.
      const removed = await this.prisma.$executeRaw`
        DELETE FROM "CalendarSyncOutbox"
        WHERE "userId" = ${row.userId} AND "dirtyAt" = ${row.dirtyAt}`;
      if (removed === 0) {
        await this.prisma.$executeRaw`
          UPDATE "CalendarSyncOutbox"
          SET "claimedUntil" = NULL, "attempts" = 0, "lastError" = NULL
          WHERE "userId" = ${row.userId}`;
      }
    } catch (error) {
      const attempts = row.attempts + 1;
      const message = (error as Error).message.slice(0, 500);
      this.logger.warn(
        `Calendar sync failed for ${row.userId} (attempt ${attempts}): ${message}`,
      );
      const nextAttemptAt = new Date(Date.now() + backoffMs(attempts));
      await this.prisma.$executeRaw`
        UPDATE "CalendarSyncOutbox"
        SET "claimedUntil" = NULL,
            "attempts" = ${attempts},
            "lastError" = ${message},
            "nextAttemptAt" = ${nextAttemptAt}
        WHERE "userId" = ${row.userId}`;
    }
  }
}
