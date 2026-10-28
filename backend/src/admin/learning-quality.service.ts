import { Injectable } from "@nestjs/common";
import type {
  AdminPolicy,
  LearningQualityResponse,
  PolicyQuality,
  WeeklyKept,
} from "@zenflow/shared";
import { PrismaService } from "../prisma/prisma.service";

const POLICIES: AdminPolicy[] = ["HEURISTIC", "LINUCB"];

/**
 * Scheduler quality per primary policy, as in `backend/scripts/ab-report.ts`.
 * PYTHON placements only. A session's events are attributed to the policy of
 * its latest proposal.
 */
@Injectable()
export class LearningQualityService {
  constructor(private readonly prisma: PrismaService) {}

  async learningQuality(): Promise<LearningQualityResponse> {
    const [proposals, events, weekly] = await Promise.all([
      this.prisma.$queryRaw<
        {
          policy: AdminPolicy;
          proposals: number;
          acceptedUnmodified: number;
        }[]
      >`
        SELECT "primaryPolicy"::text AS policy,
               count(*)::int AS proposals,
               count(*) FILTER (WHERE "acceptedWithoutModification")::int AS "acceptedUnmodified"
        FROM "SlotProposal"
        WHERE "placementSource" = 'PYTHON'
        GROUP BY 1`,
      this.prisma.$queryRaw<
        {
          policy: AdminPolicy;
          due: number;
          kept: number;
          move: number;
          dragMinutes: number;
          reward: number;
        }[]
      >`
        WITH latest AS (
          SELECT DISTINCT ON ("sessionId") "sessionId", "primaryPolicy"
          FROM "SlotProposal"
          WHERE "sessionId" IS NOT NULL AND "placementSource" = 'PYTHON'
          ORDER BY "sessionId", "timestamp" DESC
        )
        SELECT l."primaryPolicy"::text AS policy,
               count(DISTINCT l."sessionId") FILTER (
                 WHERE s."scheduledStartTime" + make_interval(mins => s."durationMinutes") <= now()
               )::int AS due,
               count(*) FILTER (WHERE e."eventType" = 'KEPT')::int AS kept,
               count(*) FILTER (WHERE e."eventType" = 'MOVE')::int AS move,
               coalesce(avg(abs(e."dragDistanceMinutes")) FILTER (WHERE e."eventType" = 'MOVE'), 0)::float AS "dragMinutes",
               coalesce(avg(e."rewardScore") FILTER (WHERE e."eventType" IN ('KEPT', 'MOVE')), 0)::float AS reward
        FROM latest l
        JOIN "Session" s ON s.id = l."sessionId"
        LEFT JOIN "SessionEvent" e ON e."sessionId" = l."sessionId"
        GROUP BY 1`,
      this.prisma.$queryRaw<
        {
          week: Date;
          policy: AdminPolicy;
          proposals: number;
          acceptedUnmodified: number;
        }[]
      >`
        SELECT date_trunc('week', "timestamp")::date AS week,
               "primaryPolicy"::text AS policy,
               count(*)::int AS proposals,
               count(*) FILTER (WHERE "acceptedWithoutModification")::int AS "acceptedUnmodified"
        FROM "SlotProposal"
        WHERE "placementSource" = 'PYTHON'
        GROUP BY 1, 2
        ORDER BY 1, 2`,
    ]);

    const policies: PolicyQuality[] = POLICIES.map((policy) => {
      const p = proposals.find((r) => r.policy === policy);
      const e = events.find((r) => r.policy === policy);
      return {
        policy,
        proposals: p?.proposals ?? 0,
        acceptedUnmodified: p?.acceptedUnmodified ?? 0,
        due: e?.due ?? 0,
        events: {
          KEPT: e?.kept ?? 0,
          MOVE: e?.move ?? 0,
        },
        dragMinutes: e?.dragMinutes ?? 0,
        reward: e?.reward ?? 0,
      };
    });

    const weeklyRows: WeeklyKept[] = weekly.map((row) => ({
      week: row.week.toISOString().slice(0, 10),
      policy: row.policy,
      proposals: row.proposals,
      acceptedUnmodified: row.acceptedUnmodified,
    }));

    return { policies, weekly: weeklyRows };
  }
}
