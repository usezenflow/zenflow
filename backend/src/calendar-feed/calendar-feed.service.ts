import { Injectable } from "@nestjs/common";
import type { CalendarFeedResponse } from "@zenflow/shared";
import { createHash, randomBytes } from "crypto";
import { type User } from "../../generated/prisma";
import { PrismaService } from "../prisma/prisma.service";
import { expandRrule } from "../scheduler/core/recurrence";
import { buildIcs, type IcsEvent } from "./ics";

const MS_PER_MINUTE = 60_000;
const DAY_MS = 24 * 60 * MS_PER_MINUTE;
/** The feed covers two weeks back and 180 days ahead, rebuilt on every fetch. */
const PAST_DAYS = 14;
const FUTURE_DAYS = 180;

const sha256 = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

/**
 * Read-only ICS feed of the user's sessions for external calendars. The URL
 * carries a 256-bit secret; only its SHA-256 is stored, so the secret is shown
 * once on create or rotate. Recurring series are expanded in the user's zone
 * and emitted as concrete UTC events, so DST never shifts a series.
 */
@Injectable()
export class CalendarFeedService {
  constructor(private readonly prisma: PrismaService) {}

  async status(user: User): Promise<CalendarFeedResponse> {
    const row = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { calendarFeedTokenHash: true, calendarFeedCreatedAt: true },
    });
    return {
      enabled: Boolean(row?.calendarFeedTokenHash),
      createdAt: row?.calendarFeedCreatedAt?.toISOString() ?? null,
      path: null,
    };
  }

  /** Creates the feed, or replaces its secret so the old URL stops working. */
  async rotate(
    user: User,
    now: Date = new Date(),
  ): Promise<CalendarFeedResponse> {
    const token = randomBytes(32).toString("base64url");
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        calendarFeedTokenHash: sha256(token),
        calendarFeedCreatedAt: now,
      },
    });
    return {
      enabled: true,
      createdAt: now.toISOString(),
      path: `/api/v1/calendar/${token}.ics`,
    };
  }

  async revoke(user: User): Promise<CalendarFeedResponse> {
    await this.prisma.user.update({
      where: { id: user.id },
      data: { calendarFeedTokenHash: null, calendarFeedCreatedAt: null },
    });
    return { enabled: false, createdAt: null, path: null };
  }

  /** The feed for a secret, or null when no user holds it. */
  async render(token: string, now: Date = new Date()): Promise<string | null> {
    const user = await this.prisma.user.findUnique({
      where: { calendarFeedTokenHash: sha256(token) },
      select: { id: true, timezone: true },
    });
    if (!user) return null;
    const events = await this.events(user.id, user.timezone, now);
    return buildIcs(events, now);
  }

  private async events(
    userId: string,
    tz: string,
    now: Date,
  ): Promise<IcsEvent[]> {
    const from = new Date(now.getTime() - PAST_DAYS * DAY_MS);
    const to = new Date(now.getTime() + FUTURE_DAYS * DAY_MS);

    const rows = await this.prisma.session.findMany({
      where: {
        userId,
        deleted: false,
        scheduledStartTime: { not: null },
        OR: [
          { scheduledStartTime: { gte: from, lt: to } },
          { seriesId: { not: null } },
        ],
      },
      select: {
        id: true,
        title: true,
        seriesId: true,
        scheduledStartTime: true,
        durationMinutes: true,
        skipped: true,
        series: { select: { rrule: true, exdates: true, skippedFrom: true } },
      },
    });

    const skippedOccurrences =
      await this.prisma.sessionOccurrenceState.findMany({
        where: {
          userId,
          skipped: true,
          occurrenceStart: { gte: from, lt: to },
        },
        select: { seriesId: true, occurrenceStart: true },
      });
    const skipped = new Set(
      skippedOccurrences.map(
        (s) => `${s.seriesId}|${s.occurrenceStart.getTime()}`,
      ),
    );

    const events: IcsEvent[] = [];
    for (const row of rows) {
      if (!row.scheduledStartTime) continue;
      const summary = row.title || "Session";
      const length = row.durationMinutes * MS_PER_MINUTE;

      if (row.seriesId && row.series?.rrule) {
        const starts = expandRrule(
          row.series.rrule,
          row.scheduledStartTime,
          from,
          to,
          tz,
          row.series.exdates,
        );
        for (const start of starts) {
          if (skipped.has(`${row.seriesId}|${start.getTime()}`)) continue;
          if (row.series.skippedFrom && start >= row.series.skippedFrom)
            continue;
          events.push({
            uid: `${row.seriesId}-${start.getTime()}@zenflow`,
            summary,
            start,
            end: new Date(start.getTime() + length),
          });
        }
        continue;
      }

      if (row.skipped) continue;
      const start = row.scheduledStartTime;
      if (start < from || start >= to) continue;
      events.push({
        uid: `${row.id}@zenflow`,
        summary,
        start,
        end: new Date(start.getTime() + length),
      });
    }
    return events;
  }
}
