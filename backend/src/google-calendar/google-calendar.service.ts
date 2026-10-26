import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import type {
  GoogleCalendarConnectResponse,
  GoogleCalendarStatus,
} from "@zenflow/shared";
import type { User } from "../../generated/prisma";
import { PrismaService } from "../prisma/prisma.service";
import { CalendarSyncTrigger } from "./calendar-sync-trigger.service";
import { CalendarWatchService } from "./calendar-watch.service";
import { GoogleCalendarClient } from "./google-calendar.client";
import { GoogleCalendarConfig } from "./google-calendar.config";
import { GoogleOAuthService } from "./google-oauth.service";

const CALENDAR_NAME = "Zenflow";

@Injectable()
export class GoogleCalendarService {
  private readonly logger = new Logger(GoogleCalendarService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: GoogleCalendarConfig,
    private readonly oauth: GoogleOAuthService,
    private readonly client: GoogleCalendarClient,
    private readonly watch: CalendarWatchService,
    private readonly trigger: CalendarSyncTrigger,
  ) {}

  async status(user: User): Promise<GoogleCalendarStatus> {
    const [connection, outbox, target] = await Promise.all([
      this.prisma.calendarConnection.findUnique({ where: { userId: user.id } }),
      this.prisma.calendarSyncOutbox.findUnique({ where: { userId: user.id } }),
      this.prisma.user.findUniqueOrThrow({
        where: { id: user.id },
        select: { calendarTarget: true },
      }),
    ]);
    // A row in the outbox means session changes are waiting for the next push.
    const failing = outbox && outbox.attempts > 0 ? outbox : null;
    return {
      available: this.config.available,
      target: target.calendarTarget,
      connected: !!connection,
      state: connection?.status ?? null,
      lastSyncedAt: connection?.lastSyncedAt?.toISOString() ?? null,
      lastError: failing?.lastError ?? connection?.lastError ?? null,
      pendingSince: outbox?.dirtyAt.toISOString() ?? null,
      retryAt: failing?.nextAttemptAt.toISOString() ?? null,
      attempts: outbox?.attempts ?? 0,
    };
  }

  connectUrl(user: User): GoogleCalendarConnectResponse {
    this.requireAvailable();
    return { url: this.oauth.authUrl(user.id) };
  }

  /** Finishes the Google redirect. Returns the web URL to send the browser to. */
  async complete(
    code: string | undefined,
    state: string | undefined,
    error: string | undefined,
  ): Promise<string> {
    const back = (result: string) => `${this.config.webUrl}/?google=${result}`;
    if (error || !code || !state) return back("denied");
    const userId = this.oauth.verifyState(state);
    if (!userId) return back("invalid");
    try {
      await this.connect(userId, code);
      return back("connected");
    } catch (err) {
      this.logger.warn(
        `Google connect failed for ${userId}: ${(err as Error).message}`,
      );
      return back("failed");
    }
  }

  async disconnect(user: User): Promise<GoogleCalendarStatus> {
    const connection = await this.prisma.calendarConnection.findUnique({
      where: { userId: user.id },
    });
    if (connection) {
      try {
        const token = await this.oauth.accessToken(
          user.id,
          connection.refreshTokenEnc,
        );
        await this.watch.stop(connection, token);
        await this.client.deleteCalendar(token, connection.googleCalendarId);
      } catch (err) {
        this.logger.debug(
          `Cleanup on disconnect for ${user.id}: ${(err as Error).message}`,
        );
      }
      await this.oauth.revoke(connection.refreshTokenEnc);
      this.oauth.forget(user.id);
      await this.prisma.$transaction([
        this.prisma.calendarLink.deleteMany({ where: { userId: user.id } }),
        this.prisma.calendarConnection.delete({ where: { id: connection.id } }),
        this.prisma.user.updateMany({
          where: { id: user.id, calendarTarget: "GOOGLE" },
          data: { calendarTarget: "NONE" },
        }),
      ]);
    }
    return this.status(user);
  }

  async syncNow(user: User): Promise<GoogleCalendarStatus> {
    const connection = await this.prisma.calendarConnection.findUnique({
      where: { userId: user.id },
    });
    if (!connection)
      throw new BadRequestException("Google Calendar isn't connected.");
    await this.trigger.enqueue(user.id, "sync");
    return this.status(user);
  }

  /** Called by the webhook: schedules a pull for the connection that owns the channel. */
  async onNotification(
    channelId: string,
    token: string | undefined,
    state: string | undefined,
  ): Promise<void> {
    if (!this.watch.verify(channelId, token) || state === "sync") return;
    const connection = await this.prisma.calendarConnection.findUnique({
      where: { channelId },
      select: { userId: true, status: true },
    });
    if (connection?.status === "ACTIVE")
      await this.trigger.enqueue(connection.userId, "pull");
  }

  private async connect(userId: string, code: string): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { timezone: true },
    });
    const { refreshToken, accessToken } = await this.oauth.exchangeCode(code);
    const sealed = this.oauth.seal(refreshToken);

    const existing = await this.prisma.calendarConnection.findUnique({
      where: { userId },
    });
    // Reconnecting reuses the calendar so events keep their place.
    const calendarId =
      existing?.googleCalendarId ??
      (await this.client.createCalendar(
        accessToken,
        CALENDAR_NAME,
        user.timezone,
      ));
    // Google becomes the target in the same write, so the phone side can't also run.
    const [connection] = await this.prisma.$transaction([
      this.prisma.calendarConnection.upsert({
        where: { userId },
        create: {
          userId,
          googleCalendarId: calendarId,
          refreshTokenEnc: sealed,
        },
        update: {
          googleCalendarId: calendarId,
          refreshTokenEnc: sealed,
          status: "ACTIVE",
          lastError: null,
          syncToken: null,
        },
      }),
      this.prisma.user.update({
        where: { id: userId },
        data: { calendarTarget: "GOOGLE" },
      }),
    ]);
    if (existing)
      await this.prisma.calendarLink.deleteMany({ where: { userId } });
    try {
      await this.watch.ensure(connection, accessToken);
    } catch (err) {
      this.logger.warn(
        `Couldn't open a push channel for ${userId}: ${(err as Error).message}`,
      );
    }
    await this.trigger.enqueue(userId, "sync");
    await this.trigger.enqueue(userId, "pull", 5_000);
  }

  private requireAvailable(): void {
    if (!this.config.available) {
      throw new ServiceUnavailableException(
        "Google Calendar isn't set up on this server.",
      );
    }
  }
}
