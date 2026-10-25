import { Injectable } from "@nestjs/common";
import { createHmac, randomUUID, timingSafeEqual } from "crypto";
import type { CalendarConnection } from "../../generated/prisma";
import { PrismaService } from "../prisma/prisma.service";
import { GoogleCalendarClient } from "./google-calendar.client";
import { GoogleCalendarConfig } from "./google-calendar.config";

const DAY_MS = 86_400_000;
/** Google caps channel life; replace one well before it lapses. */
const CHANNEL_TTL_MS = 7 * DAY_MS;
const RENEW_BEFORE_MS = 36 * 3_600_000;

/** Keeps one push channel per connection alive, since Google never renews them. */
@Injectable()
export class CalendarWatchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly client: GoogleCalendarClient,
    private readonly config: GoogleCalendarConfig,
  ) {}

  channelToken(channelId: string): string {
    return createHmac("sha256", this.config.stateSecret)
      .update(`channel:${channelId}`)
      .digest("base64url");
  }

  verify(channelId: string, token: string | undefined): boolean {
    if (!token) return false;
    const expected = Buffer.from(this.channelToken(channelId));
    const given = Buffer.from(token);
    return expected.length === given.length && timingSafeEqual(expected, given);
  }

  /** Opens a channel when there is none or it lapses soon; the old one is stopped after the new one is stored. */
  async ensure(
    connection: CalendarConnection,
    accessToken: string,
    now = new Date(),
  ): Promise<void> {
    const fresh =
      connection.channelId &&
      connection.channelExpiresAt &&
      connection.channelExpiresAt.getTime() > now.getTime() + RENEW_BEFORE_MS;
    if (fresh) return;

    const id = randomUUID();
    const opened = await this.client.watch(
      accessToken,
      connection.googleCalendarId,
      {
        id,
        token: this.channelToken(id),
        address: this.config.webhookUrl,
        expirationMs: now.getTime() + CHANNEL_TTL_MS,
      },
    );
    await this.prisma.calendarConnection.update({
      where: { id: connection.id },
      data: {
        channelId: id,
        channelResourceId: opened.resourceId,
        channelExpiresAt: new Date(opened.expirationMs),
      },
    });
    if (connection.channelId && connection.channelResourceId) {
      await this.client
        .stopChannel(
          accessToken,
          connection.channelId,
          connection.channelResourceId,
        )
        .catch(() => undefined);
    }
  }

  async stop(
    connection: CalendarConnection,
    accessToken: string,
  ): Promise<void> {
    if (!connection.channelId || !connection.channelResourceId) return;
    await this.client
      .stopChannel(
        accessToken,
        connection.channelId,
        connection.channelResourceId,
      )
      .catch(() => undefined);
  }
}
