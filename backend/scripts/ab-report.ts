/**
 * Read-only A/B report, HEURISTIC vs LINUCB (docs/scheduler/ab-testing.md §6).
 * Per primary policy: proposals, the offer funnel (offered, tapped) and which
 * side the user picked, plus the moves of each due session. Also per week and
 * per observation bucket. PYTHON placements only.
 *
 *   pnpm --filter backend ab:report [--since 2026-10-01] [--csv <file>]

 */
import { writeFileSync } from "node:fs";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/prisma/prisma.service";

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : null;
}

function sinceArg(): Date {
  const v = arg("--since");
  return v ? new Date(v) : new Date(0);
}

type Row = Record<string, string | number | null>;

/** Rows of several tables as one CSV, each tagged with its table name. */
function toCsv(tables: Record<string, Row[]>): string {
  const lines: Row[] = Object.entries(tables).flatMap(([table, rows]) =>
    rows.map((r) => ({ table, ...r })),
  );
  const keys = [...new Set(lines.flatMap((r) => Object.keys(r)))];
  const cell = (v: string | number | null | undefined) =>
    v === null || v === undefined ? "" : `"${String(v).replace(/"/g, '""')}"`;
  return [
    keys.join(","),
    ...lines.map((r) => keys.map((k) => cell(r[k])).join(",")),
  ].join("\n");
}

async function main(): Promise<void> {
  const since = sinceArg();
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ["error", "warn"],
  });
  const tables: Record<string, Row[]> = {};
  try {
    const prisma = app.get(PrismaService);

    tables.proposals = (await prisma.$queryRaw`
      SELECT "primaryPolicy" AS policy,
             count(*)::int AS proposals,
             count(*) FILTER (WHERE "pairwiseShown")::int AS pairwise_shown,
             count(*) FILTER (WHERE "pairwiseShown" AND "chosenByUser" = "primaryPolicy")::int AS kept_primary,
             count(*) FILTER (WHERE "pairwiseShown" AND "chosenByUser" IS NOT NULL AND "chosenByUser" <> "primaryPolicy")::int AS chose_alternative,
             count(*) FILTER (WHERE "acceptedWithoutModification")::int AS accepted_unmodified,
             count(*) FILTER (WHERE "firstModifiedAt" IS NOT NULL)::int AS modified
      FROM "SlotProposal"
      WHERE "placementSource" = 'PYTHON' AND "timestamp" >= ${since}
      GROUP BY 1 ORDER BY 1`) as Row[];
    console.log("Proposals");
    console.table(tables.proposals);

    tables.funnel = (await prisma.$queryRaw`
      SELECT p."primaryPolicy" AS policy,
             count(*) FILTER (WHERE p."pairwiseShown")::int AS offered,
             count(*) FILTER (WHERE p."pairwiseShown" AND p."chosenByUser" IS NOT NULL)::int AS tapped,
             count(*) FILTER (WHERE p."pairwiseShown" AND p."chosenByUser" = 'LINUCB')::int AS picked_linucb
      FROM "SlotProposal" p
      WHERE p."placementSource" = 'PYTHON' AND p."timestamp" >= ${since}
      GROUP BY 1 ORDER BY 1`) as Row[];
    console.log("Offer funnel by primary policy");
    console.table(tables.funnel);

    tables.weeks = (await prisma.$queryRaw`
      SELECT date_trunc('week', "timestamp")::date AS week,
             "primaryPolicy" AS policy,
             count(*) FILTER (WHERE "pairwiseShown")::int AS offered,
             count(*) FILTER (WHERE "pairwiseShown" AND "chosenByUser" IS NOT NULL)::int AS tapped
      FROM "SlotProposal"
      WHERE "placementSource" = 'PYTHON' AND "timestamp" >= ${since}
      GROUP BY 1, 2 ORDER BY 1, 2`) as Row[];
    console.log("Offers per week");
    console.table(tables.weeks);

    tables.observations = (await prisma.$queryRaw`
      SELECT CASE WHEN "observationCount" < 5 THEN '0-4'
                  WHEN "observationCount" < 20 THEN '5-19'
                  ELSE '20+' END AS observations,
             "primaryPolicy" AS policy,
             count(*)::int AS proposals,
             count(*) FILTER (WHERE "pairwiseShown")::int AS offered,
             count(*) FILTER (WHERE "pairwiseShown" AND "chosenByUser" IS NOT NULL)::int AS tapped
      FROM "SlotProposal"
      WHERE "placementSource" = 'PYTHON' AND "timestamp" >= ${since}
      GROUP BY 1, 2 ORDER BY 1, 2`) as Row[];
    console.log("Offers by observation count (cold-start bucket)");
    console.table(tables.observations);

    // Due sessions: placed sessions whose slot has passed, and how many were moved.
    tables.outcomes = (await prisma.$queryRaw`
      WITH latest AS (
        SELECT DISTINCT ON ("sessionId") "sessionId", "primaryPolicy"
        FROM "SlotProposal"
        WHERE "sessionId" IS NOT NULL AND "placementSource" = 'PYTHON' AND "timestamp" >= ${since}
        ORDER BY "sessionId", "timestamp" DESC
      ),
      due AS (
        SELECT l."primaryPolicy", l."sessionId"
        FROM latest l
        JOIN "Session" s ON s.id = l."sessionId"
        WHERE s."scheduledStartTime" + make_interval(mins => s."durationMinutes") <= now()
      )
      SELECT d."primaryPolicy" AS policy,
             count(DISTINCT d."sessionId")::int AS due,
             count(DISTINCT e."sessionId") FILTER (WHERE e."eventType" = 'MOVE')::int AS moved
      FROM due d
      LEFT JOIN "SessionEvent" e ON e."sessionId" = d."sessionId"
      GROUP BY 1 ORDER BY 1`) as Row[];
    console.log("Moved sessions by primary policy (due sessions only)");
    console.table(tables.outcomes);

    tables.learning = (await prisma.$queryRaw`
      SELECT "arm"::text AS arm, count(*)::int AS users, sum("version")::int AS updates
      FROM "BanditArmState"
      GROUP BY 1 ORDER BY 1`) as Row[];
    console.log("LinUCB arm updates persisted");
    console.table(tables.learning);
  } finally {
    await app.close();
  }

  const out = arg("--csv");
  if (out) {
    writeFileSync(out, toCsv(tables));
    console.log(`CSV written to ${out}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
