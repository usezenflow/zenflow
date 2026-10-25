import { Injectable } from "@nestjs/common";
import type {
  BufferItem,
  FocusCell,
  InsightsResponse,
  WeeklyRecap,
} from "@zenflow/shared";
import { Prisma, type User } from "../../generated/prisma";
import { PrismaService } from "../prisma/prisma.service";
import { addDaysStr, DAY_MS, MS_PER_MINUTE } from "../scheduler/core/slot";
import { minutesToUtc } from "../common/utils";
import { resolveWindow } from "./insights-window";
import type { InsightsQueryDto } from "./dto/insights-query.dto";

/** Exams and assignments due within this many days get a buffer meter. */
export const BUFFER_HORIZON_DAYS = 30;

type InsightsUser = Pick<User, "id" | "timezone">;

/**
 * Read-only aggregates over the caller's own `SessionEvent` rows and sessions.
 * Every query is an aggregate: no events or sessions are loaded for counting.
 */
@Injectable()
export class InsightsService {
  constructor(private readonly prisma: PrismaService) {}

  async summarize(
    user: InsightsUser,
    query: InsightsQueryDto,
    now: Date = new Date(),
  ): Promise<InsightsResponse> {
    const window = resolveWindow(query, user.timezone, now);
    const fromAt = minutesToUtc(window.from, 0, user.timezone);
    const toAt = minutesToUtc(addDaysStr(window.to, 1), 0, user.timezone);
    const [focus, recap, buffers] = await Promise.all([
      this.focus(user, fromAt, toAt),
      this.recap(user.id, fromAt, toAt),
      this.buffers(user.id, now),
    ]);
    return { window, focus, recap, buffers };
  }

  /** Full 7×24 grid, Monday-first, zero where no DONE event fell. */
  private async focus(
    user: InsightsUser,
    fromAt: Date,
    toAt: Date,
  ): Promise<FocusCell[]> {
    const rows = await this.prisma.$queryRaw<
      { weekday: number; hour: number; done: number }[]
    >`
      SELECT (EXTRACT(ISODOW FROM (e."occurredAt" AT TIME ZONE 'UTC') AT TIME ZONE ${user.timezone}::text))::int - 1 AS weekday,
             EXTRACT(HOUR FROM (e."occurredAt" AT TIME ZONE 'UTC') AT TIME ZONE ${user.timezone}::text)::int AS hour,
             count(*)::int AS done
      FROM "SessionEvent" e
      WHERE e."userId" = ${user.id}
        AND e."eventType" = 'DONE'
        AND e."occurredAt" >= ${fromAt}
        AND e."occurredAt" < ${toAt}
      GROUP BY 1, 2`;
    const counts = new Map(rows.map((r) => [r.weekday * 24 + r.hour, r.done]));
    return Array.from({ length: 7 * 24 }, (_, i) => ({
      weekday: Math.floor(i / 24),
      hour: i % 24,
      done: counts.get(i) ?? 0,
    }));
  }

  private async recap(
    userId: string,
    fromAt: Date,
    toAt: Date,
  ): Promise<WeeklyRecap> {
    const placed: Prisma.SessionWhereInput = {
      userId,
      type: "TASK",
      deleted: false,
      skipped: false,
      scheduledStartTime: { gte: fromAt, lt: toAt },
    };
    const [planned, done, notThisTimeCount, onTimeCount] = await Promise.all([
      this.prisma.session.aggregate({
        where: placed,
        _sum: { durationMinutes: true },
      }),
      this.prisma.session.aggregate({
        where: { ...placed, events: { some: { eventType: "DONE" } } },
        _sum: { durationMinutes: true },
      }),
      this.prisma.session.count({
        where: {
          userId,
          type: "TASK",
          deleted: false,
          skipped: true,
          scheduledStartTime: { gte: fromAt, lt: toAt },
        },
      }),
      this.onTimeCount(userId, fromAt, toAt),
    ]);
    return {
      plannedMinutes: planned._sum.durationMinutes ?? 0,
      doneMinutes: done._sum?.durationMinutes ?? 0,
      notThisTimeCount,
      onTimeCount,
    };
  }

  /** Done placed TASKs whose first DONE event is before their deadline. */
  private async onTimeCount(
    userId: string,
    fromAt: Date,
    toAt: Date,
  ): Promise<number> {
    const [row] = await this.prisma.$queryRaw<{ count: number }[]>`
      SELECT count(*)::int AS count
      FROM "Session" s
      WHERE s."userId" = ${userId}
        AND s.type = 'TASK'
        AND s.deleted = false
        AND s.skipped = false
        AND s.deadline IS NOT NULL
        AND s."scheduledStartTime" >= ${fromAt}
        AND s."scheduledStartTime" < ${toAt}
        AND (
          SELECT min(e."occurredAt")
          FROM "SessionEvent" e
          WHERE e."sessionId" = s.id AND e."eventType" = 'DONE'
        ) < s.deadline`;
    return row?.count ?? 0;
  }

  /**
   * Per upcoming EXAM or ASSIGNMENT: whole days between the last unfinished
   * prep TASK's end (prep starting before the due time) and the due time.
   */
  private async buffers(userId: string, now: Date): Promise<BufferItem[]> {
    const horizon = new Date(now.getTime() + BUFFER_HORIZON_DAYS * DAY_MS);
    const parents = await this.prisma.session.findMany({
      where: {
        userId,
        deleted: false,
        skipped: false,
        type: { in: ["EXAM", "ASSIGNMENT"] },
        scheduledStartTime: { gte: now, lte: horizon },
      },
      select: { id: true, title: true, type: true, scheduledStartTime: true },
      orderBy: { scheduledStartTime: "asc" },
    });
    if (parents.length === 0) return [];

    const preps = await this.prisma.session.findMany({
      where: {
        userId,
        type: "TASK",
        deleted: false,
        skipped: false,
        events: { none: { eventType: "DONE" } },
        prepForSessionId: { in: parents.map((p) => p.id) },
        scheduledStartTime: { not: null },
      },
      select: {
        prepForSessionId: true,
        scheduledStartTime: true,
        durationMinutes: true,
      },
    });

    const items: BufferItem[] = [];
    for (const parent of parents) {
      if (parent.type !== "EXAM" && parent.type !== "ASSIGNMENT") {
        continue;
      }
      if (!parent.scheduledStartTime) continue;
      const dueMs = parent.scheduledStartTime.getTime();
      const ends = preps
        .filter(
          (p) =>
            p.prepForSessionId === parent.id &&
            p.scheduledStartTime !== null &&
            p.scheduledStartTime.getTime() < dueMs,
        )
        .map(
          (p) =>
            p.scheduledStartTime!.getTime() + p.durationMinutes * MS_PER_MINUTE,
        );
      const lastEnd = ends.length > 0 ? Math.max(...ends) : null;
      items.push({
        sessionId: parent.id,
        title: parent.title,
        type: parent.type,
        dueAt: parent.scheduledStartTime.toISOString(),
        bufferDays:
          lastEnd === null
            ? null
            : Math.max(0, Math.floor((dueMs - lastEnd) / DAY_MS)),
      });
    }
    return items;
  }
}
