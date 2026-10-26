import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { SessionsService } from "../sessions/sessions.service";
import { DEFAULT_REMINDER_CHOICES } from "@zenflow/shared";
import { CalendarImportService } from "./calendar-import.service";
import { CalendarSyncService } from "./calendar-sync.service";
import {
  GoogleApiError,
  GoogleCalendarClient,
  type GoogleEventItem,
} from "./google-calendar.client";
import { GoogleOAuthService } from "./google-oauth.service";

const SLOT_MS = 15 * 60_000;

/**
 * The popup reminder Google holds for an event: minutes before start, 0 for
 * none. Undefined when the event uses Google's default, which Zenflow never sets.
 */
export function googleReminder(item: GoogleEventItem): number | undefined {
  if (!item.reminders || item.reminders.useDefault) return undefined;
  const popup = item.reminders.overrides?.find((o) => o.method === "popup");
  return popup?.minutes ?? 0;
}

export interface PullSummary {
  /** Sessions moved or removed to match a change made in Google. */
  applied: number;
  /** Events that must be rewritten because Zenflow keeps its own version. */
  restored: number;
}

/**
 * Reads changes the user made to Zenflow events in Google and applies the ones
 * Zenflow allows. Zenflow wins when both sides changed, and an ingested
 * timetable item can never be moved from Google: its event is written back.
 */
@Injectable()
export class CalendarPullService {
  private readonly logger = new Logger(CalendarPullService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly oauth: GoogleOAuthService,
    private readonly client: GoogleCalendarClient,
    private readonly sessions: SessionsService,
    private readonly sync: CalendarSyncService,
    private readonly imports: CalendarImportService,
  ) {}

