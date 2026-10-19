import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../prisma/prisma.service";
import { resolveSemester } from "./core/semester";
import { termKey } from "./core/schedule-plan";
import { planWalkers, type WalkerCandidate } from "./core/walker-planner";
import { OccurrenceCacheService } from "./occurrence-cache.service";
import { isOccurrenceCacheEnabled } from "./watcher-support";

/** How long a computed order is reused before the population is read again. */
const PLAN_TTL_MS = 15 * 60_000;

/**
 * Which students' timetable walks to run first, so each one warms the most
 * classmates' sections (see `planWalkers`).
 *
 * The order is computed over the discovered students of the current term and
 * reused for {@link PLAN_TTL_MS}, because the ticker asks on every tick. A
 * student whose last walk failed is left out, so their sections go to the next
 * student enrolled in them.
 */
@Injectable()
export class WalkerPlanService {
  private readonly tz: string;
  private cached: { key: string; at: number; order: string[] } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly cache: OccurrenceCacheService,
  ) {
    this.tz = this.config.get<string>("DLU_TZ") ?? "Asia/Ho_Chi_Minh";
  }

  /** User ids in walk order; empty when the occurrence cache is off. */
  async preferred(now: Date): Promise<string[]> {
    if (!isOccurrenceCacheEnabled(this.config)) return [];
    const term = resolveSemester(now, this.tz);
    const key = termKey(term);
    if (
      this.cached &&
      this.cached.key === key &&
      now.getTime() - this.cached.at < PLAN_TTL_MS
    ) {
      return this.cached.order;
    }
    const order = await this.compute(now, term);
    this.cached = { key, at: now.getTime(), order };
    return order;
  }

  private async compute(
    now: Date,
    term: { academicYear: string; semester: string; endDate: Date },
  ): Promise<string[]> {
    const schedules = await this.prisma.ingestionSchedule.findMany({
      where: {
        kind: "PORTAL_TIMETABLE",
        consecutiveFailures: 0,
        integration: {
          schedules: {
            some: {
              kind: "PORTAL_DISCOVERY",
              lastSuccessTerm: termKey(term),
            },
          },
        },
      },
      // Least recently walked first: ties in the planner rotate across students.
      orderBy: [{ lastClaimedAt: { sort: "asc", nulls: "first" } }],
      select: { integration: { select: { userId: true } } },
    });
    const userIds = schedules.map((row) => row.integration.userId);
    if (userIds.length === 0) return [];

    const rows = await this.prisma.portalSectionEnrollment.findMany({
      where: {
        userId: { in: userIds },
        yearStudy: term.academicYear,
        termId: term.semester,
        droppedAt: null,
      },
      select: { userId: true, scheduleStudyUnitId: true },
    });
    const byUser = new Map<string, string[]>();
    for (const { userId, scheduleStudyUnitId } of rows) {
      const list = byUser.get(userId) ?? [];
      list.push(scheduleStudyUnitId);
      byUser.set(userId, list);
    }

    const candidates: WalkerCandidate[] = userIds.map((userId) => ({
      userId,
      sectionIds: byUser.get(userId) ?? [],
    }));
    const allSections = [...new Set(rows.map((r) => r.scheduleStudyUnitId))];
    const { stale } = await this.cache.timetableFreshness(allSections, {
      now,
      throughDate: term.endDate,
    });
    return planWalkers(candidates, new Set(stale));
  }
}
