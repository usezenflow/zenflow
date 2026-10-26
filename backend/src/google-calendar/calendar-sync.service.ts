import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { NotificationsService } from "../notifications/notifications.service";
import {
  eventIdOf,
  inviteKeyOf,
  payloadHash,
  seriesEvent,
  sessionEvent,
  type EventContext,
  type GoogleEventBody,
} from "./event-mapper";
import { GoogleApiError, GoogleCalendarClient } from "./google-calendar.client";
import { GoogleCalendarConfig } from "./google-calendar.config";
import { GoogleOAuthService } from "./google-oauth.service";

const DAY_MS = 86_400_000;
/** Sessions this far back or ahead are kept in step; older events are left as history. */
const PAST_DAYS = 2;
const AHEAD_DAYS = 120;
const CONCURRENCY = 4;

interface Desired {
  eventId: string;
  sessionId?: string;
  seriesId?: string;
  body: GoogleEventBody;
  hash: string;
}

export interface SyncSummary {
  written: number;
  deleted: number;
  failed: number;
  /** Failures worth another attempt; the job should be retried. */
  retryable: number;
}

/**
 * Makes a user's Google calendar match their schedule. Zenflow is the source
 * of truth: it builds the events it wants, compares each to the hash last
 * written (`CalendarLink`), and writes only the differences. Because it diffs
 * state rather than reacting to events, every writer (API, scheduler,
 * ingestion) is covered and a repeated run changes nothing.
 */
@Injectable()
export class CalendarSyncService {
  private readonly logger = new Logger(CalendarSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly oauth: GoogleOAuthService,
    private readonly client: GoogleCalendarClient,
    private readonly config: GoogleCalendarConfig,
    private readonly notifications: NotificationsService,
  ) {}