  async pullUser(userId: string): Promise<PullSummary | null> {
    const connection = await this.prisma.calendarConnection.findUnique({
      where: { userId },
    });
    if (!connection || connection.status !== "ACTIVE") return null;
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { calendarTarget: true },
    });
    if (user.calendarTarget !== "GOOGLE") return null;
    const summary: PullSummary = { applied: 0, restored: 0 };
    try {
      const token = await this.oauth.accessToken(
        userId,
        connection.refreshTokenEnc,
      );
      await this.importBusy(userId, token, connection.googleCalendarId);
      if (!connection.syncToken) {
        await this.baseline(userId, token, connection.googleCalendarId);
        return summary;
      }
      const { items, nextSyncToken } = await this.collect(
        token,
        connection.googleCalendarId,
        connection.syncToken,
      );
      if (items === null) {
        await this.baseline(userId, token, connection.googleCalendarId);
        return summary;
      }
      for (const item of items) await this.apply(userId, item, summary);
      if (nextSyncToken) {
        await this.prisma.calendarConnection.update({
          where: { userId },
          data: { syncToken: nextSyncToken },
        });
      }
      return summary;
    } catch (error) {
      if (error instanceof GoogleApiError && error.authRevoked) {
        await this.sync.needsReconnect(userId, "Google access was revoked");
        return summary;
      }
      throw error;
    }
  }

  /** Busy time from the user's other calendars. Its failures must not stop the pull of Zenflow's own events. */
  private async importBusy(
    userId: string,
    token: string,
    calendarId: string,
  ): Promise<void> {
    try {
      await this.imports.importUser(userId, token, calendarId);
    } catch (error) {
      if (error instanceof GoogleApiError && error.authRevoked) throw error;
      this.logger.warn(
        `Busy time import for ${userId} failed: ${(error as Error).message}`,
      );
    }
  }

  /** Pages through a sync token; null when Google says it expired (410). */
  private async collect(token: string, calendarId: string, syncToken: string) {
    const items: GoogleEventItem[] = [];
    let pageToken: string | undefined;
    let nextSyncToken: string | undefined;
    try {
      do {
        const page = await this.client.listEvents(token, calendarId, {
          syncToken,
          pageToken,
        });
        items.push(...page.items);
        pageToken = page.nextPageToken;
        nextSyncToken = page.nextSyncToken ?? nextSyncToken;
      } while (pageToken);
    } catch (error) {
      if (error instanceof GoogleApiError && error.status === 410)
        return { items: null, nextSyncToken: undefined };
      throw error;
    }
    return { items, nextSyncToken };
  }

  /** Stores a fresh token without applying anything: the calendar holds only what Zenflow wrote. */
  private async baseline(
    userId: string,
    token: string,
    calendarId: string,
  ): Promise<void> {
    let pageToken: string | undefined;
    let nextSyncToken: string | undefined;
    do {
      const page = await this.client.listEvents(token, calendarId, {
        pageToken,
      });
      pageToken = page.nextPageToken;
      nextSyncToken = page.nextSyncToken ?? nextSyncToken;
    } while (pageToken);
    await this.prisma.calendarConnection.update({
      where: { userId },
      data: { syncToken: nextSyncToken ?? null },
    });
  }

  private async apply(
    userId: string,
    item: GoogleEventItem,
    summary: PullSummary,
  ): Promise<void> {
    const priv = item.extendedProperties?.private;
    if (!priv?.zf || item.recurringEventId) return;
    const link = await this.prisma.calendarLink.findUnique({
      where: { userId_eventId: { userId, eventId: item.id } },
    });
    if (!link) return;

    const restore = async () => {
      await this.prisma.calendarLink.update({
        where: { id: link.id },
        data: { payloadHash: "" },
      });
      summary.restored++;
    };

    // A recurring series is only ever written from Zenflow.
    if (priv.zfk === "r" || !link.sessionId) {
      if (
        item.status === "cancelled" ||
        this.changedSinceWrite(item, link.etag)
      )
        await restore();
      return;
    }
    if (!this.changedSinceWrite(item, link.etag)) return;

    const session = await this.prisma.session.findFirst({
      where: { id: link.sessionId, userId },
    });
    if (!session || session.deleted) return;
    // Zenflow changed it after the last write: its version wins.
    if (session.updatedAt > link.syncedAt) return restore();

    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
    });
    try {
      if (item.status === "cancelled") {
        if (session.source === "LMS" || session.source === "PORTAL")
          return restore();
        await this.sessions.remove(session.id, user);
        await this.prisma.calendarLink.delete({ where: { id: link.id } });
        summary.applied++;
        return;
      }
      const start = item.start?.dateTime ? new Date(item.start.dateTime) : null;
      const end = item.end?.dateTime ? new Date(item.end.dateTime) : null;
      if (!start || !end) return restore();
      const snapped = Math.round(start.getTime() / SLOT_MS) * SLOT_MS;
      const minutes = Math.max(
        15,
        Math.round((end.getTime() - start.getTime()) / SLOT_MS) * 15,
      );
      const timeChanged =
        session.scheduledStartTime?.getTime() !== snapped ||
        session.durationMinutes !== minutes;

      const reminder = googleReminder(item);
      const reminderChanged =
        reminder !== undefined &&
        reminder !== (session.reminderMinutes ?? user.defaultReminderMinutes);
      if (reminder !== undefined && reminderChanged) {
        // Only the choices the app offers are read back; anything else is rewritten.
        if (!(DEFAULT_REMINDER_CHOICES as readonly number[]).includes(reminder))
          return restore();
      }
      if (!timeChanged && !reminderChanged) return;

      if (timeChanged) {
        await this.sessions.update(
          session.id,
          {
            scheduledStartTime: new Date(snapped).toISOString(),
            durationMinutes: minutes,
          },
          user,
        );
      }
      if (reminder !== undefined && reminderChanged) {
        await this.prisma.session.update({
          where: { id: session.id },
          data: {
            reminderMinutes:
              reminder === user.defaultReminderMinutes ? null : reminder,
          },
        });
      }
      summary.applied++;
    } catch (error) {
      this.logger.debug(
        `Google change to ${session.id} refused: ${(error as Error).message}`,
      );
      await restore();
    }
  }

  /** Our own writes echo back through the channel with the etag we stored; any other etag is a user change. */
  private changedSinceWrite(
    item: GoogleEventItem,
    writtenEtag: string | null,
  ): boolean {
    if (item.status === "cancelled") return true;
    return !!item.etag && item.etag !== writtenEtag;
  }
}
