import { Injectable, Logger } from "@nestjs/common";
import {
  type BanditArmStateWire,
  SCHEDULING_ARMS,
  type SchedulingArm,
} from "@zenflow/shared";
import { PrismaService } from "../prisma/prisma.service";

/**
 * Load / overwrite the 24 hour arms of a user's LinUCB state for the stateless
 * Python bandit service. A reward changes every arm (the kernel spreads it), so
 * the whole state is read and written together.
 */
@Injectable()
export class BanditArmStateRepository {
  private readonly logger = new Logger(BanditArmStateRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  /** All 24 hour arms for a user. An arm with no row yet comes back cold (empty `A`, `b`). */
  async loadAll(
    userId: string,
  ): Promise<Record<SchedulingArm, BanditArmStateWire>> {
    const rows = await this.prisma.banditArmState.findMany({
      where: { userId },
    });
    const byArm = new Map(rows.map((r) => [r.arm, r]));

    const out = {} as Record<SchedulingArm, BanditArmStateWire>;
    for (const arm of SCHEDULING_ARMS) {
      const row = byArm.get(arm);
      out[arm] = row ? { A: row.A, b: row.b } : { A: [], b: [] };
    }
    return out;
  }

  /**
   * Overwrite all 24 hour arms for a user, in one transaction. Best-effort: a
   * failure is logged and the previous state stays.
   */
  async replaceAll(
    userId: string,
    arms: Record<SchedulingArm, BanditArmStateWire>,
  ): Promise<void> {
    try {
      await this.prisma.$transaction(
        SCHEDULING_ARMS.map((arm) =>
          this.prisma.banditArmState.upsert({
            where: { userId_arm: { userId, arm } },
            create: { userId, arm, A: arms[arm].A, b: arms[arm].b },
            update: { A: arms[arm].A, b: arms[arm].b },
          }),
        ),
      );
    } catch (err) {
      this.logger.warn(
        `bandit state save failed for user=${userId}: ${(err as Error).message}`,
      );
    }
  }
}
