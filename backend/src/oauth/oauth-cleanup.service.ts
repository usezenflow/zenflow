import { Injectable } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { PrismaService } from "../prisma/prisma.service";

const KEEP_MS = 24 * 3_600_000;

/** Removes tokens a day after they expire. Runs on the watcher only. */
@Injectable()
export class OAuthCleanupService {
  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_HOUR)
  async purge(): Promise<void> {
    await this.prisma.oAuthToken.deleteMany({
      where: { expiresAt: { lt: new Date(Date.now() - KEEP_MS) } },
    });
  }
}