  async syncUser(
    userId: string,
    now = new Date(),
  ): Promise<SyncSummary | null> {
    const connection = await this.prisma.calendarConnection.findUnique({
      where: { userId },
    });
    if (!connection || connection.status !== "ACTIVE") return null;
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        timezone: true,
        defaultReminderMinutes: true,
        calendarTarget: true,
      },
    });
    if (user.calendarTarget !== "GOOGLE") return null;

    const summary: SyncSummary = {
      written: 0,
      deleted: 0,
      failed: 0,
      retryable: 0,
    };
    try {
      const token = await this.oauth.accessToken(
        userId,
        connection.refreshTokenEnc,
      );
      const ctx: EventContext = {
        timezone: user.timezone,
        defaultReminderMinutes: user.defaultReminderMinutes,
        appUrl: this.config.webUrl,
      };

      const desired = await this.desired(userId, ctx, now);
      const links = await this.prisma.calendarLink.findMany({
        where: { userId },
      });
      const linked = new Map(links.map((l) => [l.eventId, l]));

      const writes = desired.filter(
        (d) => linked.get(d.eventId)?.payloadHash !== d.hash,
      );
      const removals = await this.staleLinks(userId, links, desired);
      const calendarId = connection.googleCalendarId;

      const failures = await this.inChunks(writes, async (d) => {
        const link = linked.get(d.eventId);
        const inviteKey = inviteKeyOf(d.body);
        const etag = await this.client.writeEvent(
          token,
          calendarId,
          d.eventId,
          d.body,
          {
            exists: !!link,
            etag: link?.etag ?? null,
            notify: inviteKey !== null && inviteKey !== link?.inviteKey,
          },
        );
        await this.prisma.calendarLink.upsert({
          where: { userId_eventId: { userId, eventId: d.eventId } },
          create: {
            userId,
            eventId: d.eventId,
            sessionId: d.sessionId,
            seriesId: d.seriesId,
            payloadHash: d.hash,
            etag,
            inviteKey,
            syncedAt: now,
          },
          update: {
            sessionId: d.sessionId,
            seriesId: d.seriesId,
            payloadHash: d.hash,
            etag,
            inviteKey,
            syncedAt: now,
          },
        });
        summary.written++;
      });
      failures.push(
        ...(await this.inChunks(removals, async (l) => {
          await this.client.deleteEvent(token, calendarId, l.eventId);
          await this.prisma.calendarLink.delete({ where: { id: l.id } });
          summary.deleted++;
        })),
      );

      for (const error of failures) {
        if (error instanceof GoogleApiError && error.authRevoked) throw error;
        summary.failed++;
        if (error instanceof GoogleApiError && error.retryable)
          summary.retryable++;
        else
          this.logger.warn(
            `Calendar write failed for ${userId}: ${(error as Error).message}`,
          );
      }
      await this.prisma.calendarConnection.update({
        where: { userId },
        data: {
          lastSyncedAt: now,
          lastError:
            summary.failed > 0
              ? `${summary.failed} events could not be written`
              : null,
        },
      });
      return summary;
    } catch (error) {
      if (error instanceof GoogleApiError && error.authRevoked) {
        await this.needsReconnect(userId, "Google access was revoked");
        return summary;
      }
      throw error;
    }
  }

  /** Marks the connection unusable and tells the user once. */
  async needsReconnect(userId: string, reason: string): Promise<void> {
    this.oauth.forget(userId);
    const updated = await this.prisma.calendarConnection.updateMany({
      where: { userId, status: "ACTIVE" },
      data: { status: "NEEDS_RECONNECT", lastError: reason },
    });
    if (updated.count === 0) return;
    await this.notifications.create(userId, {
      title: "Reconnect Google Calendar",
      content: "Your Google link stopped working. Connect again in settings.",
      eventName: "calendar.reconnect",
      sessionId: null,
      eventEndsAt: null,
      materializeSession: false,
    });
  }

  private async desired(
    userId: string,
    ctx: EventContext,
    now: Date,
  ): Promise<Desired[]> {
    const from = new Date(now.getTime() - PAST_DAYS * DAY_MS);
    const to = new Date(now.getTime() + AHEAD_DAYS * DAY_MS);
    const select = {
      id: true,
      title: true,
      type: true,
      location: true,
      durationMinutes: true,
      deadline: true,
      scheduledStartTime: true,
      reminderMinutes: true,
      attendees: true,
    } as const;

    const singles = await this.prisma.session.findMany({
      where: {
        userId,
        deleted: false,
        // Busy time imported from other calendars is read, never written back.
        source: { notIn: ["GOOGLE", "DEVICE"] },
        scheduledStartTime: { gte: from, lte: to },
        OR: [{ seriesId: null }, { series: { rrule: null } }],
      },
      select,
    });
    const series = await this.prisma.sessionSeries.findMany({
      where: { userId, rrule: { not: null } },
      select: {
        id: true,
        rrule: true,
        exdates: true,
        sessions: {
          where: {
            deleted: false,
            scheduledStartTime: { not: null },
            source: { notIn: ["GOOGLE", "DEVICE"] },
          },
          orderBy: { createdAt: "asc" },
          take: 1,
          select,
        },
      },
    });

    const out: Desired[] = [];
    for (const s of singles) {
      const body = sessionEvent(
        { ...s, scheduledStartTime: s.scheduledStartTime! },
        ctx,
      );
      out.push({
        eventId: eventIdOf(s.id),
        sessionId: s.id,
        body,
        hash: payloadHash(body),
      });
    }
    for (const r of series) {
      const first = r.sessions[0];
      if (!first || !r.rrule) continue;
      const model = {
        id: r.id,
        rrule: r.rrule,
        exdates: r.exdates,
      };
      const body = seriesEvent(
        { ...first, scheduledStartTime: first.scheduledStartTime! },
        model,
        ctx,
      );
      out.push({
        eventId: eventIdOf(r.id),
        seriesId: r.id,
        body,
        hash: payloadHash(body),
      });
    }
    return out;
  }

  /** Links whose event should go: the session is gone or unscheduled. A session just outside the window stays. */
  private async staleLinks<
    L extends { eventId: string; sessionId: string | null },
  >(userId: string, links: L[], desired: Desired[]): Promise<L[]> {
    const wanted = new Set(desired.map((d) => d.eventId));
    const candidates = links.filter((l) => !wanted.has(l.eventId));
    const sessionIds = candidates.flatMap((l) =>
      l.sessionId ? [l.sessionId] : [],
    );
    const alive = sessionIds.length
      ? await this.prisma.session.findMany({
          where: {
            id: { in: sessionIds },
            userId,
            deleted: false,
            scheduledStartTime: { not: null },
          },
          select: { id: true },
        })
      : [];
    const aliveIds = new Set(alive.map((s) => s.id));
    return candidates.filter((l) => !l.sessionId || !aliveIds.has(l.sessionId));
  }

  /** Runs `fn` over `items` a few at a time and returns the errors instead of throwing on the first. */
  private async inChunks<T>(
    items: T[],
    fn: (item: T) => Promise<void>,
  ): Promise<unknown[]> {
    const errors: unknown[] = [];
    for (let i = 0; i < items.length; i += CONCURRENCY) {
      const results = await Promise.allSettled(
        items.slice(i, i + CONCURRENCY).map(fn),
      );
      for (const r of results)
        if (r.status === "rejected") errors.push(r.reason);
    }
    return errors;
  }
}
