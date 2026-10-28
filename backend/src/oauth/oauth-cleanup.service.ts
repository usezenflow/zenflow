import { Injectable } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { PrismaService } from "../prisma/prisma.service";
import { UNUSED_CLIENT_TTL_MS } from "./oauth.config";

const KEEP_MS = 24 * 3_600_000;

/** Removes tokens and consent requests a day after they expire, and clients nobody uses. Runs on the watcher only. */
@Injectable()
export class OAuthCleanupService {
  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_HOUR)
  async purge(): Promise<void> {
    const now = Date.now();
    await this.prisma.oAuthToken.deleteMany({
      where: { expiresAt: { lt: new Date(now - KEEP_MS) } },
    });
    await this.prisma.oAuthConsent.deleteMany({
      where: { expiresAt: { lt: new Date(now - KEEP_MS) } },
    });
    await this.prisma.oAuthClient.deleteMany({
      where: {
        createdAt: { lt: new Date(now - UNUSED_CLIENT_TTL_MS) },
        tokens: { none: {} },
      },
    });
  }
}
