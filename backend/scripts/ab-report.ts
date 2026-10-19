/**
 * Read-only A/B report, HEURISTIC vs LINUCB (docs/scheduler/ab-testing.md §6).
 * Per primary policy: proposals, shown pairwise comparisons and which side the
 * user picked, kept-without-move rate, and the settled outcome of each session
 * (latest proposal per session, PYTHON placements only).
 *
 *   pnpm --filter backend ab:report [--since 2026-10-01]
 */
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/prisma/prisma.service";

function sinceArg(): Date {
  const i = process.argv.indexOf("--since");
  return i > -1 ? new Date(process.argv[i + 1]) : new Date(0);
}

async function main(): Promise<void> {
  const since = sinceArg();
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ["error", "warn"],
  });
  try {
    const prisma = app.get(PrismaService);

    const proposals = await prisma.$queryRaw`
      SELECT "primaryPolicy" AS policy,
             count(*)::int AS proposals,
             count(*) FILTER (WHERE "pairwiseShown")::int AS pairwise_shown,
             count(*) FILTER (WHERE "pairwiseShown" AND "chosenByUser" = "primaryPolicy")::int AS kept_primary,
             count(*) FILTER (WHERE "pairwiseShown" AND "chosenByUser" IS NOT NULL AND "chosenByUser" <> "primaryPolicy")::int AS chose_alternative,
             count(*) FILTER (WHERE "acceptedWithoutModification")::int AS accepted_unmodified,
             count(*) FILTER (WHERE "firstModifiedAt" IS NOT NULL)::int AS modified
      FROM "SlotProposal"
      WHERE "placementSource" = 'PYTHON' AND "timestamp" >= ${since}
      GROUP BY 1 ORDER BY 1`;
    console.log("Proposals");
    console.table(proposals);

    const wins = await prisma.$queryRaw`
      SELECT "chosenByUser" AS policy, count(*)::int AS picks
      FROM "SlotProposal"
      WHERE "pairwiseShown" AND "chosenByUser" IS NOT NULL AND "timestamp" >= ${since}
      GROUP BY 1 ORDER BY 1`;
    console.log("Pairwise picks by chosen policy");
    console.table(wins);

    const outcomes = await prisma.$queryRaw`
      WITH latest AS (
        SELECT DISTINCT ON ("sessionId") "sessionId", "primaryPolicy"
        FROM "SlotProposal"
        WHERE "sessionId" IS NOT NULL AND "placementSource" = 'PYTHON' AND "timestamp" >= ${since}
        ORDER BY "sessionId", "timestamp" DESC
      )
      SELECT l."primaryPolicy" AS policy,
             count(DISTINCT l."sessionId")::int AS sessions,
             count(DISTINCT e."sessionId") FILTER (WHERE e."eventType" = 'START')::int AS started,
             count(DISTINCT e."sessionId") FILTER (WHERE e."eventType" = 'COMPLETE')::int AS done,
             count(DISTINCT e."sessionId") FILTER (WHERE e."eventType" = 'LAPSED')::int AS lapsed,
             count(DISTINCT e."sessionId") FILTER (WHERE e."eventType" = 'SKIP')::int AS skipped,
             count(DISTINCT e."sessionId") FILTER (WHERE e."eventType" = 'MOVE')::int AS moved
      FROM latest l
      LEFT JOIN "SessionEvent" e ON e."sessionId" = l."sessionId"
      GROUP BY 1 ORDER BY 1`;
    console.log("Session outcomes by primary policy");
    console.table(outcomes);

    const learning = await prisma.$queryRaw`
      SELECT "arm"::text AS arm, count(*)::int AS users, sum("version")::int AS updates
      FROM "BanditArmState"
      GROUP BY 1 ORDER BY 1`;
    console.log("LinUCB arm updates persisted");
    console.table(learning);
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
