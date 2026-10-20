import { BadRequestException, Injectable } from "@nestjs/common";
import type { RegisterDeviceInput } from "@zenflow/shared";
import { type User } from "../../generated/prisma";
import { PrismaService } from "../prisma/prisma.service";
import { WebPushSender } from "./web-push.sender";

/**
 * The native and web push device registry.
 *
 * One row per (device, provider), keyed by the opaque `pushToken`. Rows are
 * also removed by {@link PushService} when a provider reports a token dead.
 */
@Injectable()
export class DevicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly webPush: WebPushSender,
  ) {}

  /**
   * `POST /devices` — register this device, or refresh an existing row.
   *
   * Upserts on the unique `pushToken`, so a token that has moved to a new user
   * (a shared handset, a reinstall) re-homes to the caller instead of hitting a
   * unique-constraint error. `lastSeenAt` is the only activity kept.
   */
  async registerDevice(
    user: User,
    dto: RegisterDeviceInput,
  ): Promise<{ id: string }> {
    if (dto.platform === "WEB" && !isBrowserPushEndpoint(dto.pushToken)) {
      throw new BadRequestException(
        "WEB pushToken must be a browser push service endpoint",
      );
    }
    // Keys belong to WEB rows only; a native client's absent keys become null.
    const p256dh = dto.platform === "WEB" ? (dto.p256dh ?? null) : null;
    const auth = dto.platform === "WEB" ? (dto.auth ?? null) : null;
    const now = new Date();
    const row = await this.prisma.userDevice.upsert({
      where: { pushToken: dto.pushToken },
      create: {
        platform: dto.platform,
        pushToken: dto.pushToken,
        p256dh,
        auth,
        userId: user.id,
        lastSeenAt: now,
      },
      update: {
        platform: dto.platform,
        p256dh,
        auth,
        userId: user.id,
        lastSeenAt: now,
      },
      select: { id: true },
    });
    return { id: row.id };
  }

  /**
   * `DELETE /devices` — drop this device. Scoped to the caller and idempotent:
   * another user's token, or one already gone, is a no-op rather than a 404.
   */
  async unregisterDevice(
    user: User,
    pushToken: string,
  ): Promise<{ pushToken: string }> {
    await this.prisma.userDevice.deleteMany({
      where: { pushToken, userId: user.id },
    });
    return { pushToken };
  }
}

/**
 * Push services the browsers hand out endpoints for: Chrome and Edge (FCM),
 * Firefox (Mozilla), Safari (Apple) and Windows (WNS). The API only ever
 * contacts these hosts, so a registered device cannot point it at an
 * arbitrary server.
 */
const BROWSER_PUSH_HOSTS = [
  "fcm.googleapis.com",
  "android.googleapis.com",
  "updates.push.services.mozilla.com",
  "web.push.apple.com",
];
const BROWSER_PUSH_SUFFIXES = [".notify.windows.com"];

function isBrowserPushEndpoint(value: string): boolean {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.port !== "" ||
      url.username ||
      url.password
    ) {
      return false;
    }
    const host = url.hostname;
    return (
      BROWSER_PUSH_HOSTS.includes(host) ||
      BROWSER_PUSH_SUFFIXES.some((suffix) => host.endsWith(suffix))
    );
  } catch {
    return false;
  }
}
