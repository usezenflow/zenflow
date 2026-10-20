import { Injectable } from "@nestjs/common";
import type {
  EngagementResponse,
  RetentionCohort,
  StreakBucket,
} from "@zenflow/shared";
import { ActiveUsersService } from "../observability/active-users.service";
import { PrismaService } from "../prisma/prisma.service";

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
const DAILY_DAYS = 8;
const COHORTS = 8;
const RETENTION_WEEKS = 6;
/** Streaks are counted over this many days. The open-ended top bucket stays exact. */
const STREAK_WINDOW_DAYS = 120;

const STREAK_BUCKETS: { days: string; min: number; max: number }[] = [
  { days: "1", min: 1, max: 1 },
  { days: "2 to 3", min: 2, max: 3 },
  { days: "4 to 6", min: 4, max: 6 },
  { days: "7 to 13", min: 7, max: 13 },
  { days: "14 or more", min: 14, max: Infinity },
];

const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/**
 * Engagement for the dashboard: DAU and WAU from `ActiveUsersService`, weekly
 * retention and current streaks from `User` and `ClientEvent` APP_OPEN.
 */
@Injectable()
export class EngagementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activeUsers: ActiveUsersService,
  ) {}

  async engagement(now = new Date()): Promise<EngagementResponse> {
    const [activeDays, wau, retention, streaks] = await Promise.all([
      this.activeUsers.dailyCounts(now, DAILY_DAYS),
      this.activeUsers.weeklyCount(now),
      this.retention(now),
      this.streaks(now),
    ]);
    return {
      dau: activeDays[activeDays.length - 1]?.dau ?? 0,
      wau,
      activeDays,
      retention,
      streaks,
    };
  }

  /**
   * Share of each sign-up week's cohort with an APP_OPEN in week `n` after
   * joining. A week that has not ended yet for the cohort is `null`.
   */
  private async retention(now: Date): Promise<RetentionCohort[]> {
    const since = new Date(now.getTime() - (COHORTS - 1) * WEEK_MS);
    const cohorts = await this.prisma.$queryRaw<
      { cohortWeek: Date; size: number }[]
    >`
      SELECT date_trunc('week', "createdAt") AS "cohortWeek",
             count(*)::int AS size
      FROM "User"
      WHERE "createdAt" >= date_trunc('week', ${since})
      GROUP BY 1
      ORDER BY 1`;

    const opens = await this.prisma.$queryRaw<
      { cohortWeek: Date; week: number; active: number }[]
    >`
      SELECT date_trunc('week', u."createdAt") AS "cohortWeek",
             floor(extract(epoch FROM (e."occurredAt" - u."createdAt")) / 604800)::int AS week,
             count(DISTINCT u.id)::int AS active
      FROM "User" u
      JOIN "ClientEvent" e
        ON e."userId" = u.id
       AND e.kind = 'APP_OPEN'
       AND e."occurredAt" >= u."createdAt"
      WHERE u."createdAt" >= date_trunc('week', ${since})
        AND floor(extract(epoch FROM (e."occurredAt" - u."createdAt")) / 604800) < ${RETENTION_WEEKS}
      GROUP BY 1, 2`;

    return cohorts.map((cohort) => {
      const start = cohort.cohortWeek.getTime();
      const weeks = Array.from({ length: RETENTION_WEEKS }, (_, n) => {
        if (start + (n + 1) * WEEK_MS > now.getTime()) return null;
        const row = opens.find(
          (o) => o.cohortWeek.getTime() === start && o.week === n,
        );
        return (row?.active ?? 0) / cohort.size;
      });
      return {
        cohortWeek: utcDay(start),
        size: cohort.size,
        weeks,
      };
    });
  }

  /**
   * Users by the length of their run of consecutive UTC days with an APP_OPEN.
   * A run counts as current when it ends today or yesterday, so a streak is not
   * zero before the student opens the app on a new day.
   */
  private async streaks(now: Date): Promise<StreakBucket[]> {
    const since = new Date(now.getTime() - STREAK_WINDOW_DAYS * DAY_MS);
    const yesterday = utcDay(now.getTime() - DAY_MS);
    const runs = await this.prisma.$queryRaw<{ length: number }[]>`
      WITH days AS (
        SELECT DISTINCT "userId", ("occurredAt")::date AS day
        FROM "ClientEvent"
        WHERE kind = 'APP_OPEN' AND "occurredAt" >= ${since}
      ),
      islands AS (
        SELECT "userId", max(day) AS "lastDay", count(*)::int AS length
        FROM (
          SELECT "userId", day,
                 day - (row_number() OVER (PARTITION BY "userId" ORDER BY day))::int AS grp
          FROM days
        ) grouped
        GROUP BY "userId", grp
      )
      SELECT length
      FROM islands
      WHERE "lastDay" >= ${yesterday}::date`;

    return STREAK_BUCKETS.map((bucket) => ({
      days: bucket.days,
      users: runs.filter(
        (r) => r.length >= bucket.min && r.length <= bucket.max,
      ).length,
    }));
  }
}
